import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { OPERACAO_JOIN, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL, PCP_ESTOQUE_LIQUIDO_SKU_FILTER } from './relatorioBase.service.js';
import { FILIAIS } from '../config/constants.js';

// V1 direto ao ponto (pedido do usuario) - relatorio de rede inteira, sem quebra por
// filial: a producao atende todas as lojas juntas, entao estoque/venda/OP sao somados
// entre todas as filiais antes de qualquer conta. Formula (tambem pedida literalmente
// pelo usuario, "uma conta bem simples"):
//   estoqueMinimo = vendaMediaMensal * coberturaAlvoMeses (config)
//   estoqueFuturo = estoqueAtual (rede) + emProducao (OPs pendentes, rede)
//   deficit = estoqueMinimo - estoqueFuturo
//   sugestaoProducao = deficit <= 0 ? 0 : ceil(deficit / corteMinimoDoSku) * corteMinimoDoSku
const RELATORIO_KEY = 'sugestao_producao';

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export interface SugestaoProducaoFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  search?: string;
  apenasComSugestao?: boolean;
}

export interface SugestaoProducaoRow {
  sku: string;
  productCode: number | null;
  referenceCode: string;
  descricao: string;
  cor: string;
  tamanho: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status: string | null;
  estoqueAtual: number;
  emProducao: number;
  estoqueFuturo: number;
  vendaPeriodoAtual: number;
  vendaPeriodoAnterior: number;
  vendaMediaMensal: number;
  estoqueMinimo: number;
  corteMinimo: number;
  sugestaoProducao: number;
}

export interface SugestaoProducaoResponse {
  config: { giroDias: number; coberturaMeses: number; coberturaAlvoMeses: number; corteMinimoDefault: number };
  periodo: { atualInicio: string; atualFim: string; anteriorInicio: string; anteriorFim: string };
  kpis: {
    skuCount: number;
    skusComSugestao: number;
    totalSugerido: number;
    totalEstoqueAtual: number;
    totalEmProducao: number;
  };
  rows: SugestaoProducaoRow[];
}

async function getConfig() {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: RELATORIO_KEY },
    create: { relatorio: RELATORIO_KEY },
    update: {},
  });
}

function filtroProductCodeTi(codes: number[] | null): Prisma.Sql {
  if (codes === null) return Prisma.empty;
  if (codes.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ti.product_code IN (${Prisma.join(codes)})`;
}
function filtroProductCode(codes: number[] | null): Prisma.Sql {
  if (codes === null) return Prisma.empty;
  if (codes.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND product_code IN (${Prisma.join(codes)})`;
}
function filtroProductSku(skus: string[] | null): Prisma.Sql {
  if (skus === null) return Prisma.empty;
  if (skus.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND product_sku IN (${Prisma.join(skus)})`;
}

interface IdentidadeRow {
  product_sku: string;
  product_code: number | null;
  reference_code: string | null;
  reference_name: string | null;
  color_name: string | null;
  size: string | null;
  descricao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status: string | null;
}

function buildIdentidadeFiltro(filtro: SugestaoProducaoFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(a.class_categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(a.class_linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(a.class_genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`TRIM(a.class_status) IN (${Prisma.join(filtro.status)})`);
  if (filtro.search?.trim()) {
    const termo = `%${filtro.search.trim()}%`;
    condicoes.push(Prisma.sql`(a.product_sku ILIKE ${termo} OR a.reference_name ILIKE ${termo} OR a.product_name ILIKE ${termo})`);
  }
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

async function getIdentidadeRows(filtro: SugestaoProducaoFiltro): Promise<IdentidadeRow[]> {
  const filtroSql = buildIdentidadeFiltro(filtro);
  return prisma.$queryRaw<IdentidadeRow[]>`
    SELECT
      a.product_sku, a.product_code, a.reference_code, a.reference_name, a.color_name, a.size,
      COALESCE(NULLIF(TRIM(a.product_name), ''), NULLIF(TRIM(a.reference_name), ''), a.product_sku) as descricao,
      NULLIF(TRIM(a.class_categoria), '') as categoria,
      NULLIF(TRIM(a.class_linha), '') as linha,
      NULLIF(TRIM(a.class_genero), '') as genero,
      NULLIF(TRIM(a.class_status), '') as status
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE a.reference_code IS NOT NULL AND a.size IS NOT NULL
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${filtroSql}
  `;
}

interface EstoqueRow {
  product_sku: string;
  quantidade_estoque: Decimal;
}

// Estoque atual por SKU, somado em TODAS as filiais (rede inteira - a producao
// atende todas as lojas, nao faz sentido olhar loja isolada aqui).
async function getEstoqueRows(productSkus: string[] | null): Promise<EstoqueRow[]> {
  return prisma.$queryRaw<EstoqueRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, stock
      FROM prd_saldo
      WHERE 1=1 ${filtroProductSku(productSkus)}
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    )
    SELECT product_sku, COALESCE(SUM(COALESCE(stock, 0)), 0) AS quantidade_estoque
    FROM ultimo_saldo
    GROUP BY product_sku
  `;
}

interface VendaRow {
  product_code: number;
  quantidade: Decimal;
}

// Total vendido por product_code (liquido de devolucao, rede inteira), num intervalo de
// datas [inicio, fim) explicito - usado tanto pros 2 periodos comparados quanto pra
// janela da venda media, cada chamada com um range diferente.
async function getVendaPorPeriodoRows(inicio: Date, fim: Date, productCodes: number[] | null): Promise<VendaRow[]> {
  return prisma.$queryRaw<VendaRow[]>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= ${inicio} AND t.transaction_date < ${fim}
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code
  `;
}

// Quantidade pendente de OPs abertas por product_code, somada em todas as filiais -
// mesma query ja usada em relatorioBase.service.ts.getEmProducaoRows.
async function getEmProducaoRows(productCodes: number[] | null): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT product_code, SUM(quantidade_pendente) AS quantidade
    FROM ops_em_producao
    WHERE 1=1 ${filtroProductCode(productCodes)}
    GROUP BY product_code
  `;
}

function somaMapa(mapa: Map<string, number> | undefined): number {
  return mapa ? [...mapa.values()].reduce((s, v) => s + v, 0) : 0;
}

export async function getSugestaoProducao(filtro: SugestaoProducaoFiltro = {}): Promise<SugestaoProducaoResponse> {
  const config = await getConfig();
  const giroDias = config.giroDias;
  const coberturaMeses = config.coberturaMeses;
  const coberturaAlvoMeses = decimalToNumber(config.coberturaAlvoMeses);
  const corteMinimoDefault = decimalToNumber(config.corteMinimoDefault);

  const hoje = new Date();
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);
  const inicioAtual = new Date(hoje);
  inicioAtual.setDate(inicioAtual.getDate() - giroDias);
  const inicioAnterior = new Date(inicioAtual);
  inicioAnterior.setDate(inicioAnterior.getDate() - giroDias);
  const inicioMedia = new Date(hoje.getFullYear(), hoje.getMonth() - coberturaMeses, hoje.getDate());

  const identidadeRows = await getIdentidadeRows(filtro);
  const temFiltro = !!(filtro.categoria?.length || filtro.linha?.length || filtro.genero?.length || filtro.status?.length || filtro.search?.trim());
  const productCodesFiltro = temFiltro ? [...new Set(identidadeRows.map((r) => r.product_code).filter((c): c is number => c !== null))] : null;
  const productSkusFiltro = temFiltro ? identidadeRows.map((r) => r.product_sku) : null;

  const [estoqueRows, vendaAtualRows, vendaAnteriorRows, vendaMediaRows, emProducaoRows, corteMinimoRows] = await Promise.all([
    getEstoqueRows(productSkusFiltro),
    getVendaPorPeriodoRows(inicioAtual, amanha, productCodesFiltro),
    getVendaPorPeriodoRows(inicioAnterior, inicioAtual, productCodesFiltro),
    getVendaPorPeriodoRows(inicioMedia, amanha, productCodesFiltro),
    getEmProducaoRows(productCodesFiltro),
    prisma.pcpCorteMinimoSku.findMany({ where: { relatorio: RELATORIO_KEY } }),
  ]);

  const estoquePorSku = new Map<string, number>();
  for (const r of estoqueRows) estoquePorSku.set(r.product_sku, decimalToNumber(r.quantidade_estoque));

  const vendaAtualPorProductCode = new Map<number, number>();
  for (const r of vendaAtualRows) vendaAtualPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));
  const vendaAnteriorPorProductCode = new Map<number, number>();
  for (const r of vendaAnteriorRows) vendaAnteriorPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));
  const vendaMediaPorProductCode = new Map<number, number>();
  for (const r of vendaMediaRows) vendaMediaPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));
  const emProducaoPorProductCode = new Map<number, number>();
  for (const r of emProducaoRows) emProducaoPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));
  const corteMinimoPorSku = new Map<string, number>();
  for (const r of corteMinimoRows) corteMinimoPorSku.set(r.sku, decimalToNumber(r.corteMinimo));

  let totalSugerido = 0;
  let totalEstoqueAtual = 0;
  let totalEmProducao = 0;
  let skusComSugestao = 0;

  const rows: SugestaoProducaoRow[] = [];
  for (const row of identidadeRows) {
    const estoqueAtual = round(estoquePorSku.get(row.product_sku) || 0, 0);
    const emProducao = round(row.product_code !== null ? emProducaoPorProductCode.get(row.product_code) || 0 : 0, 0);
    const estoqueFuturo = estoqueAtual + emProducao;
    const vendaPeriodoAtual = round(row.product_code !== null ? vendaAtualPorProductCode.get(row.product_code) || 0 : 0, 0);
    const vendaPeriodoAnterior = round(row.product_code !== null ? vendaAnteriorPorProductCode.get(row.product_code) || 0 : 0, 0);
    const vendaMediaTotal = row.product_code !== null ? vendaMediaPorProductCode.get(row.product_code) || 0 : 0;
    const vendaMediaMensal = round(vendaMediaTotal / coberturaMeses, 2);
    const estoqueMinimo = round(vendaMediaMensal * coberturaAlvoMeses, 0);
    const deficit = estoqueMinimo - estoqueFuturo;
    const corteMinimo = corteMinimoPorSku.get(row.product_sku) ?? corteMinimoDefault;
    const sugestaoProducao = deficit > 0 && corteMinimo > 0 ? Math.ceil(deficit / corteMinimo) * corteMinimo : 0;

    // Estoque/em producao somam SEMPRE a base inteira analisada (antes do filtro
    // "so quem precisa produzir") - senao "Em Producao (Rede)" e "Estoque Atual (Rede)"
    // ficam artificialmente baixos (so contam OP/estoque dos SKUs que sobraram no
    // filtro), inconsistente com o mesmo KPI em Acompanhamento por Linha, que sempre
    // soma a base inteira. So "sugerido"/"skusComSugestao" fazem sentido restritos ao
    // filtro (sao 0 pra quem nao precisa produzir de qualquer forma, filtrar antes ou
    // depois da soma da o mesmo resultado).
    totalEstoqueAtual += estoqueAtual;
    totalEmProducao += emProducao;

    if (filtro.apenasComSugestao && sugestaoProducao <= 0) continue;

    totalSugerido += sugestaoProducao;
    if (sugestaoProducao > 0) skusComSugestao++;

    rows.push({
      sku: row.product_sku,
      productCode: row.product_code,
      referenceCode: row.reference_code || row.product_sku,
      descricao: row.descricao || row.product_sku,
      cor: row.color_name || '-',
      tamanho: row.size || '-',
      categoria: row.categoria,
      linha: row.linha,
      genero: row.genero,
      status: row.status,
      estoqueAtual,
      emProducao,
      estoqueFuturo,
      vendaPeriodoAtual,
      vendaPeriodoAnterior,
      vendaMediaMensal,
      estoqueMinimo,
      corteMinimo,
      sugestaoProducao,
    });
  }

  rows.sort((a, b) => b.sugestaoProducao - a.sugestaoProducao);

  return {
    config: { giroDias, coberturaMeses, coberturaAlvoMeses, corteMinimoDefault },
    periodo: {
      atualInicio: inicioAtual.toISOString().slice(0, 10),
      atualFim: hoje.toISOString().slice(0, 10),
      anteriorInicio: inicioAnterior.toISOString().slice(0, 10),
      anteriorFim: inicioAtual.toISOString().slice(0, 10),
    },
    kpis: {
      skuCount: rows.length,
      skusComSugestao,
      totalSugerido: round(totalSugerido, 0),
      totalEstoqueAtual: round(totalEstoqueAtual, 0),
      totalEmProducao: round(totalEmProducao, 0),
    },
    rows,
  };
}

export async function getFiltrosSugestaoProducao() {
  const [categoriaRows, linhaRows, generoRows, statusRows] = await Promise.all([
    prisma.$queryRaw<Array<{ valor: string; qtd: bigint }>>`
      SELECT TRIM(class_categoria) AS valor, COUNT(*) AS qtd FROM produto_analitico
      WHERE class_categoria IS NOT NULL AND TRIM(class_categoria) NOT IN ('', '.') AND reference_code IS NOT NULL AND size IS NOT NULL
      GROUP BY TRIM(class_categoria) ORDER BY TRIM(class_categoria)
    `,
    prisma.$queryRaw<Array<{ valor: string; qtd: bigint }>>`
      SELECT TRIM(class_linha) AS valor, COUNT(*) AS qtd FROM produto_analitico
      WHERE class_linha IS NOT NULL AND TRIM(class_linha) NOT IN ('', '.') AND reference_code IS NOT NULL AND size IS NOT NULL
      GROUP BY TRIM(class_linha) ORDER BY TRIM(class_linha)
    `,
    prisma.$queryRaw<Array<{ valor: string; qtd: bigint }>>`
      SELECT TRIM(class_genero) AS valor, COUNT(*) AS qtd FROM produto_analitico
      WHERE class_genero IS NOT NULL AND TRIM(class_genero) NOT IN ('', '.') AND reference_code IS NOT NULL AND size IS NOT NULL
      GROUP BY TRIM(class_genero) ORDER BY TRIM(class_genero)
    `,
    prisma.$queryRaw<Array<{ valor: string; qtd: bigint }>>`
      SELECT TRIM(class_status) AS valor, COUNT(*) AS qtd FROM produto_analitico
      WHERE class_status IS NOT NULL AND TRIM(class_status) NOT IN ('', '.') AND reference_code IS NOT NULL AND size IS NOT NULL
      GROUP BY TRIM(class_status) ORDER BY TRIM(class_status)
    `,
  ]);

  return {
    categoria: categoriaRows.map((r) => ({ valor: r.valor, qtd_skus: Number(r.qtd) })),
    linha: linhaRows.map((r) => ({ valor: r.valor, qtd_skus: Number(r.qtd) })),
    genero: generoRows.map((r) => ({ valor: r.valor, qtd_skus: Number(r.qtd) })),
    status: statusRows.map((r) => ({ valor: r.valor, qtd_skus: Number(r.qtd) })),
  };
}

const STATUS_OP_LABEL: Record<number, string> = { 5: 'Bloqueada', 10: 'Aguardando', 20: 'Em Andamento' };

export interface OpDetalhe {
  orderCode: number;
  branchCode: number;
  branchName: string;
  status: number;
  statusLabel: string;
  dtInicio: string | null;
  dtPrevisao: string | null;
  quantidadeOp: number;
  quantidadeFinalizada: number;
  quantidadePendente: number;
}

// Detalhe das OPs abertas por tras do numero agregado de "Em Producao" de um SKU - o
// dado ja esta sincronizado em ops_em_producao (nao precisa chamar a API do TOTVS de
// novo, so ja e usado pelo relatorio "Em Producao" - emProducao.service.ts). Usado
// quando o usuario clica no valor "Em Producao" de uma linha, pra ver o numero da OP.
export async function getOpsDetalhePorProductCode(productCode: number): Promise<OpDetalhe[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      order_code: number;
      branch_code: number;
      status: number;
      dt_inicio: Date | null;
      dt_previsao: Date | null;
      quantidade_op: Decimal;
      quantidade_finalizada: Decimal;
      quantidade_pendente: Decimal;
    }>
  >`
    SELECT order_code, branch_code, status, dt_inicio, dt_previsao, quantidade_op, quantidade_finalizada, quantidade_pendente
    FROM ops_em_producao
    WHERE product_code = ${productCode}
    ORDER BY dt_previsao NULLS LAST, order_code
  `;

  return rows.map((r) => ({
    orderCode: r.order_code,
    branchCode: r.branch_code,
    branchName: FILIAIS[r.branch_code] || `Filial ${r.branch_code}`,
    status: r.status,
    statusLabel: STATUS_OP_LABEL[r.status] || `Status ${r.status}`,
    dtInicio: r.dt_inicio ? r.dt_inicio.toISOString().slice(0, 10) : null,
    dtPrevisao: r.dt_previsao ? r.dt_previsao.toISOString().slice(0, 10) : null,
    quantidadeOp: decimalToNumber(r.quantidade_op),
    quantidadeFinalizada: decimalToNumber(r.quantidade_finalizada),
    quantidadePendente: decimalToNumber(r.quantidade_pendente),
  }));
}
