import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { ATACADO_BRANCH_CODE, RELATORIO_BASE_BRANCH_ORDER } from '../config/constants.js';
import { IS_DEVOLUCAO, OPERACAO_JOIN, QUANTIDADE_COM_SINAL, SALE_OPERATION_FILTER } from './relatorioBase.service.js';

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
  const incluiAtacado = branches.includes(ATACADO_BRANCH_CODE);
  const condicoes: Prisma.Sql[] = [];
  if (normais.length) condicoes.push(Prisma.sql`t.branch_code IN (${Prisma.join(normais)})`);
  if (incluiAtacado) condicoes.push(Prisma.sql`(t.branch_code = 2 AND co.description ILIKE '%ATACADO%')`);
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND (${Prisma.join(condicoes, ' OR ')})`;
}

function buildEstoqueBranchFiltro(branches?: number[]): Prisma.Sql {
  if (!branches?.length) return Prisma.empty;

  const codigos = new Set<number>();
  for (const branchCode of branches) {
    if (branchCode === ATACADO_BRANCH_CODE) codigos.add(2);
    else if (branchCode > 0) codigos.add(branchCode);
  }
  if (codigos.size === 0) return Prisma.empty;
  return Prisma.sql`AND branch_code IN (${Prisma.join([...codigos])})`;
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
}

async function getVendaPeriodoTotal(filtro: PerformanceColecaoFiltro): Promise<number> {
  const produtoFiltro = buildProdutoFiltro(filtro, false);
  const vendaBranchFiltro = buildVendaBranchFiltro(filtro.branches);
  const rows = await prisma.$queryRaw<Array<{ total: Decimal | null }>>`
    WITH produtos_filtrados AS (
      SELECT DISTINCT a.product_code
      FROM produto_analitico a
      WHERE a.product_code IS NOT NULL
        AND (a.product_code < 1000000 OR NULLIF(TRIM(a.class_categoria), '') IS NOT NULL)
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

export async function getPerformanceColecao(filtro: PerformanceColecaoFiltro): Promise<PerformanceColecaoResponse> {
  const config = await getConfig();
  const produtoFiltro = buildProdutoFiltro(filtro, true);
  const vendaBranchFiltro = buildVendaBranchFiltro(filtro.branches);
  const estoqueBranchFiltro = buildEstoqueBranchFiltro(filtro.branches);

  const [rows, vendaPeriodoTotal] = await Promise.all([
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
          AND (a.product_code < 1000000 OR NULLIF(TRIM(a.class_categoria), '') IS NOT NULL)
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
          WHERE COALESCE(stock, 0) > 0
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
          SELECT DISTINCT product_code FROM produto_custos WHERE branch_code = ${config.precoCustoBranchCode}
          UNION
          SELECT DISTINCT product_code FROM produto_precos WHERE branch_code = ${config.precoCustoBranchCode}
        ) base
        LEFT JOIN produto_custos c ON c.product_code = base.product_code AND c.branch_code = ${config.precoCustoBranchCode} AND c.cost_code = ${config.custoCode}
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
        SUM(total_estoque_venda) AS total_estoque_venda
      FROM por_produto
      WHERE qtde_produzida <> 0 OR qtde_vendida <> 0 OR estoque_final <> 0
      GROUP BY grupo, reference_code
      ORDER BY SUM(total_venda_valor) DESC, reference_code ASC
    `,
    getVendaPeriodoTotal(filtro),
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

  const inicio = new Date(`${filtro.dataInicio}T00:00:00`);
  const meses = [0, 1, 2].map((offset) => {
    const date = new Date(inicio);
    date.setMonth(date.getMonth() + offset);
    return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  });

  return {
    config: {
      precoCustoBranchCode: config.precoCustoBranchCode,
      custoCode: config.custoCode,
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
