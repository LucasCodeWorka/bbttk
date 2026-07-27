import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { OPERACAO_JOIN, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL } from './relatorioBase.service.js';

const RELATORIO_BASE_KEY = 'relatorio_base';
// Janela fixa da curva ABC de tamanhos - o mockup rotula essa tabela especifica como
// "(6 meses)", diferente da janela configuravel de giro/cobertura do resto do modulo.
const CURVA_ABC_TAMANHO_MESES = 6;

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export interface AnaliseGradeFiltro {
  referencia?: string;
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  cor?: string[];
  branches?: number[];
}

interface GradeRawRow {
  reference_code: string;
  reference_name: string | null;
  size: string;
  product_code: number | null;
  estoque: Decimal;
}

function buildFiltroSql(filtro: AnaliseGradeFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (filtro.referencia?.trim()) condicoes.push(Prisma.sql`a.reference_code = ${filtro.referencia.trim()}`);
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(a.class_categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(a.class_linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(a.class_genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.cor?.length) condicoes.push(Prisma.sql`TRIM(a.color_name) IN (${Prisma.join(filtro.cor)})`);
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

async function getGradeRawRows(filtro: AnaliseGradeFiltro): Promise<GradeRawRow[]> {
  const filtroSql = buildFiltroSql(filtro);
  const filtroBranch =
    filtro.branches && filtro.branches.length > 0
      ? Prisma.sql`AND branch_code IN (${Prisma.join(filtro.branches)})`
      : Prisma.empty;

  return prisma.$queryRaw<GradeRawRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, branch_code, stock
      FROM prd_saldo
      WHERE 1=1 ${filtroBranch}
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    ),
    estoque_sku AS (
      SELECT product_sku, SUM(COALESCE(stock, 0)) FILTER (WHERE COALESCE(stock, 0) > 0) AS estoque
      FROM ultimo_saldo
      GROUP BY product_sku
    )
    SELECT a.reference_code, a.reference_name, a.size, a.product_code,
      COALESCE(es.estoque, 0) AS estoque
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    LEFT JOIN estoque_sku es ON es.product_sku = a.product_sku
    WHERE a.reference_code IS NOT NULL AND a.size IS NOT NULL
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${filtroSql}
  `;
}

async function getGiroPorProductCode(meses: number): Promise<Map<number, number>> {
  const rows = await prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4 AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code
  `;
  const mapa = new Map<number, number>();
  for (const r of rows) mapa.set(r.product_code, decimalToNumber(r.quantidade));
  return mapa;
}

interface CelulaGrade {
  size: string;
  estoque: number;
  giro: number;
  cobertura: number | null;
  ruptura: boolean;
}

interface ReferenciaGrade {
  referenceCode: string;
  referenceName: string;
  celulas: CelulaGrade[];
  completudePercent: number;
}

export async function getGrade(filtro: AnaliseGradeFiltro = {}) {
  const config = await prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: RELATORIO_BASE_KEY },
    create: { relatorio: RELATORIO_BASE_KEY },
    update: {},
  });

  const [rawRows, giroPorProductCode] = await Promise.all([
    getGradeRawRows(filtro),
    getGiroPorProductCode(config.coberturaMeses),
  ]);

  // Agrupa por referencia+tamanho, somando estoque entre cores e juntando os
  // product_code envolvidos (giro somado dos que aparecem naquela celula).
  const porReferencia = new Map<string, { nome: string; tamanhos: Map<string, { estoque: number; productCodes: Set<number> }> }>();
  for (const row of rawRows) {
    const ref = porReferencia.get(row.reference_code) || { nome: row.reference_name || row.reference_code, tamanhos: new Map() };
    const cel = ref.tamanhos.get(row.size) || { estoque: 0, productCodes: new Set<number>() };
    cel.estoque += decimalToNumber(row.estoque);
    if (row.product_code !== null) cel.productCodes.add(row.product_code);
    ref.tamanhos.set(row.size, cel);
    porReferencia.set(row.reference_code, ref);
  }

  const referencias: ReferenciaGrade[] = [];
  let totalCelulas = 0;
  let celulasComEstoque = 0;
  let celulasComCoberturaBaixa = 0;
  let skusEmRupturaTotal = 0;

  for (const [referenceCode, dados] of porReferencia) {
    const celulas: CelulaGrade[] = [];
    for (const [size, cel] of dados.tamanhos) {
      let giro = 0;
      for (const pc of cel.productCodes) giro += giroPorProductCode.get(pc) || 0;
      const mediaMensal = giro / config.coberturaMeses;
      const cobertura = mediaMensal > 0 ? round(cel.estoque / mediaMensal, 2) : null;
      const ruptura = cel.estoque <= 0;

      celulas.push({ size, estoque: round(cel.estoque, 0), giro: round(giro, 0), cobertura, ruptura });

      totalCelulas++;
      if (cel.estoque > 0) celulasComEstoque++;
      if (ruptura) skusEmRupturaTotal++;
      if (cobertura !== null && cobertura < 1) celulasComCoberturaBaixa++;
    }
    const completudePercent = celulas.length > 0 ? round((celulas.filter((c) => c.estoque > 0).length / celulas.length) * 100, 1) : 0;
    referencias.push({ referenceCode, referenceName: dados.nome, celulas, completudePercent });
  }

  referencias.sort((a, b) => b.celulas.reduce((s, c) => s + c.estoque, 0) - a.celulas.reduce((s, c) => s + c.estoque, 0));

  return {
    config: { coberturaMeses: config.coberturaMeses },
    referencias,
    indicadores: {
      skusEmRupturaTotal,
      totalCelulas,
      celulasComCoberturaBaixa,
      completudeMediaPercent: totalCelulas > 0 ? round((celulasComEstoque / totalCelulas) * 100, 1) : 0,
    },
  };
}

export async function getCurvaAbcTamanho(filtro: AnaliseGradeFiltro = {}) {
  const [rawRows, giroPorProductCode] = await Promise.all([
    getGradeRawRows(filtro),
    getGiroPorProductCode(CURVA_ABC_TAMANHO_MESES),
  ]);

  const productCodesPorTamanho = new Map<string, Set<number>>();
  for (const row of rawRows) {
    const set = productCodesPorTamanho.get(row.size) || new Set<number>();
    if (row.product_code !== null) set.add(row.product_code);
    productCodesPorTamanho.set(row.size, set);
  }

  const linhas = [...productCodesPorTamanho.entries()]
    .map(([size, productCodes]) => {
      let giro = 0;
      for (const pc of productCodes) giro += giroPorProductCode.get(pc) || 0;
      return { size, giro: round(giro, 0) };
    })
    .filter((l) => l.giro > 0)
    .sort((a, b) => b.giro - a.giro);

  const totalGiro = linhas.reduce((s, l) => s + l.giro, 0);
  let acumulado = 0;
  const resultado = linhas.map((l) => {
    acumulado += l.giro;
    const percentVendas = totalGiro > 0 ? round((l.giro / totalGiro) * 100, 1) : 0;
    const percentAcumulado = totalGiro > 0 ? round((acumulado / totalGiro) * 100, 1) : 0;
    const classe = percentAcumulado <= 80 ? 'A' : percentAcumulado <= 95 ? 'B' : 'C';
    return { size: l.size, giro: l.giro, percentVendas, percentAcumulado, classe };
  });

  return { meses: CURVA_ABC_TAMANHO_MESES, linhas: resultado };
}
