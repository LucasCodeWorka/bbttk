import { prisma } from '../config/database.js';
import { PCP_ESTOQUE_LIQUIDO_SKU_FILTER } from './relatorioBase.service.js';

const TIPO_COR_PRODUTO = 'cor_produto';

export interface AgrupamentoCoberturaStats {
  totalGrupos: number;
  totalCoresAgrupadas: number;
  totalReferenciasAtingidas: number;
}

export interface AgrupamentoCoberturaLinha {
  referenceCode: string;
  descricao: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  colecao: string | null;
  corOriginal: string;
  corAgrupada: string;
  qtdSkus: number;
}

export interface AgrupamentoCoberturaResponse {
  stats: AgrupamentoCoberturaStats;
  linhas: AgrupamentoCoberturaLinha[];
}

interface LinhaQueryRow {
  reference_code: string;
  descricao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  colecao: string | null;
  cor_original: string | null;
  cor_agrupada: string;
  qtd_skus: bigint;
}

export async function getCoberturaAgrupamento(): Promise<AgrupamentoCoberturaResponse> {
  const [statsRows, linhasRows] = await Promise.all([
    prisma.$queryRaw<Array<{ total_grupos: bigint; total_cores_agrupadas: bigint; total_referencias_atingidas: bigint }>>`
      SELECT
        COUNT(DISTINCT ag.id) AS total_grupos,
        COUNT(DISTINCT am.id) AS total_cores_agrupadas,
        COUNT(DISTINCT am.reference_code) AS total_referencias_atingidas
      FROM agrupamento_membros am
      JOIN agrupamento_grupos ag ON ag.id = am.grupo_id
      WHERE am.tipo = ${TIPO_COR_PRODUTO}
    `,
    // Uma linha por membro (referencia+cor original agrupada) - a "foto" de antes do
    // agrupamento. O frontend colapsa por (reference_code, cor_agrupada) pra mostrar o
    // "depois", sem precisar de uma segunda query (mesma logica que ja usamos no
    // drill-down da Performance Colecao: soma qtdSkus, nunca duplica linha).
    prisma.$queryRaw<LinhaQueryRow[]>`
      SELECT
        am.reference_code,
        MIN(COALESCE(NULLIF(TRIM(a.reference_name), ''), am.reference_code)) AS descricao,
        MIN(NULLIF(TRIM(a.class_categoria), '')) AS categoria,
        MIN(NULLIF(TRIM(a.class_linha), '')) AS linha,
        MIN(NULLIF(TRIM(a.class_genero), '')) AS genero,
        MIN(NULLIF(TRIM(a.class_colecao), '')) AS colecao,
        COALESCE(NULLIF(TRIM(am.color_name), ''), NULLIF(TRIM(am.color_code), ''), am.color_match_key) AS cor_original,
        ag.nome AS cor_agrupada,
        COUNT(DISTINCT a.product_sku) AS qtd_skus
      FROM agrupamento_membros am
      JOIN agrupamento_grupos ag ON ag.id = am.grupo_id
      LEFT JOIN produto_analitico a
        ON a.reference_code = am.reference_code
        AND COALESCE(NULLIF(TRIM(a.color_code), ''), NULLIF(TRIM(a.color_name), '')) = am.color_match_key
        AND a.product_code IS NOT NULL
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      WHERE am.tipo = ${TIPO_COR_PRODUTO}
      GROUP BY am.id, am.reference_code, am.color_name, am.color_code, am.color_match_key, ag.nome
      ORDER BY am.reference_code, ag.nome, cor_original
    `,
  ]);

  const stats = statsRows[0];

  return {
    stats: {
      totalGrupos: Number(stats?.total_grupos ?? 0),
      totalCoresAgrupadas: Number(stats?.total_cores_agrupadas ?? 0),
      totalReferenciasAtingidas: Number(stats?.total_referencias_atingidas ?? 0),
    },
    linhas: linhasRows.map((row) => ({
      referenceCode: row.reference_code,
      descricao: row.descricao || row.reference_code,
      categoria: row.categoria,
      linha: row.linha,
      genero: row.genero,
      colecao: row.colecao,
      corOriginal: row.cor_original || '-',
      corAgrupada: row.cor_agrupada,
      qtdSkus: Number(row.qtd_skus),
    })),
  };
}
