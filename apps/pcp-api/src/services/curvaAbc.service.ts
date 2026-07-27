import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { OPERACAO_JOIN, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL, FABRICA_BRANCH_CODE } from './relatorioBase.service.js';

const CURVA_ABC_CONFIG_KEY = 'curva_abc';

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

async function getConfig() {
  return prisma.pcpCurvaAbcConfig.upsert({
    where: { relatorio: CURVA_ABC_CONFIG_KEY },
    create: { relatorio: CURVA_ABC_CONFIG_KEY },
    update: {},
  });
}

export interface CurvaAbcFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  familia?: string[];
}

interface IdentidadeRow {
  product_sku: string;
  product_code: number | null;
  reference_code: string | null;
  reference_name: string | null;
}

function buildFiltroSql(filtro: CurvaAbcFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(a.class_categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(a.class_linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(a.class_genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`TRIM(a.class_status) IN (${Prisma.join(filtro.status)})`);
  // "Familia" aproximado por class_grupo - e o mais proximo que temos no TOTVS (na
  // pratica hoje se parece mais com marca: BEBETENKITE/TEENKIS/MIST BRAND etc).
  if (filtro.familia?.length) condicoes.push(Prisma.sql`TRIM(a.class_grupo) IN (${Prisma.join(filtro.familia)})`);
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

async function getIdentidadeRows(filtro: CurvaAbcFiltro): Promise<IdentidadeRow[]> {
  const filtroSql = buildFiltroSql(filtro);
  return prisma.$queryRaw<IdentidadeRow[]>`
    SELECT a.product_sku, a.product_code, a.reference_code, a.reference_name
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
      AND a.reference_code IS NOT NULL
      ${filtroSql}
  `;
}

interface VendaProductCode {
  product_code: number;
  quantidade: Decimal;
  valor: Decimal;
}

// Vendas liquidas de devolucao por product_code numa janela [inicio, fim) de dias
// atras - inicio > fim (ex: janela atual = [giroDias, 0), janela anterior = [2*giroDias, giroDias)).
async function getVendaPorProductCode(diasInicio: number, diasFim: number): Promise<Map<number, { quantidade: number; valor: number }>> {
  const rows = await prisma.$queryRaw<VendaProductCode[]>`
    SELECT ti.product_code,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade,
      SUM(CASE WHEN (co.operations_type = 'E' AND co.operation_mode = '3') THEN -ABS(ti.net_value) ELSE ti.net_value END) AS valor
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(days => ${diasInicio}::int)
      AND t.transaction_date < CURRENT_DATE - make_interval(days => ${diasFim}::int)
      AND t.status = 4 AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code
  `;
  const mapa = new Map<number, { quantidade: number; valor: number }>();
  for (const r of rows) mapa.set(r.product_code, { quantidade: decimalToNumber(r.quantidade), valor: decimalToNumber(r.valor) });
  return mapa;
}

export type CurvaLetra = 'A' | 'B' | 'C' | 'D';

export interface ReferenciaAbc {
  referenceCode: string;
  referenceName: string;
  curva: CurvaLetra;
  rankQtd: number;
  qtdVendida: number;
  mediaMensal: number;
  totalSkus: number;
  mediaPorSku: number;
  mediaPorSkuAnterior: number;
  tendenciaMediaSku: 'up' | 'down' | 'flat';
  rankValor: number;
  valorReais: number;
}

export interface CurvaResumo {
  curva: CurvaLetra;
  totalReferencias: number;
  quantidade: number;
  valorReais: number;
  totalSkus: number;
  mediaMensal: number;
  percentDoTotal: number;
  ultimaReferencia: ReferenciaAbc | null;
}

export async function getCurvaAbcResumo(filtro: CurvaAbcFiltro = {}) {
  const config = await getConfig();
  const giroDias = config.giroDias;

  const [identidadeRows, vendaAtual, vendaAnterior] = await Promise.all([
    getIdentidadeRows(filtro),
    getVendaPorProductCode(giroDias, 0),
    getVendaPorProductCode(giroDias * 2, giroDias),
  ]);

  // Agrupa SKUs por referencia
  const porReferencia = new Map<string, { nome: string; skus: Set<string>; productCodes: Set<number> }>();
  for (const row of identidadeRows) {
    if (!row.reference_code) continue;
    const ref = porReferencia.get(row.reference_code) || { nome: row.reference_name || row.reference_code, skus: new Set<string>(), productCodes: new Set<number>() };
    ref.skus.add(row.product_sku);
    if (row.product_code !== null) ref.productCodes.add(row.product_code);
    porReferencia.set(row.reference_code, ref);
  }

  const mesesJanela = giroDias / 30;
  const brutos: Array<{ referenceCode: string; referenceName: string; qtdVendida: number; valorReais: number; totalSkus: number; qtdAnterior: number }> = [];

  for (const [referenceCode, dados] of porReferencia) {
    let qtdVendida = 0;
    let valorReais = 0;
    let qtdAnterior = 0;
    for (const pc of dados.productCodes) {
      const atual = vendaAtual.get(pc);
      if (atual) {
        qtdVendida += atual.quantidade;
        valorReais += atual.valor;
      }
      const anterior = vendaAnterior.get(pc);
      if (anterior) qtdAnterior += anterior.quantidade;
    }
    if (qtdVendida <= 0) continue; // so entra quem foi "analisado" (teve venda no periodo)
    brutos.push({ referenceCode, referenceName: dados.nome, qtdVendida, valorReais, totalSkus: dados.skus.size, qtdAnterior });
  }

  // Classificacao: A = limiar fixo de unidades. D = cauda (% configuravel do total de
  // referencias analisadas), C = fatia seguinte acima da cauda, B = o resto.
  const totalAnalisadas = brutos.length;
  const naoA = brutos.filter((r) => r.qtdVendida < config.metaCurvaAUnidades).sort((a, b) => a.qtdVendida - b.qtdVendida);
  const qtdD = Math.round(totalAnalisadas * (decimalToNumber(config.curvaDPercent) / 100));
  const qtdC = Math.round(totalAnalisadas * (decimalToNumber(config.curvaCPercent) / 100));

  const curvaPorReferencia = new Map<string, CurvaLetra>();
  naoA.forEach((r, i) => {
    if (i < qtdD) curvaPorReferencia.set(r.referenceCode, 'D');
    else if (i < qtdD + qtdC) curvaPorReferencia.set(r.referenceCode, 'C');
    else curvaPorReferencia.set(r.referenceCode, 'B');
  });
  for (const r of brutos) {
    if (r.qtdVendida >= config.metaCurvaAUnidades) curvaPorReferencia.set(r.referenceCode, 'A');
  }

  // Ranking geral (todas as referencias analisadas, independente da curva)
  const porQtdDesc = [...brutos].sort((a, b) => b.qtdVendida - a.qtdVendida);
  const rankQtdPorReferencia = new Map<string, number>();
  porQtdDesc.forEach((r, i) => rankQtdPorReferencia.set(r.referenceCode, i + 1));

  const porValorDesc = [...brutos].sort((a, b) => b.valorReais - a.valorReais);
  const rankValorPorReferencia = new Map<string, number>();
  porValorDesc.forEach((r, i) => rankValorPorReferencia.set(r.referenceCode, i + 1));

  const referencias: ReferenciaAbc[] = brutos.map((r) => {
    const mediaPorSku = r.totalSkus > 0 ? round(r.qtdVendida / r.totalSkus, 0) : 0;
    const mediaPorSkuAnterior = r.totalSkus > 0 ? round(r.qtdAnterior / r.totalSkus, 0) : 0;
    const tendencia: 'up' | 'down' | 'flat' = mediaPorSku > mediaPorSkuAnterior ? 'up' : mediaPorSku < mediaPorSkuAnterior ? 'down' : 'flat';

    return {
      referenceCode: r.referenceCode,
      referenceName: r.referenceName,
      curva: curvaPorReferencia.get(r.referenceCode) || 'B',
      rankQtd: rankQtdPorReferencia.get(r.referenceCode) || 0,
      qtdVendida: round(r.qtdVendida, 0),
      mediaMensal: round(r.qtdVendida / mesesJanela, 0),
      totalSkus: r.totalSkus,
      mediaPorSku,
      mediaPorSkuAnterior,
      tendenciaMediaSku: tendencia,
      rankValor: rankValorPorReferencia.get(r.referenceCode) || 0,
      valorReais: round(r.valorReais, 2),
    };
  });

  referencias.sort((a, b) => a.rankQtd - b.rankQtd);

  const totalQuantidadeGeral = referencias.reduce((s, r) => s + r.qtdVendida, 0);

  const curvas: CurvaResumo[] = (['A', 'B', 'C', 'D'] as CurvaLetra[]).map((curva) => {
    const doGrupo = referencias.filter((r) => r.curva === curva).sort((a, b) => a.rankQtd - b.rankQtd);
    const quantidade = doGrupo.reduce((s, r) => s + r.qtdVendida, 0);
    const valorReais = doGrupo.reduce((s, r) => s + r.valorReais, 0);
    const totalSkus = doGrupo.reduce((s, r) => s + r.totalSkus, 0);
    return {
      curva,
      totalReferencias: doGrupo.length,
      quantidade: round(quantidade, 0),
      valorReais: round(valorReais, 2),
      totalSkus,
      mediaMensal: round(quantidade / mesesJanela, 0),
      percentDoTotal: totalQuantidadeGeral > 0 ? round((quantidade / totalQuantidadeGeral) * 100, 1) : 0,
      ultimaReferencia: doGrupo.length > 0 ? doGrupo[doGrupo.length - 1] : null,
    };
  });

  return {
    config: {
      giroDias,
      metaCurvaAUnidades: config.metaCurvaAUnidades,
      curvaDPercent: decimalToNumber(config.curvaDPercent),
      curvaCPercent: decimalToNumber(config.curvaCPercent),
    },
    totalAnalisadas,
    curvas,
    referencias,
  };
}

// ---- Visao por SKU (ref-cor-tam), paginada - drill-down opcional dentro de uma referencia ----

export interface CurvaAbcSkuFiltro extends CurvaAbcFiltro {
  referencia?: string;
  page: number;
  pageSize: number;
}

interface EstoqueCanalPorSku {
  product_sku: string;
  canal: 'varejo' | 'atacado';
  estoque: Decimal;
}

async function getEstoqueCanalPorSku(): Promise<EstoqueCanalPorSku[]> {
  return prisma.$queryRaw<EstoqueCanalPorSku[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, branch_code, stock
      FROM prd_saldo
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    )
    SELECT product_sku,
      CASE WHEN branch_code = ${FABRICA_BRANCH_CODE} THEN 'atacado' ELSE 'varejo' END AS canal,
      SUM(COALESCE(stock, 0)) FILTER (WHERE COALESCE(stock, 0) > 0) AS estoque
    FROM ultimo_saldo
    GROUP BY product_sku, canal
  `;
}

export async function getCurvaAbcSkus(filtro: CurvaAbcSkuFiltro) {
  const config = await getConfig();
  const filtroComReferencia: CurvaAbcFiltro = { ...filtro };
  const identidadeRows = (await getIdentidadeRows(filtroComReferencia)).filter(
    (r) => !filtro.referencia || r.reference_code === filtro.referencia
  );

  const [vendaAtual, estoqueRows] = await Promise.all([
    getVendaPorProductCode(config.giroDias, 0),
    getEstoqueCanalPorSku(),
  ]);

  const estoquePorSku = new Map<string, { varejo: number; atacado: number }>();
  for (const row of estoqueRows) {
    const atual = estoquePorSku.get(row.product_sku) || { varejo: 0, atacado: 0 };
    atual[row.canal] += decimalToNumber(row.estoque);
    estoquePorSku.set(row.product_sku, atual);
  }

  const linhas = identidadeRows
    .map((row) => {
      const venda = row.product_code !== null ? vendaAtual.get(row.product_code) : undefined;
      const estoque = estoquePorSku.get(row.product_sku) || { varejo: 0, atacado: 0 };
      return {
        sku: row.product_sku,
        referenceCode: row.reference_code,
        referenceName: row.reference_name,
        qtdVendida: round(venda?.quantidade || 0, 0),
        valorReais: round(venda?.valor || 0, 2),
        estoqueVarejo: round(estoque.varejo, 0),
        estoqueAtacado: round(estoque.atacado, 0),
      };
    })
    .filter((l) => l.qtdVendida > 0 || l.estoqueVarejo > 0 || l.estoqueAtacado > 0)
    .sort((a, b) => b.qtdVendida - a.qtdVendida);

  const total = linhas.length;
  const inicio = (filtro.page - 1) * filtro.pageSize;

  return {
    total,
    page: filtro.page,
    pageSize: filtro.pageSize,
    linhas: linhas.slice(inicio, inicio + filtro.pageSize),
  };
}
