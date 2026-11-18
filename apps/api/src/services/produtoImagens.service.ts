export interface ProdutoImagem {
  imageCode: number;
  imageName: string;
  imageDescription: string | null;
  typeImageCode: string | null;
  typeImageName: string | null;
  mimeType: string;
  base64: string;
}

export interface ProdutoImagens {
  productCode: number;
  images: ProdutoImagem[];
}

export class ProdutoImagensError extends Error {
  constructor(message: string, public statusCode = 502) { super(message); }
}

const MB = 1024 * 1024;
const MAX_RESPONSE_BYTES = 12 * MB;
const MAX_CACHE_BYTES = 24 * MB;

async function lerJson(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProdutoImagensError('O TOTVS retornou uma resposta vazia.');
  const partes: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProdutoImagensError('As imagens deste produto excedem o limite de consulta.');
    }
    partes.push(value);
  }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); }
  catch { throw new ProdutoImagensError('O TOTVS retornou uma resposta inválida.'); }
}

function lerImagem(raw: any): ProdutoImagem | null {
  if (!raw.imageFile) return null;
  if (typeof raw.imageFile !== 'string' || !Number.isInteger(raw.imageCode)) {
    throw new ProdutoImagensError('O TOTVS retornou uma imagem inválida.');
  }
  const base64 = raw.imageFile.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, '');
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new ProdutoImagensError('Não foi possível ler a imagem cadastrada no TOTVS.');
  }
  const buffer = Buffer.from(base64, 'base64');
  let mimeType: string;
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mimeType = 'image/jpeg';
  else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = 'image/png';
  else if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) mimeType = 'image/gif';
  else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') mimeType = 'image/webp';
  else if (buffer.subarray(0, 2).toString() === 'BM') mimeType = 'image/bmp';
  else throw new ProdutoImagensError('O formato da imagem cadastrada não permite a visualização.');
  return {
    imageCode: raw.imageCode, imageName: String(raw.imageName || `Imagem ${raw.imageCode}`),
    imageDescription: raw.imageDescription || null,
    typeImageCode: raw.typeImageCode == null ? null : String(raw.typeImageCode),
    typeImageName: raw.typeImageName || null, mimeType, base64,
  };
}

export function criarConsultaProdutoImagens(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = options.fetcher || fetch;
  const now = options.now || Date.now;
  const cache = new Map<number, { data: ProdutoImagens; expires: number; bytes: number }>();
  const pendentes = new Map<number, Promise<ProdutoImagens>>();
  let cacheBytes = 0;
  let token: { value: string; expires: number } | null = null;
  let autenticando: Promise<string> | null = null;

  const baseUrl = () => (process.env.TOTVS_API_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda').replace(/\/$/, '');

  async function autenticar(): Promise<string> {
    if (token && token.expires > now()) return token.value;
    if (autenticando) return autenticando;
    autenticando = (async () => {
      const response = await fetcher(`${baseUrl()}/authorization/v2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password', client_id: process.env.TOTVS_CLIENT_ID || '',
          client_secret: process.env.TOTVS_CLIENT_SECRET || '', username: process.env.TOTVS_USERNAME || '',
          password: process.env.TOTVS_PASSWORD || '',
        }), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProdutoImagensError('Não foi possível autenticar a consulta de imagens no TOTVS.');
      }
      const data = await lerJson(response);
      if (typeof data.access_token !== 'string' || !data.access_token) throw new ProdutoImagensError('Não foi possível autenticar a consulta de imagens no TOTVS.');
      const expiresIn = Number(data.expires_in);
      const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.max(0, expiresIn - 30) * 1000 : 30_000;
      token = { value: data.access_token, expires: now() + ttl };
      return token.value;
    })();
    try { return await autenticando; } finally { autenticando = null; }
  }

  async function consultarTotvs(productCode: number): Promise<ProdutoImagens> {
    const images = new Map<number, ProdutoImagem>();
    let bytes = 0;
    let renovouToken = false;
    const prazo = AbortSignal.timeout(30_000);
    for (let page = 1; page <= 20; page++) {
      let response: Response;
      while (true) {
        const accessToken = await autenticar();
        response = await fetcher(`${baseUrl()}/image/v2/product/search`, {
          method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter: { productCodeList: [productCode] }, page, pageSize: 100 }),
          signal: prazo,
        });
        if (response.status !== 401 || renovouToken) break;
        await response.body?.cancel();
        token = null;
        renovouToken = true;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProdutoImagensError('Não foi possível consultar as imagens no TOTVS. Tente novamente.');
      }
      const data = await lerJson(response);
      if (!Array.isArray(data.items) || typeof data.hasNext !== 'boolean') throw new ProdutoImagensError('O TOTVS retornou uma lista de imagens inválida.');
      for (const item of data.items) {
        if (item.productCode !== productCode || (item.images != null && !Array.isArray(item.images))) {
          throw new ProdutoImagensError('O TOTVS retornou imagens de um produto diferente do solicitado.');
        }
        for (const raw of item.images || []) {
          if (!raw || typeof raw !== 'object') throw new ProdutoImagensError('O TOTVS retornou uma imagem inválida.');
          if (images.has(raw.imageCode)) continue;
          const image = lerImagem(raw);
          if (image) {
            bytes += image.base64.length * 2;
            if (bytes > 16 * MB || images.size >= 100) throw new ProdutoImagensError('As imagens deste produto excedem o limite de consulta.');
            images.set(image.imageCode, image);
          }
        }
      }
      if (!data.hasNext) return { productCode, images: [...images.values()] };
    }
    throw new ProdutoImagensError('Não foi possível concluir a consulta de imagens deste produto.');
  }

  return async function getProdutoImagens(productCode: number): Promise<ProdutoImagens> {
    if (!Number.isInteger(productCode) || productCode <= 0 || productCode > 2147483647) throw new ProdutoImagensError('Código de produto inválido.', 400);
    const cached = cache.get(productCode);
    if (cached) {
      cache.delete(productCode);
      if (cached.expires > now()) { cache.set(productCode, cached); return cached.data; }
      cacheBytes -= cached.bytes;
    }
    const pendente = pendentes.get(productCode);
    if (pendente) return pendente;
    if (pendentes.size >= 4) throw new ProdutoImagensError('Há outras consultas de fotos em andamento. Tente novamente em instantes.', 503);
    const promise = (async () => {
      try {
        const data = await consultarTotvs(productCode);
        const bytes = JSON.stringify(data).length * 2;
        if (bytes <= MAX_CACHE_BYTES) {
          while (cache.size && (cacheBytes + bytes > MAX_CACHE_BYTES || cache.size >= 100)) {
            const key = cache.keys().next().value!;
            cacheBytes -= cache.get(key)!.bytes;
            cache.delete(key);
          }
          cache.set(productCode, { data, bytes, expires: now() + (data.images.length ? 24 * 60 * 60_000 : 5 * 60_000) });
          cacheBytes += bytes;
        }
        return data;
      } catch (error) {
        if (error instanceof ProdutoImagensError) throw error;
        throw new ProdutoImagensError('Não foi possível carregar as fotos no momento. Tente novamente.', 502);
      } finally { pendentes.delete(productCode); }
    })();
    pendentes.set(productCode, promise);
    return promise;
  };
}

export const getProdutoImagens = criarConsultaProdutoImagens();
