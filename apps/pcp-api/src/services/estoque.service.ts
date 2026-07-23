import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { DEVOLUTION_OPERATIONS, EXCLUDED_OPERATIONS, FILIAIS } from '../config/constants.js';

const EXCLUDED_OPERATIONS_LIST = [...EXCLUDED_OPERATIONS];
const DEVOLUTION_OPERATIONS_LIST = [...DEVOLUTION_OPERATIONS];

const REAL_CUSTOMER_FILTER = Prisma.sql`(t.customer_code IS NULL OR t.customer_code < 110000000)`;
const VALID_SALE_FILTER = Prisma.sql`
  t.status = 4
  AND (t.operation_code IS NULL OR t.operation_code NOT IN (${Prisma.join(EXCLUDED_OPERATIONS_LIST)}))
  AND (t.operation_code IS NULL OR t.operation_code NOT IN (${Prisma.join(DEVOLUTION_OPERATIONS_LIST)}))
  AND ${REAL_CUSTOMER_FILTER}
`;

export interface ProdutoFiltro {
  categoria?: string[];
  genero?: string[];
  linha?: string[];
}

export type CoberturaFiltro = '6-12' | '12-24' | '24+';

export interface EstoqueSemGiroParams {
  dias: number;
  branchCodes?: number[];
  cobertura?: CoberturaFiltro;
  produtoFiltro?: ProdutoFiltro;
  limit?: number;
}

export interface EstoqueSemGiroResumoItem {
  dias: number;
  label: string;
  sku_count: number;
  quantidade: number;
  valor: number;
  pct_total: number;
}

export interface EstoqueSemGiroResumoLoja {
  branch_code: number;
  branch_name: string;
  sku_count: number;
  quantidade: number;
  valor: number;
  pct_quantidade: number;
}

export interface EstoqueSemGiroSku {
  sku: string;
  referencia: string;
  descricao: string;
  colecao: string | null;
  dias_sem_giro: number;
  ultima_venda: string | null;
  quantidade: number;
  valor: number;
  cobertura_meses: number | null;
  lojas: Array<{
    branch_code: number;
    branch_name: string;
    quantidade: number;
  }>;
}

export interface EstoqueSemGiroResponse {
  atualizado_em: string | null;
  dias_selecionado: number;
  resumo: EstoqueSemGiroResumoItem[];
  total: {
    sku_count: number;
    quantidade: number;
    valor: number;
  };
  lojas: Array<{ branch_code: number; branch_name: string }>;
  resumo_lojas: EstoqueSemGiroResumoLoja[];
  top_skus: EstoqueSemGiroSku[];
}

function decimalToNumber(value: Decimal | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

const CLASSIFICACAO_COLUNAS: Record<keyof ProdutoFiltro, string> = {
  categoria: 'class_categoria',
  genero: 'class_genero',
  linha: 'class_linha',
};

function buildBranchFilter(branchCodes?: number[]) {
  if (!branchCodes || branchCodes.length === 0) return Prisma.empty;
  return Prisma.sql`AND s.branch_code IN (${Prisma.join(branchCodes)})`;
}

function buildProdutoFilter(filtro?: ProdutoFiltro): Prisma.Sql {
  if (!filtro) return Prisma.empty;

  const condicoes: Prisma.Sql[] = [];
  for (const chave of Object.keys(CLASSIFICACAO_COLUNAS) as (keyof ProdutoFiltro)[]) {
    const valores = filtro[chave];
    if (valores && valores.length > 0) {
      condicoes.push(Prisma.sql`TRIM(pa.${Prisma.raw(CLASSIFICACAO_COLUNAS[chave])}) IN (${Prisma.join(valores)})`);
    }
  }

  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

function buildCoberturaFilter(cobertura?: CoberturaFiltro): Prisma.Sql {
  if (!cobertura) return Prisma.empty;

  if (cobertura === '6-12') {
    return Prisma.sql`AND cobertura_meses >= 6 AND cobertura_meses < 12`;
  }

  if (cobertura === '12-24') {
    return Prisma.sql`AND cobertura_meses >= 12 AND cobertura_meses < 24`;
  }

  return Prisma.sql`AND (cobertura_meses >= 24 OR cobertura_meses IS NULL)`;
}

function labelDias(dias: number): string {
  return dias > 90 ? '> 90 dias' : `${dias} dias`;
}

function rowBranchName(branchCode: number, branchName?: string | null): string {
  return branchName || FILIAIS[branchCode] || `Filial ${branchCode}`;
}

async function getBaseRows(params: EstoqueSemGiroParams) {
  const branchFilter = buildBranchFilter(params.branchCodes);
  const produtoFilter = buildProdutoFilter(params.produtoFiltro);
  const coberturaFilter = buildCoberturaFilter(params.cobertura);

  return prisma.$queryRaw<Array<{
    product_sku: string;
    product_code: number;
    reference_code: string | null;
    descricao: string | null;
    colecao: string | null;
    branch_code: number;
    branch_name: string | null;
    ultima_venda: Date | null;
    dias_sem_giro: number;
    quantidade: Decimal;
    valor: Decimal;
    cobertura_meses: Decimal | null;
    atualizado_em: Date | null;
  }>>`
    WITH latest_stock AS (
      SELECT DISTINCT ON (ps.product_sku, ps.branch_code, ps.stock_code)
        ps.product_sku,
        ps.product_code,
        ps.branch_code,
        ps.stock_code,
        ps.stock,
        ps.captured_at
      FROM prd_saldo ps
      WHERE COALESCE(ps.stock, 0) > 0
      ORDER BY ps.product_sku, ps.branch_code, ps.stock_code, ps.captured_at DESC
    ),
    stock_by_sku_branch AS (
      SELECT
        product_sku,
        product_code,
        branch_code,
        SUM(stock) as quantidade,
        MAX(captured_at) as atualizado_em
      FROM latest_stock
      GROUP BY product_sku, product_code, branch_code
    ),
    vendas_validas AS (
      SELECT
        ti.product_code,
        t.branch_code,
        t.transaction_date,
        COALESCE(ti.quantity, 0) as quantity,
        COALESCE(ti.net_value, 0) as net_value
      FROM transacao_itens ti
      JOIN transacoes t ON t.branch_code = ti.branch_code
        AND t.transaction_code = ti.transaction_code
      WHERE ${VALID_SALE_FILTER}
        AND ti.seller_code != 1
        AND COALESCE(ti.quantity, 0) > 0
    ),
    ultima_venda AS (
      SELECT
        product_code,
        branch_code,
        MAX(transaction_date) as ultima_venda
      FROM vendas_validas
      GROUP BY product_code, branch_code
    ),
    preco_medio AS (
      SELECT
        product_code,
        SUM(net_value) / NULLIF(SUM(quantity), 0) as preco_unitario
      FROM vendas_validas
      WHERE transaction_date >= CURRENT_DATE - INTERVAL '365 days'
      GROUP BY product_code
    ),
    venda_media AS (
      SELECT
        product_code,
        branch_code,
        SUM(quantity) / 6 as media_mensal
      FROM vendas_validas
      WHERE transaction_date >= CURRENT_DATE - INTERVAL '180 days'
      GROUP BY product_code, branch_code
    ),
    base AS (
      SELECT
        s.product_sku,
        s.product_code,
        p.reference_code,
        COALESCE(p.reference_name, p.product_name, s.product_sku) as descricao,
        NULLIF(TRIM(pa.class_colecao), '') as colecao,
        s.branch_code,
        b.branch_name,
        uv.ultima_venda,
        COALESCE((CURRENT_DATE - uv.ultima_venda), 9999)::int as dias_sem_giro,
        s.quantidade,
        COALESCE(s.quantidade * pm.preco_unitario, 0) as valor,
        CASE
          WHEN vm.media_mensal > 0 THEN s.quantidade / vm.media_mensal
          ELSE NULL
        END as cobertura_meses,
        s.atualizado_em
      FROM stock_by_sku_branch s
      JOIN produtos p ON p.product_sku = s.product_sku
      LEFT JOIN branches b ON b.branch_code = s.branch_code
      LEFT JOIN produto_analitico pa ON pa.product_code = s.product_code
      LEFT JOIN ultima_venda uv ON uv.product_code = s.product_code AND uv.branch_code = s.branch_code
      LEFT JOIN preco_medio pm ON pm.product_code = s.product_code
      LEFT JOIN venda_media vm ON vm.product_code = s.product_code AND vm.branch_code = s.branch_code
      WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
        ${branchFilter}
        ${produtoFilter}
    )
    SELECT *
    FROM base
    WHERE dias_sem_giro >= ${params.dias}
      ${coberturaFilter}
    ORDER BY dias_sem_giro DESC, valor DESC
  `;
}

export async function getEstoqueSemGiro(params: EstoqueSemGiroParams): Promise<EstoqueSemGiroResponse> {
  const diasSelecionado = params.dias > 90 ? 91 : params.dias;
  const rows = await getBaseRows({ ...params, dias: diasSelecionado });
  const thresholds = [30, 60, 90, 91];

  const resumoRows = await Promise.all(
    thresholds.map(async (dias) => {
      const bucketRows = await getBaseRows({ ...params, dias });
      const skuSet = new Set(bucketRows.map((row) => row.product_sku));
      const quantidade = bucketRows.reduce((sum, row) => sum + decimalToNumber(row.quantidade), 0);
      const valor = bucketRows.reduce((sum, row) => sum + decimalToNumber(row.valor), 0);
      return {
        dias,
        label: labelDias(dias),
        sku_count: skuSet.size,
        quantidade,
        valor,
      };
    })
  );

  const totalSkuSet = new Set(rows.map((row) => row.product_sku));
  const totalQuantidade = rows.reduce((sum, row) => sum + decimalToNumber(row.quantidade), 0);
  const totalValor = rows.reduce((sum, row) => sum + decimalToNumber(row.valor), 0);
  const baseTotal = resumoRows[0]?.sku_count || 0;

  const resumo = resumoRows.map((row) => ({
    ...row,
    quantidade: round(row.quantidade, 0),
    valor: round(row.valor),
    pct_total: baseTotal > 0 ? round((row.sku_count / baseTotal) * 100, 1) : 0,
  }));

  const lojasMap = new Map<number, string>();
  const resumoLojasMap = new Map<number, {
    branch_code: number;
    branch_name: string;
    skuSet: Set<string>;
    quantidade: number;
    valor: number;
  }>();

  rows.forEach((row) => {
    const branchName = rowBranchName(row.branch_code, row.branch_name);
    const quantidade = decimalToNumber(row.quantidade);
    const valor = decimalToNumber(row.valor);
    lojasMap.set(row.branch_code, branchName);

    const resumoLoja = resumoLojasMap.get(row.branch_code) || {
      branch_code: row.branch_code,
      branch_name: branchName,
      skuSet: new Set<string>(),
      quantidade: 0,
      valor: 0,
    };
    resumoLoja.skuSet.add(row.product_sku);
    resumoLoja.quantidade += quantidade;
    resumoLoja.valor += valor;
    resumoLojasMap.set(row.branch_code, resumoLoja);
  });

  const resumoLojas = [...resumoLojasMap.values()]
    .map((loja) => ({
      branch_code: loja.branch_code,
      branch_name: loja.branch_name,
      sku_count: loja.skuSet.size,
      quantidade: round(loja.quantidade, 0),
      valor: round(loja.valor),
      pct_quantidade: totalQuantidade > 0 ? round((loja.quantidade / totalQuantidade) * 100, 1) : 0,
    }))
    .sort((a, b) => a.branch_code - b.branch_code);

  const skuMap = new Map<string, EstoqueSemGiroSku>();
  for (const row of rows) {
    const atual = skuMap.get(row.product_sku);
    const quantidade = decimalToNumber(row.quantidade);
    const valor = decimalToNumber(row.valor);
    const cobertura = row.cobertura_meses === null ? null : decimalToNumber(row.cobertura_meses);

    if (!atual) {
      skuMap.set(row.product_sku, {
        sku: row.product_sku,
        referencia: row.reference_code || row.product_sku,
        descricao: row.descricao || row.product_sku,
        colecao: row.colecao,
        dias_sem_giro: row.dias_sem_giro,
        ultima_venda: row.ultima_venda ? row.ultima_venda.toISOString().split('T')[0] : null,
        quantidade: round(quantidade, 0),
        valor: round(valor),
        cobertura_meses: cobertura === null ? null : round(cobertura, 1),
        lojas: [
          {
            branch_code: row.branch_code,
            branch_name: rowBranchName(row.branch_code, row.branch_name),
            quantidade: round(quantidade, 0),
          },
        ],
      });
      continue;
    }

    atual.quantidade = round(atual.quantidade + quantidade, 0);
    atual.valor = round(atual.valor + valor);
    atual.dias_sem_giro = Math.max(atual.dias_sem_giro, row.dias_sem_giro);
    atual.cobertura_meses =
      atual.cobertura_meses === null || cobertura === null
        ? null
        : round(Math.max(atual.cobertura_meses, cobertura), 1);
    atual.lojas.push({
      branch_code: row.branch_code,
      branch_name: rowBranchName(row.branch_code, row.branch_name),
      quantidade: round(quantidade, 0),
    });
  }

  const topSkus = [...skuMap.values()]
    .sort((a, b) => b.dias_sem_giro - a.dias_sem_giro || b.valor - a.valor)
    .slice(0, params.limit || 10);

  const atualizadoEm = rows.reduce<Date | null>((latest, row) => {
    if (!row.atualizado_em) return latest;
    if (!latest || row.atualizado_em > latest) return row.atualizado_em;
    return latest;
  }, null);

  return {
    atualizado_em: atualizadoEm ? atualizadoEm.toISOString() : null,
    dias_selecionado: diasSelecionado,
    resumo,
    total: {
      sku_count: totalSkuSet.size,
      quantidade: round(totalQuantidade, 0),
      valor: round(totalValor),
    },
    lojas: [...lojasMap.entries()]
      .map(([branch_code, branch_name]) => ({ branch_code, branch_name }))
      .sort((a, b) => a.branch_code - b.branch_code),
    resumo_lojas: resumoLojas,
    top_skus: topSkus,
  };
}

export async function getFiltrosEstoqueSemGiro() {
  const dimensoes = [
    { chave: 'categoria', coluna: 'class_categoria', label: 'Categoria' },
    { chave: 'linha', coluna: 'class_linha', label: 'Linha' },
    { chave: 'genero', coluna: 'class_genero', label: 'Genero' },
  ];

  const classificacoes = [];
  for (const dim of dimensoes) {
    const rows = await prisma.$queryRawUnsafe<Array<{ valor: string; qtd: bigint }>>(`
      SELECT TRIM(${dim.coluna}) as valor, COUNT(*) as qtd
      FROM produto_analitico
      WHERE ${dim.coluna} IS NOT NULL AND TRIM(${dim.coluna}) NOT IN ('', '.')
      GROUP BY TRIM(${dim.coluna})
      ORDER BY TRIM(${dim.coluna})
    `);

    classificacoes.push({
      chave: dim.chave,
      label: dim.label,
      opcoes: rows.map((row) => ({ valor: row.valor, qtd_skus: Number(row.qtd) })),
    });
  }

  const lojas = await prisma.branches.findMany({
    select: { branch_code: true, branch_name: true },
    orderBy: { branch_code: 'asc' },
  });

  return {
    classificacoes,
    lojas: lojas.map((loja) => ({
      branch_code: loja.branch_code,
      branch_name: rowBranchName(loja.branch_code, loja.branch_name),
    })),
  };
}
