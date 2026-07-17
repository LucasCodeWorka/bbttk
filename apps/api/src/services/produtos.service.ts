import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';

export interface CorProduto {
  color_code: string | null;
  color_name: string | null;
  qtd_referencias: number;
  qtd_skus: number;
}

// Chave de casamento: usa color_code quando existe, senao cai pra color_name
function colorMatchKeyOf(color_code: string | null, color_name: string | null): string {
  return color_code || color_name || '';
}

// Cores distintas cadastradas (agrupadas por color_code+color_name)
export async function getCoresDistintas(): Promise<CorProduto[]> {
  const results = await prisma.$queryRaw<Array<{
    color_code: string | null;
    color_name: string | null;
    qtd_referencias: bigint;
    qtd_skus: bigint;
  }>>`
    SELECT
      color_code,
      color_name,
      COUNT(DISTINCT reference_code) as qtd_referencias,
      COUNT(*) as qtd_skus
    FROM produtos
    WHERE color_name IS NOT NULL
    GROUP BY color_code, color_name
    ORDER BY color_name
  `;

  return results.map(row => ({
    color_code: row.color_code,
    color_name: row.color_name,
    qtd_referencias: Number(row.qtd_referencias),
    qtd_skus: Number(row.qtd_skus),
  }));
}

export interface ImpactoAgrupamentoItem {
  reference_code: string;
  reference_name: string | null;
  color_code: string | null;
  color_name: string | null;
  qtd_skus: number;
  ja_agrupado_em: string | null;
}

// Todas as combinacoes referencia+cor que batem com as cores selecionadas,
// marcando quais ja pertencem a outro grupo do mesmo tipo (nao podem ser incluidas de novo)
export async function getImpactoAgrupamento(
  tipo: string,
  cores: { color_code: string | null; color_name: string | null }[],
  excluirGrupoId?: number
): Promise<ImpactoAgrupamentoItem[]> {
  if (cores.length === 0) return [];

  const matchKeys = cores.map(c => colorMatchKeyOf(c.color_code, c.color_name));

  const excluirFilter = excluirGrupoId
    ? Prisma.sql`AND am.grupo_id != ${excluirGrupoId}`
    : Prisma.empty;

  const results = await prisma.$queryRaw<Array<{
    reference_code: string;
    reference_name: string | null;
    color_code: string | null;
    color_name: string | null;
    qtd_skus: bigint;
    ja_agrupado_em: string | null;
  }>>`
    SELECT
      p.reference_code,
      MAX(p.reference_name) as reference_name,
      p.color_code,
      p.color_name,
      COUNT(*) as qtd_skus,
      MAX(g.nome) as ja_agrupado_em
    FROM produtos p
    LEFT JOIN agrupamento_membros am
      ON am.tipo = ${tipo}
      AND am.reference_code = p.reference_code
      AND am.color_match_key = COALESCE(p.color_code, p.color_name)
      ${excluirFilter}
    LEFT JOIN agrupamento_grupos g ON g.id = am.grupo_id
    WHERE p.reference_code IS NOT NULL
      AND COALESCE(p.color_code, p.color_name) IN (${Prisma.join(matchKeys)})
    GROUP BY p.reference_code, p.color_code, p.color_name
    ORDER BY p.reference_code, p.color_name
  `;

  return results.map(row => ({
    reference_code: row.reference_code,
    reference_name: row.reference_name,
    color_code: row.color_code,
    color_name: row.color_name,
    qtd_skus: Number(row.qtd_skus),
    ja_agrupado_em: row.ja_agrupado_em,
  }));
}

// Casa nomes de cor vindos de um CSV (case-insensitive) contra as cores distintas cadastradas
export function matchColorsFromCsv(colorNamesFromCsv: string[], cores: CorProduto[]): CorProduto[] {
  const normalized = colorNamesFromCsv.map(c => c.trim().toUpperCase()).filter(Boolean);
  return cores.filter(cor =>
    normalized.includes((cor.color_name || '').trim().toUpperCase()) ||
    normalized.includes((cor.color_code || '').trim().toUpperCase())
  );
}

export { colorMatchKeyOf };
