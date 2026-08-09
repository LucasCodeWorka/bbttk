import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { FILIAIS } from '../config/constants.js';
import { OPERACAO_JOIN, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL } from './relatorioBase.service.js';

const CURVA_ABC_CONFIG_KEY = 'curva_abc';
const RELATORIO_BASE_CONFIG_KEY = 'relatorio_base';
const MESES_FECHADOS = 3;
const RISCO_COBERTURA_MESES_DEFAULT = 1;
const STATUS_ATENCAO_LIMITE_PERCENT = 30;
const CURVA_ABC_TAMANHO_MESES = 6;

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export interface AnaliseGradeFiltro {
  referencia?: string;
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  cor?: string[];
  branches?: number[];
}

interface GradeRawRow {
  product_sku: string;
  reference_code: string;
  reference_name: string | null;
  color_code: string | null;
  color_name: string | null;
  size: string;
  product_code: number | null;
  estoque: Decimal;
}

interface VendaMensalRow {
  product_code: number;
  venda_mes_1: Decimal;
  venda_mes_2: Decimal;
  venda_mes_3: Decimal;
  valor_mes_1: Decimal;
  valor_mes_2: Decimal;
  valor_mes_3: Decimal;
}

function buildFiltroSql(filtro: AnaliseGradeFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (filtro.referencia?.trim()) condicoes.push(Prisma.sql`a.reference_code = ${filtro.referencia.trim()}`);
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(a.class_categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(a.class_linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(a.class_genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`TRIM(a.class_status) IN (${Prisma.join(filtro.status)})`);
  if (filtro.cor?.length) condicoes.push(Prisma.sql`TRIM(a.color_name) IN (${Prisma.join(filtro.cor)})`);
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

// Busca so os product_sku que batem no filtro de classificacao/referencia/cor, direto
// em produto_analitico (tabela pequena, sem tocar prd_saldo) - usado pra restringir a
// CTE cara sobre prd_saldo em getGradeRawRows/getSaldoPorFilial, que antes SEMPRE
// escaneava a tabela inteira de snapshots independente do filtro aplicado (o filtro so
// entrava depois, no JOIN final com produto_analitico, sem baratear a CTE em si - essa
// e a causa real de "com varios filtros continua demorando"). null = sem filtro de
// classificacao, mantem o comportamento antigo (sem restricao).
async function getSkusFiltrados(filtro: AnaliseGradeFiltro): Promise<string[] | null> {
  const temFiltro = !!(
    filtro.referencia?.trim() || filtro.categoria?.length || filtro.linha?.length || filtro.genero?.length || filtro.status?.length || filtro.cor?.length
  );
  if (!temFiltro) return null;
  const filtroSql = buildFiltroSql(filtro);
  const rows = await prisma.$queryRaw<Array<{ product_sku: string }>>`
    SELECT a.product_sku
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE a.reference_code IS NOT NULL AND a.size IS NOT NULL
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${filtroSql}
  `;
  return rows.map((r) => r.product_sku);
}

function filtroProductSkuAG(skus: string[] | null): Prisma.Sql {
  if (skus === null) return Prisma.empty;
  if (skus.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND product_sku IN (${Prisma.join(skus)})`;
}

async function getGradeRawRows(filtro: AnaliseGradeFiltro, productSkus: string[] | null): Promise<GradeRawRow[]> {
  const filtroSql = buildFiltroSql(filtro);
  const filtroBranch = filtro.branches?.length
    ? Prisma.sql`AND branch_code IN (${Prisma.join(filtro.branches)})`
    : Prisma.empty;

  return prisma.$queryRaw<GradeRawRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, branch_code, stock
      FROM prd_saldo
      WHERE 1=1 ${filtroBranch} ${filtroProductSkuAG(productSkus)}
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    ),
    estoque_sku AS (
      SELECT product_sku, SUM(COALESCE(stock, 0)) FILTER (WHERE COALESCE(stock, 0) > 0) AS estoque
      FROM ultimo_saldo
      GROUP BY product_sku
    )
    SELECT
      a.product_sku,
      a.reference_code,
      a.reference_name,
      a.color_code,
      a.color_name,
      a.size,
      a.product_code,
      COALESCE(es.estoque, 0) AS estoque
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    LEFT JOIN estoque_sku es ON es.product_sku = a.product_sku
    WHERE a.reference_code IS NOT NULL AND a.size IS NOT NULL
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${filtroSql}
  `;
}

interface SaldoFilialRow {
  reference_code: string;
  branch_code: number;
  estoque: Decimal;
}

// Saldo fisico (estoque real na loja/filial, nao venda/canal) por referencia - mesmo
// "ultimo_saldo" de getGradeRawRows, so que sem colapsar o branch_code no meio do
// caminho. Usado pra secao "Saldo por Filial" do drill-down de cada referencia.
async function getSaldoPorFilial(filtro: AnaliseGradeFiltro, productSkus: string[] | null): Promise<Map<string, Map<number, number>>> {
  const filtroSql = buildFiltroSql(filtro);
  const filtroBranch = filtro.branches?.length
    ? Prisma.sql`AND branch_code IN (${Prisma.join(filtro.branches)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<SaldoFilialRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, branch_code, stock
      FROM prd_saldo
      WHERE 1=1 ${filtroBranch} ${filtroProductSkuAG(productSkus)}
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    ),
    saldo_sku_filial AS (
      SELECT product_sku, branch_code, SUM(COALESCE(stock, 0)) FILTER (WHERE COALESCE(stock, 0) > 0) AS estoque
      FROM ultimo_saldo
      GROUP BY product_sku, branch_code
    )
    SELECT a.reference_code, s.branch_code, SUM(COALESCE(s.estoque, 0)) AS estoque
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    JOIN saldo_sku_filial s ON s.product_sku = a.product_sku
    WHERE a.reference_code IS NOT NULL AND a.size IS NOT NULL
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${filtroSql}
    GROUP BY a.reference_code, s.branch_code
  `;

  const mapa = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const porFilial = mapa.get(row.reference_code) || new Map<number, number>();
    porFilial.set(row.branch_code, decimalToNumber(row.estoque));
    mapa.set(row.reference_code, porFilial);
  }
  return mapa;
}

// productCodes: restringe ao universo ja filtrado por categoria/linha/genero/status/cor
// (extraido de getGradeRawRows) - null = sem filtro de classificacao aplicado, mantem
// o universo completo. Antes essa query sempre escaneava transacoes/transacao_itens
// pra TODOS os product_code vendidos nos ultimos 3 meses, entao filtro de
// classificacao nao acelerava nada (o piso de tempo dessa query era sempre o mesmo).
async function getVendasMensaisPorProductCode(filtro: AnaliseGradeFiltro = {}, productCodes: number[] | null = null): Promise<Map<number, VendaMensalRow>> {
  const filtroBranch = filtro.branches?.length
    ? Prisma.sql`AND t.branch_code IN (${Prisma.join(filtro.branches)})`
    : Prisma.empty;
  const filtroProductCode =
    productCodes === null
      ? Prisma.empty
      : productCodes.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND ti.product_code IN (${Prisma.join(productCodes)})`;

  const rows = await prisma.$queryRaw<VendaMensalRow[]>`
    WITH limites AS (
      SELECT
        date_trunc('month', CURRENT_DATE)::date AS inicio_mes_atual,
        (date_trunc('month', CURRENT_DATE)::date - INTERVAL '3 months') AS inicio_mes_1,
        (date_trunc('month', CURRENT_DATE)::date - INTERVAL '2 months') AS inicio_mes_2,
        (date_trunc('month', CURRENT_DATE)::date - INTERVAL '1 month') AS inicio_mes_3
    )
    SELECT
      ti.product_code,
      SUM(${QUANTIDADE_COM_SINAL}) FILTER (WHERE t.transaction_date >= l.inicio_mes_1 AND t.transaction_date < l.inicio_mes_2) AS venda_mes_1,
      SUM(${QUANTIDADE_COM_SINAL}) FILTER (WHERE t.transaction_date >= l.inicio_mes_2 AND t.transaction_date < l.inicio_mes_3) AS venda_mes_2,
      SUM(${QUANTIDADE_COM_SINAL}) FILTER (WHERE t.transaction_date >= l.inicio_mes_3 AND t.transaction_date < l.inicio_mes_atual) AS venda_mes_3,
      SUM(CASE WHEN (co.operations_type = 'E' AND co.operation_mode = '3') THEN -ABS(ti.net_value) ELSE ti.net_value END)
        FILTER (WHERE t.transaction_date >= l.inicio_mes_1 AND t.transaction_date < l.inicio_mes_2) AS valor_mes_1,
      SUM(CASE WHEN (co.operations_type = 'E' AND co.operation_mode = '3') THEN -ABS(ti.net_value) ELSE ti.net_value END)
        FILTER (WHERE t.transaction_date >= l.inicio_mes_2 AND t.transaction_date < l.inicio_mes_3) AS valor_mes_2,
      SUM(CASE WHEN (co.operations_type = 'E' AND co.operation_mode = '3') THEN -ABS(ti.net_value) ELSE ti.net_value END)
        FILTER (WHERE t.transaction_date >= l.inicio_mes_3 AND t.transaction_date < l.inicio_mes_atual) AS valor_mes_3
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    CROSS JOIN limites l
    WHERE t.transaction_date >= l.inicio_mes_1
      AND t.transaction_date < l.inicio_mes_atual
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroBranch}
      ${filtroProductCode}
    GROUP BY ti.product_code
  `;

  const mapa = new Map<number, VendaMensalRow>();
  for (const row of rows) mapa.set(row.product_code, row);
  return mapa;
}

async function getMesesFechadosLabels(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ label: string }>>`
    SELECT to_char(mes, 'Mon/YYYY') AS label
    FROM generate_series(
      date_trunc('month', CURRENT_DATE)::date - INTERVAL '3 months',
      date_trunc('month', CURRENT_DATE)::date - INTERVAL '1 month',
      INTERVAL '1 month'
    ) AS mes
    ORDER BY mes
  `;
  return rows.map((r) => r.label);
}

async function getCurvaConfig() {
  const config = await prisma.pcpCurvaAbcConfig.upsert({
    where: { relatorio: CURVA_ABC_CONFIG_KEY },
    create: { relatorio: CURVA_ABC_CONFIG_KEY },
    update: {},
  });
  const a = Number(config.curvaALimitePercent);
  const b = Number(config.curvaBLimitePercent);
  const c = Number(config.curvaCLimitePercent);
  if (!(a > 0 && a < b && b < c && c <= 100)) {
    return prisma.pcpCurvaAbcConfig.update({
      where: { relatorio: CURVA_ABC_CONFIG_KEY },
      data: { curvaALimitePercent: 80, curvaBLimitePercent: 95, curvaCLimitePercent: 100 },
    });
  }
  return config;
}

type CurvaLetra = 'A' | 'B' | 'C';
type StatusReferencia = 'saudavel' | 'atencao' | 'critica';

function buildRefCorTam(row: GradeRawRow): string {
  const cor = row.color_name?.trim() || row.color_code?.trim() || 'SEM COR';
  const tamanho = row.size?.trim() || 'SEM TAM';
  return [row.reference_code, cor, tamanho].join(' - ');
}

function getStatus(percentRisco: number, skusRisco: number): StatusReferencia {
  if (skusRisco === 0) return 'saudavel';
  if (percentRisco <= STATUS_ATENCAO_LIMITE_PERCENT) return 'atencao';
  return 'critica';
}

function prioridade(curva: CurvaLetra, status: StatusReferencia): number {
  if (curva === 'A' && status === 'critica') return 1;
  if (curva === 'A' && status === 'atencao') return 2;
  if (curva === 'B' && status === 'critica') return 3;
  if (curva === 'B' && status === 'atencao') return 4;
  if (status === 'critica') return 5;
  return 6;
}

// Quantidade pendente em producao por product_code (soma dos itens de OP abertas,
// tabela detalhada ops_em_producao - ver totvs.service.ts syncEmProducao). productCodes
// restringe ao universo ja filtrado por classificacao (null = sem filtro aplicado).
async function getEmProducaoPorProductCode(productCodes: number[] | null = null): Promise<Map<number, number>> {
  const filtroProductCode =
    productCodes === null
      ? Prisma.empty
      : productCodes.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND product_code IN (${Prisma.join(productCodes)})`;

  const rows = await prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT product_code, SUM(quantidade_pendente) AS quantidade
    FROM ops_em_producao
    WHERE 1=1 ${filtroProductCode}
    GROUP BY product_code
  `;
  const mapa = new Map<number, number>();
  for (const r of rows) mapa.set(r.product_code, decimalToNumber(r.quantidade));
  return mapa;
}

export async function getGrade(filtro: AnaliseGradeFiltro = {}) {
  // Busca so os SKUs que batem no filtro de classificacao PRIMEIRO (query leve, so
  // produto_analitico) - usada pra restringir a CTE cara sobre prd_saldo em
  // getGradeRawRows/getSaldoPorFilial (antes sempre escaneava a tabela de snapshots
  // inteira, o filtro so entrava depois no JOIN final, sem baratear a CTE em si - essa
  // e a causa real da lentidao "com varios filtros continua demorando"). Depois usa o
  // product_code do resultado pra restringir vendas/em-producao ao mesmo universo.
  // branches fica de fora dessa restricao (so afeta o estoque mostrado, nao quais SKUs
  // aparecem).
  const productSkusFiltro = await getSkusFiltrados(filtro);
  const rawRows = await getGradeRawRows(filtro, productSkusFiltro);
  const temFiltroClassificacao = productSkusFiltro !== null;
  const productCodesFiltro = temFiltroClassificacao
    ? [...new Set(rawRows.map((r) => r.product_code).filter((c): c is number => c !== null))]
    : null;

  const [vendasPorProductCode, mesesLabels, curvaConfig, relatorioConfig, saldoPorFilialPorReferencia, emProducaoPorProductCode] = await Promise.all([
    getVendasMensaisPorProductCode(filtro, productCodesFiltro),
    getMesesFechadosLabels(),
    getCurvaConfig(),
    prisma.pcpRelatorioConfig.upsert({
      where: { relatorio: RELATORIO_BASE_CONFIG_KEY },
      create: { relatorio: RELATORIO_BASE_CONFIG_KEY },
      update: {},
    }),
    getSaldoPorFilial(filtro, productSkusFiltro),
    getEmProducaoPorProductCode(productCodesFiltro),
  ]);
  const riscoCoberturaMeses = decimalToNumber(relatorioConfig.riscoCoberturaMeses) || RISCO_COBERTURA_MESES_DEFAULT;

  const refs = new Map<string, {
    referenceName: string;
    estoque: number;
    emProducao: number;
    vendaMes1: number;
    vendaMes2: number;
    vendaMes3: number;
    valorMes1: number;
    valorMes2: number;
    valorMes3: number;
    skus: Map<string, {
      sku: string;
      refCorTam: string;
      cor: string;
      tamanho: string;
      estoque: number;
      emProducao: number;
      vendaMes1: number;
      vendaMes2: number;
      vendaMes3: number;
    }>;
  }>();

  for (const row of rawRows) {
    const atual = refs.get(row.reference_code) || {
      referenceName: row.reference_name || row.reference_code,
      estoque: 0,
      emProducao: 0,
      vendaMes1: 0,
      vendaMes2: 0,
      vendaMes3: 0,
      valorMes1: 0,
      valorMes2: 0,
      valorMes3: 0,
      skus: new Map(),
    };
    const venda = row.product_code !== null ? vendasPorProductCode.get(row.product_code) : undefined;
    const estoque = decimalToNumber(row.estoque);
    const emProducao = row.product_code !== null ? emProducaoPorProductCode.get(row.product_code) || 0 : 0;
    const vendaMes1 = decimalToNumber(venda?.venda_mes_1);
    const vendaMes2 = decimalToNumber(venda?.venda_mes_2);
    const vendaMes3 = decimalToNumber(venda?.venda_mes_3);

    atual.estoque += estoque;
    atual.emProducao += emProducao;
    atual.vendaMes1 += vendaMes1;
    atual.vendaMes2 += vendaMes2;
    atual.vendaMes3 += vendaMes3;
    atual.valorMes1 += decimalToNumber(venda?.valor_mes_1);
    atual.valorMes2 += decimalToNumber(venda?.valor_mes_2);
    atual.valorMes3 += decimalToNumber(venda?.valor_mes_3);
    atual.skus.set(row.product_sku, {
      sku: row.product_sku,
      refCorTam: buildRefCorTam(row),
      cor: row.color_name?.trim() || row.color_code?.trim() || 'SEM COR',
      tamanho: row.size,
      estoque,
      emProducao,
      vendaMes1,
      vendaMes2,
      vendaMes3,
    });
    refs.set(row.reference_code, atual);
  }

  const totalValorMedio = [...refs.values()].reduce((s, r) => s + Math.max(0, (r.valorMes1 + r.valorMes2 + r.valorMes3) / MESES_FECHADOS), 0);
  const curvaPorReferencia = new Map<string, CurvaLetra>();
  let acumuladoValorMedio = 0;
  [...refs.entries()]
    .sort(([, a], [, b]) => ((b.valorMes1 + b.valorMes2 + b.valorMes3) / MESES_FECHADOS) - ((a.valorMes1 + a.valorMes2 + a.valorMes3) / MESES_FECHADOS))
    .forEach(([referenceCode, dados]) => {
      acumuladoValorMedio += Math.max(0, (dados.valorMes1 + dados.valorMes2 + dados.valorMes3) / MESES_FECHADOS);
      const acumuladoPercent = totalValorMedio > 0 ? (acumuladoValorMedio / totalValorMedio) * 100 : 0;
      // Curva C vai ate 100% (nao existe mais curva D)
      if (acumuladoPercent <= Number(curvaConfig.curvaALimitePercent)) curvaPorReferencia.set(referenceCode, 'A');
      else if (acumuladoPercent <= Number(curvaConfig.curvaBLimitePercent)) curvaPorReferencia.set(referenceCode, 'B');
      else curvaPorReferencia.set(referenceCode, 'C');
    });

  let skusEmRiscoTotal = 0;
  let totalSkus = 0;
  let referenciasCriticas = 0;

  const referencias = [...refs.entries()].map(([referenceCode, dados]) => {
    const detalhes = [...dados.skus.values()].map((sku) => {
      const vendaTotal = sku.vendaMes1 + sku.vendaMes2 + sku.vendaMes3;
      const mediaMensal = vendaTotal / MESES_FECHADOS;
      const cobertura = mediaMensal > 0 ? round(sku.estoque / mediaMensal, 2) : null;
      const emRisco = cobertura !== null && cobertura < riscoCoberturaMeses;
      if (emRisco) skusEmRiscoTotal++;
      totalSkus++;
      return {
        ...sku,
        estoque: round(sku.estoque, 0),
        emProducao: round(sku.emProducao, 0),
        vendaMes1: round(sku.vendaMes1, 0),
        vendaMes2: round(sku.vendaMes2, 0),
        vendaMes3: round(sku.vendaMes3, 0),
        mediaMensal: round(mediaMensal, 2),
        cobertura,
        status: emRisco ? 'risco' : 'ok',
      };
    });

    const vendaTotal = dados.vendaMes1 + dados.vendaMes2 + dados.vendaMes3;
    const mediaMensal = vendaTotal / MESES_FECHADOS;
    const coberturaGeral = mediaMensal > 0 ? round(dados.estoque / mediaMensal, 2) : null;
    const skusEmRisco = detalhes.filter((d) => d.status === 'risco').length;
    const percentGradeEmRisco = detalhes.length > 0 ? round((skusEmRisco / detalhes.length) * 100, 1) : 0;
    const status = getStatus(percentGradeEmRisco, skusEmRisco);
    if (status === 'critica') referenciasCriticas++;

    return {
      referenceCode,
      referenceName: dados.referenceName,
      curva: curvaPorReferencia.get(referenceCode) || 'C',
      estoqueTotal: round(dados.estoque, 0),
      emProducao: round(dados.emProducao, 0),
      vendaMes1: round(dados.vendaMes1, 0),
      vendaMes2: round(dados.vendaMes2, 0),
      vendaMes3: round(dados.vendaMes3, 0),
      mediaMensal: round(mediaMensal, 2),
      coberturaGeral,
      totalSkus: detalhes.length,
      skusEmRisco,
      percentGradeEmRisco,
      status,
      prioridade: prioridade(curvaPorReferencia.get(referenceCode) || 'C', status),
      detalhes: detalhes.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'risco' ? -1 : 1;
        return a.cor.localeCompare(b.cor) || a.tamanho.localeCompare(b.tamanho);
      }),
      saldoPorFilial: [...(saldoPorFilialPorReferencia.get(referenceCode) || new Map())]
        .map(([branchCode, estoque]) => ({
          branchCode,
          branchName: FILIAIS[branchCode] || `Filial ${branchCode}`,
          estoque: round(estoque, 0),
        }))
        .filter((f) => f.estoque > 0)
        .sort((a, b) => b.estoque - a.estoque),
    };
  });

  referencias.sort((a, b) => a.prioridade - b.prioridade || b.percentGradeEmRisco - a.percentGradeEmRisco || b.mediaMensal - a.mediaMensal);

  return {
    config: {
      mesesFechados: MESES_FECHADOS,
      riscoCoberturaMeses,
      statusAtencaoLimitePercent: STATUS_ATENCAO_LIMITE_PERCENT,
      meses: mesesLabels,
    },
    referencias,
    indicadores: {
      referenciasTotal: referencias.length,
      referenciasCriticas,
      skusEmRiscoTotal,
      totalSkus,
      percentSkusEmRisco: totalSkus > 0 ? round((skusEmRiscoTotal / totalSkus) * 100, 1) : 0,
    },
  };
}

async function getGiroPorProductCode(meses: number, productCodes: number[] | null = null): Promise<Map<number, number>> {
  const filtroProductCode =
    productCodes === null
      ? Prisma.empty
      : productCodes.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND ti.product_code IN (${Prisma.join(productCodes)})`;

  const rows = await prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4 AND ${SALE_OPERATION_FILTER}
      ${filtroProductCode}
    GROUP BY ti.product_code
  `;
  const mapa = new Map<number, number>();
  for (const r of rows) mapa.set(r.product_code, decimalToNumber(r.quantidade));
  return mapa;
}

export async function getCurvaAbcTamanho(filtro: AnaliseGradeFiltro = {}) {
  const productSkusFiltro = await getSkusFiltrados(filtro);
  const rawRows = await getGradeRawRows(filtro, productSkusFiltro);
  const temFiltroClassificacao = productSkusFiltro !== null;
  const productCodesFiltro = temFiltroClassificacao
    ? [...new Set(rawRows.map((r) => r.product_code).filter((c): c is number => c !== null))]
    : null;
  const giroPorProductCode = await getGiroPorProductCode(CURVA_ABC_TAMANHO_MESES, productCodesFiltro);

  const productCodesPorTamanho = new Map<string, Set<number>>();
  for (const row of rawRows) {
    const set = productCodesPorTamanho.get(row.size) || new Set<number>();
    if (row.product_code !== null) set.add(row.product_code);
    productCodesPorTamanho.set(row.size, set);
  }

  const linhas = [...productCodesPorTamanho.entries()]
    .map(([size, productCodes]) => {
      let giro = 0;
      for (const pc of productCodes) giro += giroPorProductCode.get(pc) || 0;
      return { size, giro: round(giro, 0) };
    })
    .filter((l) => l.giro > 0)
    .sort((a, b) => b.giro - a.giro);

  const totalGiro = linhas.reduce((s, l) => s + l.giro, 0);
  let acumulado = 0;
  const resultado = linhas.map((l) => {
    acumulado += l.giro;
    const percentVendas = totalGiro > 0 ? round((l.giro / totalGiro) * 100, 1) : 0;
    const percentAcumulado = totalGiro > 0 ? round((acumulado / totalGiro) * 100, 1) : 0;
    const classe = percentAcumulado <= 80 ? 'A' : percentAcumulado <= 95 ? 'B' : 'C';
    return { size: l.size, giro: l.giro, percentVendas, percentAcumulado, classe };
  });

  return { meses: CURVA_ABC_TAMANHO_MESES, linhas: resultado };
}

