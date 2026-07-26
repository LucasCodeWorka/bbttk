import https from 'https';
import { prisma } from '../config/database.js';

const API_BASE_URL = process.env.TOTVS_API_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

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

// Checa se apareceu algum operation_code novo (sem classificacao ainda) e sincroniza
// sozinho - chamado no inicio das queries de faturamento mais usadas, pra pegar
// operacao nova do TOTVS sem precisar de acao manual. So bate no banco uma vez a cada
// 10 min (o resto do tempo so olha o relogio em memoria) e so chama a API do TOTVS
// quando realmente acha codigo novo, que deve ser raro.
let ultimaChecagemClassificacao: Date | null = null;
const INTERVALO_CHECAGEM_MS = 10 * 60 * 1000;

export async function garantirClassificacaoAtualizada(): Promise<void> {
  const agora = new Date();
  if (ultimaChecagemClassificacao && agora.getTime() - ultimaChecagemClassificacao.getTime() < INTERVALO_CHECAGEM_MS) {
    return;
  }
  ultimaChecagemClassificacao = agora;

  try {
    const novos = await prisma.$queryRaw<Array<{ operation_code: number }>>`
      SELECT DISTINCT t.operation_code
      FROM transacoes t
      LEFT JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
      WHERE t.operation_code IS NOT NULL AND co.operation_code IS NULL
    `;
    if (novos.length > 0) {
      console.log(`[classificacao_operacoes] ${novos.length} operation_code(s) novo(s) encontrado(s), sincronizando com o TOTVS...`);
      await syncClassificacaoOperacoes(novos.map((n) => n.operation_code));
    }
  } catch (error) {
    // Nao deixa a checagem quebrar a tela por causa disso - so loga e segue
    console.error('Erro ao checar classificacao de operacoes novas:', error);
  }
}
