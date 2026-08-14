import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import {
  OPERACAO_JOIN,
  SALE_OPERATION_FILTER,
  QUANTIDADE_COM_SINAL,
  FABRICA_BRANCH_CODE,
  linhaBucket,
  formatarLancamento,
  getConfig as getRelatorioBaseConfig,
  getCustoUltimaCompraRows,
  getUltimaEntradaRows,
  PCP_ESTOQUE_LIQUIDO_SKU_FILTER,
} from './relatorioBase.service.js';

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
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status: string | null;
  lancamento: string | null;
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
    SELECT a.product_sku, a.product_code, a.reference_code, a.reference_name, a.color_code, a.color_name, a.size,
      NULLIF(TRIM(a.class_categoria), '') as categoria,
      NULLIF(TRIM(a.class_linha), '') as linha,
      NULLIF(TRIM(a.class_genero), '') as genero,
      NULLIF(TRIM(a.class_status), '') as status,
      NULLIF(TRIM(a.class_lancamento), '') as lancamento
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
      AND a.reference_code IS NOT NULL
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
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
// SEM_VENDA = referencia com estoque mas ZERO venda no periodo - antes essas
// referencias eram simplesmente excluidas do relatorio inteiro (nunca apareciam em
// lugar nenhum, nem na tabela nem nos totais). Pedido explicito da usuaria: precisam
// aparecer (sem entrar no ranking/classificacao A/B/C, que so faz sentido pra quem
// vendeu), justamente pra evidenciar peca parada sem giro nenhum.
export type CurvaGrupo = CurvaLetra | 'SEM_VENDA';

// Estratificacao de uma curva (A/B/C) por Linha (Básico/Básico Renovável/Coleção, via
// linhaBucket) - percentDoValorCurva e calculado sobre valorReais (nao sobre
// quantidade), consistente com a propria classificacao ABC que ja e feita por valor.
// Itens com linha fora dos 3 buckets nomeados (ou sem linha) ficam de fora dos buckets
// mas continuam contando no total da curva - por isso os percentuais podem somar menos
// que 100%.
export interface CurvaLinhaBucket {
  bucket: string;
  quantidade: number;
  valorReais: number;
  percentDoValorCurva: number;
}

function buildLinhaStratificacao<T extends { linha: string | null; valorReais: number }>(
  doGrupo: T[],
  valorTotalCurva: number
): CurvaLinhaBucket[] {
  const buckets = ['Básico', 'Básico Renovável', 'Coleção'] as const;
  return buckets.map((bucket) => {
    const doBucket = doGrupo.filter((r) => linhaBucket(r.linha) === bucket);
    const valorReais = round(doBucket.reduce((s, r) => s + r.valorReais, 0), 2);
    return {
      bucket,
      quantidade: doBucket.length,
      valorReais,
      percentDoValorCurva: valorTotalCurva > 0 ? round((valorReais / valorTotalCurva) * 100, 1) : 0,
    };
  });
}

export interface ReferenciaAbc {
  referenceCode: string;
  referenceName: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status: string | null;
  lancamento: string | null;
  ultimaEntrada: string | null;
  curva: CurvaGrupo;
  rankQtd: number;
  rankCurva: number;
  qtdVendida: number;
  mediaMensal: number;
  giro90dPercent: number | null;
  giro30dPercent: number | null;
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
  valorEstoqueCusto: number;
}

// Resumo comparando participacao de venda x estoque por grupo (A/B/C/SEM_VENDA/TOTAL) -
// pedido da usuaria via planilha Excel: "80% da venda era quase 65% do estoque, a ideia
// e ter essas participacoes equilibradas, pra nao faltar peca". Percentuais de venda
// sao calculados sobre o total COM venda; percentuais de estoque sao calculados sobre
// o total geral (incluindo SEM_VENDA, que so tem estoque mesmo).
export interface VendaEstoqueResumoLinha {
  grupo: CurvaGrupo | 'TOTAL';
  totalReferencias: number;
  percentReferencias: number;
  qtdVendida: number;
  valorVenda: number;
  percentValorVenda: number;
  estoquePecas: number;
  valorEstoqueCusto: number;
  percentValorEstoque: number;
}

export interface CurvaResumo {
  curva: CurvaLetra;
  totalReferencias: number;
  quantidade: number;
  valorReais: number;
  totalSkus: number;
  mediaMensal: number;
  percentDoTotal: number;
  porLinha: CurvaLinhaBucket[];
}

export async function getCurvaAbcResumo(filtro: CurvaAbcFiltro = {}) {
  const config = await getConfig();
  // giro_dias guarda a janela em dias (sempre multiplo de 30) pra reaproveitar a mesma
  // coluna/config do Relatorio Base - na pratica o usuario sempre pensa e edita em
  // "meses fechados" (ver Input na tela de Configuracoes do PCP).
  const mesesJanela = Math.max(1, Math.round(config.giroDias / 30));

  const relatorioBaseConfig = await getRelatorioBaseConfig();

  const [identidadeRows, vendaAtual, vendaAnterior, estoqueRows, venda30d, custoRows, ultimaEntradaRows] = await Promise.all([
    getIdentidadeRows(filtro),
    getVendaPorProductCodeMesesFechados(mesesJanela, 0),
    getVendaPorProductCodeMesesFechados(mesesJanela * 2, mesesJanela),
    getEstoqueCanalPorSku(),
    getVenda30DiasPorCanal(),
    getCustoUltimaCompraRows(relatorioBaseConfig.precoCustoBranchCode, null),
    getUltimaEntradaRows(null),
  ]);

  // Mapa de estoque por SKU
  const estoquePorSku = new Map<string, { varejo: number; atacado: number }>();
  for (const row of estoqueRows) {
    const atual = estoquePorSku.get(row.product_sku) || { varejo: 0, atacado: 0 };
    atual[row.canal] += decimalToNumber(row.estoque);
    estoquePorSku.set(row.product_sku, atual);
  }

  // Custo (ultima compra, mesma fonte/loja de referencia do Relatorio Base) e ultima
  // entrada de estoque, por product_code - usados abaixo pra calcular o valor de
  // estoque a custo e a coluna "ultima entrada" por referencia.
  const custoPorProductCode = new Map<number, number>();
  for (const r of custoRows) custoPorProductCode.set(r.product_code, decimalToNumber(r.valor));
  const ultimaEntradaPorProductCode = new Map<number, Date>();
  for (const r of ultimaEntradaRows) ultimaEntradaPorProductCode.set(r.product_code, r.ultima_entrada);
  const productCodePorSku = new Map<string, number>();
  for (const row of identidadeRows) {
    if (row.product_code !== null) productCodePorSku.set(row.product_sku, row.product_code);
  }

  // Agrupa SKUs por referencia - categoria/linha/genero/status/lancamento vem do
  // primeiro SKU encontrado (classificacao da referencia como um todo, consistente
  // entre as variacoes na pratica - mesmo padrao ja usado em relatorioBase.service.ts).
  const porReferencia = new Map<string, { nome: string; skus: Set<string>; productCodes: Set<number>; categoria: string | null; linha: string | null; genero: string | null; status: string | null; lancamento: string | null }>();
  for (const row of identidadeRows) {
    if (!row.reference_code) continue;
    const ref = porReferencia.get(row.reference_code) || {
      nome: row.reference_name || row.reference_code,
      skus: new Set<string>(),
      productCodes: new Set<number>(),
      categoria: row.categoria,
      linha: row.linha,
      genero: row.genero,
      status: row.status,
      lancamento: row.lancamento,
    };
    ref.skus.add(row.product_sku);
    if (row.product_code !== null) ref.productCodes.add(row.product_code);
    porReferencia.set(row.reference_code, ref);
  }

  const brutos: Array<{ referenceCode: string; referenceName: string; categoria: string | null; linha: string | null; genero: string | null; status: string | null; lancamento: string | null; ultimaEntrada: Date | null; qtdVendida: number; valorReais: number; valorMedioMensal: number; totalSkus: number; qtdAnterior: number; estoqueVarejo: number; estoqueAtacado: number; valorEstoqueCusto: number; giro30dVarejo: number; giro30dAtacado: number }> = [];

  for (const [referenceCode, dados] of porReferencia) {
    let qtdVendida = 0;
    let valorReais = 0;
    let qtdAnterior = 0;
    let estoqueVarejo = 0;
    let estoqueAtacado = 0;
    let giro30dVarejo = 0;
    let giro30dAtacado = 0;
    let ultimaEntrada: Date | null = null;
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
      const entrada = ultimaEntradaPorProductCode.get(pc);
      if (entrada && (!ultimaEntrada || entrada > ultimaEntrada)) ultimaEntrada = entrada;
    }
    // Soma estoque (e valor de estoque a custo) de todos os SKUs da referência
    let valorEstoqueCusto = 0;
    for (const sku of dados.skus) {
      const estoque = estoquePorSku.get(sku) || { varejo: 0, atacado: 0 };
      estoqueVarejo += estoque.varejo;
      estoqueAtacado += estoque.atacado;
      const productCode = productCodePorSku.get(sku);
      const custo = productCode !== undefined ? custoPorProductCode.get(productCode) : undefined;
      if (custo) valorEstoqueCusto += (estoque.varejo + estoque.atacado) * custo;
    }
    // Antes excluia qualquer referencia sem venda no periodo do relatorio inteiro -
    // agora só pula quem nao tem venda NEM estoque (referencia irrelevante de fato).
    // Quem tem estoque mas nao vendeu entra como grupo SEM_VENDA mais abaixo.
    if (qtdVendida <= 0 && estoqueVarejo + estoqueAtacado <= 0) continue;
    brutos.push({
      referenceCode,
      referenceName: dados.nome,
      categoria: dados.categoria,
      linha: dados.linha,
      genero: dados.genero,
      status: dados.status,
      lancamento: dados.lancamento,
      ultimaEntrada,
      qtdVendida,
      valorReais,
      valorMedioMensal: valorReais / mesesJanela,
      totalSkus: dados.skus.size,
      qtdAnterior,
      estoqueVarejo,
      estoqueAtacado,
      valorEstoqueCusto,
      giro30dVarejo,
      giro30dAtacado,
    });
  }

  const brutosComVenda = brutos.filter((r) => r.qtdVendida > 0);
  const brutosSemVenda = brutos.filter((r) => r.qtdVendida <= 0);

  const totalAnalisadas = brutosComVenda.length;
  const curvaALimitePercent = decimalToNumber(config.curvaALimitePercent);
  const curvaBLimitePercent = decimalToNumber(config.curvaBLimitePercent);
  const curvaCLimitePercent = decimalToNumber(config.curvaCLimitePercent);
  const totalValorGeralBruto = brutosComVenda.reduce((s, r) => s + Math.max(0, r.valorMedioMensal), 0);

  const curvaPorReferencia = new Map<string, CurvaLetra>();
  const representatividadePorReferencia = new Map<string, { percent: number; acumulado: number }>();
  const porValorDesc = [...brutosComVenda].sort((a, b) => b.valorMedioMensal - a.valorMedioMensal);
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

  // Ranking geral (so entre quem teve venda - "SEM_VENDA" nao entra em rank nenhum)
  const porQtdDesc = [...brutosComVenda].sort((a, b) => b.qtdVendida - a.qtdVendida);
  const rankQtdPorReferencia = new Map<string, number>();
  porQtdDesc.forEach((r, i) => rankQtdPorReferencia.set(r.referenceCode, i + 1));

  const rankValorPorReferencia = new Map<string, number>();
  porValorDesc.forEach((r, i) => rankValorPorReferencia.set(r.referenceCode, i + 1));

  function mapearReferencia(r: (typeof brutos)[number], curva: CurvaGrupo): ReferenciaAbc {
    const mediaPorSku = r.totalSkus > 0 ? round(r.qtdVendida / r.totalSkus, 0) : 0;
    const mediaPorSkuAnterior = r.totalSkus > 0 ? round(r.qtdAnterior / r.totalSkus, 0) : 0;
    const tendencia: 'up' | 'down' | 'flat' = mediaPorSku > mediaPorSkuAnterior ? 'up' : mediaPorSku < mediaPorSkuAnterior ? 'down' : 'flat';
    const estoqueTotal = r.estoqueVarejo + r.estoqueAtacado;

    return {
      referenceCode: r.referenceCode,
      referenceName: r.referenceName,
      categoria: r.categoria,
      linha: r.linha,
      genero: r.genero,
      status: r.status,
      lancamento: formatarLancamento(r.lancamento),
      ultimaEntrada: r.ultimaEntrada ? r.ultimaEntrada.toISOString().slice(0, 10) : null,
      curva,
      rankQtd: rankQtdPorReferencia.get(r.referenceCode) || 0,
      rankCurva: rankValorPorReferencia.get(r.referenceCode) || 0,
      qtdVendida: round(r.qtdVendida, 0),
      mediaMensal: round(r.qtdVendida / mesesJanela, 0),
      giro90dPercent: estoqueTotal > 0 ? round((r.qtdVendida / estoqueTotal) * 100, 1) : null,
      giro30dPercent: estoqueTotal > 0 ? round(((r.giro30dVarejo + r.giro30dAtacado) / estoqueTotal) * 100, 1) : null,
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
      estoqueTotal: round(estoqueTotal, 0),
      valorEstoqueCusto: round(r.valorEstoqueCusto, 2),
    };
  }

  const referenciasComVenda = brutosComVenda
    .map((r) => mapearReferencia(r, curvaPorReferencia.get(r.referenceCode) || 'B'))
    .sort((a, b) => a.rankValor - b.rankValor);

  // SEM_VENDA nao tem rank de valor pra ordenar - maior estoque primeiro, pra
  // evidenciar logo de cara a peca parada mais volumosa. Sempre "no final" da lista,
  // depois de todo mundo que vendeu (pedido explicito da usuaria).
  const referenciasSemVenda = brutosSemVenda
    .map((r) => mapearReferencia(r, 'SEM_VENDA'))
    .sort((a, b) => b.estoqueTotal - a.estoqueTotal);

  const referencias: ReferenciaAbc[] = [...referenciasComVenda, ...referenciasSemVenda];

  const totalValorGeral = referenciasComVenda.reduce((s, r) => s + r.valorReais, 0);

  const curvas: CurvaResumo[] = (['A', 'B', 'C'] as CurvaLetra[]).map((curva) => {
    const doGrupo = referenciasComVenda.filter((r) => r.curva === curva).sort((a, b) => a.rankValor - b.rankValor);
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
      porLinha: buildLinhaStratificacao(doGrupo, valorReais),
    };
  });

  // Resumo Venda x Estoque por grupo (A/B/C/SEM_VENDA/TOTAL) - pedido original da
  // usuaria via planilha Excel, comparando participacao de venda com participacao de
  // estoque lado a lado, pra identificar desequilibrio (ex: 80% da venda concentrada
  // em so 65% do estoque, sinal de risco de ruptura na curva A).
  const totalReferenciasGeral = referencias.length;
  const totalEstoquePecasGeral = referencias.reduce((s, r) => s + r.estoqueTotal, 0);
  const totalValorEstoqueGeral = referencias.reduce((s, r) => s + r.valorEstoqueCusto, 0);

  function montarResumoVendaEstoque(grupo: CurvaGrupo | 'TOTAL', doGrupo: ReferenciaAbc[]): VendaEstoqueResumoLinha {
    const qtdVendida = doGrupo.reduce((s, r) => s + r.qtdVendida, 0);
    const valorVenda = doGrupo.reduce((s, r) => s + r.valorReais, 0);
    const estoquePecas = doGrupo.reduce((s, r) => s + r.estoqueTotal, 0);
    const valorEstoqueCusto = doGrupo.reduce((s, r) => s + r.valorEstoqueCusto, 0);
    return {
      grupo,
      totalReferencias: doGrupo.length,
      percentReferencias: totalReferenciasGeral > 0 ? round((doGrupo.length / totalReferenciasGeral) * 100, 2) : 0,
      qtdVendida: round(qtdVendida, 0),
      valorVenda: round(valorVenda, 2),
      percentValorVenda: totalValorGeral > 0 ? round((valorVenda / totalValorGeral) * 100, 2) : 0,
      estoquePecas: round(estoquePecas, 0),
      valorEstoqueCusto: round(valorEstoqueCusto, 2),
      percentValorEstoque: totalValorEstoqueGeral > 0 ? round((valorEstoqueCusto / totalValorEstoqueGeral) * 100, 2) : 0,
    };
  }

  const resumoVendaEstoque: VendaEstoqueResumoLinha[] = [
    ...(['A', 'B', 'C'] as CurvaLetra[]).map((curva) => montarResumoVendaEstoque(curva, referenciasComVenda.filter((r) => r.curva === curva))),
    montarResumoVendaEstoque('SEM_VENDA', referenciasSemVenda),
    montarResumoVendaEstoque('TOTAL', referencias),
  ];

  return {
    config: {
      giroDias: mesesJanela * 30,
      mesesFechados: mesesJanela,
      curvaALimitePercent,
      curvaBLimitePercent,
      curvaCLimitePercent,
    },
    totalAnalisadas,
    totalSemVenda: referenciasSemVenda.length,
    curvas,
    resumoVendaEstoque,
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
  giro90dPercent: number | null;
  giro30dPercent: number | null;
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
  porLinha: CurvaLinhaBucket[];
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
    cor: string; tamanho: string; linha: string | null; qtdVendida: number; valorReais: number; estoqueVarejo: number; estoqueAtacado: number;
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
      linha: row.linha,
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

  const itens: SkuAbc[] = comMedio.map((r) => {
    const estoqueTotal = r.estoqueVarejo + r.estoqueAtacado;
    return {
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
      giro90dPercent: estoqueTotal > 0 ? round((r.qtdVendida / estoqueTotal) * 100, 1) : null,
      giro30dPercent: estoqueTotal > 0 ? round(((r.giro30dVarejo + r.giro30dAtacado) / estoqueTotal) * 100, 1) : null,
      rankValor: rankValorPorSku.get(r.sku) || 0,
      valorReais: round(r.valorReais, 2),
      valorMedioMensal: round(r.valorMedioMensal, 2),
      representatividadeValor: round(representatividadePorSku.get(r.sku)?.percent || 0, 2),
      representatividadeAcumulada: round(representatividadePorSku.get(r.sku)?.acumulado || 0, 2),
      estoqueAtacado: round(r.estoqueAtacado, 0),
      estoqueVarejo: round(r.estoqueVarejo, 0),
      estoqueTotal: round(estoqueTotal, 0),
    };
  });

  itens.sort((a, b) => a.rankValor - b.rankValor);

  const totalValorGeral = itens.reduce((s, r) => s + r.valorReais, 0);

  // linha nao entra no tipo publico SkuAbc (classificacao fica so na tabela de
  // referencias) - mapa auxiliar so pra alimentar a estratificacao por linha dos cards.
  const linhaPorSku = new Map<string, string | null>();
  for (const r of comMedio) linhaPorSku.set(r.sku, r.linha);

  const curvas: SkuCurvaResumo[] = (['A', 'B', 'C'] as CurvaLetra[]).map((curva) => {
    const doGrupo = itens.filter((r) => r.curva === curva).sort((a, b) => a.rankValor - b.rankValor);
    const quantidade = doGrupo.reduce((s, r) => s + r.qtdVendida, 0);
    const valorReais = doGrupo.reduce((s, r) => s + r.valorReais, 0);
    const doGrupoComLinha = doGrupo.map((r) => ({ linha: linhaPorSku.get(r.sku) ?? null, valorReais: r.valorReais }));
    return {
      curva,
      totalItens: doGrupo.length,
      quantidade: round(quantidade, 0),
      valorReais: round(valorReais, 2),
      mediaMensal: round(quantidade / mesesJanela, 0),
      percentDoTotal: totalValorGeral > 0 ? round((valorReais / totalValorGeral) * 100, 1) : 0,
      porLinha: buildLinhaStratificacao(doGrupoComLinha, valorReais),
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
    SELECT us.product_sku,
      CASE WHEN us.branch_code = ${FABRICA_BRANCH_CODE} THEN 'atacado' ELSE 'varejo' END AS canal,
      SUM(COALESCE(us.stock, 0)) AS estoque
    FROM ultimo_saldo us
    JOIN produto_analitico a ON a.product_sku = us.product_sku
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
    GROUP BY us.product_sku, canal
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
