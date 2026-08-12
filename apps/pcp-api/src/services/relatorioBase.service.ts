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
  // Paginacao real por REFERENCIA (nao por SKU) - troca o antigo "rank" (Top 50/100/
  // 250/Todos) por pagina/tamanho de pagina, pedido do usuario ("nao ficar controlando
  // por rank... crie paginacoes"). pageSize grande (export) e um uso valido, nao um
  // caso especial - so significa "1 pagina com tudo".
  page?: number;
  pageSize?: number;
}

export interface RelatorioBaseColunaFilial {
  giro: number;
  est: number;
  cob: number | null;
}

export interface RelatorioBaseRow {
  sku: string;
  codigo: number | null;
  referenceCode: string;
  cor: string;
  tamanho: string;
  refCorTam: string;
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
  // nao tem o codigo escolhido no Configurador. pdvAtual e um alias de pdvRealVar (por
  // pedido do usuario, sem sync propria - mesmo valor, coluna separada por proposito).
  custo: number | null;
  pdvAtual: number | null;
  pdvRealVar: number | null;
  markupVar: number | null;
  pdvRealAta: number | null;
  markupAta: number | null;
  estDisponivel: null;
  // Soma das quantidades pendentes de Ordens de Producao abertas do product_code, em
  // todas as filiais (sincronizado via ops_em_producao - ver totvs.service.ts
  // syncEmProducao). Diferente de custo/preco, e sempre um numero real (0 quando nao
  // tem O.P. aberta), nao "ainda nao sincronizado".
  emProducao: number;
  estPrevisto: null;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
}

// Linha principal da tabela - 1 por REFERENCIA (agregando todos os SKUs dela: cores e
// tamanhos somados). Campos de identidade (categoria/linha/genero/modelo/status/
// lancamento) vem do primeiro SKU encontrado - sao classificacao da referencia como um
// todo, consistentes entre as variacoes na pratica. Custo/PDV/markup SO aparecem aqui
// quando TODOS os SKUs da referencia tem o MESMO valor (caso comum - preco/custo e
// definido por referencia no varejo, nao varia por cor/tamanho) - quando diverge entre
// SKUs da mesma referencia, fica null (dash), sem inventar uma media/aproximacao.
export interface RelatorioBaseReferenciaRow {
  referenceCode: string;
  referenceName: string;
  totalSkus: number;
  descricao: string;
  descricaoCompleta: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  modelo: string | null;
  status: string | null;
  lancamento: string | null;
  ultimaEntrada: string | null;
  custo: number | null;
  pdvAtual: number | null;
  pdvRealVar: number | null;
  markupVar: number | null;
  pdvRealAta: number | null;
  markupAta: number | null;
  emProducao: number;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
  skus: RelatorioBaseRow[];
}

// KPIs executivos calculados sobre o MESMO universo de SKUs/filtros da tabela
// detalhada (nunca uma query separada) - pra nunca divergir do que a tabela mostra.
// "Varejo" = qualquer filial real exceto Fabrica; "Atacado" = canal Atacado da
// Fabrica (mesmo channel-split ja usado no resto do relatorio).
export interface RelatorioBaseKpisExtra {
  coberturaGeral: number | null;
  coberturaVarejo: number | null;
  coberturaAtacado: number | null;
  giroAnualizado: number;
  valorEstoqueTotal: number;
  // "Estoque morto" = status TOTVS comecando com "FORA DE LINHA" (cobre todas as
  // variantes de campanha: "FORA DE LINHA BLACK FRIDAY 2024", "FORA DE LINHA PROMO JAN
  // 2025" etc, confirmado direto no banco - nao e um dia-sem-venda, e classificacao).
  estoqueMortoQtd: number;
  estoqueMortoValor: number;
  estoqueMortoPercent: number;
  coberturaBasico: number | null;
  coberturaBasicoRenovavel: number | null;
  coberturaColecao: number | null;
  referenciasComEstoque: number;
  // Participacao por status real do TOTVS (ATIVO/FORA DE LINHA/INATIVO - "OUTROS" pega
  // qualquer status novo/inesperado, nunca descarta silenciosamente).
  statusBreakdown: { status: string; estTt: number; percent: number }[];
}

export interface RelatorioBaseMatrizLinha {
  label: string;
  estoqueVarejo: number;
  estoqueAtacado: number;
  estoqueTotal: number;
  valorEstoque: number;
  coberturaVarejo: number | null;
  coberturaAtacado: number | null;
  coberturaGeral: number | null;
}

export interface RelatorioBaseResponse {
  config: {
    giroDias: number;
    coberturaMeses: number;
    atacadoCoberturaBase: string;
    coberturaLimiteVerde: number;
    coberturaLimiteVermelho: number;
  };
  kpis: { giroTt1: number; giroTt3: number; giroTt6: number; estTt: number; skuCount: number };
  kpisExtra: RelatorioBaseKpisExtra;
  matriz: {
    linha: RelatorioBaseMatrizLinha[];
    categoria: RelatorioBaseMatrizLinha[];
    genero: RelatorioBaseMatrizLinha[];
  };
  pagination: { page: number; pageSize: number; totalReferencias: number; totalPages: number };
  colunas: { branchCode: number; label: string }[];
  rows: RelatorioBaseReferenciaRow[];
}

export async function getConfig() {
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
async function getEstoqueRows(productSkus: string[] | null): Promise<EstoqueRow[]> {
  return prisma.$queryRaw<EstoqueRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, product_code, branch_code, stock, captured_at
      FROM prd_saldo
      WHERE 1=1 ${filtroProductSku(productSkus)}
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
async function getGiroRows(dias: number, productCodes: number[] | null): Promise<ProductCodeAggRow[]> {
  return prisma.$queryRaw<ProductCodeAggRow[]>`
    SELECT ti.product_code, t.branch_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(days => ${dias}::int)
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code, t.branch_code
  `;
}

// Giro do canal Atacado (channel-split real, so branch_code=2), mesmo padrao de
// getVendasFabricaDividida/getDevolucoesFabricaDividida em vendas.service.ts
async function getGiroAtacadoRows(dias: number, productCodes: number[] | null): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
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
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code
  `;
}

// Total vendido por product_code x filial nos ultimos `meses` meses - denominador da
// cobertura (media_mensal = total / meses).
async function getVendaPorMesesRows(meses: number, productCodes: number[] | null): Promise<ProductCodeAggRow[]> {
  return prisma.$queryRaw<ProductCodeAggRow[]>`
    SELECT ti.product_code, t.branch_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code, t.branch_code
  `;
}

// Total vendido do canal Atacado nos ultimos `meses` meses - usado como denominador da
// cobertura do Atacado quando atacadoCoberturaBase = 'atacado_only'.
async function getVendaAtacadoPorMesesRows(meses: number, productCodes: number[] | null): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
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
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code
  `;
}

// Giro TT de rede (soma de todas as filiais) por product_code, nas janelas de 1/3/6 meses
async function getGiroTtRows(meses: number, productCodes: number[] | null): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
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
async function getCustoPrecoRows(precoCustoBranchCode: number, custoCode: number, pdvVarejoCode: number, pdvAtacadoCode: number, productCodes: number[] | null): Promise<CustoPrecoRow[]> {
  return prisma.$queryRaw<CustoPrecoRow[]>`
    SELECT
      base.product_code,
      c.valor AS custo,
      pv.valor AS pdv_var,
      pa.valor AS pdv_ata
    FROM (
      SELECT DISTINCT product_code FROM produto_custos WHERE branch_code = ${precoCustoBranchCode} ${filtroProductCode(productCodes)}
      UNION
      SELECT DISTINCT product_code FROM produto_precos WHERE branch_code = ${precoCustoBranchCode} ${filtroProductCode(productCodes)}
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

// Base do MARKUP (decisao do usuario): nao usa o CUSTO configurado no Configurador
// (esse continua mostrando o preco de TABELA do TOTVS, pra referencia) - usa custo da
// ULTIMA COMPRA (costCode=2, fixo) contra o PDV Real/Atual (pdvRealVar/pdvRealAta, ja
// sincronizados do TOTVS), separado por canal. Antes usava o preco da ultima venda
// real (transacao de verdade, com desconto ja aplicado) em vez do PDV Real/Atual -
// trocado por pedido do usuario, pra nao variar com o desconto de cada venda.
export const CUSTO_ULTIMA_COMPRA_CODE = 2;

export async function getCustoUltimaCompraRows(precoCustoBranchCode: number, productCodes: number[] | null): Promise<Array<{ product_code: number; valor: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; valor: Decimal }>>`
    SELECT product_code, valor FROM produto_custos
    WHERE branch_code = ${precoCustoBranchCode} AND cost_code = ${CUSTO_ULTIMA_COMPRA_CODE}
      ${filtroProductCode(productCodes)}
  `;
}

// Ultima entrada de estoque por product_code (rede toda, nao por filial - o relatorio
// tem 1 coluna so) - qualquer operacao classificada como entrada no TOTVS
// (operations_type='E': transferencia, compra, retorno, entrada avulsa etc.), pega so
// o MAX(transaction_date), sem diferenciar o tipo (confirmado com o usuario: "e so
// pegar o max"). Devolucao (operation_mode='3') tambem e operations_type='E' mas ja e
// tratada em separado no resto do sistema - aqui entra igual, pois fisicamente tambem
// e uma entrada de mercadoria no estoque daquela filial.
export async function getUltimaEntradaRows(productCodes: number[] | null): Promise<Array<{ product_code: number; ultima_entrada: Date }>> {
  return prisma.$queryRaw<Array<{ product_code: number; ultima_entrada: Date }>>`
    SELECT ti.product_code, MAX(t.transaction_date) AS ultima_entrada
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
    ${OPERACAO_JOIN}
    WHERE t.status = 4 AND co.operations_type = 'E'
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code
  `;
}

// Quantidade pendente de Ordens de Producao abertas, somada em todas as filiais - a
// tabela ops_em_producao vem detalhada por OP + product_code (sincronizada via
// totvs.service.ts syncEmProducao), aqui so agrega pro nivel do relatorio (que mostra
// "Em Producao" como 1 numero so por SKU, sem quebrar por OP/loja).
async function getEmProducaoRows(productCodes: number[] | null): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT product_code, SUM(quantidade_pendente) AS quantidade
    FROM ops_em_producao
    WHERE 1=1 ${filtroProductCode(productCodes)}
    GROUP BY product_code
  `;
}

interface IdentidadeRow {
  product_sku: string;
  product_code: number | null;
  reference_code: string | null;
  reference_name: string | null;
  color_code: string | null;
  color_name: string | null;
  size: string | null;
  descricao: string | null;
  descricao_completa: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  modelo: string | null;
  status: string | null;
  lancamento: string | null;
}

function buildRefCorTam(referenceCode: string, cor: string, tamanho: string): string {
  return [referenceCode, cor, tamanho].join(' - ');
}

// class_lancamento vem do TOTVS no formato "MM AAAA" (ex: "11 2020") - so reformata pra
// "MM/AAAA" pra exibicao, sem inventar data (nao existe timestamp exato de lancamento,
// so o mes/ano). "012019" (sem espaco, ~20mil SKUs) parece um valor default/generico do
// TOTVS pra produto sem classificacao de lancamento real - tratado como null.
export function formatarLancamento(valor: string | null): string | null {
  if (!valor) return null;
  const match = valor.trim().match(/^(\d{2})\s+(\d{4})$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

// Básico Renovável entra separado de Básico (pedido do usuario); resto da linha
// (TEENKIS/PROMOCOES/BRINDE/MODA PRAIA/EMBALAGEM/CASUAL/PROTECAO) fica de fora da
// matriz por linha, mesma politica que ja existia no visaoGeral.service.ts antigo.
export function linhaBucket(linha: string | null): string | null {
  const l = linha?.trim().toUpperCase();
  if (l === 'BASICA') return 'Básico';
  if (l === 'BASICA RENOVAVEL') return 'Básico Renovável';
  if (l === 'STYLE') return 'Coleção';
  return null;
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

// Restringe as queries auxiliares (venda/giro/custo/em producao) ao universo ja
// filtrado por getIdentidadeRows - antes elas escaneavam o catalogo INTEIRO sempre,
// entao aplicar mais filtros de classificacao nao acelerava nada (o filtro so
// afetava a query de identidade, o resto continuava caro do mesmo jeito). null =
// sem restricao (nenhum filtro de classificacao aplicado, mantem o universo
// completo como antes). Array vazio = filtro aplicado mas sem produto nenhum
// batendo, forca "AND FALSE" em vez de acidentalmente virar "sem filtro".
function filtroProductCodeTi(codes: number[] | null): Prisma.Sql {
  if (codes === null) return Prisma.empty;
  if (codes.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ti.product_code IN (${Prisma.join(codes)})`;
}
function filtroProductCode(codes: number[] | null): Prisma.Sql {
  if (codes === null) return Prisma.empty;
  if (codes.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND product_code IN (${Prisma.join(codes)})`;
}
function filtroProductSku(skus: string[] | null): Prisma.Sql {
  if (skus === null) return Prisma.empty;
  if (skus.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND product_sku IN (${Prisma.join(skus)})`;
}

// product_code >= 1000000 e convencao do TOTVS pra SUBPRODUTO (componente interno de
// montagem de um conjunto, ex "SUBPRODUTO CAMISA CONJUNTO..." com reference_code "SP
// ..."), nao item vendavel - confirmado com o time (Marcelo) que isso so existe na
// Fabrica e e a causa principal do estoque "inflado" la (~97% do estoque fisico da
// Fabrica era subproduto, nao produto real). is_finished_product sozinho nao pega
// isso porque metade desses SKUs tem o campo NULL, nao false. Categoria EMBALAGEM e
// um problema separado e menor (produto real, mas nao e peca de vestuario vendavel).
async function getIdentidadeRows(filtro: RelatorioBaseFiltro): Promise<IdentidadeRow[]> {
  const filtroSql = buildIdentidadeFiltro(filtro);

  return prisma.$queryRaw<IdentidadeRow[]>`
    SELECT
      a.product_sku,
      a.product_code,
      a.reference_code,
      a.reference_name,
      a.color_code,
      a.color_name,
      a.size,
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
      AND (a.product_code IS NULL OR a.product_code < 1000000)
      AND TRIM(UPPER(COALESCE(a.class_categoria, ''))) != 'EMBALAGEM'
      ${filtroSql}
  `;
}

export async function getRelatorioBase(filtro: RelatorioBaseFiltro): Promise<RelatorioBaseResponse> {
  const config = await getConfig();
  const branchFiltro = filtro.branches && filtro.branches.length > 0 ? new Set(filtro.branches) : null;

  // Busca identidade PRIMEIRO (respeitando os filtros de classificacao/busca), depois
  // usa o resultado pra restringir as queries auxiliares (venda/giro/custo/em
  // producao) ao mesmo universo - antes elas sempre escaneavam o catalogo inteiro,
  // entao aplicar mais filtros nao acelerava nada (causa real da lentidao "com varios
  // filtros"). branches NAO entra nessa restricao (so afeta quais colunas aparecem,
  // nao o universo de produtos), entao so ativa a restricao quando ha filtro de
  // classificacao/busca de verdade - evita montar uma lista IN(...) enorme (~catalogo
  // inteiro) sem necessidade quando o usuario nao filtrou por classificacao nenhuma.
  const identidadeRows = await getIdentidadeRows(filtro);
  const temFiltroClassificacao = !!(
    filtro.categoria?.length || filtro.linha?.length || filtro.genero?.length || filtro.status?.length || filtro.search?.trim()
  );
  const productCodesFiltro = temFiltroClassificacao
    ? [...new Set(identidadeRows.map((r) => r.product_code).filter((c): c is number => c !== null))]
    : null;
  const productSkusFiltro = temFiltroClassificacao ? identidadeRows.map((r) => r.product_sku) : null;

  const [
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
    emProducaoRows,
    venda12mRows,
  ] = await Promise.all([
    getEstoqueRows(productSkusFiltro),
    getGiroRows(config.giroDias, productCodesFiltro),
    getGiroAtacadoRows(config.giroDias, productCodesFiltro),
    getVendaPorMesesRows(config.coberturaMeses, productCodesFiltro),
    config.atacadoCoberturaBase === 'atacado_only' ? getVendaAtacadoPorMesesRows(config.coberturaMeses, productCodesFiltro) : Promise.resolve([]),
    getGiroTtRows(1, productCodesFiltro),
    getGiroTtRows(3, productCodesFiltro),
    getGiroTtRows(6, productCodesFiltro),
    getCustoPrecoRows(config.precoCustoBranchCode, config.custoCode, config.pdvVarejoCode, config.pdvAtacadoCode, productCodesFiltro),
    getUltimaEntradaRows(productCodesFiltro),
    getCustoUltimaCompraRows(config.precoCustoBranchCode, productCodesFiltro),
    getEmProducaoRows(productCodesFiltro),
    getVendaPorMesesRows(12, productCodesFiltro),
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

  const emProducaoPorProductCode = new Map<number, number>();
  for (const r of emProducaoRows) emProducaoPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));

  const venda12mPorProductCode = new Map<number, Map<number, number>>();
  for (const r of venda12mRows) {
    const mapa = venda12mPorProductCode.get(r.product_code) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade));
    venda12mPorProductCode.set(r.product_code, mapa);
  }
  function somaMapa(mapa: Map<number, number> | undefined): number {
    if (!mapa) return 0;
    let soma = 0;
    for (const v of mapa.values()) soma += v;
    return soma;
  }

  function coberturaDe(estoque: number, mediaMensal: number): number | null {
    if (mediaMensal <= 0) return null;
    return round(estoque / mediaMensal, 2);
  }

  // Acumuladores dos KPIs executivos e da matriz linha/categoria/genero - preenchidos
  // dentro do MESMO loop por SKU abaixo (sem query nova), pra nunca divergir da tabela.
  interface BucketAcc {
    estVarejo: number;
    estAtacado: number;
    vendaVarejo: number;
    vendaAtacado: number;
    valorEstoque: number;
  }
  function bucketVazio(): BucketAcc {
    return { estVarejo: 0, estAtacado: 0, vendaVarejo: 0, vendaAtacado: 0, valorEstoque: 0 };
  }
  function acumularBucket(mapa: Map<string, BucketAcc>, chave: string | null, valores: BucketAcc) {
    if (!chave) return;
    const acc = mapa.get(chave) || bucketVazio();
    acc.estVarejo += valores.estVarejo;
    acc.estAtacado += valores.estAtacado;
    acc.vendaVarejo += valores.vendaVarejo;
    acc.vendaAtacado += valores.vendaAtacado;
    acc.valorEstoque += valores.valorEstoque;
    mapa.set(chave, acc);
  }

  const matrizLinhaAgg = new Map<string, BucketAcc>();
  const matrizCategoriaAgg = new Map<string, BucketAcc>();
  const matrizGeneroAgg = new Map<string, BucketAcc>();
  const statusAgg = new Map<string, number>(); // balde de status -> soma de estTt
  let valorEstoqueTotal = 0;
  let venda12mTotal = 0;
  let estVarejoTotal = 0;
  let estAtacadoTotal = 0;
  let vendaVarejoTotal = 0;
  let vendaAtacadoTotal = 0;
  let estoqueMortoQtd = 0;
  let estoqueMortoValor = 0;

  const colunasAtivas = branchFiltro
    ? RELATORIO_BASE_BRANCH_ORDER.filter((c) => branchFiltro.has(c.branchCode))
    : RELATORIO_BASE_BRANCH_ORDER;

  const skuRows: RelatorioBaseRow[] = [];

  // Agregacao por referencia, construida no mesmo loop dos SKUs pra nao duplicar os
  // lookups - cada referencia acumula est/giro por filial (pra recalcular cobertura
  // certa, nao so somar a cobertura ja arredondada de cada SKU) e a lista completa de
  // SKUs (usada no drill-down "abrir por SKU").
  interface RefAgg {
    referenceName: string;
    categoria: string | null;
    linha: string | null;
    genero: string | null;
    modelo: string | null;
    status: string | null;
    lancamento: string | null;
    ultimaEntrada: string | null;
    emProducao: number;
    estTt: number;
    giroTt1: number;
    giroTt3: number;
    giroTt6: number;
    branchesAgg: Map<number, { est: number; giro: number; mediaMensalSum: number }>;
    skus: RelatorioBaseRow[];
  }
  const referenciaAgg = new Map<string, RefAgg>();

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
    const mediaMensalPorBranchDoSku = new Map<number, number>();
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
        mediaMensalPorBranchDoSku.set(coluna.branchCode, mediaMensalAtacado);
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
      mediaMensalPorBranchDoSku.set(coluna.branchCode, mediaMensal);
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
    const emProducao = productCode !== null ? emProducaoPorProductCode.get(productCode) || 0 : 0;

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

    // KPIs executivos e matriz linha/categoria/genero - acumulados aqui pra reusar
    // exatamente os mesmos branches/custo/mediaMensal ja calculados pra essa linha,
    // respeitando os mesmos filtros (loja/categoria/etc) da tabela detalhada.
    const estAtacadoSku = branches[ATACADO_BRANCH_CODE]?.est ?? 0;
    let estVarejoSku = 0;
    let vendaVarejoSku = 0;
    for (const coluna of colunasAtivas) {
      if (coluna.branchCode === ATACADO_BRANCH_CODE) continue;
      estVarejoSku += branches[coluna.branchCode]?.est ?? 0;
      vendaVarejoSku += (mediaMensalPorBranchDoSku.get(coluna.branchCode) || 0) * config.coberturaMeses;
    }
    const vendaAtacadoSku = (mediaMensalPorBranchDoSku.get(ATACADO_BRANCH_CODE) || 0) * config.coberturaMeses;
    const venda12mSku = productCode !== null ? somaMapa(venda12mPorProductCode.get(productCode)) : 0;
    const valorEstoqueSku = estTt * (custo ?? 0);

    valorEstoqueTotal += valorEstoqueSku;
    venda12mTotal += venda12mSku;
    estVarejoTotal += estVarejoSku;
    estAtacadoTotal += estAtacadoSku;
    vendaVarejoTotal += vendaVarejoSku;
    vendaAtacadoTotal += vendaAtacadoSku;

    const statusTrim = identidade.status?.trim().toUpperCase() || null;
    let statusBucketKey: string;
    if (statusTrim && statusTrim.startsWith('FORA DE LINHA')) statusBucketKey = 'FORA DE LINHA';
    else if (statusTrim === 'ATIVO') statusBucketKey = 'ATIVO';
    else if (statusTrim === 'INATIVO') statusBucketKey = 'INATIVO';
    else statusBucketKey = 'OUTROS';
    statusAgg.set(statusBucketKey, (statusAgg.get(statusBucketKey) || 0) + estTt);
    if (statusBucketKey === 'FORA DE LINHA') {
      estoqueMortoQtd += estTt;
      estoqueMortoValor += valorEstoqueSku;
    }

    const bucketValores: BucketAcc = {
      estVarejo: estVarejoSku,
      estAtacado: estAtacadoSku,
      vendaVarejo: vendaVarejoSku,
      vendaAtacado: vendaAtacadoSku,
      valorEstoque: valorEstoqueSku,
    };
    acumularBucket(matrizLinhaAgg, linhaBucket(identidade.linha), bucketValores);
    acumularBucket(matrizCategoriaAgg, identidade.categoria?.trim() || null, bucketValores);
    acumularBucket(matrizGeneroAgg, identidade.genero?.trim() || null, bucketValores);

    // Referencia/cor/tamanho vem do produto_analitico - fallback pro proprio SKU quando
    // reference_code vier nulo (dado incompleto), pra nao perder a linha, so vira uma
    // "referencia" de 1 SKU so.
    const referenceCode = identidade.reference_code || sku;
    const referenceName = identidade.reference_name || referenceCode;
    const cor = identidade.color_name?.trim() || identidade.color_code?.trim() || 'SEM COR';
    const tamanho = identidade.size?.trim() || 'SEM TAM';

    const skuRow: RelatorioBaseRow = {
      sku,
      codigo: productCode,
      referenceCode,
      cor,
      tamanho,
      refCorTam: buildRefCorTam(referenceCode, cor, tamanho),
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
      pdvAtual: pdvRealVar,
      pdvRealVar,
      markupVar: markupPercentual(pdvRealVar, custoUltimaCompra),
      pdvRealAta,
      markupAta: markupPercentual(pdvRealAta, custoUltimaCompra),
      estDisponivel: null,
      emProducao: round(emProducao, 0),
      estPrevisto: null,
      estTt: round(estTt, 0),
      giroTt1: round(giroTt1, 0),
      giroTt3: round(giroTt3, 0),
      giroTt6: round(giroTt6, 0),
      branches,
    };
    skuRows.push(skuRow);

    const agg = referenciaAgg.get(referenceCode) || {
      referenceName,
      categoria: identidade.categoria,
      linha: identidade.linha,
      genero: identidade.genero,
      modelo: identidade.modelo,
      status: identidade.status,
      lancamento: formatarLancamento(identidade.lancamento),
      ultimaEntrada: null,
      emProducao: 0,
      estTt: 0,
      giroTt1: 0,
      giroTt3: 0,
      giroTt6: 0,
      branchesAgg: new Map<number, { est: number; giro: number; mediaMensalSum: number }>(),
      skus: [],
    };
    agg.emProducao += skuRow.emProducao;
    agg.estTt += skuRow.estTt;
    agg.giroTt1 += skuRow.giroTt1;
    agg.giroTt3 += skuRow.giroTt3;
    agg.giroTt6 += skuRow.giroTt6;
    if (ultimaEntrada && (!agg.ultimaEntrada || ultimaEntrada > agg.ultimaEntrada)) agg.ultimaEntrada = ultimaEntrada;
    for (const coluna of colunasAtivas) {
      const acumulado = agg.branchesAgg.get(coluna.branchCode) || { est: 0, giro: 0, mediaMensalSum: 0 };
      acumulado.est += branches[coluna.branchCode].est;
      acumulado.giro += branches[coluna.branchCode].giro;
      acumulado.mediaMensalSum += mediaMensalPorBranchDoSku.get(coluna.branchCode) || 0;
      agg.branchesAgg.set(coluna.branchCode, acumulado);
    }
    agg.skus.push(skuRow);
    referenciaAgg.set(referenceCode, agg);
  }

  // Custo/PDV/markup na referencia so aparecem quando TODOS os SKUs dela concordam no
  // mesmo valor (ignora SKU sem esse dado, sem invalidar os outros) - caso comum no
  // varejo, preco/custo e por referencia, nao por cor/tamanho. Se divergir, fica null.
  function valorConsistente(
    skus: RelatorioBaseRow[],
    campo: 'custo' | 'pdvAtual' | 'pdvRealVar' | 'markupVar' | 'pdvRealAta' | 'markupAta'
  ): number | null {
    let valor: number | null | undefined;
    for (const s of skus) {
      const v = s[campo];
      if (v === null) continue;
      if (valor === undefined) valor = v;
      else if (valor !== v) return null;
    }
    return valor ?? null;
  }

  const rows: RelatorioBaseReferenciaRow[] = [];
  for (const [referenceCode, agg] of referenciaAgg) {
    const branches: Record<number, RelatorioBaseColunaFilial> = {};
    for (const [branchCode, valores] of agg.branchesAgg) {
      branches[branchCode] = {
        est: round(valores.est, 0),
        giro: round(valores.giro, 0),
        cob: coberturaDe(valores.est, valores.mediaMensalSum),
      };
    }
    rows.push({
      referenceCode,
      referenceName: agg.referenceName,
      totalSkus: agg.skus.length,
      descricao: agg.referenceName,
      descricaoCompleta: agg.referenceName,
      categoria: agg.categoria,
      linha: agg.linha,
      genero: agg.genero,
      modelo: agg.modelo,
      status: agg.status,
      lancamento: agg.lancamento,
      ultimaEntrada: agg.ultimaEntrada,
      custo: valorConsistente(agg.skus, 'custo'),
      pdvAtual: valorConsistente(agg.skus, 'pdvAtual'),
      pdvRealVar: valorConsistente(agg.skus, 'pdvRealVar'),
      markupVar: valorConsistente(agg.skus, 'markupVar'),
      pdvRealAta: valorConsistente(agg.skus, 'pdvRealAta'),
      markupAta: valorConsistente(agg.skus, 'markupAta'),
      emProducao: round(agg.emProducao, 0),
      estTt: round(agg.estTt, 0),
      giroTt1: round(agg.giroTt1, 0),
      giroTt3: round(agg.giroTt3, 0),
      giroTt6: round(agg.giroTt6, 0),
      branches,
      skus: agg.skus.sort((a, b) => a.refCorTam.localeCompare(b.refCorTam, undefined, { numeric: true })),
    });
  }

  // Ordenado por venda (giro 3 meses), nao por estoque - pedido do usuario ("tudo vindo
  // ordenado por venda"). Isso tambem decide a ordem das paginas, nao so a ordem visual.
  rows.sort((a, b) => b.giroTt3 - a.giroTt3);

  // Paginacao real por referencia (substitui o antigo "rank" Top 50/100/250/Todos, que
  // o usuario pediu pra tirar - "muito ruim... crie paginacoes"). pageSize grande e um
  // uso valido (ex: exportar tudo numa pagina so), nao precisa de sentinel especial.
  const pageSize = filtro.pageSize && filtro.pageSize > 0 ? filtro.pageSize : 15;
  const totalReferencias = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalReferencias / pageSize));
  const page = filtro.page && filtro.page > 0 ? Math.min(filtro.page, totalPages) : 1;
  const rowsPaginadas = rows.slice((page - 1) * pageSize, page * pageSize);

  const kpis = skuRows.reduce(
    (acc, r) => {
      acc.giroTt1 += r.giroTt1;
      acc.giroTt3 += r.giroTt3;
      acc.giroTt6 += r.giroTt6;
      acc.estTt += r.estTt;
      return acc;
    },
    { giroTt1: 0, giroTt3: 0, giroTt6: 0, estTt: 0, skuCount: skuRows.length }
  );

  // Monta uma linha da matriz (usada tanto por linha/categoria/genero quanto pro
  // "Total" agregado) - cobertura recalculada aqui, nao somada ja arredondada.
  function montarLinhaMatriz(label: string, acc: BucketAcc): RelatorioBaseMatrizLinha {
    const mediaMensalVarejo = acc.vendaVarejo / config.coberturaMeses;
    const mediaMensalAtacado = acc.vendaAtacado / config.coberturaMeses;
    const mediaMensalGeral = (acc.vendaVarejo + acc.vendaAtacado) / config.coberturaMeses;
    return {
      label,
      estoqueVarejo: round(acc.estVarejo, 0),
      estoqueAtacado: round(acc.estAtacado, 0),
      estoqueTotal: round(acc.estVarejo + acc.estAtacado, 0),
      valorEstoque: round(acc.valorEstoque, 2),
      coberturaVarejo: coberturaDe(acc.estVarejo, mediaMensalVarejo),
      coberturaAtacado: coberturaDe(acc.estAtacado, mediaMensalAtacado),
      coberturaGeral: coberturaDe(acc.estVarejo + acc.estAtacado, mediaMensalGeral),
    };
  }

  // Ordenado por venda (varejo+atacado) desc, "Total" sempre por ultimo - mesma
  // convencao do antigo visaoGeral.service.ts.
  function buildMatriz(agg: Map<string, BucketAcc>): RelatorioBaseMatrizLinha[] {
    const entradas = [...agg.entries()].sort(
      (a, b) => b[1].vendaVarejo + b[1].vendaAtacado - (a[1].vendaVarejo + a[1].vendaAtacado)
    );
    const linhas = entradas.map(([label, acc]) => montarLinhaMatriz(label, acc));
    const totalAcc = entradas.reduce<BucketAcc>(
      (acc, [, v]) => ({
        estVarejo: acc.estVarejo + v.estVarejo,
        estAtacado: acc.estAtacado + v.estAtacado,
        vendaVarejo: acc.vendaVarejo + v.vendaVarejo,
        vendaAtacado: acc.vendaAtacado + v.vendaAtacado,
        valorEstoque: acc.valorEstoque + v.valorEstoque,
      }),
      bucketVazio()
    );
    linhas.push(montarLinhaMatriz('Total', totalAcc));
    return linhas;
  }

  const matrizLinha = buildMatriz(matrizLinhaAgg);
  const matrizCategoria = buildMatriz(matrizCategoriaAgg);
  const matrizGenero = buildMatriz(matrizGeneroAgg);

  function coberturaPorLabel(linhas: RelatorioBaseMatrizLinha[], label: string): number | null {
    return linhas.find((l) => l.label === label)?.coberturaGeral ?? null;
  }

  const statusBreakdown = [...statusAgg.entries()]
    .map(([status, qtd]) => ({
      status,
      estTt: round(qtd, 0),
      percent: kpis.estTt > 0 ? round((qtd / kpis.estTt) * 100, 1) : 0,
    }))
    .sort((a, b) => b.estTt - a.estTt);

  const kpisExtra: RelatorioBaseKpisExtra = {
    coberturaGeral: coberturaDe(estVarejoTotal + estAtacadoTotal, (vendaVarejoTotal + vendaAtacadoTotal) / config.coberturaMeses),
    coberturaVarejo: coberturaDe(estVarejoTotal, vendaVarejoTotal / config.coberturaMeses),
    coberturaAtacado: coberturaDe(estAtacadoTotal, vendaAtacadoTotal / config.coberturaMeses),
    giroAnualizado: valorEstoqueTotal > 0 ? round(venda12mTotal / valorEstoqueTotal, 2) : 0,
    valorEstoqueTotal: round(valorEstoqueTotal, 2),
    estoqueMortoQtd: round(estoqueMortoQtd, 0),
    estoqueMortoValor: round(estoqueMortoValor, 2),
    estoqueMortoPercent: valorEstoqueTotal > 0 ? round((estoqueMortoValor / valorEstoqueTotal) * 100, 1) : 0,
    coberturaBasico: coberturaPorLabel(matrizLinha, 'Básico'),
    coberturaBasicoRenovavel: coberturaPorLabel(matrizLinha, 'Básico Renovável'),
    coberturaColecao: coberturaPorLabel(matrizLinha, 'Coleção'),
    referenciasComEstoque: rows.filter((r) => r.estTt > 0).length,
    statusBreakdown,
  };

  return {
    config: {
      giroDias: config.giroDias,
      coberturaMeses: config.coberturaMeses,
      atacadoCoberturaBase: config.atacadoCoberturaBase,
      coberturaLimiteVerde: decimalToNumber(config.coberturaLimiteVerde),
      coberturaLimiteVermelho: decimalToNumber(config.coberturaLimiteVermelho),
    },
    kpis: {
      giroTt1: round(kpis.giroTt1, 0),
      giroTt3: round(kpis.giroTt3, 0),
      giroTt6: round(kpis.giroTt6, 0),
      estTt: round(kpis.estTt, 0),
      skuCount: kpis.skuCount,
    },
    kpisExtra,
    matriz: {
      linha: matrizLinha,
      categoria: matrizCategoria,
      genero: matrizGenero,
    },
    pagination: { page, pageSize, totalReferencias, totalPages },
    colunas: colunasAtivas,
    rows: rowsPaginadas,
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

