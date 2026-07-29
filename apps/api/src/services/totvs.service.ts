import https from 'https';
import { Prisma } from '@prisma/client';
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

// Filiais reais consideradas pelo Relatorio Base do PCP (mesma lista de
// apps/pcp-api/src/config/constants.ts, exceto o sentinel Atacado) - custo/preco so
// precisa ser sincronizado pra essas.
const FILIAIS_RELATORIO_BASE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 17];

// Codigos de custo e preco confirmados testando costCode/priceCode 1-20 direto na API
// (ela responde 400 PRA CHAMADA INTEIRA se algum codigo da lista nao existir, entao
// diferente de operation_code isso nao pode usar uma faixa "generosa" - so os
// confirmados). Se o TOTVS criar codigo novo, precisa atualizar essa lista na mao.
const COST_CODES_TENTATIVA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const PRICE_CODES_TENTATIVA = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// Fragmentos de classificacao duplicados de vendas.service.ts (mesmo app, duplicado por
// simplicidade em vez de exportar de um arquivo ja bem sensivel/testado) - so pra achar
// o universo de product_code relevante, nao pra calculo financeiro.
const OPERACAO_JOIN = Prisma.sql`LEFT JOIN classificacao_operacoes co ON co.operation_code = t.operation_code`;
const IS_VENDA = Prisma.sql`(co.operations_type = 'S' AND co.operation_mode = '4')`;
const IS_DEVOLUCAO = Prisma.sql`(co.operations_type = 'E' AND co.operation_mode = '3')`;
const SALE_OPERATION_FILTER = Prisma.sql`(${IS_VENDA} OR ${IS_DEVOLUCAO})`;

// Universo de product_code que realmente aparece no Relatorio Base do PCP (mesmo
// criterio de apps/pcp-api/src/services/relatorioBase.service.ts: estoque atual > 0 OU
// giro de rede nos ultimos 6 meses > 0) - sincronizar custo/preco so desses em vez do
// catalogo INTEIRO do TOTVS (66 mil+ produtos, a maioria embalagem/materia-prima/
// descontinuado que nunca aparece no relatorio) reduz o tempo de sync em ~9x.
async function getProductCodesRelevantes(): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ product_code: number }>>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_code, stock
      FROM prd_saldo
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    ),
    estoque AS (
      SELECT product_code, SUM(COALESCE(stock, 0)) AS est_tt
      FROM ultimo_saldo
      WHERE product_code IS NOT NULL
      GROUP BY product_code
    ),
    giro6 AS (
      SELECT ti.product_code, SUM(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(ti.quantity) ELSE ti.quantity END) AS giro
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
      ${OPERACAO_JOIN}
      WHERE t.transaction_date >= CURRENT_DATE - INTERVAL '6 months'
        AND t.status = 4 AND ${SALE_OPERATION_FILTER}
      GROUP BY ti.product_code
    )
    SELECT product_code FROM estoque WHERE est_tt > 0
    UNION
    SELECT product_code FROM giro6 WHERE giro > 0
  `;
  return rows.map((r) => r.product_code).filter((c): c is number => c !== null);
}

interface SyncCustoPrecoResumo {
  produtos: number;
  linhas: number;
  codigosAtivos: { code: number; name: string }[];
}

// Sincroniza custo OU preco (mesmo formato de chamada e resposta na API do TOTVS,
// so muda o endpoint e os nomes dos campos) - product/v2/costs/search ou
// product/v2/prices/search. So os produtos passados em productCodes (universo do
// Relatorio Base do PCP, nao o catalogo inteiro do TOTVS), paginado, pras filiais +
// codigos passados, e grava tudo no cache proprio (produto_custos ou produto_precos) -
// o usuario escolhe depois, no Configurador do PCP, qual codigo usar em cada contexto
// (custo, PDV varejo, PDV atacado).
async function syncCustoOuPreco(
  tipo: 'custo' | 'preco',
  branches: number[],
  codigosTentativa: number[],
  productCodes: number[]
): Promise<SyncCustoPrecoResumo> {
  if (productCodes.length === 0) {
    return { produtos: 0, linhas: 0, codigosAtivos: [] };
  }

  const endpoint = tipo === 'custo' ? 'costs' : 'prices';
  const optionKey = tipo === 'custo' ? 'costs' : 'prices';
  const codeListKey = tipo === 'custo' ? 'costCodeList' : 'priceCodeList';

  const option = {
    [optionKey]: branches.map((branchCode) => ({ branchCode, [codeListKey]: codigosTentativa })),
  };

  const codigosAtivos = new Map<number, string>();
  const produtosVistos = new Set<number>();
  let linhas = 0;

  // pageSize baixo de proposito: com 13 filiais x ate 15 codigos por produto, o TOTVS
  // demora bastante pra montar a resposta (testado: pageSize=1000/200 estoura o gateway
  // deles com 502 depois de ~75-110s; pageSize=100 fica dentro do limite). Sequencial
  // (nao paralelo) porque testamos requests concorrentes e o tempo de cada uma piora
  // muito (contencao do lado do TOTVS), aumentando o risco de 502 em vez de acelerar.
  const PAGE_SIZE = 100;
  const MAX_TENTATIVAS = 4;
  // O TOTVS rejeita com HTTP 400 (ListExceeded) se filter.productCodeList passar de 900
  // itens - testado ao vivo. Divide o universo de produtos relevantes em lotes de 900,
  // cada lote com sua propria paginacao completa.
  const PRODUCT_CODE_CHUNK = 900;

  for (let chunkStart = 0; chunkStart < productCodes.length; chunkStart += PRODUCT_CODE_CHUNK) {
  const filter = { productCodeList: productCodes.slice(chunkStart, chunkStart + PRODUCT_CODE_CHUNK) };
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    let response: Response | null = null;
    let ultimoErro = '';
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        // Token TOTVS buscado de novo a cada pagina - o catalogo inteiro leva horas pra
        // sincronizar (medido: ~30s/pagina de 100 produtos, ~670 paginas), tempo maior
        // que a validade tipica de um token OAuth, entao nao da pra buscar uma vez so
        // no inicio e reusar.
        const token = await getApiToken();
        if (!token) throw new Error('Nao foi possivel autenticar na API TOTVS');
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

        const tentativaResponse = await fetch(`${API_BASE_URL}/product/v2/${endpoint}/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ filter, option, page, pageSize: PAGE_SIZE }),
          // @ts-ignore
          agent: httpsAgent,
        });
        if (tentativaResponse.ok) {
          response = tentativaResponse;
          break;
        }
        ultimoErro = `HTTP ${tentativaResponse.status} ${(await tentativaResponse.text().catch(() => '')).slice(0, 200)}`;
      } catch (error) {
        ultimoErro = error instanceof Error ? error.message : String(error);
      }
      // Backoff simples - 502 do gateway TOTVS costuma ser transitorio (timeout de
      // processamento do lado deles, nao erro permanente).
      if (tentativa < MAX_TENTATIVAS) await new Promise((r) => setTimeout(r, tentativa * 3000));
    }

    if (!response) {
      throw new Error(`Erro ao sincronizar ${tipo} do TOTVS (pagina ${page}) apos ${MAX_TENTATIVAS} tentativas: ${ultimoErro}`);
    }

    const data = (await response.json()) as {
      hasNext?: boolean;
      items?: Array<{
        productCode: number;
        costs?: Array<{ branchCode: number; costCode: number; costName?: string; cost: number }>;
        prices?: Array<{ branchCode: number; priceCode: number; priceName?: string; price: number }>;
      }>;
    };

    // Junta todas as linhas da pagina pra gravar em UM INSERT so (upsert linha a linha
    // seria ~1,6 milhao de round-trips pro banco no catalogo inteiro - inviavel).
    const linhasPagina: { productCode: number; branchCode: number; code: number; name: string | null; valor: number }[] = [];

    for (const item of data.items || []) {
      if (item.productCode == null) continue;
      produtosVistos.add(item.productCode);

      const entradas = tipo === 'custo' ? item.costs || [] : item.prices || [];
      for (const entrada of entradas) {
        const code = tipo === 'custo' ? (entrada as any).costCode : (entrada as any).priceCode;
        const name = tipo === 'custo' ? (entrada as any).costName : (entrada as any).priceName;
        const valor = tipo === 'custo' ? (entrada as any).cost : (entrada as any).price;
        if (code == null || valor == null) continue;
        codigosAtivos.set(code, name || `Codigo ${code}`);
        linhasPagina.push({ productCode: item.productCode, branchCode: entrada.branchCode, code, name: name ?? null, valor });
      }
    }

    // Lotes de 2000 linhas por INSERT (6 colunas x 2000 = 12000 parametros, bem abaixo
    // do limite de 65535 do Postgres por query - 15000 linhas numa pagina cheia
    // estourariam o limite se fosse tudo num INSERT so).
    for (let i = 0; i < linhasPagina.length; i += 2000) {
      const lote = linhasPagina.slice(i, i + 2000);
      if (tipo === 'custo') {
        await prisma.$executeRaw`
          INSERT INTO produto_custos (product_code, branch_code, cost_code, cost_name, valor, synced_at)
          VALUES ${Prisma.join(
            lote.map((l) => Prisma.sql`(${l.productCode}, ${l.branchCode}, ${l.code}, ${l.name}, ${l.valor}, now())`)
          )}
          ON CONFLICT (product_code, branch_code, cost_code)
          DO UPDATE SET cost_name = EXCLUDED.cost_name, valor = EXCLUDED.valor, synced_at = now()
        `;
      } else {
        await prisma.$executeRaw`
          INSERT INTO produto_precos (product_code, branch_code, price_code, price_name, valor, synced_at)
          VALUES ${Prisma.join(
            lote.map((l) => Prisma.sql`(${l.productCode}, ${l.branchCode}, ${l.code}, ${l.name}, ${l.valor}, now())`)
          )}
          ON CONFLICT (product_code, branch_code, price_code)
          DO UPDATE SET price_name = EXCLUDED.price_name, valor = EXCLUDED.valor, synced_at = now()
        `;
      }
    }
    linhas += linhasPagina.length;

    hasNext = !!data.hasNext;
    page++;
  }
  }

  return {
    produtos: produtosVistos.size,
    linhas,
    codigosAtivos: [...codigosAtivos.entries()].map(([code, name]) => ({ code, name })),
  };
}

// Busca o universo de product_code relevante UMA vez so e sincroniza custo + preco em
// paralelo pra esse universo - evita recalcular a mesma query duas vezes (custo e preco
// sincronizam produtos identicos).
export async function syncCustosEPrecos(): Promise<{ custos: SyncCustoPrecoResumo; precos: SyncCustoPrecoResumo }> {
  const productCodes = await getProductCodesRelevantes();
  const [custos, precos] = await Promise.all([
    syncCustoOuPreco('custo', FILIAIS_RELATORIO_BASE, COST_CODES_TENTATIVA, productCodes),
    syncCustoOuPreco('preco', FILIAIS_RELATORIO_BASE, PRICE_CODES_TENTATIVA, productCodes),
  ]);
  return { custos, precos };
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
