import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { filtroLocalEstoqueSql, getColunasEstoque, localEstoqueSql } from './estoqueLocal.service.js';
import { ATACADO_BRANCH_CODE, ATACADO_STOCK_CODE, DPA_BRANCH_CODE, FILIAIS } from '../config/constants.js';
import { AGRUPAMENTO_COR_JOIN, CUSTO_PRODUCAO_BRANCH_CODE, CUSTO_PRODUCAO_CODE, FABRICA_BRANCH_CODE, PCP_ESTOQUE_LIQUIDO_SKU_FILTER } from './relatorioBase.service.js';

const RELATORIO_KEY = 'relatorio_base';
const STOCK_CODE_LABELS: Record<number, string> = {
  1: 'Varejo',
  5: '2ª qualidade',
  8: 'Atacado',
};
const DASHBOARD_DPA_STOCK_CODE = 5;
const DASHBOARD_ESTOQUE_CACHE_MAX_ENTRIES = 20;

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function createDashboardPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

function stockCodeLabel(stockCode: number, stockDescription?: string | null) {
  const dashboardLabel = STOCK_CODE_LABELS[stockCode];
  if (dashboardLabel) return dashboardLabel;
  const label = stockDescription || '';
  return label ? `${stockCode} - ${label}` : String(stockCode);
}

export interface DashboardEstoqueFiltro {
  data: string;
  branches?: number[];
  stockCodes?: number[];
  search?: string;
  produtos?: string[];
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
  // Quando true, "cor" passa a ser o nome do grupo do Agrupamento de Cores (quando
  // aquela cor foi agrupada). Como toda a query deriva a cor da CTE base, a grade
  // cor x tamanho ja soma as cores unificadas sozinha.
  agruparPorCorSalva?: boolean;
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
  valorVarejo: number;
  valorAtacado: number;
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
  valorVarejo: number;
  valorAtacado: number;
  custo: number | null;
  skus: number;
  saldos: DashboardEstoqueSaldoTipo[];
  grades: DashboardEstoqueGrade[];
}

export interface DashboardEstoqueProdutoSugestao {
  referencia: string;
  descricao: string;
  skus: number;
}

interface BucketRow {
  label: string | null;
  quantidade: Decimal | null;
  valor_custo: Decimal | null;
  skus: bigint | number;
  referencias: bigint | number;
}

interface ValorVendaRow {
  valor_varejo: Decimal | null;
  valor_atacado: Decimal | null;
}

interface ReferenciaRow extends ValorVendaRow {
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

interface GradeRow extends ValorVendaRow {
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

interface TotalRow extends ValorVendaRow {
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

interface ProdutoSugestaoRow {
  referencia: string | null;
  descricao: string | null;
  skus: bigint | number;
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

  if (filtro.produtos?.length) {
    clauses.push(Prisma.sql`AND COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku) IN (${Prisma.join(filtro.produtos)})`);
  }

  return clauses.length ? Prisma.sql`${Prisma.join(clauses, ' ')}` : Prisma.empty;
}

function buildEstoqueLocalFiltro(branches?: number[]): Prisma.Sql {
  return filtroLocalEstoqueSql(branches, 'ps');
}

function buildStockCodeFiltro(stockCodes?: number[]): Prisma.Sql {
  return stockCodes?.length ? Prisma.sql`AND ps.stock_code IN (${Prisma.join(stockCodes)})` : Prisma.empty;
}

// Preco de venda (tabela) usado pra valorizar o estoque: mesma filial de referencia e
// mesmas tabelas de varejo/atacado da Visao Geral (config do relatorio_base).
interface PrecoVendaConfig {
  branchCode: number;
  varejoCode: number;
  atacadoCode: number;
}

// Devolutiva "Analise de Estoque" 13/11: no modo agrupado o cliente quer UMA linha por
// cor, somando os tons (claro/medio/escuro) e os tamanhos - "AZUL TOTAL". Os grupos
// cadastrados no Agrupamento de Cores sao de TOM ("azul claro", "amarelo escuro") e
// muitas cores nem estao agrupadas ("AZUL 2103"), entao a familia e: nome do grupo (ou
// da cor, se nao agrupada), sem numeros e sem as palavras de tom.
export const FAMILIA_COR_SQL = Prisma.sql`
  NULLIF(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
    UPPER(COALESCE(NULLIF(TRIM(ag.nome), ''), NULLIF(TRIM(a.color_name), ''), '')),
    '[0-9]+', ' ', 'g'),
    '\\m(CLAR[OA]|M[EÉ]DI[OA]|ESCUR[OA])\\M', ' ', 'g'),
    '\\s+', ' ', 'g')), '')
`;

// Mesma regra dos cards da Visao Geral (montarIndicadoresEstoqueAtivos): SKU conta como
// "com estoque" pelo saldo LIQUIDO somado em todos os locais (+5 numa loja e -5 noutra
// = sem estoque) e status diferente de INATIVO.
const SKU_ATIVO_SQL = Prisma.sql`UPPER(REGEXP_REPLACE(TRIM(COALESCE(status, '')), '\\s+', ' ', 'g')) <> 'INATIVO'`;

function baseCte(filtro: DashboardEstoqueFiltro, preco: PrecoVendaConfig): Prisma.Sql {
  const produtoFiltro = buildProdutoFiltro(filtro);
  const localFiltro = buildEstoqueLocalFiltro(filtro.branches);
  const stockCodeFiltro = buildStockCodeFiltro(filtro.stockCodes);

  // No modo agrupado a cor vira a familia da cor (FAMILIA_COR_SQL), com fallback pra
  // cor original. Trocar aqui basta: a grade e os buckets todos derivam desta CTE; o
  // tamanho some da grade no proprio SELECT da grade (gradeTamanhoSql).
  const corSelect = filtro.agruparPorCorSalva
    ? Prisma.sql`COALESCE(${FAMILIA_COR_SQL}, NULLIF(TRIM(a.color_name), ''), NULLIF(TRIM(a.color_code), ''))`
    : Prisma.sql`COALESCE(NULLIF(TRIM(a.color_name), ''), NULLIF(TRIM(a.color_code), ''))`;

  return Prisma.sql`
    WITH produtos_filtrados AS (
      SELECT
        a.product_sku,
        a.product_code,
        COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku) AS referencia,
        COALESCE(NULLIF(TRIM(a.reference_name), ''), NULLIF(TRIM(a.product_name), ''), a.product_sku) AS descricao,
        ${corSelect} AS cor,
        NULLIF(TRIM(a.size), '') AS tamanho,
        NULLIF(TRIM(a.class_colecao), '') AS colecao,
        NULLIF(TRIM(a.class_linha), '') AS linha,
        NULLIF(TRIM(a.class_grupo), '') AS grupo,
        NULLIF(TRIM(a.class_categoria), '') AS categoria,
        NULLIF(TRIM(a.class_genero), '') AS genero,
        NULLIF(TRIM(a.class_status), '') AS status
      FROM produto_analitico a
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      ${AGRUPAMENTO_COR_JOIN}
      WHERE a.product_code IS NOT NULL
        AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
        AND TRIM(UPPER(COALESCE(a.class_tipo, ''))) <> 'USO E CONSUMO'
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
      WHERE ps.captured_at < ${filtro.data}::date + INTERVAL '1 day'
        ${localFiltro}
        ${stockCodeFiltro}
      ORDER BY ps.product_sku, ps.branch_code, ps.stock_code, ps.captured_at DESC
    ),
    precos AS (
      SELECT product_code, MAX(valor) AS custo
      FROM produto_custos
      WHERE branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE}
        AND cost_code = ${CUSTO_PRODUCAO_CODE}
      GROUP BY product_code
    ),
    pdv AS (
      SELECT
        product_code,
        MAX(valor) FILTER (WHERE price_code = ${preco.varejoCode}) AS pdv_var,
        MAX(valor) FILTER (WHERE price_code = ${preco.atacadoCode}) AS pdv_ata
      FROM produto_precos
      WHERE branch_code = ${preco.branchCode}
        AND price_code IN (${preco.varejoCode}, ${preco.atacadoCode})
      GROUP BY product_code
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
        ${localEstoqueSql('us')} AS branch_code,
        us.stock_code,
        NULLIF(TRIM(us.stock_description), '') AS stock_description,
        COALESCE(us.stock, 0) AS quantidade,
        pc.custo,
        pv.pdv_var,
        pv.pdv_ata,
        us.captured_at
      FROM ultimo_saldo us
      JOIN produtos_filtrados pf ON pf.product_sku = us.product_sku
      LEFT JOIN precos pc ON pc.product_code = pf.product_code
      LEFT JOIN pdv pv ON pv.product_code = pf.product_code
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

async function getConfig(db: PrismaClient = prisma) {
  return db.pcpRelatorioConfig.upsert({
    where: { relatorio: RELATORIO_KEY },
    create: { relatorio: RELATORIO_KEY },
    update: {},
  });
}

async function getBuckets(db: PrismaClient, filtro: DashboardEstoqueFiltro, preco: PrecoVendaConfig, dimensao: 'colecao' | 'linha' | 'grupo' | 'categoria' | 'genero' | 'status') {
  const column = Prisma.raw(dimensao);
  return db.$queryRaw<BucketRow[]>`
    ${baseCte(filtro, preco)}
    SELECT
      ${column} AS label,
      SUM(quantidade) AS quantidade,
      SUM(valor_custo) AS valor_custo,
      COUNT(DISTINCT product_sku) AS skus,
      COUNT(DISTINCT referencia) AS referencias
    FROM saldo_sku
    GROUP BY ${column}
    ORDER BY SUM(quantidade) DESC
  `;
}

async function getBucketFilial(db: PrismaClient, filtro: DashboardEstoqueFiltro, preco: PrecoVendaConfig) {
  return db.$queryRaw<BucketRow[]>`
    ${baseCte(filtro, preco)}
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
  `;
}

function formatFilialBuckets(rows: BucketRow[], totalQuantidade: number): DashboardEstoqueBucket[] {
  return rows.map((row) => {
    const branchCode = Number(row.label);
    const quantidade = decimalToNumber(row.quantidade);
    return {
      label: FILIAIS[branchCode] || `Filial ${row.label}`,
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

function normalizeList(values?: Array<string | number>) {
  return values?.map((value) => String(value)).sort() || [];
}

function dashboardEstoqueCacheKey(filtro: DashboardEstoqueFiltro) {
  return JSON.stringify({
    data: filtro.data,
    branches: normalizeList(filtro.branches),
    stockCodes: normalizeList(filtro.stockCodes),
    search: filtro.search?.trim() || '',
    produtos: normalizeList(filtro.produtos),
    tipo: normalizeList(filtro.tipo),
    categoria: normalizeList(filtro.categoria),
    grupo: normalizeList(filtro.grupo),
    linha: normalizeList(filtro.linha),
    colecao: normalizeList(filtro.colecao),
    genero: normalizeList(filtro.genero),
    modelo: normalizeList(filtro.modelo),
    tecido: normalizeList(filtro.tecido),
    lancamento: normalizeList(filtro.lancamento),
    status: normalizeList(filtro.status),
    motorPromocional: normalizeList(filtro.motorPromocional),
    campanha: normalizeList(filtro.campanha),
    // Precisa entrar na chave: o modo agrupado muda a cor de cada linha, entao
    // reaproveitar o cache do modo normal devolveria a grade errada.
    agruparPorCorSalva: filtro.agruparPorCorSalva ?? false,
  });
}

async function calcularDashboardEstoque(db: PrismaClient, filtro: DashboardEstoqueFiltro) {
  const config = await getConfig(db);
  const preco: PrecoVendaConfig = {
    branchCode: config.precoCustoBranchCode,
    varejoCode: config.pdvVarejoCode,
    atacadoCode: config.pdvAtacadoCode,
  };
  // Modo agrupado: uma linha por familia de cor, somando todos os tamanhos.
  const gradeTamanhoSql = filtro.agruparPorCorSalva ? Prisma.sql`'TODOS'` : Prisma.sql`COALESCE(tamanho, 'SEM TAM')`;
  const [
    totais,
    porColecao,
    porLinha,
    porCategoria,
    porStatus,
    porFilial,
    tiposSaldoRows,
    referenciasRows,
    referenciaSaldosRows,
    gradeRows,
    gradeSaldosRows,
  ] = await Promise.all([
    db.$queryRaw<TotalRow[]>`
      ${baseCte(filtro, preco)}
      SELECT
        SUM(quantidade) AS quantidade,
        SUM(quantidade * COALESCE(custo, 0)) AS valor_custo,
        SUM(quantidade * COALESCE(pdv_var, 0)) AS valor_varejo,
        SUM(quantidade * COALESCE(pdv_ata, 0)) AS valor_atacado,
        (SELECT COUNT(*) FROM saldo_sku WHERE ${SKU_ATIVO_SQL}) AS skus,
        (SELECT COUNT(DISTINCT referencia) FROM saldo_sku WHERE ${SKU_ATIVO_SQL}) AS referencias,
        COUNT(DISTINCT branch_code) AS filiais,
        MAX(captured_at) AS atualizado_em
      FROM saldo
      WHERE quantidade <> 0
    `,
    getBuckets(db, filtro, preco, 'colecao'),
    getBuckets(db, filtro, preco, 'linha'),
    getBuckets(db, filtro, preco, 'categoria'),
    getBuckets(db, filtro, preco, 'status'),
    getBucketFilial(db, filtro, preco),
    db.$queryRaw<SaldoTipoRow[]>`
      ${baseCte(filtro, preco)}
      SELECT
        stock_code,
        MIN(stock_description) AS stock_description,
        SUM(quantidade) AS quantidade
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY stock_code
      ORDER BY
        CASE stock_code
          WHEN 1 THEN 1
          WHEN ${ATACADO_STOCK_CODE} THEN 2
          WHEN ${DASHBOARD_DPA_STOCK_CODE} THEN 3
          ELSE 99
        END,
        stock_code
    `,
    db.$queryRaw<ReferenciaRow[]>`
      ${baseCte(filtro, preco)}
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
        SUM(quantidade * COALESCE(pdv_var, 0)) AS valor_varejo,
        SUM(quantidade * COALESCE(pdv_ata, 0)) AS valor_atacado,
        CASE
          WHEN SUM(quantidade) FILTER (WHERE custo IS NOT NULL) = 0 THEN NULL
          ELSE SUM(quantidade * custo) FILTER (WHERE custo IS NOT NULL) / SUM(quantidade) FILTER (WHERE custo IS NOT NULL)
        END AS custo,
        COUNT(DISTINCT product_sku) AS skus
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY referencia
      ORDER BY SUM(quantidade) DESC, SUM(quantidade * COALESCE(custo, 0)) DESC
    `,
    db.$queryRaw<ReferenciaSaldoTipoRow[]>`
      ${baseCte(filtro, preco)}
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
    db.$queryRaw<GradeRow[]>`
      ${baseCte(filtro, preco)}
      SELECT
        referencia,
        COALESCE(cor, 'SEM COR') AS cor,
        ${gradeTamanhoSql} AS tamanho,
        SUM(quantidade) AS quantidade,
        SUM(quantidade * COALESCE(custo, 0)) AS valor_custo,
        SUM(quantidade * COALESCE(pdv_var, 0)) AS valor_varejo,
        SUM(quantidade * COALESCE(pdv_ata, 0)) AS valor_atacado,
        CASE
          WHEN SUM(quantidade) FILTER (WHERE custo IS NOT NULL) = 0 THEN NULL
          ELSE SUM(quantidade * custo) FILTER (WHERE custo IS NOT NULL) / SUM(quantidade) FILTER (WHERE custo IS NOT NULL)
        END AS custo,
        COUNT(DISTINCT product_sku) AS skus
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `,
    db.$queryRaw<GradeSaldoTipoRow[]>`
      ${baseCte(filtro, preco)}
      SELECT
        referencia,
        COALESCE(cor, 'SEM COR') AS cor,
        ${gradeTamanhoSql} AS tamanho,
        stock_code,
        MIN(stock_description) AS stock_description,
        SUM(quantidade) AS quantidade
      FROM saldo
      WHERE quantidade <> 0
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3, 4
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
      valorVarejo: round(decimalToNumber(row.valor_varejo), 2),
      valorAtacado: round(decimalToNumber(row.valor_atacado), 2),
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
      valorVarejo: round(decimalToNumber(row.valor_varejo), 2),
      valorAtacado: round(decimalToNumber(row.valor_atacado), 2),
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
      custoCode: CUSTO_PRODUCAO_CODE,
    },
    total: {
      quantidade: round(totalQuantidade, 0),
      valorCusto: round(decimalToNumber(total?.valor_custo), 2),
      valorVarejo: round(decimalToNumber(total?.valor_varejo), 2),
      valorAtacado: round(decimalToNumber(total?.valor_atacado), 2),
      skus: Number(total?.skus || 0),
      referencias: Number(total?.referencias || 0),
      filiais: Number(total?.filiais || 0),
    },
    graficos: {
      colecao: formatBuckets(porColecao, totalQuantidade),
      linha: formatBuckets(porLinha, totalQuantidade),
      categoria: formatBuckets(porCategoria, totalQuantidade),
      status: formatBuckets(porStatus, totalQuantidade),
      filial: formatFilialBuckets(porFilial, totalQuantidade),
    },
    tiposSaldo,
    itens,
    lojas: (await getColunasEstoque()).map((item) => ({ branch_code: item.branchCode, branch_name: item.label })),
  };
}

type DashboardEstoqueData = Awaited<ReturnType<typeof calcularDashboardEstoque>>;
const dashboardEstoqueCache = new Map<string, { data: DashboardEstoqueData; createdAt: number }>();

export async function getDashboardEstoque(filtro: DashboardEstoqueFiltro, options: { refresh?: boolean } = {}) {
  const key = dashboardEstoqueCacheKey(filtro);
  if (!options.refresh) {
    const cached = dashboardEstoqueCache.get(key);
    if (cached) return { data: cached.data, fromCache: true };
  }

  const db = createDashboardPrisma();
  try {
    const data = await calcularDashboardEstoque(db, filtro);
    dashboardEstoqueCache.set(key, { data, createdAt: Date.now() });

    while (dashboardEstoqueCache.size > DASHBOARD_ESTOQUE_CACHE_MAX_ENTRIES) {
      const oldest = [...dashboardEstoqueCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0];
      if (!oldest) break;
      dashboardEstoqueCache.delete(oldest);
    }

    return { data, fromCache: false };
  } finally {
    await db.$disconnect().catch((error) => {
      console.error('Erro ao fechar conexao temporaria do dashboard de estoque:', error);
    });
  }
}

export async function buscarProdutosDashboardEstoque(search: string): Promise<DashboardEstoqueProdutoSugestao[]> {
  const termo = search.trim();
  if (termo.length < 2) return [];

  const like = `%${termo}%`;
  const rows = await prisma.$queryRaw<ProdutoSugestaoRow[]>`
    SELECT
      COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku) AS referencia,
      COALESCE(NULLIF(TRIM(a.reference_name), ''), NULLIF(TRIM(a.product_name), ''), a.product_sku) AS descricao,
      COUNT(DISTINCT a.product_sku) AS skus
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE a.product_code IS NOT NULL
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      AND (
        a.product_sku ILIKE ${like}
        OR a.reference_code ILIKE ${like}
        OR a.reference_name ILIKE ${like}
        OR a.product_name ILIKE ${like}
        OR a.description ILIKE ${like}
      )
    GROUP BY
      COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku),
      COALESCE(NULLIF(TRIM(a.reference_name), ''), NULLIF(TRIM(a.product_name), ''), a.product_sku)
    ORDER BY
      CASE WHEN COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku) ILIKE ${`${termo}%`} THEN 0 ELSE 1 END,
      COALESCE(NULLIF(TRIM(a.reference_code), ''), a.product_sku)
    LIMIT 30
  `;

  return rows.map((row) => ({
    referencia: row.referencia || '',
    descricao: row.descricao || row.referencia || '',
    skus: Number(row.skus),
  }));
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
      ORDER BY
        CASE stock_code
          WHEN 1 THEN 1
          WHEN ${ATACADO_STOCK_CODE} THEN 2
          WHEN ${DASHBOARD_DPA_STOCK_CODE} THEN 3
          ELSE 99
        END,
        stock_code
    `,
  ]);

  return {
    classificacoes: entradas,
    tiposEstoque: tiposEstoque.map((row) => ({
      stockCode: row.stock_code,
      label: stockCodeLabel(row.stock_code, row.stock_description),
      qtd_skus: Number(row.qtd_skus),
    })),
    lojas: (await getColunasEstoque()).map((item) => ({ branch_code: item.branchCode, branch_name: item.label })),
  };
}
