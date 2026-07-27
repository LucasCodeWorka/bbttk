import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { ATACADO_BRANCH_CODE, RELATORIO_BASE_BRANCH_ORDER } from '../config/constants.js';

// Fragmentos de classificacao de venda duplicados de
// apps/api/src/services/vendas.service.ts:20-54 - workspaces separados, sem
// cross-import configurado entre apps/api e apps/pcp-api. Se a logica de
// classificacao do TOTVS mudar la, replicar aqui tambem.
// Exportados pra reuso em outros services do mesmo app (visaoGeral/analiseGrade/
// curvaAbc.service.ts) - evita duplicar de novo dentro do proprio apps/pcp-api.
export const OPERACAO_JOIN = Prisma.sql`LEFT JOIN classificacao_operacoes co ON co.operation_code = t.operation_code`;
export const IS_VENDA = Prisma.sql`(co.operations_type = 'S' AND co.operation_mode = '4')`;
export const IS_DEVOLUCAO = Prisma.sql`(co.operations_type = 'E' AND co.operation_mode = '3')`;
export const SALE_OPERATION_FILTER = Prisma.sql`(${IS_VENDA} OR ${IS_DEVOLUCAO})`;
// Giro liquido de devolucao (mesmo padrao do resto do sistema - venda/peca sempre liquida)
export const QUANTIDADE_COM_SINAL = Prisma.sql`(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(ti.quantity) ELSE ti.quantity END)`;

export const FABRICA_BRANCH_CODE = 2;
const RELATORIO_KEY = 'relatorio_base';

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export interface RelatorioBaseFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  branches?: number[];
  search?: string;
  limit?: number | null;
}

export interface RelatorioBaseColunaFilial {
  giro: number;
  est: number;
  cob: number | null;
}

export interface RelatorioBaseRow {
  sku: string;
  codigo: number | null;
  descricao: string;
  descricaoCompleta: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  modelo: string | null;
  status: string | null;
  // lancamento vem de class_lancamento (TOTVS, "MM/AAAA"); ultimaEntrada vem do MAX de
  // transacao de entrada (TOTVS). Ambos null se o produto nao tiver essa info.
  lancamento: string | null;
  ultimaEntrada: string | null;
  // custo/pdvRealVar/markupVar/pdvRealAta/markupAta vem de produto_custos/produto_precos
  // (sincronizados do TOTVS via pcpConfig), null se o SKU ainda nao foi sincronizado ou
  // nao tem o codigo escolhido no Configurador. pdvAtual nao tem fonte de dado ainda.
  custo: number | null;
  pdvAtual: null;
  pdvRealVar: number | null;
  markupVar: number | null;
  pdvRealAta: number | null;
  markupAta: number | null;
  estDisponivel: null;
  transito: null;
  emProducao: null;
  estPrevisto: null;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
}

export interface RelatorioBaseResponse {
  config: { giroDias: number; coberturaMeses: number; atacadoCoberturaBase: string };
  kpis: { giroTt1: number; giroTt3: number; giroTt6: number; estTt: number; skuCount: number };
  colunas: { branchCode: number; label: string }[];
  rows: RelatorioBaseRow[];
}

async function getConfig() {
  return prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: RELATORIO_KEY },
    create: { relatorio: RELATORIO_KEY },
    update: {},
  });
}

interface EstoqueRow {
  product_sku: string;
  product_code: number | null;
  branch_code: number;
  quantidade_estoque: Decimal;
}

// Estoque atual por SKU x filial - mesma regra de dedup da tabela analitica externa
// (PROMPT_TABELA_ANALITICA_PCP_ESTOQUE_SEM_GIRO.md): captura mais recente por
// product_sku+branch_code+stock_code, depois soma.
async function getEstoqueRows(): Promise<EstoqueRow[]> {
  return prisma.$queryRaw<EstoqueRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, product_code, branch_code, stock, captured_at
      FROM prd_saldo
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    )
    SELECT product_sku, product_code, branch_code,
           COALESCE(SUM(COALESCE(stock,0)) FILTER (WHERE COALESCE(stock,0) > 0), 0) AS quantidade_estoque
    FROM ultimo_saldo
    GROUP BY product_sku, product_code, branch_code
  `;
}

interface ProductCodeAggRow {
  product_code: number;
  branch_code: number;
  quantidade: Decimal;
}

// Giro (peca vendida, liquido de devolucao) por product_code x filial, ultimos `dias` dias
async function getGiroRows(dias: number): Promise<ProductCodeAggRow[]> {
  return prisma.$queryRaw<ProductCodeAggRow[]>`
    SELECT ti.product_code, t.branch_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(days => ${dias}::int)
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code, t.branch_code
  `;
}

// Giro do canal Atacado (channel-split real, so branch_code=2), mesmo padrao de
// getVendasFabricaDividida/getDevolucoesFabricaDividida em vendas.service.ts
async function getGiroAtacadoRows(dias: number): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(days => ${dias}::int)
      AND t.status = 4
      AND t.branch_code = ${FABRICA_BRANCH_CODE}
      AND co.description ILIKE '%ATACADO%'
      AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code
  `;
}

// Total vendido por product_code x filial nos ultimos `meses` meses - denominador da
// cobertura (media_mensal = total / meses).
async function getVendaPorMesesRows(meses: number): Promise<ProductCodeAggRow[]> {
  return prisma.$queryRaw<ProductCodeAggRow[]>`
    SELECT ti.product_code, t.branch_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code, t.branch_code
  `;
}

// Total vendido do canal Atacado nos ultimos `meses` meses - usado como denominador da
// cobertura do Atacado quando atacadoCoberturaBase = 'atacado_only'.
async function getVendaAtacadoPorMesesRows(meses: number): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4
      AND t.branch_code = ${FABRICA_BRANCH_CODE}
      AND co.description ILIKE '%ATACADO%'
      AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code
  `;
}

// Giro TT de rede (soma de todas as filiais) por product_code, nas janelas de 1/3/6 meses
async function getGiroTtRows(meses: number): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code
  `;
}

interface CustoPrecoRow {
  product_code: number;
  custo: Decimal | null;
  pdv_var: Decimal | null;
  pdv_ata: Decimal | null;
}

// Custo/PDV real (var/ata) por product_code, na "loja de referencia" configurada -
// custo/preco no TOTVS sao por filial, mas o Relatorio Base mostra 1 valor so por SKU
// (decisao do Configurador do PCP: apps/web/.../pcp/relatorio-base-config/page.tsx).
async function getCustoPrecoRows(precoCustoBranchCode: number, custoCode: number, pdvVarejoCode: number, pdvAtacadoCode: number): Promise<CustoPrecoRow[]> {
  return prisma.$queryRaw<CustoPrecoRow[]>`
    SELECT
      base.product_code,
      c.valor AS custo,
      pv.valor AS pdv_var,
      pa.valor AS pdv_ata
    FROM (
      SELECT DISTINCT product_code FROM produto_custos WHERE branch_code = ${precoCustoBranchCode}
      UNION
      SELECT DISTINCT product_code FROM produto_precos WHERE branch_code = ${precoCustoBranchCode}
    ) base
    LEFT JOIN produto_custos c ON c.product_code = base.product_code AND c.branch_code = ${precoCustoBranchCode} AND c.cost_code = ${custoCode}
    LEFT JOIN produto_precos pv ON pv.product_code = base.product_code AND pv.branch_code = ${precoCustoBranchCode} AND pv.price_code = ${pdvVarejoCode}
    LEFT JOIN produto_precos pa ON pa.product_code = base.product_code AND pa.branch_code = ${precoCustoBranchCode} AND pa.price_code = ${pdvAtacadoCode}
  `;
}

// Markup: (preco - custo) / custo * 100. Null se nao tem custo (ou custo <= 0) ou nao
// tem preco - nao faz sentido calcular markup sem os dois.
function markupPercentual(preco: number | null, custo: number | null): number | null {
  if (preco === null || custo === null || custo <= 0) return null;
  return round(((preco - custo) / custo) * 100, 1);
}

// Base do MARKUP (decisao do usuario): nao usa o CUSTO/PDV REAL configurados no
// Configurador (esses continuam mostrando o preco de TABELA do TOTVS, pra referencia) -
// usa custo da ULTIMA COMPRA (costCode=2, fixo) contra o preco da ULTIMA VENDA REAL
// daquele produto (transacao de verdade, com desconto ja aplicado - net_value/quantity),
// separado por canal (varejo = filiais reais exceto Fabrica; atacado = mesmo
// channel-split ja usado no resto do relatorio).
const CUSTO_ULTIMA_COMPRA_CODE = 2;

async function getCustoUltimaCompraRows(precoCustoBranchCode: number): Promise<Array<{ product_code: number; valor: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; valor: Decimal }>>`
    SELECT product_code, valor FROM produto_custos
    WHERE branch_code = ${precoCustoBranchCode} AND cost_code = ${CUSTO_ULTIMA_COMPRA_CODE}
  `;
}

// Preco unitario (liquido de desconto) da ultima venda real de cada product_code, por
// canal - varejo = qualquer filial real exceto Fabrica; atacado = mesmo channel-split
// (branch_code=2 + descricao contendo ATACADO) usado no resto do relatorio.
async function getUltimaVendaRealRows(canal: 'varejo' | 'atacado'): Promise<Array<{ product_code: number; preco_unitario: number }>> {
  const canalFiltro =
    canal === 'varejo'
      ? Prisma.sql`t.branch_code != ${FABRICA_BRANCH_CODE}`
      : Prisma.sql`t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%'`;

  const rows = await prisma.$queryRaw<Array<{ product_code: number; preco_unitario: Decimal | null }>>`
    SELECT DISTINCT ON (ti.product_code) ti.product_code,
      CASE WHEN ti.quantity IS NOT NULL AND ti.quantity != 0 THEN ti.net_value / ti.quantity ELSE NULL END AS preco_unitario
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.status = 4 AND ${IS_VENDA} AND ${canalFiltro}
    ORDER BY ti.product_code, t.transaction_date DESC, t.transaction_code DESC
  `;
  return rows
    .filter((r) => r.preco_unitario !== null)
    .map((r) => ({ product_code: r.product_code, preco_unitario: decimalToNumber(r.preco_unitario) }));
}

// Ultima entrada de estoque por product_code (rede toda, nao por filial - o relatorio
// tem 1 coluna so) - qualquer operacao classificada como entrada no TOTVS
// (operations_type='E': transferencia, compra, retorno, entrada avulsa etc.), pega so
// o MAX(transaction_date), sem diferenciar o tipo (confirmado com o usuario: "e so
// pegar o max"). Devolucao (operation_mode='3') tambem e operations_type='E' mas ja e
// tratada em separado no resto do sistema - aqui entra igual, pois fisicamente tambem
// e uma entrada de mercadoria no estoque daquela filial.
async function getUltimaEntradaRows(): Promise<Array<{ product_code: number; ultima_entrada: Date }>> {
  return prisma.$queryRaw<Array<{ product_code: number; ultima_entrada: Date }>>`
    SELECT ti.product_code, MAX(t.transaction_date) AS ultima_entrada
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
    ${OPERACAO_JOIN}
    WHERE t.status = 4 AND co.operations_type = 'E'
    GROUP BY ti.product_code
  `;
}

interface IdentidadeRow {
  product_sku: string;
  product_code: number | null;
  descricao: string | null;
  descricao_completa: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  modelo: string | null;
  status: string | null;
  lancamento: string | null;
}

// class_lancamento vem do TOTVS no formato "MM AAAA" (ex: "11 2020") - so reformata pra
// "MM/AAAA" pra exibicao, sem inventar data (nao existe timestamp exato de lancamento,
// so o mes/ano). "012019" (sem espaco, ~20mil SKUs) parece um valor default/generico do
// TOTVS pra produto sem classificacao de lancamento real - tratado como null.
function formatarLancamento(valor: string | null): string | null {
  if (!valor) return null;
  const match = valor.trim().match(/^(\d{2})\s+(\d{4})$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function buildIdentidadeFiltro(filtro: RelatorioBaseFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(a.class_categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(a.class_linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(a.class_genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`TRIM(a.class_status) IN (${Prisma.join(filtro.status)})`);
  if (filtro.search?.trim()) {
    const termo = `%${filtro.search.trim()}%`;
    condicoes.push(Prisma.sql`(a.product_sku ILIKE ${termo} OR a.reference_name ILIKE ${termo} OR a.product_name ILIKE ${termo})`);
  }
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

async function getIdentidadeRows(filtro: RelatorioBaseFiltro): Promise<IdentidadeRow[]> {
  const filtroSql = buildIdentidadeFiltro(filtro);

  return prisma.$queryRaw<IdentidadeRow[]>`
    SELECT
      a.product_sku,
      a.product_code,
      COALESCE(NULLIF(TRIM(a.product_name), ''), NULLIF(TRIM(a.reference_name), ''), a.product_sku) as descricao,
      COALESCE(NULLIF(TRIM(a.description), ''), NULLIF(TRIM(a.product_name), ''), NULLIF(TRIM(a.reference_name), ''), a.product_sku) as descricao_completa,
      NULLIF(TRIM(a.class_categoria), '') as categoria,
      NULLIF(TRIM(a.class_linha), '') as linha,
      NULLIF(TRIM(a.class_genero), '') as genero,
      NULLIF(TRIM(a.class_modelo), '') as modelo,
      NULLIF(TRIM(a.class_status), '') as status,
      NULLIF(TRIM(a.class_lancamento), '') as lancamento
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${filtroSql}
  `;
}

export async function getRelatorioBase(filtro: RelatorioBaseFiltro): Promise<RelatorioBaseResponse> {
  const config = await getConfig();
  const branchFiltro = filtro.branches && filtro.branches.length > 0 ? new Set(filtro.branches) : null;

  const [
    identidadeRows,
    estoqueRows,
    giroRows,
    giroAtacadoRows,
    vendaMesesRows,
    vendaAtacadoMesesRows,
    giroTt1Rows,
    giroTt3Rows,
    giroTt6Rows,
    custoPrecoRows,
    ultimaEntradaRows,
    custoUltimaCompraRows,
    ultimaVendaVarejoRows,
    ultimaVendaAtacadoRows,
  ] = await Promise.all([
    getIdentidadeRows(filtro),
    getEstoqueRows(),
    getGiroRows(config.giroDias),
    getGiroAtacadoRows(config.giroDias),
    getVendaPorMesesRows(config.coberturaMeses),
    config.atacadoCoberturaBase === 'atacado_only' ? getVendaAtacadoPorMesesRows(config.coberturaMeses) : Promise.resolve([]),
    getGiroTtRows(1),
    getGiroTtRows(3),
    getGiroTtRows(6),
    getCustoPrecoRows(config.precoCustoBranchCode, config.custoCode, config.pdvVarejoCode, config.pdvAtacadoCode),
    getUltimaEntradaRows(),
    getCustoUltimaCompraRows(config.precoCustoBranchCode),
    getUltimaVendaRealRows('varejo'),
    getUltimaVendaRealRows('atacado'),
  ]);

  // Mapas auxiliares product_sku -> ... e product_code -> ...
  const estoquePorSku = new Map<string, Map<number, number>>(); // sku -> branch_code -> quantidade
  for (const r of estoqueRows) {
    const mapa = estoquePorSku.get(r.product_sku) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade_estoque));
    estoquePorSku.set(r.product_sku, mapa);
  }

  const giroPorProductCode = new Map<number, Map<number, number>>(); // product_code -> branch_code -> giro
  for (const r of giroRows) {
    const mapa = giroPorProductCode.get(r.product_code) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade));
    giroPorProductCode.set(r.product_code, mapa);
  }

  const giroAtacadoPorProductCode = new Map<number, number>();
  for (const r of giroAtacadoRows) giroAtacadoPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));

  const vendaMesesPorProductCode = new Map<number, Map<number, number>>(); // product_code -> branch_code -> total vendido no periodo
  for (const r of vendaMesesRows) {
    const mapa = vendaMesesPorProductCode.get(r.product_code) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade));
    vendaMesesPorProductCode.set(r.product_code, mapa);
  }

  const vendaAtacadoMesesPorProductCode = new Map<number, number>();
  for (const r of vendaAtacadoMesesRows) vendaAtacadoMesesPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));

  const giroTt1PorProductCode = new Map<number, number>();
  for (const r of giroTt1Rows) giroTt1PorProductCode.set(r.product_code, decimalToNumber(r.quantidade));
  const giroTt3PorProductCode = new Map<number, number>();
  for (const r of giroTt3Rows) giroTt3PorProductCode.set(r.product_code, decimalToNumber(r.quantidade));
  const giroTt6PorProductCode = new Map<number, number>();
  for (const r of giroTt6Rows) giroTt6PorProductCode.set(r.product_code, decimalToNumber(r.quantidade));

  const custoPrecoPorProductCode = new Map<number, { custo: number | null; pdvVar: number | null; pdvAta: number | null }>();
  for (const r of custoPrecoRows) {
    custoPrecoPorProductCode.set(r.product_code, {
      custo: r.custo !== null ? decimalToNumber(r.custo) : null,
      pdvVar: r.pdv_var !== null ? decimalToNumber(r.pdv_var) : null,
      pdvAta: r.pdv_ata !== null ? decimalToNumber(r.pdv_ata) : null,
    });
  }

  const ultimaEntradaPorProductCode = new Map<number, Date>();
  for (const r of ultimaEntradaRows) ultimaEntradaPorProductCode.set(r.product_code, r.ultima_entrada);

  const custoUltimaCompraPorProductCode = new Map<number, number>();
  for (const r of custoUltimaCompraRows) custoUltimaCompraPorProductCode.set(r.product_code, decimalToNumber(r.valor));
  const ultimaVendaVarejoPorProductCode = new Map<number, number>();
  for (const r of ultimaVendaVarejoRows) ultimaVendaVarejoPorProductCode.set(r.product_code, r.preco_unitario);
  const ultimaVendaAtacadoPorProductCode = new Map<number, number>();
  for (const r of ultimaVendaAtacadoRows) ultimaVendaAtacadoPorProductCode.set(r.product_code, r.preco_unitario);

  function coberturaDe(estoque: number, mediaMensal: number): number | null {
    if (mediaMensal <= 0) return null;
    return round(estoque / mediaMensal, 2);
  }

  const colunasAtivas = branchFiltro
    ? RELATORIO_BASE_BRANCH_ORDER.filter((c) => branchFiltro.has(c.branchCode))
    : RELATORIO_BASE_BRANCH_ORDER;

  const rows: RelatorioBaseRow[] = [];

  for (const identidade of identidadeRows) {
    const sku = identidade.product_sku;
    const productCode = identidade.product_code;
    const estoqueDoSku = estoquePorSku.get(sku) || new Map<number, number>();
    const giroDoProduto = productCode !== null ? giroPorProductCode.get(productCode) : undefined;
    const vendaMesesDoProduto = productCode !== null ? vendaMesesPorProductCode.get(productCode) : undefined;

    // EST.TT = soma de todas as filiais reais (inclui a Fabrica/branch_code=2)
    let estTt = 0;
    for (const valor of estoqueDoSku.values()) estTt += valor;

    const branches: Record<number, RelatorioBaseColunaFilial> = {};
    for (const coluna of colunasAtivas) {
      if (coluna.branchCode === ATACADO_BRANCH_CODE) {
        const estFabrica = estoqueDoSku.get(FABRICA_BRANCH_CODE) || 0;
        const giroAtacado = productCode !== null ? giroAtacadoPorProductCode.get(productCode) || 0 : 0;
        const mediaMensalAtacado =
          config.atacadoCoberturaBase === 'atacado_only'
            ? (productCode !== null ? vendaAtacadoMesesPorProductCode.get(productCode) || 0 : 0) / config.coberturaMeses
            : (vendaMesesDoProduto?.get(FABRICA_BRANCH_CODE) || 0) / config.coberturaMeses;

        branches[coluna.branchCode] = {
          giro: round(giroAtacado, 0),
          est: round(estFabrica, 0),
          cob: coberturaDe(estFabrica, mediaMensalAtacado),
        };
        continue;
      }

      const est = estoqueDoSku.get(coluna.branchCode) || 0;
      const giro = giroDoProduto?.get(coluna.branchCode) || 0;
      const mediaMensal = (vendaMesesDoProduto?.get(coluna.branchCode) || 0) / config.coberturaMeses;

      branches[coluna.branchCode] = {
        giro: round(giro, 0),
        est: round(est, 0),
        cob: coberturaDe(est, mediaMensal),
      };
    }

    const giroTt1 = productCode !== null ? giroTt1PorProductCode.get(productCode) || 0 : 0;
    const giroTt3 = productCode !== null ? giroTt3PorProductCode.get(productCode) || 0 : 0;
    const giroTt6 = productCode !== null ? giroTt6PorProductCode.get(productCode) || 0 : 0;

    const custoPreco = productCode !== null ? custoPrecoPorProductCode.get(productCode) : undefined;
    const custo = custoPreco?.custo ?? null;
    const pdvRealVar = custoPreco?.pdvVar ?? null;
    const pdvRealAta = custoPreco?.pdvAta ?? null;

    const ultimaEntradaData = productCode !== null ? ultimaEntradaPorProductCode.get(productCode) : undefined;
    const ultimaEntrada = ultimaEntradaData ? ultimaEntradaData.toISOString().slice(0, 10) : null;

    const custoUltimaCompra = productCode !== null ? custoUltimaCompraPorProductCode.get(productCode) ?? null : null;
    const ultimaVendaVarejo = productCode !== null ? ultimaVendaVarejoPorProductCode.get(productCode) ?? null : null;
    const ultimaVendaAtacado = productCode !== null ? ultimaVendaAtacadoPorProductCode.get(productCode) ?? null : null;

    // So entra na tabela quem tem estoque ou movimento recente - evita catalogo inteiro
    // com SKU morto (mesma convencao da tabela pcp_estoque_sem_giro_analitico).
    const temSinal = estTt > 0 || giroTt6 > 0;
    if (!temSinal) continue;

    // Se filtrou por filial, so entra quem tem sinal (estoque ou giro) em alguma das
    // colunas selecionadas.
    if (branchFiltro) {
      const temSinalNaSelecao = Object.values(branches).some((c) => c.est > 0 || c.giro !== 0);
      if (!temSinalNaSelecao) continue;
    }

    rows.push({
      sku,
      codigo: productCode,
      descricao: identidade.descricao || sku,
      descricaoCompleta: identidade.descricao_completa || sku,
      categoria: identidade.categoria,
      linha: identidade.linha,
      genero: identidade.genero,
      modelo: identidade.modelo,
      status: identidade.status,
      lancamento: formatarLancamento(identidade.lancamento),
      ultimaEntrada,
      custo,
      pdvAtual: null,
      pdvRealVar,
      markupVar: markupPercentual(ultimaVendaVarejo, custoUltimaCompra),
      pdvRealAta,
      markupAta: markupPercentual(ultimaVendaAtacado, custoUltimaCompra),
      estDisponivel: null,
      transito: null,
      emProducao: null,
      estPrevisto: null,
      estTt: round(estTt, 0),
      giroTt1: round(giroTt1, 0),
      giroTt3: round(giroTt3, 0),
      giroTt6: round(giroTt6, 0),
      branches,
    });
  }

  rows.sort((a, b) => b.estTt - a.estTt);
  const rowsLimitadas = filtro.limit && filtro.limit > 0 ? rows.slice(0, filtro.limit) : rows;

  const kpis = rows.reduce(
    (acc, r) => {
      acc.giroTt1 += r.giroTt1;
      acc.giroTt3 += r.giroTt3;
      acc.giroTt6 += r.giroTt6;
      acc.estTt += r.estTt;
      return acc;
    },
    { giroTt1: 0, giroTt3: 0, giroTt6: 0, estTt: 0, skuCount: rows.length }
  );

  return {
    config: {
      giroDias: config.giroDias,
      coberturaMeses: config.coberturaMeses,
      atacadoCoberturaBase: config.atacadoCoberturaBase,
    },
    kpis: {
      giroTt1: round(kpis.giroTt1, 0),
      giroTt3: round(kpis.giroTt3, 0),
      giroTt6: round(kpis.giroTt6, 0),
      estTt: round(kpis.estTt, 0),
      skuCount: kpis.skuCount,
    },
    colunas: colunasAtivas,
    rows: rowsLimitadas,
  };
}

export async function getFiltrosRelatorioBase() {
  const dimensoes = [
    { chave: 'categoria', coluna: 'class_categoria', label: 'Categoria' },
    { chave: 'linha', coluna: 'class_linha', label: 'Linha' },
    { chave: 'genero', coluna: 'class_genero', label: 'Genero' },
    { chave: 'status', coluna: 'class_status', label: 'Status' },
  ];

  const classificacoes = [];
  for (const dim of dimensoes) {
    const rows = await prisma.$queryRawUnsafe<Array<{ valor: string; qtd: bigint }>>(`
      SELECT TRIM(${dim.coluna}) as valor, COUNT(DISTINCT product_sku) as qtd
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

  return {
    classificacoes,
    colunas: RELATORIO_BASE_BRANCH_ORDER,
  };
}
