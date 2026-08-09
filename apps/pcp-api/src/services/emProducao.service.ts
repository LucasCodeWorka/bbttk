import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { FILIAIS } from '../config/constants.js';

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function toDateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

const STATUS_LABEL: Record<number, string> = {
  5: 'Bloqueada',
  10: 'Aguardando',
  20: 'Em Andamento',
  30: 'Finalizada',
  40: 'Cancelada',
};

export interface EmProducaoFiltro {
  status?: number[];
  colecao?: string[];
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  statusProduto?: string[];
  search?: string;
  dataInicio?: string;
  considerarSemReferencia?: boolean;
}

export interface EmProducaoRow {
  id: number;
  branchCode: number;
  branchName: string;
  orderCode: number;
  status: number;
  statusLabel: string;
  dtInicio: string | null;
  dtPrevisao: string | null;
  insertDate: string | null;
  lastChangeDate: string | null;
  productCode: number;
  referenceCode: string | null;
  descricao: string;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  statusProduto: string | null;
  quantidadeOp: number;
  quantidadeFinalizada: number;
  quantidadePendente: number;
  percentFinalizado: number;
  diasEmProcesso: number | null;
  diasAtraso: number;
  syncedAt: string | null;
}

export interface EmProducaoResponse {
  atualizadoEm: string | null;
  kpis: {
    ordens: number;
    linhas: number;
    referencias: number;
    produtos: number;
    quantidadeOp: number;
    quantidadeFinalizada: number;
    quantidadePendente: number;
    percentFinalizado: number;
    ordensAtrasadas: number;
    quantidadeAtrasada: number;
  };
  statusResumo: Array<{ status: number; statusLabel: string; ordens: number; quantidadePendente: number }>;
  rows: EmProducaoRow[];
}

function buildFiltro(filtro: EmProducaoFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (filtro.status?.length) condicoes.push(Prisma.sql`o.status IN (${Prisma.join(filtro.status)})`);
  if (filtro.colecao?.length) condicoes.push(Prisma.sql`TRIM(i.colecao) IN (${Prisma.join(filtro.colecao)})`);
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(i.categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(i.linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(i.genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.statusProduto?.length) condicoes.push(Prisma.sql`TRIM(i.status_produto) IN (${Prisma.join(filtro.statusProduto)})`);
  if (filtro.search?.trim()) {
    const termo = `%${filtro.search.trim()}%`;
    condicoes.push(Prisma.sql`(
      o.order_code::text ILIKE ${termo}
      OR o.product_code::text ILIKE ${termo}
      OR i.reference_code ILIKE ${termo}
      OR i.descricao ILIKE ${termo}
    )`);
  }
  if (filtro.dataInicio) condicoes.push(Prisma.sql`o.dt_inicio >= ${filtro.dataInicio}::date`);
  if (filtro.considerarSemReferencia === false) condicoes.push(Prisma.sql`i.reference_code IS NOT NULL`);
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(condicoes, ' AND ')}`;
}

interface RawRow {
  id: number;
  branch_code: number;
  order_code: number;
  status: number;
  dt_inicio: Date | null;
  dt_previsao: Date | null;
  insert_date: Date | null;
  last_change_date: Date | null;
  product_code: number;
  reference_code: string | null;
  descricao: string | null;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status_produto: string | null;
  quantidade_op: Decimal;
  quantidade_finalizada: Decimal;
  quantidade_pendente: Decimal;
  dias_em_processo: number | null;
  dias_atraso: number;
  synced_at: Date | null;
}

async function getRawRows(filtro: EmProducaoFiltro): Promise<RawRow[]> {
  const filtroSql = buildFiltro(filtro);
  return prisma.$queryRaw<RawRow[]>`
    WITH identidade AS (
      SELECT
        product_code,
        MIN(NULLIF(TRIM(reference_code), '')) AS reference_code,
        MIN(COALESCE(NULLIF(TRIM(reference_name), ''), NULLIF(TRIM(product_name), ''), product_code::text)) AS descricao,
        STRING_AGG(DISTINCT NULLIF(TRIM(color_name), ''), ', ' ORDER BY NULLIF(TRIM(color_name), '')) AS cor,
        STRING_AGG(DISTINCT NULLIF(TRIM(size), ''), ', ' ORDER BY NULLIF(TRIM(size), '')) AS tamanho,
        MIN(NULLIF(TRIM(class_colecao), '')) AS colecao,
        MIN(NULLIF(TRIM(class_categoria), '')) AS categoria,
        MIN(NULLIF(TRIM(class_linha), '')) AS linha,
        MIN(NULLIF(TRIM(class_genero), '')) AS genero,
        MIN(NULLIF(TRIM(class_status), '')) AS status_produto
      FROM produto_analitico
      WHERE product_code IS NOT NULL
      GROUP BY product_code
    )
    SELECT
      o.id,
      o.branch_code,
      o.order_code,
      o.status,
      o.dt_inicio,
      o.dt_previsao,
      o.insert_date,
      o.last_change_date,
      o.product_code,
      i.reference_code,
      i.descricao,
      i.cor,
      i.tamanho,
      i.colecao,
      i.categoria,
      i.linha,
      i.genero,
      i.status_produto,
      o.quantidade_op,
      o.quantidade_finalizada,
      o.quantidade_pendente,
      CASE WHEN o.dt_inicio IS NULL THEN NULL ELSE GREATEST(0, CURRENT_DATE - o.dt_inicio::date) END AS dias_em_processo,
      CASE WHEN o.dt_previsao IS NULL THEN 0 ELSE GREATEST(0, CURRENT_DATE - o.dt_previsao::date) END AS dias_atraso,
      o.synced_at
    FROM ops_em_producao o
    LEFT JOIN identidade i ON i.product_code = o.product_code
    ${filtroSql}
    ORDER BY o.dt_previsao NULLS LAST, o.order_code, i.reference_code, o.product_code
  `;
}

export async function getEmProducao(filtro: EmProducaoFiltro = {}): Promise<EmProducaoResponse> {
  const rawRows = await getRawRows(filtro);

  const rows: EmProducaoRow[] = rawRows.map((row) => {
    const quantidadeOp = decimalToNumber(row.quantidade_op);
    const quantidadeFinalizada = decimalToNumber(row.quantidade_finalizada);
    const quantidadePendente = decimalToNumber(row.quantidade_pendente);
    return {
      id: row.id,
      branchCode: row.branch_code,
      branchName: FILIAIS[row.branch_code] || `Filial ${row.branch_code}`,
      orderCode: row.order_code,
      status: row.status,
      statusLabel: STATUS_LABEL[row.status] || `Status ${row.status}`,
      dtInicio: toDateString(row.dt_inicio),
      dtPrevisao: toDateString(row.dt_previsao),
      insertDate: toDateString(row.insert_date),
      lastChangeDate: toDateString(row.last_change_date),
      productCode: row.product_code,
      referenceCode: row.reference_code,
      descricao: row.descricao || String(row.product_code),
      cor: row.cor,
      tamanho: row.tamanho,
      colecao: row.colecao,
      categoria: row.categoria,
      linha: row.linha,
      genero: row.genero,
      statusProduto: row.status_produto,
      quantidadeOp: round(quantidadeOp, 0),
      quantidadeFinalizada: round(quantidadeFinalizada, 0),
      quantidadePendente: round(quantidadePendente, 0),
      percentFinalizado: quantidadeOp > 0 ? round((quantidadeFinalizada / quantidadeOp) * 100, 1) : 0,
      diasEmProcesso: row.dias_em_processo,
      diasAtraso: row.dias_atraso,
      syncedAt: row.synced_at ? row.synced_at.toISOString() : null,
    };
  });

  const ordensSet = new Set<string>();
  const ordensAtrasadasSet = new Set<string>();
  const refsSet = new Set<string>();
  const productsSet = new Set<number>();
  const statusMap = new Map<number, { ordens: Set<string>; quantidadePendente: number }>();
  let quantidadeOp = 0;
  let quantidadeFinalizada = 0;
  let quantidadePendente = 0;
  let quantidadeAtrasada = 0;
  let atualizadoEm: string | null = null;

  for (const row of rows) {
    const ordemKey = `${row.branchCode}-${row.orderCode}`;
    ordensSet.add(ordemKey);
    if (row.diasAtraso > 0) ordensAtrasadasSet.add(ordemKey);
    if (row.referenceCode) refsSet.add(row.referenceCode);
    productsSet.add(row.productCode);
    quantidadeOp += row.quantidadeOp;
    quantidadeFinalizada += row.quantidadeFinalizada;
    quantidadePendente += row.quantidadePendente;
    if (row.diasAtraso > 0) quantidadeAtrasada += row.quantidadePendente;
    if (row.syncedAt && (!atualizadoEm || row.syncedAt > atualizadoEm)) atualizadoEm = row.syncedAt;

    const status = statusMap.get(row.status) || { ordens: new Set<string>(), quantidadePendente: 0 };
    status.ordens.add(ordemKey);
    status.quantidadePendente += row.quantidadePendente;
    statusMap.set(row.status, status);

  }

  return {
    atualizadoEm,
    kpis: {
      ordens: ordensSet.size,
      linhas: rows.length,
      referencias: refsSet.size,
      produtos: productsSet.size,
      quantidadeOp: round(quantidadeOp, 0),
      quantidadeFinalizada: round(quantidadeFinalizada, 0),
      quantidadePendente: round(quantidadePendente, 0),
      percentFinalizado: quantidadeOp > 0 ? round((quantidadeFinalizada / quantidadeOp) * 100, 1) : 0,
      ordensAtrasadas: ordensAtrasadasSet.size,
      quantidadeAtrasada: round(quantidadeAtrasada, 0),
    },
    statusResumo: [...statusMap.entries()]
      .map(([status, value]) => ({
        status,
        statusLabel: STATUS_LABEL[status] || `Status ${status}`,
        ordens: value.ordens.size,
        quantidadePendente: round(value.quantidadePendente, 0),
      }))
      .sort((a, b) => b.quantidadePendente - a.quantidadePendente),
    rows,
  };
}

export async function getFiltrosEmProducao() {
  const [statusRows, colecaoRows, classificacoesRows, branchRows] = await Promise.all([
    prisma.$queryRaw<Array<{ status: number; qtd: bigint }>>`
      SELECT status, COUNT(*) AS qtd
      FROM ops_em_producao
      GROUP BY status
      ORDER BY status
    `,
    prisma.$queryRaw<Array<{ valor: string; qtd: bigint }>>`
      SELECT TRIM(a.class_colecao) AS valor, COUNT(DISTINCT o.product_code) AS qtd
      FROM ops_em_producao o
      JOIN produto_analitico a ON a.product_code = o.product_code
      WHERE a.class_colecao IS NOT NULL AND TRIM(a.class_colecao) NOT IN ('', '.')
      GROUP BY TRIM(a.class_colecao)
      ORDER BY TRIM(a.class_colecao)
    `,
    prisma.$queryRaw<Array<{ chave: string; label: string; valor: string; qtd: bigint }>>`
      SELECT 'categoria' AS chave, 'Categoria' AS label, TRIM(a.class_categoria) AS valor, COUNT(DISTINCT o.product_code) AS qtd
      FROM ops_em_producao o JOIN produto_analitico a ON a.product_code = o.product_code
      WHERE a.class_categoria IS NOT NULL AND TRIM(a.class_categoria) NOT IN ('', '.')
      GROUP BY TRIM(a.class_categoria)
      UNION ALL
      SELECT 'linha' AS chave, 'Linha' AS label, TRIM(a.class_linha) AS valor, COUNT(DISTINCT o.product_code) AS qtd
      FROM ops_em_producao o JOIN produto_analitico a ON a.product_code = o.product_code
      WHERE a.class_linha IS NOT NULL AND TRIM(a.class_linha) NOT IN ('', '.')
      GROUP BY TRIM(a.class_linha)
      UNION ALL
      SELECT 'genero' AS chave, 'Genero' AS label, TRIM(a.class_genero) AS valor, COUNT(DISTINCT o.product_code) AS qtd
      FROM ops_em_producao o JOIN produto_analitico a ON a.product_code = o.product_code
      WHERE a.class_genero IS NOT NULL AND TRIM(a.class_genero) NOT IN ('', '.')
      GROUP BY TRIM(a.class_genero)
      UNION ALL
      SELECT 'statusProduto' AS chave, 'Status Produto' AS label, TRIM(a.class_status) AS valor, COUNT(DISTINCT o.product_code) AS qtd
      FROM ops_em_producao o JOIN produto_analitico a ON a.product_code = o.product_code
      WHERE a.class_status IS NOT NULL AND TRIM(a.class_status) NOT IN ('', '.')
      GROUP BY TRIM(a.class_status)
      ORDER BY chave, valor
    `,
    prisma.$queryRaw<Array<{ branch_code: number; qtd: bigint }>>`
      SELECT branch_code, COUNT(*) AS qtd
      FROM ops_em_producao
      GROUP BY branch_code
      ORDER BY branch_code
    `,
  ]);

  const classificacoes = new Map<string, { chave: string; label: string; opcoes: { valor: string; qtd_skus: number }[] }>();
  for (const row of classificacoesRows) {
    const item = classificacoes.get(row.chave) || { chave: row.chave, label: row.label, opcoes: [] };
    item.opcoes.push({ valor: row.valor, qtd_skus: Number(row.qtd) });
    classificacoes.set(row.chave, item);
  }

  return {
    status: statusRows.map((row) => ({
      valor: row.status,
      label: STATUS_LABEL[row.status] || `Status ${row.status}`,
      qtd: Number(row.qtd),
    })),
    colecoes: colecaoRows.map((row) => ({ valor: row.valor, qtd_skus: Number(row.qtd) })),
    classificacoes: [...classificacoes.values()],
    lojas: branchRows.map((row) => ({
      branchCode: row.branch_code,
      label: FILIAIS[row.branch_code] || `Filial ${row.branch_code}`,
      qtd: Number(row.qtd),
    })),
  };
}