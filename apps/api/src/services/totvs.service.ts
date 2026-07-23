import https from 'https';
import { prisma } from '../config/database.js';

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
      const data = await response.json() as { access_token?: string };
      return data.access_token || null;
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
          const data = await response.json() as { items?: Array<{ sellerCode?: number; code?: number; name?: string; sellerName?: string }>; hasNext?: boolean };
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

// Busca a classificacao real (operationsType/operationMode) direto na API do TOTVS
// (general/v2/operations) pros codigos passados, e grava no cache proprio
// (classificacao_operacoes) - usado pelo calculo de faturamento em vez de manter
// lista de codigo fixa na mao, que fica desatualizada toda vez que o TOTVS cria
// operacao nova.
export async function syncClassificacaoOperacoes(operationCodes: number[]): Promise<number> {
  if (operationCodes.length === 0) return 0;

  const token = await getApiToken();
  if (!token) throw new Error('Nao foi possivel autenticar na API TOTVS');

  const headers = { Authorization: `Bearer ${token}` };
  let atualizados = 0;

  // A API aceita OperationCodeList repetido na query, mas o servidor rejeita URL muito
  // longa (404 acima de ~5700 caracteres, testado) - lotes pequenos evitam isso.
  for (let i = 0; i < operationCodes.length; i += 50) {
    const lote = operationCodes.slice(i, i + 50);
    const qs = lote.map((c) => `OperationCodeList=${c}`).join('&');

    const response = await fetch(`${API_BASE_URL}/general/v2/operations?${qs}&PageSize=1000`, {
      method: 'GET',
      headers,
      // @ts-ignore
      agent: httpsAgent,
    });

    if (!response.ok) continue;

    const data = (await response.json()) as {
      items?: Array<{
        operationCode: number;
        description?: string;
        isFinancial?: boolean;
        invoiceData?: { operationsType?: string; operationMode?: string };
      }>;
    };

    for (const item of data.items || []) {
      await prisma.classificacaoOperacao.upsert({
        where: { operationCode: item.operationCode },
        create: {
          operationCode: item.operationCode,
          description: item.description,
          isFinancial: item.isFinancial ?? null,
          operationsType: item.invoiceData?.operationsType,
          operationMode: item.invoiceData?.operationMode,
        },
        update: {
          description: item.description,
          isFinancial: item.isFinancial ?? null,
          operationsType: item.invoiceData?.operationsType,
          operationMode: item.invoiceData?.operationMode,
        },
      });
      atualizados++;
    }
  }

  return atualizados;
}
