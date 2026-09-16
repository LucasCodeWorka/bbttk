import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { ATACADO_BRANCH_CODE, ATACADO_STOCK_CODE, DPA_BRANCH_CODE, DPA_STOCK_CODES, RELATORIO_BASE_BRANCH_ORDER } from '../config/constants.js';
import { FABRICA_BRANCH_CODE, PCP_ESTOQUE_LIQUIDO_SKU_FILTER } from './relatorioBase.service.js';

const RELATORIO_KEY = 'relatorio_base';
const STOCK_CODE_LABELS: Record<number, string> = {
  1: 'FISICO',
  5: 'DPA (SEGUNDA QUALIDADE)',
  8: 'ATACADO',
};

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function stockCodeLabel(stockCode: number, stockDescription?: string | null) {
  const label = STOCK_CODE_LABELS[stockCode] || stockDescription || '';
  return label ? `${stockCode} - ${label}` : String(stockCode);
}

export interface DashboardEstoqueFiltro {
  data: string;
  branches?: number[];
  stockCodes?: number[];
  search?: string;
  tipo?: string[];
  categoria?: string[];
  grupo?: string[];
  linha?: string[];
  colecao?: string[];
  genero?: string[];
  modelo?: string[];
  tecido?: string[];
  lancamento?: string[];
  status?: string[];
  motorPromocional?: string[];
  campanha?: string[];
}

export interface DashboardEstoqueBucket {
  label: string;
  quantidade: number;
  valorCusto: number;
  skus: number;
  referencias: number;
  pctQuantidade: number;
}

export interface DashboardEstoqueSaldoTipo {
  stockCode: number;
  label: string;
  quantidade: number;
}

export interface DashboardEstoqueGrade {
  cor: string;
  tamanho: string;
  quantidade: number;
  valorCusto: number;
  custo: number | null;
  skus: number;
  saldos: DashboardEstoqueSaldoTipo[];
}

export interface DashboardEstoqueReferencia {
  referencia: string;
  descricao: string;
  colecao: string | null;
  linha: string | null;
  categoria: string | null;
  genero: string | null;
  status: string | null;
  quantidade: number;
  valorCusto: number;
  custo: number | null;
  skus: number;
  saldos: DashboardEstoqueSaldoTipo[];
  grades: DashboardEstoqueGrade[];
}

interface BucketRow {
  label: string | null;
  quantidade: Decimal | null;
  valor_custo: Decimal | null;
  skus: bigint | number;
  referencias: bigint | number;
}

interface ReferenciaRow {
  referencia: string | null;
  descricao: string | null;
  colecao: string | null;
  linha: string | null;
  categoria: string | null;
  genero: string | null;
  status: string | null;
  quantidade: Decimal | null;
  valor_custo: Decimal | null;
  custo: Decimal | null;
  skus: bigint | number;
}

interface SaldoTipoRow {
  stock_code: number;
  stock_description: string | null;
  quantidade: Decimal | null;
}

interface ReferenciaSaldoTipoRow extends SaldoTipoRow {
  referencia: string | null;
}

interface GradeRow {
  referencia: string | null;
  cor: string | null;
  tamanho: string | null;
  quantidade: Decimal | null;
  valor_custo: Decimal | null;
  custo: Decimal | null;
  skus: bigint | number;
}

interface GradeSaldoTipoRow extends SaldoTipoRow {
  referencia: string | null;
  cor: string | null;
  tamanho: string | null;
}

interface TotalRow {
  quantidade: Decimal | null;
  valor_custo: Decimal | null;
  skus: bigint | number;
  referencias: bigint | number;
  filiais: bigint | number;
  atualizado_em: Date | null;
}

interface EstoqueTipoRow {
  stock_code: number;
  stock_description: string | null;
  qtd_skus: bigint | number;
}

const CLASS_FIELDS: Record<string, { label: string; column: string }> = {
  tipo: { label: 'Tipo', column: 'class_tipo' },
  categoria: { label: 'Categoria', column: 'class_categoria' },
  grupo: { label: 'Grupo', column: 'class_grupo' },
  linha: { label: 'Linha', column: 'class_linha' },
  colecao: { label: 'Colecao', column: 'class_colecao' },
  genero: { label: 'Genero', column: 'class_genero' },
  modelo: { label: 'Modelo', column: 'class_modelo' },
  tecido: { label: 'Tecido', column: 'class_tecido' },
  lancamento: { label: 'Lancamento', column: 'class_lancamento' },
  status: { label: 'Status', column: 'class_status' },
  motorPromocional: { label: 'Motor Promocional', column: 'class_motor_promocional' },
  campanha: { label: 'Campanha', column: 'class_campanha' },
};

function filtroValores(alias: string, column: string, values?: string[]): Prisma.Sql {
  if (!values?.length) return Prisma.empty;
  return Prisma.sql`AND TRIM(${Prisma.raw(`${alias}.${column}`)}) IN (${Prisma.join(values)})`;
}

function buildProdutoFiltro(filtro: DashboardEstoqueFiltro): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  for (const [key, config] of Object.entries(CLASS_FIELDS)) {
    clauses.push(filtroValores('a', config.column, (filtro as unknown as Record<string, string[] | undefined>)[key]));
  }

  if (filtro.search?.trim()) {
    const termo = `%${filtro.search.trim()}%`;
    clauses.push(Prisma.sql`AND (
      a.product_sku ILIKE ${termo}
      OR a.reference_code ILIKE ${termo}
      OR a.reference_name ILIKE ${termo}
      OR a.product_name ILIKE ${termo}
      OR a.description ILIKE ${termo}
    )`);
  }

  return clauses.length ? Prisma.sql`${Prisma.join(clauses, ' ')}` : Prisma.empty;
}

function buildEstoqueLocalFiltro(branches?: number[], stockCodes?: number[]): Prisma.Sql {
  if (!branches?.length) {
    if (stockCodes?.length) return Prisma.empty;
    return Prisma.sql`AND (ps.branch_code != ${FABRICA_BRANCH_CODE} OR ps.stock_code IN (${Prisma.join([...DPA_STOCK_CODES, ATACADO_STOCK_CODE])}))`;
  }

  const normais = branches.filter((branch) => branch > 0);
  const condicoes: Prisma.Sql[] = [];
  if (normais.length) condicoes.push(Prisma.sql`ps.branch_code IN (${Prisma.join(normais)})`);
  if (branches.includes(DPA_BRANCH_CODE)) condicoes.push(Prisma.sql`(ps.branch_code = ${FABRICA_BRANCH_CODE} AND ps.stock_code IN (${Prisma.join(DPA_STOCK_CODES)}))`);
  if (branches.includes(ATACADO_BRANCH_CODE)) condicoes.push(Prisma.sql`(ps.branch_code = ${FABRICA_BRANCH_CODE} AND ps.stock_code = ${ATACADO_STOCK_CODE})`);
  return condicoes.length ? Prisma.sql`AND (${Prisma.join(condicoes, ' OR ')})` : Prisma.sql`AND FALSE`;
}

function baseCte(filtro: DashboardEstoqueFiltro, custoCode: number, precoCustoBranchCode: number): Prisma.Sql {
  const produtoFiltro = buildProdutoFiltro(filtro);
  const localFiltro = buildEstoqueLocalFiltro(filtro.branches, filtro.stockCodes);
  const stockCodeFiltro = filtro.stockCodes?.length
    ? Prisma.sql`AND ps.stock_code IN (${Prisma.join(filtro.stockCodes)})`
    : Prisma.empty;

  return Prisma.sql`
    WITH produtos_filtrados AS (
      SELECT
        a.product_sku,
        a.product_code,
        COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku) AS referencia,
        COALESCE(NULLIF(TRIM(a.reference_name), ''), NULLIF(TRIM(a.product_name), ''), a.product_sku) AS descricao,
        COALESCE(NULLIF(TRIM(a.color_name), ''), NULLIF(TRIM(a.color_code), '')) AS cor,
        NULLIF(TRIM(a.size), '') AS tamanho,
        NULLIF(TRIM(a.class_colecao), '') AS colecao,
        NULLIF(TRIM(a.class_linha), '') AS linha,
        NULLIF(TRIM(a.class_grupo), '') AS grupo,
        NULLIF(TRIM(a.class_categoria), '') AS categoria,
        NULLIF(TRIM(a.class_genero), '') AS genero,
        NULLIF(TRIM(a.class_status), '') AS status
      FROM produto_analitico a
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      WHERE a.product_code IS NOT NULL
        AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
        ${produtoFiltro}
    ),
    ultimo_saldo AS (
      SELECT DISTINCT ON (ps.product_sku, ps.branch_code, ps.stock_code)
        ps.product_sku,
        ps.product_code,
        ps.branch_code,
        ps.stock_code,
        ps.stock_description,
        ps.stock,
        ps.captured_at
      FROM prd_saldo ps
      JOIN produtos_filtrados pf ON pf.product_sku = ps.product_sku
      WHERE ps.captured_at <= ${filtro.data}::date + INTERVAL '1 day'
        ${localFiltro}
        ${stockCodeFiltro}
      ORDER BY ps.product_sku, ps.branch_code, ps.stock_code, ps.captured_at DESC
    ),
    precos AS (
      SELECT product_code, valor AS custo
      FROM produto_custos
      WHERE branch_code = ${precoCustoBranchCode}
        AND cost_code = ${custoCode}
    ),
    saldo AS (
      SELECT
        pf.product_sku,
        pf.product_code,
        pf.referencia,
        pf.descricao,
        pf.cor,
        pf.tamanho,
        pf.colecao,
        pf.linha,
        pf.grupo,
        pf.categoria,
        pf.genero,
        pf.status,
        CASE
          WHEN us.branch_code = ${FABRICA_BRANCH_CODE} AND us.stock_code IN (${Prisma.join(DPA_STOCK_CODES)}) THEN ${DPA_BRANCH_CODE}
          WHEN us.branch_code = ${FABRICA_BRANCH_CODE} AND us.stock_code = ${ATACADO_STOCK_CODE} THEN ${ATACADO_BRANCH_CODE}
          ELSE us.branch_code
        END::int AS branch_code,
        us.stock_code,
        NULLIF(TRIM(us.stock_description), '') AS stock_description,
        COALESCE(us.stock, 0) AS quantidade,
        pc.custo,
        us.captured_at
      FROM ultimo_saldo us
      JOIN produtos_filtrados pf ON pf.product_sku = us.product_sku
      LEFT JOIN precos pc ON pc.product_code = pf.product_code
    ),
    saldo_sku AS (
      SELECT
        product_sku,
        MIN(product_code) AS product_code,
        MIN(referencia) AS referencia,
        MIN(descricao) AS descricao,
        MIN(cor) AS cor,
        MIN(tamanho) AS tamanho,
        MIN(colecao) AS colecao,
        MIN(linha) AS linha,
        MIN(grupo) AS grupo,
        MIN(categoria) AS categoria,
        MIN(genero) AS genero,
        MIN(status) AS status,
        AVG(custo) FILTER (WHERE custo IS NOT NULL) AS custo,
        SUM(quantidade) AS quantidade,
        SUM(quantidade * COALESCE(custo, 0)) AS valor_custo,
        MAX(captured_at) AS captured_at
      FROM saldo
      GROUP BY product_sku
      HAVING SUM(quantidade) <> 0
    )
  `;
}

function formatBuckets(rows: BucketRow[], totalQuantidade: number): DashboardEstoqueBucket[] {
  return rows.map((row) => {
    const quantidade = decimalToNumber(row.quantidade);
    return {
      label: row.label || 'Sem classificacao',
      quantidade: round(quantidade, 0),
      valorCusto: round(decimalToNumber(row.valor_custo), 2),
      skus: Number(row.skus),
      referencias: Number(row.referencias),
      pctQuantidade: totalQuantidade > 0 ? round((quantidade / totalQuantidade) * 100, 2) : 0,
    };
  });
}

async function getConfig() {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: RELATORIO_KEY },
    create: { relatorio: RELATORIO_KEY },
    update: {},
  });
}

async function getBuckets(filtro: DashboardEstoqueFiltro, custoCode: number, precoCustoBranchCode: number, dimensao: 'colecao' | 'linha' | 'grupo' | 'categoria' | 'genero' | 'status') {
  const column = Prisma.raw(dimensao);
  return prisma.$queryRaw<BucketRow[]>`
    ${baseCte(filtro, custoCode, precoCustoBranchCode)}
    SELECT
      ${column} AS label,
      SUM(quantidade) AS quantidade,
      SUM(valor_custo) AS valor_custo,
      COUNT(DISTINCT product_sku) AS skus,
      COUNT(DISTINCT referencia) AS referencias
    FROM saldo_sku
    GROUP BY ${column}
    ORDER BY SUM(quantidade) DESC
    LIMIT 12
  `;
}

async function getBucketFilial(filtro: DashboardEstoqueFiltro, custoCode: number, precoCustoBranchCode: number) {
  return prisma.$queryRaw<BucketRow[]>`
    ${baseCte(filtro, custoCode, precoCustoBranchCode)}
    SELECT
      branch_code::text AS label,
      SUM(quantidade) AS quantidade,
      SUM(quantidade * COALESCE(custo, 0)) AS valor_custo,
      COUNT(DISTINCT product_sku) AS skus,
      COUNT(DISTINCT referencia) AS referencias
    FROM saldo
    WHERE quantidade <> 0
    GROUP BY branch_code
    ORDER BY SUM(quantidade) DESC
    LIMIT 12
  `;
}

function formatFilialBuckets(rows: BucketRow[], totalQuantidade: number): DashboardEstoqueBucket[] {
  return rows.map((row) => {
    const branchCode = Number(row.label);
    const branchInfo = RELATORIO_BASE_BRANCH_ORDER.find((item) => item.branchCode === branchCode);
    const quantidade = decimalToNumber(row.quantidade);
    return {
      label: branchInfo?.label || `Filial ${row.label}`,
      quantidade: round(quantidade, 0),
      valorCusto: round(decimalToNumber(row.valor_custo), 2),
      skus: Number(row.skus),
      referencias: Number(row.referencias),
      pctQuantidade: totalQuantidade > 0 ? round((quantidade / totalQuantidade) * 100, 2) : 0,
    };
  });
}

function formatSaldoTipo(stockCode: number, stockDescription: string | null, quantidade: Decimal | number | null | undefined): DashboardEstoqueSaldoTipo {
  return {
    stockCode,
    label: stockCodeLabel(stockCode, stockDescription),
    quantidade: round(decimalToNumber(quantidade), 0),
  };
}

function gradeKey(referencia: string, cor: string, tamanho: string) {
  return `${referencia}||${cor}||${tamanho}`;
}

export async function getDashboardEstoque(filtro: DashboardEstoqueFiltro) {
  const config = await getConfig();
  const [
    totais,
    porColecao,
    porLinha,
    porCategoria,
    porFilial,
    tiposSaldoRows,
    referenciasRows,
    referenciaSaldosRows,
    gradeRows,
    gradeSaldosRows,
  ] = await Promise.all([
    prisma.$queryRaw<TotalRow[]>`
      ${baseCte(filtro, config.custoCode, config.precoCustoBranchCode)}
      SELECT
        SUM(quantidade) AS quantidade,
        SUM(quantidade * COALESCE(custo, 0)) AS valor_custo,
        COUNT(DISTINCT product_sku) AS skus,
        COUNT(DISTINCT referencia) AS referencias,
        COUNT(DISTINCT branch_code) AS filiais,
        MAX(captured_at) AS atualizado_em
      FROM saldo
      WHERE quantidade <> 0
    `,
    getBuckets(filtro, config.custoCode, config.precoCustoBranchCode, 'colecao'),
    getBuckets(filtro, config.custoCode, config.precoCustoBranchCode, 'linha'),
    getBuckets(filtro, config.custoCode, config.precoCustoBranchCode, 'categoria'),
    getBucketFilial(filtro, config.custoCode, config.precoCustoBranchCode),
    prisma.$queryRaw<SaldoTipoRow[]>`
      ${baseCte(filtro, config.custoCode, config.precoCustoBranchCode)}
      SELECT
        stock_code,
        MIN(stock_description) AS stock_description,
        SUM(quantidade) AS quantidade
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY stock_code
      ORDER BY stock_code
    `,
    prisma.$queryRaw<ReferenciaRow[]>`
      ${baseCte(filtro, config.custoCode, config.precoCustoBranchCode)}
      SELECT
        referencia,
        MIN(descricao) AS descricao,
        MIN(colecao) AS colecao,
        MIN(linha) AS linha,
        MIN(categoria) AS categoria,
        MIN(genero) AS genero,
        MIN(status) AS status,
        SUM(quantidade) AS quantidade,
        SUM(quantidade * COALESCE(custo, 0)) AS valor_custo,
        AVG(custo) FILTER (WHERE custo IS NOT NULL) AS custo,
        COUNT(DISTINCT product_sku) AS skus
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY referencia
      ORDER BY SUM(quantidade) DESC, SUM(quantidade * COALESCE(custo, 0)) DESC
    `,
    prisma.$queryRaw<ReferenciaSaldoTipoRow[]>`
      ${baseCte(filtro, config.custoCode, config.precoCustoBranchCode)}
      SELECT
        referencia,
        stock_code,
        MIN(stock_description) AS stock_description,
        SUM(quantidade) AS quantidade
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY referencia, stock_code
      ORDER BY referencia, stock_code
    `,
    prisma.$queryRaw<GradeRow[]>`
      ${baseCte(filtro, config.custoCode, config.precoCustoBranchCode)}
      SELECT
        referencia,
        COALESCE(cor, 'SEM COR') AS cor,
        COALESCE(tamanho, 'SEM TAM') AS tamanho,
        SUM(quantidade) AS quantidade,
        SUM(quantidade * COALESCE(custo, 0)) AS valor_custo,
        AVG(custo) FILTER (WHERE custo IS NOT NULL) AS custo,
        COUNT(DISTINCT product_sku) AS skus
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY referencia, COALESCE(cor, 'SEM COR'), COALESCE(tamanho, 'SEM TAM')
      ORDER BY referencia, COALESCE(cor, 'SEM COR'), COALESCE(tamanho, 'SEM TAM')
    `,
    prisma.$queryRaw<GradeSaldoTipoRow[]>`
      ${baseCte(filtro, config.custoCode, config.precoCustoBranchCode)}
      SELECT
        referencia,
        COALESCE(cor, 'SEM COR') AS cor,
        COALESCE(tamanho, 'SEM TAM') AS tamanho,
        stock_code,
        MIN(stock_description) AS stock_description,
        SUM(quantidade) AS quantidade
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY referencia, COALESCE(cor, 'SEM COR'), COALESCE(tamanho, 'SEM TAM'), stock_code
      ORDER BY referencia, COALESCE(cor, 'SEM COR'), COALESCE(tamanho, 'SEM TAM'), stock_code
    `,
  ]);

  const total = totais[0];
  const totalQuantidade = decimalToNumber(total?.quantidade);

  const tiposSaldo = tiposSaldoRows.map((row) => formatSaldoTipo(row.stock_code, row.stock_description, row.quantidade));

  const saldosPorReferencia = new Map<string, DashboardEstoqueSaldoTipo[]>();
  for (const row of referenciaSaldosRows) {
    const referencia = row.referencia || '';
    const arr = saldosPorReferencia.get(referencia) || [];
    arr.push(formatSaldoTipo(row.stock_code, row.stock_description, row.quantidade));
    saldosPorReferencia.set(referencia, arr);
  }

  const saldosPorGrade = new Map<string, DashboardEstoqueSaldoTipo[]>();
  for (const row of gradeSaldosRows) {
    const referencia = row.referencia || '';
    const cor = row.cor || 'SEM COR';
    const tamanho = row.tamanho || 'SEM TAM';
    const key = gradeKey(referencia, cor, tamanho);
    const arr = saldosPorGrade.get(key) || [];
    arr.push(formatSaldoTipo(row.stock_code, row.stock_description, row.quantidade));
    saldosPorGrade.set(key, arr);
  }

  const gradesPorReferencia = new Map<string, DashboardEstoqueGrade[]>();
  for (const row of gradeRows) {
    const referencia = row.referencia || '';
    const cor = row.cor || 'SEM COR';
    const tamanho = row.tamanho || 'SEM TAM';
    const grade: DashboardEstoqueGrade = {
      cor,
      tamanho,
      quantidade: round(decimalToNumber(row.quantidade), 0),
      valorCusto: round(decimalToNumber(row.valor_custo), 2),
      custo: row.custo === null ? null : round(decimalToNumber(row.custo), 2),
      skus: Number(row.skus),
      saldos: saldosPorGrade.get(gradeKey(referencia, cor, tamanho)) || [],
    };
    const arr = gradesPorReferencia.get(referencia) || [];
    arr.push(grade);
    gradesPorReferencia.set(referencia, arr);
  }

  const itens: DashboardEstoqueReferencia[] = referenciasRows.map((row) => {
    const referencia = row.referencia || '';
    return {
      referencia,
      descricao: row.descricao || referencia,
      colecao: row.colecao,
      linha: row.linha,
      categoria: row.categoria,
      genero: row.genero,
      status: row.status,
      quantidade: round(decimalToNumber(row.quantidade), 0),
      valorCusto: round(decimalToNumber(row.valor_custo), 2),
      custo: row.custo === null ? null : round(decimalToNumber(row.custo), 2),
      skus: Number(row.skus),
      saldos: saldosPorReferencia.get(referencia) || [],
      grades: gradesPorReferencia.get(referencia) || [],
    };
  });

  return {
    data: filtro.data,
    atualizadoEm: total?.atualizado_em ? total.atualizado_em.toISOString() : null,
    config: {
      precoCustoBranchCode: config.precoCustoBranchCode,
      custoCode: config.custoCode,
    },
    total: {
      quantidade: round(totalQuantidade, 0),
      valorCusto: round(decimalToNumber(total?.valor_custo), 2),
      skus: Number(total?.skus || 0),
      referencias: Number(total?.referencias || 0),
      filiais: Number(total?.filiais || 0),
    },
    graficos: {
      colecao: formatBuckets(porColecao, totalQuantidade),
      linha: formatBuckets(porLinha, totalQuantidade),
      categoria: formatBuckets(porCategoria, totalQuantidade),
      filial: formatFilialBuckets(porFilial, totalQuantidade),
    },
    tiposSaldo,
    itens,
    lojas: RELATORIO_BASE_BRANCH_ORDER.map((item) => ({ branch_code: item.branchCode, branch_name: item.label })),
  };
}

export async function getFiltrosDashboardEstoque() {
  const [entradas, tiposEstoque] = await Promise.all([
    Promise.all(
    Object.entries(CLASS_FIELDS).map(async ([chave, config]) => {
      const column = Prisma.raw(config.column);
      const rows = await prisma.$queryRaw<Array<{ valor: string; qtd: bigint }>>`
        SELECT TRIM(${column}) AS valor, COUNT(DISTINCT product_sku) AS qtd
        FROM produto_analitico
        WHERE ${column} IS NOT NULL AND TRIM(${column}) NOT IN ('', '.')
        GROUP BY TRIM(${column})
        ORDER BY TRIM(${column})
      `;
      return {
        chave,
        label: config.label,
        opcoes: rows.map((row) => ({ valor: row.valor, qtd_skus: Number(row.qtd) })),
      };
    })
  ),
    prisma.$queryRaw<EstoqueTipoRow[]>`
      SELECT
        stock_code,
        MIN(NULLIF(TRIM(stock_description), '')) AS stock_description,
        COUNT(DISTINCT product_sku) AS qtd_skus
      FROM prd_saldo
      GROUP BY stock_code
      ORDER BY stock_code
    `,
  ]);

  return {
    classificacoes: entradas,
    tiposEstoque: tiposEstoque.map((row) => ({
      stockCode: row.stock_code,
      label: stockCodeLabel(row.stock_code, row.stock_description),
      qtd_skus: Number(row.qtd_skus),
    })),
    lojas: RELATORIO_BASE_BRANCH_ORDER.map((item) => ({ branch_code: item.branchCode, branch_name: item.label })),
  };
}
