import https from 'https';

const API_BASE_URL = process.env.TOTVS_API_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

// Cache de vendedores
let vendedoresCache: Map<number, string> = new Map();
let vendedoresCacheTime: Date | null = null;

// Agent que ignora SSL (necessário para API TOTVS)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

async function getApiToken(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/authorization/v2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: process.env.TOTVS_CLIENT_ID || '',
        client_secret: process.env.TOTVS_CLIENT_SECRET || '',
        username: process.env.TOTVS_USERNAME || '',
        password: process.env.TOTVS_PASSWORD || '',
      }),
      // @ts-ignore - Node.js fetch suporta agent
      agent: httpsAgent,
    });

    if (response.ok) {
      const data = await response.json();
      return data.access_token;
    }
    return null;
  } catch (error) {
    console.error('Erro ao obter token TOTVS:', error);
    return null;
  }
}

export async function getVendedoresApi(): Promise<Map<number, string>> {
  // Verificar cache (1 hora)
  const now = new Date();
  if (vendedoresCache.size > 0 && vendedoresCacheTime) {
    const diffMs = now.getTime() - vendedoresCacheTime.getTime();
    if (diffMs < 3600000) { // 1 hora em ms
      return vendedoresCache;
    }
  }

  try {
    const token = await getApiToken();
    if (!token) {
      return vendedoresCache.size > 0 ? vendedoresCache : new Map();
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    vendedoresCache = new Map();

    // Buscar vendedores ativos e inativos de todas as filiais
    for (const isInactive of [false, true]) {
      let page = 1;
      while (page <= 10) {
        const body = {
          filter: {
            branchCodeList: [1, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 17],
            isInactive,
          },
          page,
          pageSize: 200,
        };

        const response = await fetch(`${API_BASE_URL}/seller/v2/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          // @ts-ignore
          agent: httpsAgent,
        });

        if (response.ok) {
          const data = await response.json();
          const items = data.items || [];

          for (const item of items) {
            const code = item.sellerCode || item.code;
            const name = item.name || item.sellerName;
            if (code && name) {
              vendedoresCache.set(code, name);
            }
          }

          if (!data.hasNext) break;
          page++;
        } else {
          break;
        }
      }
    }

    vendedoresCacheTime = now;
    console.log(`[CACHE] ${vendedoresCache.size} vendedores carregados da API TOTVS`);
    return vendedoresCache;
  } catch (error) {
    console.error('Erro ao buscar vendedores da API:', error);
    return vendedoresCache.size > 0 ? vendedoresCache : new Map();
  }
}

export function getVendedorNome(code: number): string {
  return vendedoresCache.get(code) || `Vendedor ${code}`;
}
