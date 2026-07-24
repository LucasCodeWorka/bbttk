import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';
import { FILIAIS, EXCLUDED_BRANCH_CODES } from '../config/constants.js';
import { Decimal } from '@prisma/client/runtime/library';
import * as metasService from './metas.service.js';

const EXCLUDED_BRANCH_LIST = [...EXCLUDED_BRANCH_CODES];

// Classificacao de operacao vem do cache local (classificacao_operacoes, sincronizado
// direto de general/v2/operations na API do TOTVS) em vez de lista de operation_code
// fixa na mao. O TOTVS ja criou operacao nova (compra, consignacao, remessa, brinde)
// varias vezes sem avisar, e cada vez que isso acontece ela cai silenciosamente como
// "venda" ate alguem desconfiar de um numero errado - ja causou faturamento inflado
// mais de uma vez. O que caracteriza uma venda de verdade NUNCA e o operation_code em
// si (o TOTVS pode criar/aposentar codigo a qualquer momento) - e sempre a combinacao
// invoiceData.operationsType='S' + operationMode='4'. Devolucao e sempre 'E'+'3'.
// Operacao sem classificacao no cache (nunca sincronizada) fica de fora por padrao -
// mais seguro errar excluindo um codigo novo do que inflar faturamento silenciosamente
// (que era exatamente o comportamento antigo).
const OPERACAO_JOIN = Prisma.sql`LEFT JOIN classificacao_operacoes co ON co.operation_code = t.operation_code`;
const IS_VENDA = Prisma.sql`(co.operations_type = 'S' AND co.operation_mode = '4')`;
const IS_DEVOLUCAO = Prisma.sql`(co.operations_type = 'E' AND co.operation_mode = '3')`;

// Clientes com customer_code >= 110000000 são contas internas do TOTVS (transferência entre
// filiais, ajuste de estoque, amostra, perda, etc.) - nunca um cliente real. Sem esse filtro,
// esses movimentos entram como faturamento de verdade (bug real: ~59 mil transações / R$21,6mi
// inflados no historico, descoberto batendo o Dashboard contra o relatorio nativo do TOTVS).
const REAL_CUSTOMER_FILTER = Prisma.sql`(t.customer_code IS NULL OR t.customer_code < 110000000)`;
// Filtro reutilizado: transação não cancelada, operação de venda-ou-devolução real,
// cliente real. Inclui devoluções (entram com sinal negativo via FATURAMENTO_COM_SINAL/
// PECAS_COM_SINAL, não são excluídas) - qualquer outra classificação (compra, consignação,
// remessa, brinde, ou operação nunca sincronizada) já fica fora daqui.
const SALE_OPERATION_FILTER = Prisma.sql`((${IS_VENDA} OR ${IS_DEVOLUCAO}) AND ${REAL_CUSTOMER_FILTER})`;
// O ETL grava net_value/quantity de devolução com o sinal que o TOTVS mandou - às vezes
// positivo, às vezes já negativo, inconsistente (confirmado em todo o historico, todas as
// filiais). Um "* -1" simples inverteria de volta pra positivo quando já vinha negativo,
// cancelando a devolução em vez de subtrair (bug real: ~R$11,27mi inflados no historico
// inteiro). ABS() normaliza pro valor absoluto antes de aplicar o sinal negativo, entao
// funciona certo independente de como o dado chegou do ETL. SALE_OPERATION_FILTER já
// garante que só sobra venda ou devolução aqui, então o ELSE é sempre venda.
const FATURAMENTO_COM_SINAL = Prisma.sql`(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(ti.net_value) ELSE ti.net_value END)`;
const PECAS_COM_SINAL = Prisma.sql`(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(ti.quantity) ELSE ti.quantity END)`;
// Só conta como "venda" (transação/cliente) quando não é devolução
const IS_SALE = IS_VENDA;
// Filtro reutilizado: filial de venda (exclui filiais em EXCLUDED_BRANCH_CODES, se houver)
const STORE_BRANCH_FILTER = EXCLUDED_BRANCH_LIST.length > 0
  ? Prisma.sql`t.branch_code NOT IN (${Prisma.join(EXCLUDED_BRANCH_LIST)})`
  : Prisma.sql`TRUE`;

interface VendasFilial {
  branch_code: number;
  branch_name: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
  pa: number;
  tm: number;
  clientes: number;
  pm: number;
  tm_cliente: number;
  pac: number;
}

interface VendasDiarias {
  data: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
}

interface VendasVendedor {
  seller_code: number;
  seller_name?: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
  pa: number;
  tm: number;
}

interface VendasVendedorFilial {
  seller_code: number;
  seller_name?: string;
  branch_code: number;
  transacoes: number;
  pecas: number;
  faturamento: number;
  pa: number;
  tm: number;
}

interface Produto {
  referencia: string;
  nome: string;
  quantidade: number;
  valor: number;
}

// Helpers
function decimalToNumber(value: Decimal | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Filtro de filiais reutilizado: aceita uma ou varias (undefined/vazio = todas)
function buildBranchFilter(branchCodes?: number[]) {
  if (!branchCodes || branchCodes.length === 0) return Prisma.empty;
  return Prisma.sql`AND t.branch_code IN (${Prisma.join(branchCodes)})`;
}

// Filtro por classificacao de produto (categoria, genero, status, linha,
// colecao, tecido) - vem da tabela `produto_analitico`, sincronizada pelo ETL
// com as classificacoes cadastradas no ERP. Cada dimensao aceita varios valores
// (OR entre valores da mesma dimensao, AND entre dimensoes diferentes).
export interface ProdutoFiltro {
  categoria?: string[];
  genero?: string[];
  status?: string[];
  linha?: string[];
  colecao?: string[];
  tecido?: string[];
}

const CLASSIFICACAO_COLUNAS: Record<keyof ProdutoFiltro, string> = {
  categoria: 'class_categoria',
  genero: 'class_genero',
  status: 'class_status',
  linha: 'class_linha',
  colecao: 'class_colecao',
  tecido: 'class_tecido',
};

function temFiltroProduto(filtro?: ProdutoFiltro): boolean {
  if (!filtro) return false;
  return Object.values(filtro).some((v) => v && v.length > 0);
}

// JOIN sempre em LEFT - sem filtro ativo, nao muda nada nas linhas retornadas.
const PRODUTO_ANALITICO_JOIN = Prisma.sql`LEFT JOIN produto_analitico pa ON pa.product_code = ti.product_code`;

function buildProdutoFilter(filtro?: ProdutoFiltro): Prisma.Sql {
  if (!temFiltroProduto(filtro)) return Prisma.empty;
  const condicoes: Prisma.Sql[] = [];
  for (const chave of Object.keys(CLASSIFICACAO_COLUNAS) as (keyof ProdutoFiltro)[]) {
    const valores = filtro![chave];
    if (valores && valores.length > 0) {
      condicoes.push(Prisma.sql`TRIM(pa.${Prisma.raw(CLASSIFICACAO_COLUNAS[chave])}) IN (${Prisma.join(valores)})`);
    }
  }
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

// Vendas por período (por filial de venda, exclui Fábrica e devoluções)
export async function getVendasPeriodo(
  startDate: Date,
  endDate: Date,
  branchCodes?: number[],
  produtoFiltro?: ProdutoFiltro
): Promise<VendasFilial[]> {
  const branchFilter = buildBranchFilter(branchCodes);
  const produtoFilter = buildProdutoFilter(produtoFiltro);

  const results = await prisma.$queryRaw<Array<{
    branch_code: number;
    branch_name: string;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
    clientes: bigint;
  }>>`
    SELECT
      t.branch_code,
      t.branch_name,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN t.transaction_code END) as transacoes,
      COALESCE(SUM(${PECAS_COM_SINAL}), 0) as pecas,
      COALESCE(SUM(${FATURAMENTO_COM_SINAL}), 0) as faturamento,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN t.customer_code END) as clientes
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    ${PRODUTO_ANALITICO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
      ${produtoFilter}
    GROUP BY t.branch_code, t.branch_name
    ORDER BY faturamento DESC
  `;

  return results.map(row => {
    const transacoes = Number(row.transacoes);
    const pecas = decimalToNumber(row.pecas);
    const faturamento = decimalToNumber(row.faturamento);
    const clientes = Number(row.clientes);

    return {
      branch_code: row.branch_code,
      branch_name: row.branch_name || FILIAIS[row.branch_code] || `Filial ${row.branch_code}`,
      transacoes,
      pecas: Math.round(pecas),
      faturamento: round(faturamento),
      pa: transacoes > 0 ? round(pecas / transacoes) : 0,
      tm: transacoes > 0 ? round(faturamento / transacoes) : 0,
      clientes,
      pm: pecas > 0 ? round(faturamento / pecas) : 0,
      tm_cliente: clientes > 0 ? round(faturamento / clientes) : 0,
      pac: clientes > 0 ? round(pecas / clientes) : 0,
    };
  });
}

// Vendas diárias (por filial de venda, exclui Fábrica e devoluções)
export async function getVendasDiarias(
  startDate: Date,
  endDate: Date,
  branchCodes?: number[],
  produtoFiltro?: ProdutoFiltro
): Promise<VendasDiarias[]> {
  const branchFilter = buildBranchFilter(branchCodes);
  const produtoFilter = buildProdutoFilter(produtoFiltro);

  const results = await prisma.$queryRaw<Array<{
    data: Date;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
  }>>`
    SELECT
      t.transaction_date as data,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN t.transaction_code END) as transacoes,
      COALESCE(SUM(${PECAS_COM_SINAL}), 0) as pecas,
      COALESCE(SUM(${FATURAMENTO_COM_SINAL}), 0) as faturamento
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    ${PRODUTO_ANALITICO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
      ${produtoFilter}
    GROUP BY t.transaction_date
    ORDER BY t.transaction_date
  `;

  return results.map(row => ({
    data: row.data.toISOString().split('T')[0],
    transacoes: Number(row.transacoes),
    pecas: Math.round(decimalToNumber(row.pecas)),
    faturamento: round(decimalToNumber(row.faturamento)),
  }));
}

// Vendas mensais (mesmo formato de getVendasDiarias, mas agregado por mes -
// usado quando o periodo filtrado passa de 1 mes, pra nao poluir o grafico com dias)
export async function getVendasMensais(
  startDate: Date,
  endDate: Date,
  branchCodes?: number[],
  produtoFiltro?: ProdutoFiltro
): Promise<VendasDiarias[]> {
  const branchFilter = buildBranchFilter(branchCodes);
  const produtoFilter = buildProdutoFilter(produtoFiltro);

  const results = await prisma.$queryRaw<Array<{
    mes: Date;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
  }>>`
    SELECT
      DATE_TRUNC('month', t.transaction_date) as mes,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN t.transaction_code END) as transacoes,
      COALESCE(SUM(${PECAS_COM_SINAL}), 0) as pecas,
      COALESCE(SUM(${FATURAMENTO_COM_SINAL}), 0) as faturamento
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    ${PRODUTO_ANALITICO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
      ${produtoFilter}
    GROUP BY DATE_TRUNC('month', t.transaction_date)
    ORDER BY mes
  `;

  return results.map(row => ({
    data: row.mes.toISOString().split('T')[0],
    transacoes: Number(row.transacoes),
    pecas: Math.round(decimalToNumber(row.pecas)),
    faturamento: round(decimalToNumber(row.faturamento)),
  }));
}

// Vendas por vendedor
export async function getVendasVendedor(
  startDate: Date,
  endDate: Date,
  branchCodes?: number[],
  produtoFiltro?: ProdutoFiltro
): Promise<VendasVendedor[]> {
  const branchFilter = buildBranchFilter(branchCodes);
  const produtoFilter = buildProdutoFilter(produtoFiltro);

  const results = await prisma.$queryRaw<Array<{
    seller_code: number;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
  }>>`
    SELECT
      ti.seller_code,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN (ti.branch_code, ti.transaction_code) END) as transacoes,
      SUM(${PECAS_COM_SINAL}) as pecas,
      SUM(${FATURAMENTO_COM_SINAL}) as faturamento
    FROM transacao_itens ti
    JOIN transacoes t ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
    ${OPERACAO_JOIN}
    ${PRODUTO_ANALITICO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ti.seller_code != 1
      AND ti.seller_code IS NOT NULL
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
      ${produtoFilter}
    GROUP BY ti.seller_code
    ORDER BY faturamento DESC
  `;

  return results.map(row => {
    const transacoes = Number(row.transacoes);
    const pecas = decimalToNumber(row.pecas);
    const faturamento = decimalToNumber(row.faturamento);

    return {
      seller_code: row.seller_code,
      transacoes,
      pecas: Math.round(pecas),
      faturamento: round(faturamento),
      pa: transacoes > 0 ? round(pecas / transacoes) : 0,
      tm: transacoes > 0 ? round(faturamento / transacoes) : 0,
    };
  });
}

// Vendas por vendedor, quebrado por filial (matriz vendedor x loja) - usado pela tela de
// Comissoes pra deixar explicito de qual(is) loja(s) cada vendedor e, ja que um vendedor
// pode vender em mais de uma filial no mesmo mes.
export async function getVendasVendedorPorFilial(
  startDate: Date,
  endDate: Date,
  branchCodes?: number[]
): Promise<VendasVendedorFilial[]> {
  const branchFilter = buildBranchFilter(branchCodes);

  const results = await prisma.$queryRaw<Array<{
    seller_code: number;
    branch_code: number;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
  }>>`
    SELECT
      ti.seller_code,
      ti.branch_code,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN (ti.branch_code, ti.transaction_code) END) as transacoes,
      SUM(${PECAS_COM_SINAL}) as pecas,
      SUM(${FATURAMENTO_COM_SINAL}) as faturamento
    FROM transacao_itens ti
    JOIN transacoes t ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
    ${OPERACAO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ti.seller_code != 1
      AND ti.seller_code IS NOT NULL
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
    GROUP BY ti.seller_code, ti.branch_code
    ORDER BY ti.seller_code, faturamento DESC
  `;

  return results.map(row => {
    const transacoes = Number(row.transacoes);
    const pecas = decimalToNumber(row.pecas);
    const faturamento = decimalToNumber(row.faturamento);

    return {
      seller_code: row.seller_code,
      branch_code: row.branch_code,
      transacoes,
      pecas: Math.round(pecas),
      faturamento: round(faturamento),
      pa: transacoes > 0 ? round(pecas / transacoes) : 0,
      tm: transacoes > 0 ? round(faturamento / transacoes) : 0,
    };
  });
}

// Top produtos
export async function getTopProdutos(
  startDate: Date,
  endDate: Date,
  branchCodes?: number[],
  limit: number = 10,
  produtoFiltro?: ProdutoFiltro
): Promise<Produto[]> {
  const branchFilter = buildBranchFilter(branchCodes);
  const produtoFilter = buildProdutoFilter(produtoFiltro);

  const results = await prisma.$queryRaw<Array<{
    referencia: string;
    nome: string;
    quantidade: Decimal;
    valor: Decimal;
  }>>`
    SELECT
      COALESCE(p.reference_code, ti.product_code::text) as referencia,
      COALESCE(p.reference_name, p.product_name, 'Produto ' || ti.product_code) as nome,
      SUM(${PECAS_COM_SINAL}) as quantidade,
      SUM(${FATURAMENTO_COM_SINAL}) as valor
    FROM transacao_itens ti
    JOIN transacoes t ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
    LEFT JOIN produtos p ON p.product_code = ti.product_code
    ${OPERACAO_JOIN}
    ${PRODUTO_ANALITICO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ti.seller_code != 1
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
      ${produtoFilter}
    GROUP BY COALESCE(p.reference_code, ti.product_code::text),
             COALESCE(p.reference_name, p.product_name, 'Produto ' || ti.product_code)
    ORDER BY valor DESC
    LIMIT ${limit}
  `;

  return results.map(row => ({
    referencia: row.referencia,
    nome: row.nome,
    quantidade: Math.round(decimalToNumber(row.quantidade)),
    valor: round(decimalToNumber(row.valor)),
  }));
}

// Devoluções por filial (operações com operationsType='E' e operationMode='3' no TOTVS)
export async function getDevolucoesPorFilial(
  startDate: Date,
  endDate: Date,
  produtoFiltro?: ProdutoFiltro
): Promise<Map<number, { valor: number; qtde: number }>> {
  const produtoFilter = buildProdutoFilter(produtoFiltro);

  const results = await prisma.$queryRaw<Array<{
    branch_code: number;
    qtde_dev: bigint;
    valor_dev: Decimal;
  }>>`
    SELECT
      t.branch_code,
      COUNT(DISTINCT t.transaction_code) as qtde_dev,
      COALESCE(SUM(ABS(ti.net_value)), 0) as valor_dev
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    ${PRODUTO_ANALITICO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ${IS_DEVOLUCAO}
      AND ${STORE_BRANCH_FILTER}
      AND ${REAL_CUSTOMER_FILTER}
      ${produtoFilter}
    GROUP BY t.branch_code
  `;

  const map = new Map<number, { valor: number; qtde: number }>();
  for (const row of results) {
    map.set(row.branch_code, {
      valor: round(decimalToNumber(row.valor_dev)),
      qtde: Number(row.qtde_dev),
    });
  }
  return map;
}

// Clientes novos por filial: customer_code cuja primeira compra válida (em toda a história)
// cai dentro do período. Faturamento CN = receita desses clientes no período, na filial onde compraram.
export async function getClientesNovosPorFilial(
  startDate: Date,
  endDate: Date,
  produtoFiltro?: ProdutoFiltro
): Promise<Map<number, { qtde: number; faturamento: number }>> {
  const produtoFilter = buildProdutoFilter(produtoFiltro);

  const results = await prisma.$queryRaw<Array<{
    branch_code: number;
    clientes_novos: bigint;
    faturamento_cn: Decimal;
  }>>`
    WITH primeira_compra AS (
      SELECT t.customer_code, MIN(t.transaction_date) as primeira_data
      FROM transacoes t
      ${OPERACAO_JOIN}
      WHERE t.customer_code IS NOT NULL
        AND t.status = 4
        AND ${SALE_OPERATION_FILTER}
        AND ${IS_SALE}
        AND ${STORE_BRANCH_FILTER}
      GROUP BY t.customer_code
    ),
    novos AS (
      SELECT customer_code FROM primeira_compra
      WHERE primeira_data BETWEEN ${startDate} AND ${endDate}
    )
    SELECT
      t.branch_code,
      COUNT(DISTINCT t.customer_code) as clientes_novos,
      COALESCE(SUM(${FATURAMENTO_COM_SINAL}), 0) as faturamento_cn
    FROM transacoes t
    JOIN novos n ON n.customer_code = t.customer_code
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    ${PRODUTO_ANALITICO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${produtoFilter}
    GROUP BY t.branch_code
  `;

  const map = new Map<number, { qtde: number; faturamento: number }>();
  for (const row of results) {
    map.set(row.branch_code, {
      qtde: Number(row.clientes_novos),
      faturamento: round(decimalToNumber(row.faturamento_cn)),
    });
  }
  return map;
}

// Todo operation_code distinto ja visto no historico - usado pra sincronizar a
// classificacao (classificacao_operacoes) direto da API do TOTVS.
export async function getTodosOperationCodes(): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ operation_code: number }>>`
    SELECT DISTINCT operation_code FROM transacoes WHERE operation_code IS NOT NULL
  `;
  return rows.map((r) => r.operation_code);
}

// Faturamento por canal (Varejo x Atacado) - Atacado NAO e definido por filial (a
// Fabrica/branch 2 vende Atacado, mas tambem Varejo/Delivery dentro da mesma filial,
// e contava tudo como Atacado por engano). O sinal de canal vem da descricao da
// operacao classificada (ex: "800 - VENDA ATACADO (FABRICA)", "802 - DEVOLUCAO VENDA
// ATACADO (FABRICA)") em vez de um operation_code fixo, pelo mesmo motivo de sempre:
// o TOTVS pode criar/trocar o codigo, a descricao e o sinal mais estavel.
export async function getVendasPorCanal(
  startDate: Date,
  endDate: Date,
  branchCodes?: number[]
): Promise<{ varejo: number; atacado: number }> {
  const branchFilter = buildBranchFilter(branchCodes);

  const results = await prisma.$queryRaw<Array<{ atacado: Decimal | null; total: Decimal | null }>>`
    SELECT
      COALESCE(SUM(CASE WHEN co.description ILIKE '%ATACADO%' THEN ${FATURAMENTO_COM_SINAL} ELSE 0 END), 0) as atacado,
      COALESCE(SUM(${FATURAMENTO_COM_SINAL}), 0) as total
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
  `;

  const row = results[0];
  const atacado = round(decimalToNumber(row?.atacado ?? null));
  const total = round(decimalToNumber(row?.total ?? null));
  return { varejo: round(total - atacado), atacado };
}

// Meta (nível 3 = 100%) por filial, apenas metas de loja (seller_code IS NULL)
export async function getMetasPorFilial(ano: number, mes: number): Promise<Map<number, number>> {
  const metas = await metasService.getMetas(ano, mes);
  const map = new Map<number, number>();
  for (const m of metas) {
    if (m.seller_code === null) {
      map.set(m.branch_code, m.nivel_3);
    }
  }
  return map;
}

// Calcular totais
export function calcularTotais(filiais: VendasFilial[]) {
  const totalFaturamento = filiais.reduce((sum, f) => sum + f.faturamento, 0);
  const totalPecas = filiais.reduce((sum, f) => sum + f.pecas, 0);
  const totalTransacoes = filiais.reduce((sum, f) => sum + f.transacoes, 0);
  const totalClientes = filiais.reduce((sum, f) => sum + f.clientes, 0);

  return {
    faturamento: round(totalFaturamento),
    pecas: totalPecas,
    transacoes: totalTransacoes,
    pa: totalTransacoes > 0 ? round(totalPecas / totalTransacoes) : 0,
    tm: totalTransacoes > 0 ? round(totalFaturamento / totalTransacoes) : 0,
    clientes: totalClientes,
    pm: totalPecas > 0 ? round(totalFaturamento / totalPecas) : 0,
    tm_cliente: totalClientes > 0 ? round(totalFaturamento / totalClientes) : 0,
    pac: totalClientes > 0 ? round(totalPecas / totalClientes) : 0,
  };
}

// Calcular variação
export function calcularVariacao(atual: number, anterior: number) {
  let percentual: number;
  if (anterior === 0) {
    percentual = atual > 0 ? 100 : 0;
  } else {
    percentual = ((atual - anterior) / anterior) * 100;
  }

  return {
    atual,
    anterior,
    diferenca: round(atual - anterior),
    percentual: round(percentual),
  };
}

// Projeção do mês (caminhada)
export async function getProjecaoMes(branchCode?: number, produtoFiltro?: ProdutoFiltro) {
  const today = new Date();
  const diaAtual = today.getDate();

  const startAtual = new Date(today.getFullYear(), today.getMonth(), 1);
  const endAtual = today;

  const startAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const endAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), diaAtual);

  const ultimoDiaAntCompleto = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);
  const startAntCompleto = new Date(today.getFullYear() - 1, today.getMonth(), 1);

  // Buscar dados
  const branchCodes = branchCode ? [branchCode] : undefined;
  const vendasAtual = await getVendasPeriodo(startAtual, endAtual, branchCodes, produtoFiltro);
  const vendasAntParcial = await getVendasPeriodo(startAntParcial, endAntParcial, branchCodes, produtoFiltro);
  const vendasAntCompleto = await getVendasPeriodo(startAntCompleto, ultimoDiaAntCompleto, branchCodes, produtoFiltro);

  const totalAtual = calcularTotais(vendasAtual);
  const totalAntParcial = calcularTotais(vendasAntParcial);
  const totalAntCompleto = calcularTotais(vendasAntCompleto);

  // Calcular caminhada
  let caminhadaFat: number;
  if (totalAntCompleto.faturamento > 0) {
    caminhadaFat = totalAntParcial.faturamento / totalAntCompleto.faturamento;
  } else {
    caminhadaFat = diaAtual / ultimoDiaAntCompleto.getDate();
  }
  caminhadaFat = Math.max(caminhadaFat, 0.01);

  const projecaoFaturamento = totalAtual.faturamento / caminhadaFat;
  const faltaFaturamento = projecaoFaturamento - totalAtual.faturamento;

  const ultimoDia = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const diasRestantes = Math.max(ultimoDia.getDate() - diaAtual, 0);

  const mediaDiariaNecessaria = diasRestantes > 0 ? faltaFaturamento / diasRestantes : 0;

  let varProjecaoVsAnt = 0;
  if (totalAntCompleto.faturamento > 0) {
    varProjecaoVsAnt = ((projecaoFaturamento - totalAntCompleto.faturamento) / totalAntCompleto.faturamento) * 100;
  }

  return {
    periodo_atual: {
      inicio: startAtual.toISOString().split('T')[0],
      fim: endAtual.toISOString().split('T')[0],
      dias_decorridos: diaAtual,
      dias_restantes: diasRestantes,
      dias_total: ultimoDia.getDate(),
    },
    realizado: {
      faturamento: totalAtual.faturamento,
      pecas: totalAtual.pecas,
      transacoes: totalAtual.transacoes,
      tm: totalAtual.tm,
      pa: totalAtual.pa,
    },
    caminhada: round(caminhadaFat * 100, 1),
    projecao: {
      faturamento: round(projecaoFaturamento),
    },
    falta_vender: {
      faturamento: round(faltaFaturamento),
      media_diaria_necessaria: round(mediaDiariaNecessaria),
    },
    variacao_vs_ano_anterior: round(varProjecaoVsAnt, 1),
  };
}

// Projeção por filiais
export async function getProjecaoFiliais(produtoFiltro?: ProdutoFiltro) {
  const today = new Date();
  const diaAtual = today.getDate();

  const startAtual = new Date(today.getFullYear(), today.getMonth(), 1);
  const endAtual = today;

  const startAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const endAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), diaAtual);

  const ultimoDiaAntCompleto = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);
  const startAntCompleto = new Date(today.getFullYear() - 1, today.getMonth(), 1);

  const ultimoDia = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const diasRestantes = Math.max(ultimoDia.getDate() - diaAtual, 0);

  // Buscar dados de todas as filiais
  const filiaisAtual = await getVendasPeriodo(startAtual, endAtual, undefined, produtoFiltro);
  const filiaisAntParcial = await getVendasPeriodo(startAntParcial, endAntParcial, undefined, produtoFiltro);
  const filiaisAntCompleto = await getVendasPeriodo(startAntCompleto, ultimoDiaAntCompleto, undefined, produtoFiltro);

  // Criar dicionários para lookup
  const antParcialDict = new Map(filiaisAntParcial.map(f => [f.branch_code, f]));
  const antCompletoDict = new Map(filiaisAntCompleto.map(f => [f.branch_code, f]));

  // Calcular projeção por filial
  const projecoes = filiaisAtual.map(f => {
    const antParcial = antParcialDict.get(f.branch_code) || { faturamento: 0 };
    const antCompleto = antCompletoDict.get(f.branch_code) || { faturamento: 0 };

    let caminhada: number;
    if (antCompleto.faturamento > 0) {
      caminhada = antParcial.faturamento / antCompleto.faturamento;
    } else {
      caminhada = diaAtual / ultimoDia.getDate();
    }
    caminhada = Math.max(caminhada, 0.01);

    const projecaoFat = f.faturamento / caminhada;
    const falta = projecaoFat - f.faturamento;

    let varVsAnt = 0;
    if (antCompleto.faturamento > 0) {
      varVsAnt = ((projecaoFat - antCompleto.faturamento) / antCompleto.faturamento) * 100;
    }

    return {
      branch_code: f.branch_code,
      branch_name: f.branch_name,
      realizado: round(f.faturamento),
      caminhada: round(caminhada * 100, 1),
      projecao: round(projecaoFat),
      falta: round(falta),
      ano_anterior_completo: round(antCompleto.faturamento),
      variacao_vs_ano_anterior: round(varVsAnt, 1),
    };
  });

  // Calcular totais
  const totalRealizado = projecoes.reduce((sum, p) => sum + p.realizado, 0);
  const totalProjecao = projecoes.reduce((sum, p) => sum + p.projecao, 0);
  const totalFalta = projecoes.reduce((sum, p) => sum + p.falta, 0);
  const totalAntCompleto = projecoes.reduce((sum, p) => sum + p.ano_anterior_completo, 0);

  let totalVar = 0;
  if (totalAntCompleto > 0) {
    totalVar = ((totalProjecao - totalAntCompleto) / totalAntCompleto) * 100;
  }

  return {
    periodo: {
      inicio: startAtual.toISOString().split('T')[0],
      fim: endAtual.toISOString().split('T')[0],
      dias_decorridos: diaAtual,
      dias_restantes: diasRestantes,
    },
    filiais: projecoes,
    total: {
      realizado: round(totalRealizado),
      projecao: round(totalProjecao),
      falta: round(totalFalta),
      ano_anterior_completo: round(totalAntCompleto),
      variacao_vs_ano_anterior: round(totalVar, 1),
    },
  };
}
