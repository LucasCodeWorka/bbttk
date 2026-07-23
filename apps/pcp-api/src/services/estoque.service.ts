import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { FILIAIS } from '../config/constants.js';

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

interface AnaliticoRow {
  product_sku: string;
  product_code: number | null;
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
  categoria: 'categoria',
  genero: 'genero',
  linha: 'linha',
};

function buildBranchFilter(branchCodes?: number[]) {
  if (!branchCodes || branchCodes.length === 0) return Prisma.empty;
  return Prisma.sql`AND a.branch_code IN (${Prisma.join(branchCodes)})`;
}

function buildProdutoFilter(filtro?: ProdutoFiltro): Prisma.Sql {
  if (!filtro) return Prisma.empty;

  const condicoes: Prisma.Sql[] = [];
  for (const chave of Object.keys(CLASSIFICACAO_COLUNAS) as (keyof ProdutoFiltro)[]) {
    const valores = filtro[chave];
    if (valores && valores.length > 0) {
      condicoes.push(Prisma.sql`TRIM(a.${Prisma.raw(CLASSIFICACAO_COLUNAS[chave])}) IN (${Prisma.join(valores)})`);
    }
  }

  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

function buildCoberturaFilter(cobertura?: CoberturaFiltro): Prisma.Sql {
  if (!cobertura) return Prisma.empty;

  if (cobertura === '6-12') {
    return Prisma.sql`AND a.cobertura_meses >= 6 AND a.cobertura_meses < 12`;
  }

  if (cobertura === '12-24') {
    return Prisma.sql`AND a.cobertura_meses >= 12 AND a.cobertura_meses < 24`;
  }

  return Prisma.sql`AND (a.cobertura_meses >= 24 OR a.cobertura_meses IS NULL)`;
}

function labelDias(dias: number): string {
  return dias > 90 ? '> 90 dias' : `${dias} dias`;
}

function rowBranchName(branchCode: number, branchName?: string | null): string {
  return branchName || FILIAIS[branchCode] || `Filial ${branchCode}`;
}

async function getBaseRows(params: EstoqueSemGiroParams): Promise<AnaliticoRow[]> {
  const branchFilter = buildBranchFilter(params.branchCodes);
  const produtoFilter = buildProdutoFilter(params.produtoFiltro);
  const coberturaFilter = buildCoberturaFilter(params.cobertura);

  return prisma.$queryRaw<AnaliticoRow[]>`
    SELECT
      a.product_sku,
      a.product_code,
      a.reference_code,
      COALESCE(a.descricao, a.reference_name, a.product_name, a.product_sku) as descricao,
      NULLIF(TRIM(a.colecao), '') as colecao,
      a.branch_code,
      a.branch_name,
      a.ultima_venda,
      COALESCE(a.dias_sem_giro, 9999)::int as dias_sem_giro,
      COALESCE(a.quantidade_estoque, 0) as quantidade,
      COALESCE(a.valor_estoque, 0) as valor,
      a.cobertura_meses,
      COALESCE(a.calculated_at, a.captured_at) as atualizado_em
    FROM pcp_estoque_sem_giro_analitico a
    WHERE COALESCE(a.quantidade_estoque, 0) > 0
      AND COALESCE(a.dias_sem_giro, 9999) >= ${params.dias}
      ${branchFilter}
      ${produtoFilter}
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
    { chave: 'categoria', coluna: 'categoria', label: 'Categoria' },
    { chave: 'linha', coluna: 'linha', label: 'Linha' },
    { chave: 'genero', coluna: 'genero', label: 'Genero' },
  ];

  const classificacoes = [];
  for (const dim of dimensoes) {
    const rows = await prisma.$queryRawUnsafe<Array<{ valor: string; qtd: bigint }>>(`
      SELECT TRIM(${dim.coluna}) as valor, COUNT(DISTINCT product_sku) as qtd
      FROM pcp_estoque_sem_giro_analitico
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

  const lojas = await prisma.$queryRaw<Array<{ branch_code: number; branch_name: string | null }>>`
    SELECT branch_code, MAX(branch_name) as branch_name
    FROM pcp_estoque_sem_giro_analitico
    WHERE branch_code IS NOT NULL
    GROUP BY branch_code
    ORDER BY branch_code
  `;

  return {
    classificacoes,
    lojas: lojas.map((loja) => ({
      branch_code: loja.branch_code,
      branch_name: rowBranchName(loja.branch_code, loja.branch_name),
    })),
  };
}