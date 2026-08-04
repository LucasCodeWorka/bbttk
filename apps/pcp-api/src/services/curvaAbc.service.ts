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
  const config = await prisma.pcpCurvaAbcConfig.upsert({
    where: { relatorio: CURVA_ABC_CONFIG_KEY },
    create: { relatorio: CURVA_ABC_CONFIG_KEY },
    update: {},
  });
  const a = Number(config.curvaALimitePercent);
  const b = Number(config.curvaBLimitePercent);
  const c = Number(config.curvaCLimitePercent);
  // Curva C vai ate 100% (nao existe mais curva D)
  if (!(a > 0 && a < b && b < c && c <= 100)) {
    return prisma.pcpCurvaAbcConfig.update({
      where: { relatorio: CURVA_ABC_CONFIG_KEY },
      data: { curvaALimitePercent: 80, curvaBLimitePercent: 95, curvaCLimitePercent: 100 },
    });
  }
  return config;
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
  color_code: string | null;
  color_name: string | null;
  size: string | null;
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
    SELECT a.product_sku, a.product_code, a.reference_code, a.reference_name, a.color_code, a.color_name, a.size
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

interface VendaCanalProductCode {
  product_code: number;
  canal: 'varejo' | 'atacado';
  quantidade: Decimal;
}

// Vendas dos ultimos 30 dias separadas por canal (varejo/atacado)
async function getVenda30DiasPorCanal(): Promise<Map<number, { varejo: number; atacado: number }>> {
  const rows = await prisma.$queryRaw<VendaCanalProductCode[]>`
    SELECT ti.product_code,
      CASE WHEN t.branch_code = ${FABRICA_BRANCH_CODE} THEN 'atacado' ELSE 'varejo' END AS canal,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - INTERVAL '30 days'
      AND t.status = 4 AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code, canal
  `;
  const mapa = new Map<number, { varejo: number; atacado: number }>();
  for (const r of rows) {
    const atual = mapa.get(r.product_code) || { varejo: 0, atacado: 0 };
    atual[r.canal] += decimalToNumber(r.quantidade);
    mapa.set(r.product_code, atual);
  }
  return mapa;
}

// Vendas liquidas de devolucao por product_code nos ultimos meses fechados.
// Ex: em 29/07, mesesInicio=3 e mesesFim=0 pega 01/04 ate 30/06.
async function getVendaPorProductCodeMesesFechados(mesesInicio: number, mesesFim: number): Promise<Map<number, { quantidade: number; valor: number }>> {
  const rows = await prisma.$queryRaw<VendaProductCode[]>`
    SELECT ti.product_code,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade,
      SUM(CASE WHEN (co.operations_type = 'E' AND co.operation_mode = '3') THEN -ABS(ti.net_value) ELSE ti.net_value END) AS valor
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= (date_trunc('month', CURRENT_DATE)::date - make_interval(months => ${mesesInicio}::int))
      AND t.transaction_date < (date_trunc('month', CURRENT_DATE)::date - make_interval(months => ${mesesFim}::int))
      AND t.status = 4 AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code
  `;
  const mapa = new Map<number, { quantidade: number; valor: number }>();
  for (const r of rows) mapa.set(r.product_code, { quantidade: decimalToNumber(r.quantidade), valor: decimalToNumber(r.valor) });
  return mapa;
}

export type CurvaLetra = 'A' | 'B' | 'C';

export interface ReferenciaAbc {
  referenceCode: string;
  referenceName: string;
  curva: CurvaLetra;
  rankQtd: number;
  rankCurva: number;
  qtdVendida: number;
  mediaMensal: number;
  giro30dVarejo: number;
  giro30dAtacado: number;
  totalSkus: number;
  mediaPorSku: number;
  mediaPorSkuAnterior: number;
  tendenciaMediaSku: 'up' | 'down' | 'flat';
  rankValor: number;
  valorReais: number;
  valorMedioMensal: number;
  representatividadeValor: number;
  representatividadeAcumulada: number;
  estoqueAtacado: number;
  estoqueVarejo: number;
  estoqueTotal: number;
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
  // giro_dias guarda a janela em dias (sempre multiplo de 30) pra reaproveitar a mesma
  // coluna/config do Relatorio Base - na pratica o usuario sempre pensa e edita em
  // "meses fechados" (ver Input na tela de Configuracoes do PCP).
  const mesesJanela = Math.max(1, Math.round(config.giroDias / 30));

  const [identidadeRows, vendaAtual, vendaAnterior, estoqueRows, venda30d] = await Promise.all([
    getIdentidadeRows(filtro),
    getVendaPorProductCodeMesesFechados(mesesJanela, 0),
    getVendaPorProductCodeMesesFechados(mesesJanela * 2, mesesJanela),
    getEstoqueCanalPorSku(),
    getVenda30DiasPorCanal(),
  ]);

  // Mapa de estoque por SKU
  const estoquePorSku = new Map<string, { varejo: number; atacado: number }>();
  for (const row of estoqueRows) {
    const atual = estoquePorSku.get(row.product_sku) || { varejo: 0, atacado: 0 };
    atual[row.canal] += decimalToNumber(row.estoque);
    estoquePorSku.set(row.product_sku, atual);
  }

  // Agrupa SKUs por referencia
  const porReferencia = new Map<string, { nome: string; skus: Set<string>; productCodes: Set<number> }>();
  for (const row of identidadeRows) {
    if (!row.reference_code) continue;
    const ref = porReferencia.get(row.reference_code) || { nome: row.reference_name || row.reference_code, skus: new Set<string>(), productCodes: new Set<number>() };
    ref.skus.add(row.product_sku);
    if (row.product_code !== null) ref.productCodes.add(row.product_code);
    porReferencia.set(row.reference_code, ref);
  }

  const brutos: Array<{ referenceCode: string; referenceName: string; qtdVendida: number; valorReais: number; valorMedioMensal: number; totalSkus: number; qtdAnterior: number; estoqueVarejo: number; estoqueAtacado: number; giro30dVarejo: number; giro30dAtacado: number }> = [];

  for (const [referenceCode, dados] of porReferencia) {
    let qtdVendida = 0;
    let valorReais = 0;
    let qtdAnterior = 0;
    let estoqueVarejo = 0;
    let estoqueAtacado = 0;
    let giro30dVarejo = 0;
    let giro30dAtacado = 0;
    for (const pc of dados.productCodes) {
      const atual = vendaAtual.get(pc);
      if (atual) {
        qtdVendida += atual.quantidade;
        valorReais += atual.valor;
      }
      const anterior = vendaAnterior.get(pc);
      if (anterior) qtdAnterior += anterior.quantidade;
      const giro = venda30d.get(pc);
      if (giro) {
        giro30dVarejo += giro.varejo;
        giro30dAtacado += giro.atacado;
      }
    }
    // Soma estoque de todos os SKUs da referência
    for (const sku of dados.skus) {
      const estoque = estoquePorSku.get(sku) || { varejo: 0, atacado: 0 };
      estoqueVarejo += estoque.varejo;
      estoqueAtacado += estoque.atacado;
    }
    if (qtdVendida <= 0) continue; // so entra quem foi "analisado" (teve venda no periodo)
    brutos.push({ referenceCode, referenceName: dados.nome, qtdVendida, valorReais, valorMedioMensal: valorReais / mesesJanela, totalSkus: dados.skus.size, qtdAnterior, estoqueVarejo, estoqueAtacado, giro30dVarejo, giro30dAtacado });
  }

  const totalAnalisadas = brutos.length;
  const curvaALimitePercent = decimalToNumber(config.curvaALimitePercent);
  const curvaBLimitePercent = decimalToNumber(config.curvaBLimitePercent);
  const curvaCLimitePercent = decimalToNumber(config.curvaCLimitePercent);
  const totalValorGeralBruto = brutos.reduce((s, r) => s + Math.max(0, r.valorMedioMensal), 0);

  const curvaPorReferencia = new Map<string, CurvaLetra>();
  const representatividadePorReferencia = new Map<string, { percent: number; acumulado: number }>();
  const porValorDesc = [...brutos].sort((a, b) => b.valorMedioMensal - a.valorMedioMensal);
  let acumuladoValor = 0;
  porValorDesc.forEach((r) => {
    const valorBase = Math.max(0, r.valorMedioMensal);
    acumuladoValor += valorBase;
    const percent = totalValorGeralBruto > 0 ? (valorBase / totalValorGeralBruto) * 100 : 0;
    const acumulado = totalValorGeralBruto > 0 ? (acumuladoValor / totalValorGeralBruto) * 100 : 0;
    representatividadePorReferencia.set(r.referenceCode, { percent, acumulado });
    // Curva C vai ate 100% (nao existe mais curva D)
    if (acumulado <= curvaALimitePercent) curvaPorReferencia.set(r.referenceCode, 'A');
    else if (acumulado <= curvaBLimitePercent) curvaPorReferencia.set(r.referenceCode, 'B');
    else curvaPorReferencia.set(r.referenceCode, 'C');
  });

  // Ranking geral (todas as referencias analisadas, independente da curva)
  const porQtdDesc = [...brutos].sort((a, b) => b.qtdVendida - a.qtdVendida);
  const rankQtdPorReferencia = new Map<string, number>();
  porQtdDesc.forEach((r, i) => rankQtdPorReferencia.set(r.referenceCode, i + 1));

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
      rankCurva: rankValorPorReferencia.get(r.referenceCode) || 0,
      qtdVendida: round(r.qtdVendida, 0),
      mediaMensal: round(r.qtdVendida / mesesJanela, 0),
      giro30dVarejo: round(r.giro30dVarejo, 0),
      giro30dAtacado: round(r.giro30dAtacado, 0),
      totalSkus: r.totalSkus,
      mediaPorSku,
      mediaPorSkuAnterior,
      tendenciaMediaSku: tendencia,
      rankValor: rankValorPorReferencia.get(r.referenceCode) || 0,
      valorReais: round(r.valorReais, 2),
      valorMedioMensal: round(r.valorMedioMensal, 2),
      representatividadeValor: round(representatividadePorReferencia.get(r.referenceCode)?.percent || 0, 2),
      representatividadeAcumulada: round(representatividadePorReferencia.get(r.referenceCode)?.acumulado || 0, 2),
      estoqueAtacado: round(r.estoqueAtacado, 0),
      estoqueVarejo: round(r.estoqueVarejo, 0),
      estoqueTotal: round(r.estoqueVarejo + r.estoqueAtacado, 0),
    };
  });

  referencias.sort((a, b) => a.rankValor - b.rankValor);

  const totalValorGeral = referencias.reduce((s, r) => s + r.valorReais, 0);

  const curvas: CurvaResumo[] = (['A', 'B', 'C'] as CurvaLetra[]).map((curva) => {
    const doGrupo = referencias.filter((r) => r.curva === curva).sort((a, b) => a.rankValor - b.rankValor);
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
      percentDoTotal: totalValorGeral > 0 ? round((valorReais / totalValorGeral) * 100, 1) : 0,
      ultimaReferencia: doGrupo.length > 0 ? doGrupo[doGrupo.length - 1] : null,
    };
  });

  return {
    config: {
      giroDias: mesesJanela * 30,
      mesesFechados: mesesJanela,
      curvaALimitePercent,
      curvaBLimitePercent,
      curvaCLimitePercent,
    },
    totalAnalisadas,
    curvas,
    referencias,
  };
}

// ---- Curva ABCD calculada na granularidade de SKU (ref-cor-tam) em vez de referencia -
// mesma regra de curva/rank de getCurvaAbcResumo, so que cada linha do ranking e um SKU
// (uma combinacao referencia+cor+tamanho) em vez da referencia inteira somada. Pedido do
// usuario pra alternar entre as duas visoes na mesma tela - o numero do SKU em si nunca
// e a informacao principal (ninguem decora SKU numerico), o destaque fica em refCorTam.

export interface SkuAbc {
  sku: string;
  refCorTam: string;
  referenceCode: string;
  referenceName: string;
  cor: string;
  tamanho: string;
  curva: CurvaLetra;
  rankQtd: number;
  qtdVendida: number;
  mediaMensal: number;
  giro30dVarejo: number;
  giro30dAtacado: number;
  rankValor: number;
  valorReais: number;
  valorMedioMensal: number;
  representatividadeValor: number;
  representatividadeAcumulada: number;
  estoqueAtacado: number;
  estoqueVarejo: number;
  estoqueTotal: number;
}

export interface SkuCurvaResumo {
  curva: CurvaLetra;
  totalItens: number;
  quantidade: number;
  valorReais: number;
  mediaMensal: number;
  percentDoTotal: number;
  ultimoItem: SkuAbc | null;
}

export async function getCurvaAbcResumoPorSku(filtro: CurvaAbcFiltro = {}) {
  const config = await getConfig();
  const mesesJanela = Math.max(1, Math.round(config.giroDias / 30));

  const [identidadeRows, vendaAtual, estoqueRows, venda30d] = await Promise.all([
    getIdentidadeRows(filtro),
    getVendaPorProductCodeMesesFechados(mesesJanela, 0),
    getEstoqueCanalPorSku(),
    getVenda30DiasPorCanal(),
  ]);

  // Mapa de estoque por SKU
  const estoquePorSku = new Map<string, { varejo: number; atacado: number }>();
  for (const row of estoqueRows) {
    const atual = estoquePorSku.get(row.product_sku) || { varejo: 0, atacado: 0 };
    atual[row.canal] += decimalToNumber(row.estoque);
    estoquePorSku.set(row.product_sku, atual);
  }

  const brutos: Array<{
    sku: string; refCorTam: string; referenceCode: string; referenceName: string;
    cor: string; tamanho: string; qtdVendida: number; valorReais: number; estoqueVarejo: number; estoqueAtacado: number;
    giro30dVarejo: number; giro30dAtacado: number;
  }> = [];

  for (const row of identidadeRows) {
    if (!row.reference_code || row.product_code === null) continue;
    const venda = vendaAtual.get(row.product_code);
    if (!venda || venda.quantidade <= 0) continue;
    const estoque = estoquePorSku.get(row.product_sku) || { varejo: 0, atacado: 0 };
    const giro = venda30d.get(row.product_code) || { varejo: 0, atacado: 0 };
    brutos.push({
      sku: row.product_sku,
      refCorTam: buildRefCorTam(row),
      referenceCode: row.reference_code,
      referenceName: row.reference_name || row.reference_code,
      cor: row.color_name?.trim() || row.color_code?.trim() || 'SEM COR',
      tamanho: row.size?.trim() || 'SEM TAM',
      qtdVendida: venda.quantidade,
      valorReais: venda.valor,
      estoqueVarejo: estoque.varejo,
      estoqueAtacado: estoque.atacado,
      giro30dVarejo: giro.varejo,
      giro30dAtacado: giro.atacado,
    });
  }

  const totalAnalisadas = brutos.length;
  const curvaALimitePercent = decimalToNumber(config.curvaALimitePercent);
  const curvaBLimitePercent = decimalToNumber(config.curvaBLimitePercent);
  const curvaCLimitePercent = decimalToNumber(config.curvaCLimitePercent);

  const comMedio = brutos.map((b) => ({ ...b, valorMedioMensal: b.valorReais / mesesJanela }));
  const totalValorGeralBruto = comMedio.reduce((s, r) => s + Math.max(0, r.valorMedioMensal), 0);

  const curvaPorSku = new Map<string, CurvaLetra>();
  const representatividadePorSku = new Map<string, { percent: number; acumulado: number }>();
  const porValorDesc = [...comMedio].sort((a, b) => b.valorMedioMensal - a.valorMedioMensal);
  let acumuladoValor = 0;
  porValorDesc.forEach((r) => {
    const valorBase = Math.max(0, r.valorMedioMensal);
    acumuladoValor += valorBase;
    const percent = totalValorGeralBruto > 0 ? (valorBase / totalValorGeralBruto) * 100 : 0;
    const acumulado = totalValorGeralBruto > 0 ? (acumuladoValor / totalValorGeralBruto) * 100 : 0;
    representatividadePorSku.set(r.sku, { percent, acumulado });
    // Curva C vai ate 100% (nao existe mais curva D)
    if (acumulado <= curvaALimitePercent) curvaPorSku.set(r.sku, 'A');
    else if (acumulado <= curvaBLimitePercent) curvaPorSku.set(r.sku, 'B');
    else curvaPorSku.set(r.sku, 'C');
  });

  const porQtdDesc = [...comMedio].sort((a, b) => b.qtdVendida - a.qtdVendida);
  const rankQtdPorSku = new Map<string, number>();
  porQtdDesc.forEach((r, i) => rankQtdPorSku.set(r.sku, i + 1));

  const rankValorPorSku = new Map<string, number>();
  porValorDesc.forEach((r, i) => rankValorPorSku.set(r.sku, i + 1));

  const itens: SkuAbc[] = comMedio.map((r) => ({
    sku: r.sku,
    refCorTam: r.refCorTam,
    referenceCode: r.referenceCode,
    referenceName: r.referenceName,
    cor: r.cor,
    tamanho: r.tamanho,
    curva: curvaPorSku.get(r.sku) || 'B',
    rankQtd: rankQtdPorSku.get(r.sku) || 0,
    qtdVendida: round(r.qtdVendida, 0),
    mediaMensal: round(r.qtdVendida / mesesJanela, 0),
    giro30dVarejo: round(r.giro30dVarejo, 0),
    giro30dAtacado: round(r.giro30dAtacado, 0),
    rankValor: rankValorPorSku.get(r.sku) || 0,
    valorReais: round(r.valorReais, 2),
    valorMedioMensal: round(r.valorMedioMensal, 2),
    representatividadeValor: round(representatividadePorSku.get(r.sku)?.percent || 0, 2),
    representatividadeAcumulada: round(representatividadePorSku.get(r.sku)?.acumulado || 0, 2),
    estoqueAtacado: round(r.estoqueAtacado, 0),
    estoqueVarejo: round(r.estoqueVarejo, 0),
    estoqueTotal: round(r.estoqueVarejo + r.estoqueAtacado, 0),
  }));

  itens.sort((a, b) => a.rankValor - b.rankValor);

  const totalValorGeral = itens.reduce((s, r) => s + r.valorReais, 0);

  const curvas: SkuCurvaResumo[] = (['A', 'B', 'C'] as CurvaLetra[]).map((curva) => {
    const doGrupo = itens.filter((r) => r.curva === curva).sort((a, b) => a.rankValor - b.rankValor);
    const quantidade = doGrupo.reduce((s, r) => s + r.qtdVendida, 0);
    const valorReais = doGrupo.reduce((s, r) => s + r.valorReais, 0);
    return {
      curva,
      totalItens: doGrupo.length,
      quantidade: round(quantidade, 0),
      valorReais: round(valorReais, 2),
      mediaMensal: round(quantidade / mesesJanela, 0),
      percentDoTotal: totalValorGeral > 0 ? round((valorReais / totalValorGeral) * 100, 1) : 0,
      ultimoItem: doGrupo.length > 0 ? doGrupo[doGrupo.length - 1] : null,
    };
  });

  return {
    config: {
      mesesFechados: mesesJanela,
      curvaALimitePercent,
      curvaBLimitePercent,
      curvaCLimitePercent,
    },
    totalAnalisadas,
    curvas,
    itens,
  };
}

// ---- Visao por SKU (ref-cor-tam), paginada - drill-down opcional dentro de uma referencia ----

export interface CurvaAbcSkuFiltro extends CurvaAbcFiltro {
  referencia?: string;
  page: number;
  pageSize: number;
}

function buildRefCorTam(row: IdentidadeRow): string {
  const cor = row.color_name?.trim() || row.color_code?.trim() || 'SEM COR';
  const tamanho = row.size?.trim() || 'SEM TAM';
  return [row.reference_code || row.product_sku, cor, tamanho].join(' - ');
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
  const filtroComReferencia: CurvaAbcFiltro = { ...filtro };
  const identidadeRows = (await getIdentidadeRows(filtroComReferencia)).filter(
    (r) => !filtro.referencia || r.reference_code === filtro.referencia
  );

  const [vendaAtual, estoqueRows] = await Promise.all([
    getVendaPorProductCodeMesesFechados(3, 0),
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
        refCorTam: buildRefCorTam(row),
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
