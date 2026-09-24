import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { ATACADO_BRANCH_CODE, ATACADO_STOCK_CODE, DPA_BRANCH_CODE, DPA_STOCK_CODES, RELATORIO_BASE_BRANCH_ORDER } from '../config/constants.js';
import { CUSTO_PRODUCAO_BRANCH_CODE, CUSTO_PRODUCAO_CODE, FABRICA_BRANCH_CODE, IS_DEVOLUCAO, OPERACAO_JOIN, QUANTIDADE_COM_SINAL, SALE_OPERATION_FILTER, PCP_ESTOQUE_LIQUIDO_SKU_FILTER } from './relatorioBase.service.js';

const RELATORIO_KEY = 'relatorio_base';

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export interface PerformanceColecaoFiltro {
  dataInicio: string;
  dataFim: string;
  colecao?: string[];
  branches?: number[];
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  search?: string;
}

export interface PerformanceColecaoRow {
  grupo: string | null;
  referenceCode: string;
  descricao: string;
  categoria: string | null;
  linha: string | null;
  custo: number | null;
  pdvVarejo: number | null;
  markupVarejo: number | null;
  pdvAtacado: number | null;
  markupAtacado: number | null;
  entrouDpa: string | null;
  qtdeProduzida: number;
  vendaMes1: number;
  vendaMes2: number;
  vendaMes3: number;
  valorMes1: number;
  valorMes2: number;
  valorMes3: number;
  estoqueFinal: number;
  giro: number | null;
  totalVendaValor: number;
  totalVendaCusto: number;
  totalEstoqueCusto: number;
  totalEstoqueVenda: number;
}

export interface PerformanceColecaoResumoMes {
  mes: string;
  dataEstoque: string;
  qtdeEntregue: number;
  pecasVendidasColecao: number;
  estoqueFinal: number;
  estoqueValorCusto: number;
  estoqueValorVenda: number;
  markupEstoque: number | null;
  giroPecasPercent: number;
  vendaColecaoValor: number;
  vendaTotalPecas: number;
  participacaoColecaoPecasPercent: number;
}

export interface PerformanceColecaoResumoProducao {
  valorTotal: number;
  custoTotal: number;
  markup: number | null;
  pecas: number;
  precoVendaMedio: number | null;
  precoCustoMedio: number | null;
}

export interface PerformanceColecaoResponse {
  config: {
    precoCustoBranchCode: number;
    custoCode: number;
    pdvVarejoCode: number;
    pdvAtacadoCode: number;
  };
  periodo: {
    dataInicio: string;
    dataFim: string;
    meses: string[];
  };
  kpis: {
    referencias: number;
    qtdeProduzida: number;
    qtdeVendida: number;
    estoqueFinal: number;
    totalVendaValor: number;
    totalVendaCusto: number;
    totalEstoqueCusto: number;
    totalEstoqueVenda: number;
    participacaoColecaoPercent: number;
    giroMedioPercent: number | null;
  };
  resumoProducao: PerformanceColecaoResumoProducao;
  resumoMensal: PerformanceColecaoResumoMes[];
  rows: PerformanceColecaoRow[];
}

function buildProdutoFiltro(filtro: PerformanceColecaoFiltro, incluirColecao: boolean): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (incluirColecao && filtro.colecao?.length) condicoes.push(Prisma.sql`TRIM(a.class_colecao) IN (${Prisma.join(filtro.colecao)})`);
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(a.class_categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(a.class_linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(a.class_genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`TRIM(a.class_status) IN (${Prisma.join(filtro.status)})`);
  if (filtro.search?.trim()) {
    const termo = `%${filtro.search.trim()}%`;
    condicoes.push(Prisma.sql`(
      a.product_sku ILIKE ${termo}
      OR a.reference_code ILIKE ${termo}
      OR a.reference_name ILIKE ${termo}
      OR a.product_name ILIKE ${termo}
    )`);
  }
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

function buildVendaBranchFiltro(branches?: number[]): Prisma.Sql {
  if (!branches?.length) return Prisma.empty;

  const normais = branches.filter((branchCode) => branchCode > 0);
  const incluiDpa = branches.includes(DPA_BRANCH_CODE);
  const incluiAtacado = branches.includes(ATACADO_BRANCH_CODE);
  const condicoes: Prisma.Sql[] = [];
  if (normais.length) condicoes.push(Prisma.sql`t.branch_code IN (${Prisma.join(normais)})`);
  if (incluiDpa) condicoes.push(Prisma.sql`(t.branch_code = ${FABRICA_BRANCH_CODE} AND COALESCE(co.description, '') NOT ILIKE '%ATACADO%')`);
  if (incluiAtacado) condicoes.push(Prisma.sql`(t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%')`);
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND (${Prisma.join(condicoes, ' OR ')})`;
}

function buildEstoqueBranchFiltro(branches?: number[]): Prisma.Sql {
  if (!branches?.length) return Prisma.empty;

  const normais = branches.filter((branchCode) => branchCode > 0);
  const condicoes: Prisma.Sql[] = [];
  if (normais.length) condicoes.push(Prisma.sql`branch_code IN (${Prisma.join(normais)})`);
  if (branches.includes(DPA_BRANCH_CODE)) condicoes.push(Prisma.sql`(branch_code = ${FABRICA_BRANCH_CODE} AND stock_code IN (${Prisma.join(DPA_STOCK_CODES)}))`);
  if (branches.includes(ATACADO_BRANCH_CODE)) condicoes.push(Prisma.sql`(branch_code = ${FABRICA_BRANCH_CODE} AND stock_code = ${ATACADO_STOCK_CODE})`);
  return condicoes.length ? Prisma.sql`AND (${Prisma.join(condicoes, ' OR ')})` : Prisma.sql`AND FALSE`;
}

async function getConfig() {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: RELATORIO_KEY },
    create: { relatorio: RELATORIO_KEY },
    update: {},
  });
}

interface QueryRow {
  grupo: string | null;
  reference_code: string;
  descricao: string | null;
  categoria: string | null;
  linha: string | null;
  custo: Decimal | null;
  pdv_varejo: Decimal | null;
  pdv_atacado: Decimal | null;
  entrou_dpa: Date | null;
  qtde_produzida: Decimal | null;
  qtde_vendida: Decimal | null;
  venda_mes_1: Decimal | null;
  venda_mes_2: Decimal | null;
  venda_mes_3: Decimal | null;
  valor_mes_1: Decimal | null;
  valor_mes_2: Decimal | null;
  valor_mes_3: Decimal | null;
  estoque_final: Decimal | null;
  total_venda_valor: Decimal | null;
  total_venda_custo: Decimal | null;
  total_estoque_custo: Decimal | null;
  total_estoque_venda: Decimal | null;
  total_producao_valor: Decimal | null;
  total_producao_custo: Decimal | null;
}

interface ResumoMensalQueryRow {
  mes_inicio: Date;
  data_estoque: Date;
  qtde_entregue: Decimal | null;
  pecas_vendidas_colecao: Decimal | null;
  estoque_final: Decimal | null;
  estoque_valor_custo: Decimal | null;
  estoque_valor_venda: Decimal | null;
  venda_colecao_valor: Decimal | null;
  venda_total_pecas: Decimal | null;
}

async function getVendaPeriodoTotal(filtro: PerformanceColecaoFiltro): Promise<number> {
  const produtoFiltro = buildProdutoFiltro(filtro, false);
  const vendaBranchFiltro = buildVendaBranchFiltro(filtro.branches);
  const rows = await prisma.$queryRaw<Array<{ total: Decimal | null }>>`
    WITH produtos_filtrados AS (
      SELECT DISTINCT a.product_code
      FROM produto_analitico a
      WHERE a.product_code IS NOT NULL
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${produtoFiltro}
    )
    SELECT COALESCE(SUM(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0)) ELSE COALESCE(ti.net_value, ti.value, 0) END), 0) AS total
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    JOIN produtos_filtrados pf ON pf.product_code = ti.product_code
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= ${filtro.dataInicio}::date
      AND t.transaction_date <= ${filtro.dataFim}::date
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${vendaBranchFiltro}
  `;
  return decimalToNumber(rows[0]?.total);
}

async function getResumoMensal(
  filtro: PerformanceColecaoFiltro,
  config: { precoCustoBranchCode: number; custoCode: number; pdvVarejoCode: number; pdvAtacadoCode: number }
): Promise<PerformanceColecaoResumoMes[]> {
  const produtoFiltroColecao = buildProdutoFiltro(filtro, true);
  const produtoFiltroTotal = buildProdutoFiltro(filtro, false);
  const vendaBranchFiltro = buildVendaBranchFiltro(filtro.branches);
  const estoqueBranchFiltro = buildEstoqueBranchFiltro(filtro.branches);

  const rows = await prisma.$queryRaw<ResumoMensalQueryRow[]>`
    WITH periodos AS (
      SELECT
        mes_inicio::date AS mes_inicio,
        GREATEST(mes_inicio::date, ${filtro.dataInicio}::date) AS venda_inicio,
        LEAST((mes_inicio::date + INTERVAL '1 month' - INTERVAL '1 day')::date, ${filtro.dataFim}::date) AS venda_fim,
        LEAST((mes_inicio::date + INTERVAL '1 month' - INTERVAL '1 day')::date, ${filtro.dataFim}::date) AS data_estoque
      FROM generate_series(
        date_trunc('month', ${filtro.dataInicio}::date),
        date_trunc('month', ${filtro.dataFim}::date),
        INTERVAL '1 month'
      ) AS gs(mes_inicio)
    ),
    produtos_colecao AS (
      SELECT DISTINCT a.product_sku, a.product_code
      FROM produto_analitico a
      WHERE a.product_code IS NOT NULL
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${produtoFiltroColecao}
    ),
    produtos_total AS (
      SELECT DISTINCT a.product_code
      FROM produto_analitico a
      WHERE a.product_code IS NOT NULL
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${produtoFiltroTotal}
    ),
    vendas_colecao AS (
      SELECT
        p.mes_inicio,
        COALESCE(SUM(${QUANTIDADE_COM_SINAL}), 0) AS pecas_vendidas_colecao,
        COALESCE(SUM(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0)) ELSE COALESCE(ti.net_value, ti.value, 0) END), 0) AS venda_colecao_valor
      FROM periodos p
      JOIN transacoes t ON t.transaction_date >= p.venda_inicio AND t.transaction_date <= p.venda_fim
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
      JOIN produtos_colecao pc ON pc.product_code = ti.product_code
      ${OPERACAO_JOIN}
      WHERE t.status = 4
        AND ${SALE_OPERATION_FILTER}
        ${vendaBranchFiltro}
      GROUP BY p.mes_inicio
    ),
    vendas_total AS (
      SELECT
        p.mes_inicio,
        COALESCE(SUM(${QUANTIDADE_COM_SINAL}), 0) AS venda_total_pecas
      FROM periodos p
      JOIN transacoes t ON t.transaction_date >= p.venda_inicio AND t.transaction_date <= p.venda_fim
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
      JOIN produtos_total pt ON pt.product_code = ti.product_code
      ${OPERACAO_JOIN}
      WHERE t.status = 4
        AND ${SALE_OPERATION_FILTER}
        ${vendaBranchFiltro}
      GROUP BY p.mes_inicio
    ),
    entradas AS (
      SELECT
        p.mes_inicio,
        COALESCE(SUM(ABS(COALESCE(ti.quantity, 0))), 0) AS qtde_entregue
      FROM periodos p
      JOIN transacoes t ON t.transaction_date >= p.venda_inicio AND t.transaction_date <= p.venda_fim
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
      JOIN produtos_colecao pc ON pc.product_code = ti.product_code
      ${OPERACAO_JOIN}
      WHERE t.status = 4
        AND co.operations_type = 'E'
        AND NOT ${IS_DEVOLUCAO}
        ${vendaBranchFiltro}
      GROUP BY p.mes_inicio
    ),
    precos AS (
      SELECT
        base.product_code,
        c.valor AS custo,
        pv.valor AS pdv_varejo,
        pa.valor AS pdv_atacado
      FROM (
        SELECT DISTINCT product_code FROM produto_custos WHERE branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE}
        UNION
        SELECT DISTINCT product_code FROM produto_precos WHERE branch_code = ${config.precoCustoBranchCode}
      ) base
      LEFT JOIN produto_custos c ON c.product_code = base.product_code AND c.branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE} AND c.cost_code = ${CUSTO_PRODUCAO_CODE}
      LEFT JOIN produto_precos pv ON pv.product_code = base.product_code AND pv.branch_code = ${config.precoCustoBranchCode} AND pv.price_code = ${config.pdvVarejoCode}
      LEFT JOIN produto_precos pa ON pa.product_code = base.product_code AND pa.branch_code = ${config.precoCustoBranchCode} AND pa.price_code = ${config.pdvAtacadoCode}
    ),
    ultimo_saldo AS (
      SELECT DISTINCT ON (p.mes_inicio, ps.product_sku, ps.branch_code, ps.stock_code)
        p.mes_inicio,
        ps.product_sku,
        pc.product_code,
        ps.branch_code,
        ps.stock_code,
        ps.stock
      FROM periodos p
      JOIN prd_saldo ps ON ps.captured_at <= p.data_estoque + INTERVAL '1 day'
      JOIN produtos_colecao pc ON pc.product_sku = ps.product_sku
      WHERE 1=1
        AND (ps.branch_code != ${FABRICA_BRANCH_CODE} OR ps.stock_code IN (${Prisma.join([...DPA_STOCK_CODES, ATACADO_STOCK_CODE])}))
        ${estoqueBranchFiltro}
      ORDER BY p.mes_inicio, ps.product_sku, ps.branch_code, ps.stock_code, ps.captured_at DESC
    ),
    estoque AS (
      SELECT
        us.mes_inicio,
        COALESCE(SUM(us.stock), 0) AS estoque_final,
        COALESCE(SUM(us.stock * COALESCE(p.custo, 0)), 0) AS estoque_valor_custo,
        COALESCE(SUM(us.stock * COALESCE(p.pdv_varejo, p.pdv_atacado, 0)), 0) AS estoque_valor_venda
      FROM ultimo_saldo us
      LEFT JOIN precos p ON p.product_code = us.product_code
      GROUP BY us.mes_inicio
    )
    SELECT
      p.mes_inicio,
      p.data_estoque,
      COALESCE(e.qtde_entregue, 0) AS qtde_entregue,
      COALESCE(vc.pecas_vendidas_colecao, 0) AS pecas_vendidas_colecao,
      COALESCE(es.estoque_final, 0) AS estoque_final,
      COALESCE(es.estoque_valor_custo, 0) AS estoque_valor_custo,
      COALESCE(es.estoque_valor_venda, 0) AS estoque_valor_venda,
      COALESCE(vc.venda_colecao_valor, 0) AS venda_colecao_valor,
      COALESCE(vt.venda_total_pecas, 0) AS venda_total_pecas
    FROM periodos p
    LEFT JOIN entradas e ON e.mes_inicio = p.mes_inicio
    LEFT JOIN vendas_colecao vc ON vc.mes_inicio = p.mes_inicio
    LEFT JOIN vendas_total vt ON vt.mes_inicio = p.mes_inicio
    LEFT JOIN estoque es ON es.mes_inicio = p.mes_inicio
    ORDER BY p.mes_inicio
  `;

  return rows.map((row) => {
    const pecasVendidasColecao = decimalToNumber(row.pecas_vendidas_colecao);
    const estoqueFinal = decimalToNumber(row.estoque_final);
    const estoqueValorCusto = decimalToNumber(row.estoque_valor_custo);
    const estoqueValorVenda = decimalToNumber(row.estoque_valor_venda);
    const vendaTotalPecas = decimalToNumber(row.venda_total_pecas);
    const baseGiro = pecasVendidasColecao + estoqueFinal;
    return {
      mes: row.mes_inicio.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      dataEstoque: row.data_estoque.toISOString().slice(0, 10),
      qtdeEntregue: round(decimalToNumber(row.qtde_entregue), 0),
      pecasVendidasColecao: round(pecasVendidasColecao, 0),
      estoqueFinal: round(estoqueFinal, 0),
      estoqueValorCusto: round(estoqueValorCusto, 2),
      estoqueValorVenda: round(estoqueValorVenda, 2),
      markupEstoque: estoqueValorCusto > 0 ? round(estoqueValorVenda / estoqueValorCusto, 2) : null,
      giroPecasPercent: baseGiro > 0 ? round((pecasVendidasColecao / baseGiro) * 100, 1) : 0,
      vendaColecaoValor: round(decimalToNumber(row.venda_colecao_valor), 2),
      vendaTotalPecas: round(vendaTotalPecas, 0),
      participacaoColecaoPecasPercent: vendaTotalPecas > 0 ? round((pecasVendidasColecao / vendaTotalPecas) * 100, 1) : 0,
    };
  });
}

export async function getPerformanceColecao(filtro: PerformanceColecaoFiltro): Promise<PerformanceColecaoResponse> {
  const config = await getConfig();
  const produtoFiltro = buildProdutoFiltro(filtro, true);
  const vendaBranchFiltro = buildVendaBranchFiltro(filtro.branches);
  const estoqueBranchFiltro = buildEstoqueBranchFiltro(filtro.branches);

  const [rows, vendaPeriodoTotal, resumoMensal] = await Promise.all([
    prisma.$queryRaw<QueryRow[]>`
      WITH produtos_filtrados AS (
        SELECT
          a.product_sku,
          a.product_code,
          COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku) AS reference_code,
          COALESCE(NULLIF(TRIM(a.reference_name), ''), NULLIF(TRIM(a.product_name), ''), a.product_sku) AS descricao,
          NULLIF(TRIM(a.class_colecao), '') AS grupo,
          NULLIF(TRIM(a.class_categoria), '') AS categoria,
          NULLIF(TRIM(a.class_linha), '') AS linha
        FROM produto_analitico a
        WHERE a.product_code IS NOT NULL
          ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
        ${produtoFiltro}
      ),
      produto_ref AS (
        SELECT
          product_code,
          MIN(reference_code) AS reference_code,
          MIN(descricao) AS descricao,
          MIN(grupo) AS grupo,
          MIN(categoria) AS categoria,
          MIN(linha) AS linha
        FROM produtos_filtrados
        GROUP BY product_code
      ),
      estoque AS (
        WITH ultimo_saldo AS (
          SELECT DISTINCT ON (product_sku, branch_code, stock_code)
            product_sku, product_code, branch_code, stock, captured_at
          FROM prd_saldo
          WHERE 1=1
            AND (branch_code != ${FABRICA_BRANCH_CODE} OR stock_code IN (${Prisma.join([...DPA_STOCK_CODES, ATACADO_STOCK_CODE])}))
            AND captured_at <= ${filtro.dataFim}::date + INTERVAL '1 day'
          ${estoqueBranchFiltro}
          ORDER BY product_sku, branch_code, stock_code, captured_at DESC
        )
        SELECT us.product_code, COALESCE(SUM(us.stock), 0) AS estoque_final
        FROM ultimo_saldo us
        JOIN produto_ref pr ON pr.product_code = us.product_code
        GROUP BY us.product_code
      ),
      vendas AS (
        SELECT
          ti.product_code,
          COALESCE(SUM(${QUANTIDADE_COM_SINAL}), 0) AS qtde_vendida,
          COALESCE(SUM(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0)) ELSE COALESCE(ti.net_value, ti.value, 0) END), 0) AS total_venda_valor,
          COALESCE(SUM(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0)) ELSE COALESCE(ti.net_value, ti.value, 0) END) FILTER (
            WHERE t.transaction_date >= ${filtro.dataInicio}::date
              AND t.transaction_date < (${filtro.dataInicio}::date + INTERVAL '1 month')
          ), 0) AS valor_mes_1,
          COALESCE(SUM(${QUANTIDADE_COM_SINAL}) FILTER (
            WHERE t.transaction_date >= ${filtro.dataInicio}::date
              AND t.transaction_date < (${filtro.dataInicio}::date + INTERVAL '1 month')
          ), 0) AS venda_mes_1,
          COALESCE(SUM(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0)) ELSE COALESCE(ti.net_value, ti.value, 0) END) FILTER (
            WHERE t.transaction_date >= (${filtro.dataInicio}::date + INTERVAL '1 month')
              AND t.transaction_date < (${filtro.dataInicio}::date + INTERVAL '2 months')
          ), 0) AS valor_mes_2,
          COALESCE(SUM(${QUANTIDADE_COM_SINAL}) FILTER (
            WHERE t.transaction_date >= (${filtro.dataInicio}::date + INTERVAL '1 month')
              AND t.transaction_date < (${filtro.dataInicio}::date + INTERVAL '2 months')
          ), 0) AS venda_mes_2,
          COALESCE(SUM(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0)) ELSE COALESCE(ti.net_value, ti.value, 0) END) FILTER (
            WHERE t.transaction_date >= (${filtro.dataInicio}::date + INTERVAL '2 months')
              AND t.transaction_date < (${filtro.dataInicio}::date + INTERVAL '3 months')
          ), 0) AS valor_mes_3,
          COALESCE(SUM(${QUANTIDADE_COM_SINAL}) FILTER (
            WHERE t.transaction_date >= (${filtro.dataInicio}::date + INTERVAL '2 months')
              AND t.transaction_date < (${filtro.dataInicio}::date + INTERVAL '3 months')
          ), 0) AS venda_mes_3
        FROM transacoes t
        JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
        JOIN produto_ref pr ON pr.product_code = ti.product_code
        ${OPERACAO_JOIN}
        WHERE t.transaction_date >= ${filtro.dataInicio}::date
          AND t.transaction_date <= ${filtro.dataFim}::date
          AND t.status = 4
          AND ${SALE_OPERATION_FILTER}
          ${vendaBranchFiltro}
        GROUP BY ti.product_code
      ),
      entradas AS (
        SELECT
          ti.product_code,
          MIN(t.transaction_date) AS entrou_dpa,
          COALESCE(SUM(ABS(COALESCE(ti.quantity, 0))), 0) AS qtde_produzida
        FROM transacoes t
        JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
        JOIN produto_ref pr ON pr.product_code = ti.product_code
        ${OPERACAO_JOIN}
        WHERE t.transaction_date >= ${filtro.dataInicio}::date
          AND t.transaction_date <= ${filtro.dataFim}::date
          AND t.status = 4
          AND co.operations_type = 'E'
          AND NOT ${IS_DEVOLUCAO}
          ${vendaBranchFiltro}
        GROUP BY ti.product_code
      ),
      precos AS (
        SELECT
          base.product_code,
          c.valor AS custo,
          pv.valor AS pdv_varejo,
          pa.valor AS pdv_atacado
        FROM (
          SELECT DISTINCT product_code FROM produto_custos WHERE branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE}
          UNION
          SELECT DISTINCT product_code FROM produto_precos WHERE branch_code = ${config.precoCustoBranchCode}
        ) base
        LEFT JOIN produto_custos c ON c.product_code = base.product_code AND c.branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE} AND c.cost_code = ${CUSTO_PRODUCAO_CODE}
        LEFT JOIN produto_precos pv ON pv.product_code = base.product_code AND pv.branch_code = ${config.precoCustoBranchCode} AND pv.price_code = ${config.pdvVarejoCode}
        LEFT JOIN produto_precos pa ON pa.product_code = base.product_code AND pa.branch_code = ${config.precoCustoBranchCode} AND pa.price_code = ${config.pdvAtacadoCode}
      ),
      por_produto AS (
        SELECT
          pr.*,
          p.custo,
          p.pdv_varejo,
          p.pdv_atacado,
          e.entrou_dpa,
          COALESCE(e.qtde_produzida, 0) AS qtde_produzida,
          COALESCE(v.qtde_vendida, 0) AS qtde_vendida,
          COALESCE(v.venda_mes_1, 0) AS venda_mes_1,
          COALESCE(v.venda_mes_2, 0) AS venda_mes_2,
          COALESCE(v.venda_mes_3, 0) AS venda_mes_3,
          COALESCE(v.valor_mes_1, 0) AS valor_mes_1,
          COALESCE(v.valor_mes_2, 0) AS valor_mes_2,
          COALESCE(v.valor_mes_3, 0) AS valor_mes_3,
          COALESCE(es.estoque_final, 0) AS estoque_final,
          COALESCE(v.total_venda_valor, 0) AS total_venda_valor,
          COALESCE(v.qtde_vendida, 0) * COALESCE(p.custo, 0) AS total_venda_custo,
          COALESCE(es.estoque_final, 0) * COALESCE(p.custo, 0) AS total_estoque_custo,
          COALESCE(es.estoque_final, 0) * COALESCE(p.pdv_varejo, p.pdv_atacado, 0) AS total_estoque_venda
        FROM produto_ref pr
        LEFT JOIN vendas v ON v.product_code = pr.product_code
        LEFT JOIN entradas e ON e.product_code = pr.product_code
        LEFT JOIN estoque es ON es.product_code = pr.product_code
        LEFT JOIN precos p ON p.product_code = pr.product_code
      )
      SELECT
        grupo,
        reference_code,
        MIN(descricao) AS descricao,
        MIN(categoria) AS categoria,
        MIN(linha) AS linha,
        AVG(custo) FILTER (WHERE custo IS NOT NULL) AS custo,
        AVG(pdv_varejo) FILTER (WHERE pdv_varejo IS NOT NULL) AS pdv_varejo,
        AVG(pdv_atacado) FILTER (WHERE pdv_atacado IS NOT NULL) AS pdv_atacado,
        MIN(entrou_dpa) AS entrou_dpa,
        SUM(qtde_produzida) AS qtde_produzida,
        SUM(qtde_vendida) AS qtde_vendida,
        SUM(venda_mes_1) AS venda_mes_1,
        SUM(venda_mes_2) AS venda_mes_2,
        SUM(venda_mes_3) AS venda_mes_3,
        SUM(valor_mes_1) AS valor_mes_1,
        SUM(valor_mes_2) AS valor_mes_2,
        SUM(valor_mes_3) AS valor_mes_3,
        SUM(estoque_final) AS estoque_final,
        SUM(total_venda_valor) AS total_venda_valor,
        SUM(total_venda_custo) AS total_venda_custo,
        SUM(total_estoque_custo) AS total_estoque_custo,
        SUM(total_estoque_venda) AS total_estoque_venda,
        SUM(qtde_produzida * COALESCE(pdv_varejo, 0)) AS total_producao_valor,
        SUM(qtde_produzida * COALESCE(custo, 0)) AS total_producao_custo
      FROM por_produto
      WHERE qtde_produzida <> 0 OR qtde_vendida <> 0 OR estoque_final <> 0
      GROUP BY grupo, reference_code
      ORDER BY SUM(total_venda_valor) DESC, reference_code ASC
    `,
    getVendaPeriodoTotal(filtro),
    getResumoMensal(filtro, config),
  ]);

  const mappedRows: PerformanceColecaoRow[] = rows.map((row) => {
    const custo = row.custo === null ? null : decimalToNumber(row.custo);
    const pdvVarejo = row.pdv_varejo === null ? null : decimalToNumber(row.pdv_varejo);
    const pdvAtacado = row.pdv_atacado === null ? null : decimalToNumber(row.pdv_atacado);
    const qtdeProduzida = decimalToNumber(row.qtde_produzida);
    const qtdeVendida = decimalToNumber(row.qtde_vendida);
    return {
      grupo: row.grupo,
      referenceCode: row.reference_code,
      descricao: row.descricao || row.reference_code,
      categoria: row.categoria,
      linha: row.linha,
      custo: custo === null ? null : round(custo, 2),
      pdvVarejo: pdvVarejo === null ? null : round(pdvVarejo, 2),
      markupVarejo: custo && custo > 0 && pdvVarejo !== null ? round(pdvVarejo / custo, 2) : null,
      pdvAtacado: pdvAtacado === null ? null : round(pdvAtacado, 2),
      markupAtacado: custo && custo > 0 && pdvAtacado !== null ? round(pdvAtacado / custo, 2) : null,
      entrouDpa: row.entrou_dpa ? row.entrou_dpa.toISOString().slice(0, 10) : null,
      qtdeProduzida: round(qtdeProduzida, 0),
      vendaMes1: round(decimalToNumber(row.venda_mes_1), 0),
      vendaMes2: round(decimalToNumber(row.venda_mes_2), 0),
      vendaMes3: round(decimalToNumber(row.venda_mes_3), 0),
      valorMes1: round(decimalToNumber(row.valor_mes_1), 2),
      valorMes2: round(decimalToNumber(row.valor_mes_2), 2),
      valorMes3: round(decimalToNumber(row.valor_mes_3), 2),
      estoqueFinal: round(decimalToNumber(row.estoque_final), 0),
      giro: qtdeProduzida > 0 ? round(qtdeVendida / qtdeProduzida, 2) : null,
      totalVendaValor: round(decimalToNumber(row.total_venda_valor), 2),
      totalVendaCusto: round(decimalToNumber(row.total_venda_custo), 2),
      totalEstoqueCusto: round(decimalToNumber(row.total_estoque_custo), 2),
      totalEstoqueVenda: round(decimalToNumber(row.total_estoque_venda), 2),
    };
  });

  const totals = mappedRows.reduce(
    (acc, row) => {
      acc.qtdeProduzida += row.qtdeProduzida;
      acc.qtdeVendida += row.vendaMes1 + row.vendaMes2 + row.vendaMes3;
      acc.estoqueFinal += row.estoqueFinal;
      acc.totalVendaValor += row.totalVendaValor;
      acc.totalVendaCusto += row.totalVendaCusto;
      acc.totalEstoqueCusto += row.totalEstoqueCusto;
      acc.totalEstoqueVenda += row.totalEstoqueVenda;
      return acc;
    },
    { qtdeProduzida: 0, qtdeVendida: 0, estoqueFinal: 0, totalVendaValor: 0, totalVendaCusto: 0, totalEstoqueCusto: 0, totalEstoqueVenda: 0 }
  );

  const totalProducaoValor = rows.reduce((s, r) => s + decimalToNumber(r.total_producao_valor), 0);
  const totalProducaoCusto = rows.reduce((s, r) => s + decimalToNumber(r.total_producao_custo), 0);

  const inicio = new Date(`${filtro.dataInicio}T00:00:00`);
  const meses = [0, 1, 2].map((offset) => {
    const date = new Date(inicio);
    date.setMonth(date.getMonth() + offset);
    return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  });

  return {
    config: {
      precoCustoBranchCode: config.precoCustoBranchCode,
      custoCode: CUSTO_PRODUCAO_CODE,
      pdvVarejoCode: config.pdvVarejoCode,
      pdvAtacadoCode: config.pdvAtacadoCode,
    },
    periodo: {
      dataInicio: filtro.dataInicio,
      dataFim: filtro.dataFim,
      meses,
    },
    kpis: {
      referencias: mappedRows.length,
      qtdeProduzida: round(totals.qtdeProduzida, 0),
      qtdeVendida: round(totals.qtdeVendida, 0),
      estoqueFinal: round(totals.estoqueFinal, 0),
      totalVendaValor: round(totals.totalVendaValor, 2),
      totalVendaCusto: round(totals.totalVendaCusto, 2),
      totalEstoqueCusto: round(totals.totalEstoqueCusto, 2),
      totalEstoqueVenda: round(totals.totalEstoqueVenda, 2),
      participacaoColecaoPercent: vendaPeriodoTotal > 0 ? round((totals.totalVendaValor / vendaPeriodoTotal) * 100, 1) : 0,
      giroMedioPercent: totals.qtdeProduzida > 0 ? round(totals.qtdeVendida / totals.qtdeProduzida, 2) : null,
    },
    resumoProducao: {
      valorTotal: round(totalProducaoValor, 2),
      custoTotal: round(totalProducaoCusto, 2),
      markup: totalProducaoCusto > 0 ? round(totalProducaoValor / totalProducaoCusto, 2) : null,
      pecas: round(totals.qtdeProduzida, 0),
      precoVendaMedio: totals.qtdeProduzida > 0 ? round(totalProducaoValor / totals.qtdeProduzida, 2) : null,
      precoCustoMedio: totals.qtdeProduzida > 0 ? round(totalProducaoCusto / totals.qtdeProduzida, 2) : null,
    },
    resumoMensal,
    rows: mappedRows,
  };
}

export async function getFiltrosPerformanceColecao() {
  const [colecoes, classificacoes] = await Promise.all([
    prisma.$queryRaw<Array<{ valor: string; qtd: bigint }>>`
      SELECT TRIM(class_colecao) AS valor, COUNT(DISTINCT reference_code) AS qtd
      FROM produto_analitico
      WHERE class_colecao IS NOT NULL AND TRIM(class_colecao) NOT IN ('', '.')
      GROUP BY TRIM(class_colecao)
      ORDER BY TRIM(class_colecao)
    `,
    prisma.$queryRaw<Array<{ chave: string; label: string; valor: string; qtd: bigint }>>`
      SELECT 'categoria' AS chave, 'Categoria' AS label, TRIM(class_categoria) AS valor, COUNT(DISTINCT product_sku) AS qtd
      FROM produto_analitico
      WHERE class_categoria IS NOT NULL AND TRIM(class_categoria) NOT IN ('', '.')
      GROUP BY TRIM(class_categoria)
      UNION ALL
      SELECT 'linha' AS chave, 'Linha' AS label, TRIM(class_linha) AS valor, COUNT(DISTINCT product_sku) AS qtd
      FROM produto_analitico
      WHERE class_linha IS NOT NULL AND TRIM(class_linha) NOT IN ('', '.')
      GROUP BY TRIM(class_linha)
      UNION ALL
      SELECT 'genero' AS chave, 'Genero' AS label, TRIM(class_genero) AS valor, COUNT(DISTINCT product_sku) AS qtd
      FROM produto_analitico
      WHERE class_genero IS NOT NULL AND TRIM(class_genero) NOT IN ('', '.')
      GROUP BY TRIM(class_genero)
      UNION ALL
      SELECT 'status' AS chave, 'Status' AS label, TRIM(class_status) AS valor, COUNT(DISTINCT product_sku) AS qtd
      FROM produto_analitico
      WHERE class_status IS NOT NULL AND TRIM(class_status) NOT IN ('', '.')
      GROUP BY TRIM(class_status)
      ORDER BY chave, valor
    `,
  ]);

  const mapa = new Map<string, { chave: string; label: string; opcoes: { valor: string; qtd_skus: number }[] }>();
  for (const row of classificacoes) {
    const item = mapa.get(row.chave) || { chave: row.chave, label: row.label, opcoes: [] };
    item.opcoes.push({ valor: row.valor, qtd_skus: Number(row.qtd) });
    mapa.set(row.chave, item);
  }

  return {
    colecoes: colecoes.map((row) => ({ valor: row.valor, qtd_skus: Number(row.qtd) })),
    classificacoes: [...mapa.values()],
    lojas: RELATORIO_BASE_BRANCH_ORDER,
  };
}
