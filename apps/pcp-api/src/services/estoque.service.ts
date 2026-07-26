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
  limit?: number | null;
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
  grade: string | null;
  cor_de_para: string | null;
  dias_sem_giro: number;
  ultima_venda: string | null;
  lojas_total: number;
  lojas_sem_venda: number;
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
  cor: string | null;
  tamanho: string | null;
  cor_de_para: string | null;
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
  if (dias <= 30) return 'Ate 30 dias';
  if (dias <= 60) return '31 a 60 dias';
  if (dias <= 90) return '61 a 90 dias';
  return '> 90 dias';
}

function rowBranchName(branchCode: number, branchName?: string | null): string {
  return branchName || FILIAIS[branchCode] || `Filial ${branchCode}`;
}

function buildGrade(cor?: string | null, tamanho?: string | null): string | null {
  const partes = [cor, tamanho].map((value) => value?.trim()).filter(Boolean);
  return partes.length > 0 ? partes.join(' - ') : null;
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
      COALESCE(NULLIF(TRIM(p.color_name), ''), NULLIF(TRIM(p.color_code), '')) as cor,
      NULLIF(TRIM(p.size), '') as tamanho,
      NULLIF(TRIM(ag.nome), '') as cor_de_para,
      a.branch_code,
      COALESCE(NULLIF(TRIM(b.description), ''), NULLIF(TRIM(b.fantasy_name), ''), NULLIF(TRIM(a.branch_name), ''), NULLIF(TRIM(b.branch_name), '')) as branch_name,
      a.ultima_venda,
      COALESCE(a.dias_sem_giro, 9999)::int as dias_sem_giro,
      COALESCE(a.quantidade_estoque, 0) as quantidade,
      COALESCE(a.valor_estoque, 0) as valor,
      a.cobertura_meses,
      COALESCE(a.calculated_at, a.captured_at) as atualizado_em
    FROM pcp_estoque_sem_giro_analitico a
    LEFT JOIN branches b ON b.branch_code = a.branch_code
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    LEFT JOIN agrupamento_membros am
      ON am.tipo = 'cor_produto'
      AND am.reference_code = COALESCE(a.reference_code, p.reference_code)
      AND am.color_match_key = COALESCE(NULLIF(TRIM(p.color_code), ''), NULLIF(TRIM(p.color_name), ''))
    LEFT JOIN agrupamento_grupos ag
      ON ag.id = am.grupo_id
      AND ag.tipo = am.tipo
    WHERE COALESCE(a.quantidade_estoque, 0) > 0
      ${branchFilter}
      ${produtoFilter}
      ${coberturaFilter}
    ORDER BY dias_sem_giro DESC, valor DESC
  `;
}

function isInDiasRange(diasSemGiro: number, diasFiltro: number): boolean {
  const dias = diasSemGiro >= 9999 ? 9999 : diasSemGiro;

  if (diasFiltro <= 30) return dias <= 30;
  if (diasFiltro <= 60) return dias > 30 && dias <= 60;
  if (diasFiltro <= 90) return dias > 60 && dias <= 90;
  return dias > 90;
}

function aggregateSkuRows(rows: AnaliticoRow[]): EstoqueSemGiroSku[] {
  const skuMap = new Map<string, EstoqueSemGiroSku>();

  for (const row of rows) {
    const atual = skuMap.get(row.product_sku);
    const quantidade = decimalToNumber(row.quantidade);
    const valor = decimalToNumber(row.valor);
    const cobertura = row.cobertura_meses === null ? null : decimalToNumber(row.cobertura_meses);
    const ultimaVenda = row.ultima_venda ? row.ultima_venda.toISOString().split('T')[0] : null;
    const semVendaNaLoja = !ultimaVenda || row.dias_sem_giro >= 9999;
    const diasRede = semVendaNaLoja ? 9999 : row.dias_sem_giro;
    const grade = buildGrade(row.cor, row.tamanho);

    if (!atual) {
      skuMap.set(row.product_sku, {
        sku: row.product_sku,
        referencia: row.reference_code || row.product_sku,
        descricao: row.descricao || row.product_sku,
        colecao: row.colecao,
        grade,
        cor_de_para: row.cor_de_para,
        dias_sem_giro: diasRede,
        ultima_venda: ultimaVenda,
        lojas_total: 1,
        lojas_sem_venda: semVendaNaLoja ? 1 : 0,
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

    if (!atual.grade && grade) atual.grade = grade;
    if (!atual.cor_de_para && row.cor_de_para) atual.cor_de_para = row.cor_de_para;
    atual.quantidade = round(atual.quantidade + quantidade, 0);
    atual.valor = round(atual.valor + valor);
    atual.lojas_total += 1;
    if (semVendaNaLoja) atual.lojas_sem_venda += 1;
    if (ultimaVenda && (!atual.ultima_venda || ultimaVenda > atual.ultima_venda)) {
      atual.ultima_venda = ultimaVenda;
    }
    atual.dias_sem_giro = Math.min(atual.dias_sem_giro, diasRede);
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

  return [...skuMap.values()].map((sku) => ({
    ...sku,
    lojas: sku.lojas.sort((a, b) => a.branch_code - b.branch_code),
  }));
}

export async function getEstoqueSemGiro(params: EstoqueSemGiroParams): Promise<EstoqueSemGiroResponse> {
  const diasSelecionado = params.dias > 90 ? 91 : params.dias;
  const allRows = await getBaseRows(params);
  const allSkus = aggregateSkuRows(allRows);
  const thresholds = [30, 60, 90, 91];

  const resumoRows = thresholds.map((dias) => {
    const bucketSkus = allSkus.filter((sku) => isInDiasRange(sku.dias_sem_giro, dias));
    const quantidade = bucketSkus.reduce((sum, sku) => sum + sku.quantidade, 0);
    const valor = bucketSkus.reduce((sum, sku) => sum + sku.valor, 0);

    return {
      dias,
      label: labelDias(dias),
      sku_count: bucketSkus.length,
      quantidade,
      valor,
    };
  });

  const baseTotal = resumoRows.reduce((sum, row) => sum + row.sku_count, 0);
  const resumo = resumoRows.map((row) => ({
    ...row,
    quantidade: round(row.quantidade, 0),
    valor: round(row.valor),
    pct_total: baseTotal > 0 ? round((row.sku_count / baseTotal) * 100, 1) : 0,
  }));

  const selectedSkus = allSkus.filter((sku) => isInDiasRange(sku.dias_sem_giro, diasSelecionado));
  const selectedSkuSet = new Set(selectedSkus.map((sku) => sku.sku));
  const rows = allRows.filter((row) => selectedSkuSet.has(row.product_sku));

  const totalQuantidade = selectedSkus.reduce((sum, sku) => sum + sku.quantidade, 0);
  const totalValor = selectedSkus.reduce((sum, sku) => sum + sku.valor, 0);

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

  const topSkusOrdenados = selectedSkus
    .sort((a, b) => b.dias_sem_giro - a.dias_sem_giro || b.valor - a.valor);
  const topSkus = params.limit && params.limit > 0 ? topSkusOrdenados.slice(0, params.limit) : topSkusOrdenados;

  const atualizadoEm = allRows.reduce<Date | null>((latest, row) => {
    if (!row.atualizado_em) return latest;
    if (!latest || row.atualizado_em > latest) return row.atualizado_em;
    return latest;
  }, null);

  return {
    atualizado_em: atualizadoEm ? atualizadoEm.toISOString() : null,
    dias_selecionado: diasSelecionado,
    resumo,
    total: {
      sku_count: selectedSkus.length,
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
    SELECT
      a.branch_code,
      COALESCE(MAX(NULLIF(TRIM(b.description), '')), MAX(NULLIF(TRIM(b.fantasy_name), '')), MAX(NULLIF(TRIM(a.branch_name), '')), MAX(NULLIF(TRIM(b.branch_name), ''))) as branch_name
    FROM pcp_estoque_sem_giro_analitico a
    LEFT JOIN branches b ON b.branch_code = a.branch_code
    WHERE a.branch_code IS NOT NULL
    GROUP BY a.branch_code
    ORDER BY a.branch_code
  `;

  return {
    classificacoes,
    lojas: lojas.map((loja) => ({
      branch_code: loja.branch_code,
      branch_name: rowBranchName(loja.branch_code, loja.branch_name),
    })),
  };
}