import { agruparStatus, ordenarPorEstoque, ReferenciasMatriz, ReferenciaAgrupamento } from './relatorioBaseAgrupamentos.service.js';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { filtroLocalEstoqueSql, getColunasEstoque, localEstoqueSql } from './estoqueLocal.service.js';
import { ordenarColunasRelatorioBase, selecionarColunasRelatorioBase } from './relatorioBaseLojas.service.js';
import { getProducaoRelatorio, ProducaoRelatorio, skusCanonicosProducao } from './relatorioBaseProducao.service.js';
import {
  ATACADO_BRANCH_CODE,
  DPA_BRANCH_CODE,
} from '../config/constants.js';

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
// Faturamento liquido de devolucao, mesmo padrao de vendas.service.ts:52 (apps/api) -
// ABS() normaliza o sinal que o ETL gravou pra devolucao (inconsistente, as vezes vem
// positivo, as vezes negativo) antes de aplicar o sinal negativo de verdade.
export const VALOR_COM_SINAL = Prisma.sql`(CASE WHEN ${IS_DEVOLUCAO} THEN -ABS(ti.net_value) ELSE ti.net_value END)`;

// Data de competencia da VENDA - mesma regra do DATA_PERIODO em
// apps/api/src/services/vendas.service.ts. `transaction_date` e a data em que a
// transacao foi criada no TOTVS; `dt_fatura` e a data da nota fiscal, que e quando a
// venda virou faturamento e nao se move quando a transacao e alterada depois. Sem isso,
// venda do atacado lancada num mes e faturada no seguinte cai no mes errado do giro, e
// o PCP diverge do Comercial no mesmo periodo.
//
// Use SO para datar VENDA. Para datar ENTRADA de mercadoria (primeira/ultima entrada,
// idade de estoque) continua valendo `transaction_date`: ali o que interessa e quando a
// peca chegou fisicamente na filial, nao a competencia fiscal do documento.
export const DATA_VENDA = Prisma.sql`COALESCE(t.dt_fatura, t.transaction_date)`;

// produto_analitico tem product_sku como PK, mas product_code NAO e unico nela: 182
// product_codes aparecem em duas linhas. Nao e erro de modelagem e sim residuo do ETL -
// quando o SKU real ainda nao e conhecido, a carga grava um placeholder
// product_sku = 'PRODUCT_CODE:<n>' e, numa carga posterior, entra a linha definitiva com
// o codigo de barras. As duas convivem.
//
// Consequencia: qualquer "JOIN produto_analitico ON product_code = <coluna>" duplica a
// linha da esquerda e infla todo SUM() em cima dela. Foi o que deixou o Acompanhamento
// por Linha acima do Dashboard de Vendas do Comercial (DEL PASEO, 01/09 a 30/09/2026:
// R$ 100.450,27 / 1.582 pecas contra os R$ 95.005,71 / 1.530 corretos). O lado Comercial
// nunca sofreu disso porque le produto_analitico por EXISTS (vendas.service.ts
// buildProdutoFilter), que nao multiplica.
//
// Use este helper no lugar do JOIN direto sempre que a query somar algo. Agregacao que ja
// e imune (COUNT(DISTINCT ...), GROUP BY + MIN()) nao precisa, mas tambem nao se prejudica.
//
// A linha escolhida e sempre a definitiva: o placeholder 'PRODUCT_CODE:%' vai pro fim da
// ordenacao. Isso importa porque is_finished_product diverge entre as duas copias em 159
// casos. Os campos que os relatorios realmente leem (size, reference_code, color_code,
// product_name e todas as class_*) sao identicos nas duas, entao a desduplicacao nao muda
// classificacao, grade nem referencia de nada.
// IMPLEMENTACAO: DISTINCT ON, nao LATERAL. A primeira versao deste helper usava
// `JOIN LATERAL (... LIMIT 1) ON TRUE`, que da o MESMO resultado mas e correlacionado:
// o Postgres precisa resolver a subconsulta item a item e so depois aplicar um filtro
// como `a.reference_code = '...'`, em vez de filtrar produto_analitico primeiro e fazer
// hash join. Medido em 08/10/2026, Pesos e Grades por item (1 referencia, set/2026):
// LATERAL ~106s contra 0,3s com DISTINCT ON - mesma saida, ~350x. A tela chegava a
// estourar timeout. O DISTINCT ON materializa uma linha por product_code numa passada
// so e deixa o planejador livre pra escolher a ordem do join.
// A regra de desempate e identica a da versao anterior (placeholder por ultimo).
export function joinProdutoAnaliticoUnico(
  colunaProductCode: string,
  tipoJoin: 'LEFT' | 'INNER' = 'LEFT'
): Prisma.Sql {
  return Prisma.raw(`
    ${tipoJoin === 'LEFT' ? 'LEFT JOIN' : 'JOIN'} (
      SELECT DISTINCT ON (pa.product_code) pa.*
      FROM produto_analitico pa
      ORDER BY pa.product_code, (pa.product_sku LIKE 'PRODUCT_CODE:%'), pa.product_sku
    ) a ON a.product_code = ${colunaProductCode}
  `);
}

export const FABRICA_BRANCH_CODE = 2;
const RELATORIO_KEY = 'relatorio_base';
const MATRIZ_SEM_CLASSIFICACAO = 'Nao classificado';
const COBERTURA_CRITICA_MESES = 5; // 150 dias na base de 30 dias.

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function temCoberturaCritica(estoque: number, venda30Dias: number): boolean {
  if (estoque <= 0) return false;
  if (venda30Dias <= 0) return true;
  return estoque / venda30Dias > COBERTURA_CRITICA_MESES;
}

function statusAtivo(status: string | null): boolean {
  return status?.trim().replace(/\s+/g, ' ').toUpperCase() === 'ATIVO';
}

export function skuAtivoDoMix(linha: string | null, status: string | null): boolean {
  const bucket = linhaBucket(linha);
  return statusAtivo(status) && (bucket === LINHA_BUCKET_BASICO || bucket === LINHA_BUCKET_BASICO_RENOVAVEL);
}

interface EstoqueAtivoSku {
  referencia: string;
  estoque: number;
}

export function acumularEstoqueAtivos(
  skus: Map<string, EstoqueAtivoSku>, sku: string, referencia: string,
  linha: string | null, status: string | null, estoque: number
) {
  if (!skuAtivoDoMix(linha, status)) return;
  const acc = skus.get(sku) || { referencia, estoque: 0 };
  acc.estoque += estoque;
  skus.set(sku, acc);
}

export function montarIndicadoresEstoqueAtivos(skus: Map<string, EstoqueAtivoSku>): RelatorioBaseEstoqueAtivos {
  const referencias = new Set<string>();
  const referenciasComEstoque = new Set<string>();
  let skusComEstoque = 0;
  for (const { referencia, estoque } of skus.values()) {
    referencias.add(referencia);
    if (estoque !== 0) {
      skusComEstoque += 1;
      referenciasComEstoque.add(referencia);
    }
  }
  const indicador = (comEstoque: number, totalAtivos: number) => ({
    comEstoque, totalAtivos, percent: totalAtivos > 0 ? round((comEstoque / totalAtivos) * 100, 2) : 0,
  });
  return {
    referencias: indicador(referenciasComEstoque.size, referencias.size),
    skus: indicador(skusComEstoque, skus.size),
  };
}

interface EstoqueAnaliseAcc {
  quantidade: number;
  valor: number;
  referencias: Set<string>;
}

function estoqueAnaliseAccVazio(): EstoqueAnaliseAcc {
  return { quantidade: 0, valor: 0, referencias: new Set<string>() };
}

function acumularEstoqueAnalise(acc: EstoqueAnaliseAcc, referenceCode: string, quantidade: number, valor: number) {
  if (quantidade <= 0) return;
  acc.quantidade += quantidade;
  acc.valor += valor;
  acc.referencias.add(referenceCode);
}

function montarEstoqueAnaliseKpi(acc: EstoqueAnaliseAcc, estoqueTotal: number, valorEstoqueTotal: number): RelatorioBaseEstoqueAnaliseKpi {
  return {
    quantidade: round(acc.quantidade, 0),
    referencias: acc.referencias.size,
    quantidadePercent: estoqueTotal > 0 ? round((acc.quantidade / estoqueTotal) * 100, 1) : 0,
    valor: round(acc.valor, 2),
    valorPercent: valorEstoqueTotal > 0 ? round((acc.valor / valorEstoqueTotal) * 100, 1) : 0,
  };
}

interface EstoqueAnaliseReferencia {
  quantidade: number;
  valor: number;
  venda30: number;
  venda60: number;
  venda90: number;
}

export function acumularEstoqueAnaliseReferencia(
  referencias: Map<string, EstoqueAnaliseReferencia>,
  referenceCode: string,
  quantidade: number,
  valor: number,
  venda30: number,
  venda60: number,
  venda90: number
) {
  const acc = referencias.get(referenceCode) || { quantidade: 0, valor: 0, venda30: 0, venda60: 0, venda90: 0 };
  acc.quantidade += quantidade;
  acc.valor += valor;
  acc.venda30 += venda30;
  acc.venda60 += venda60;
  acc.venda90 += venda90;
  referencias.set(referenceCode, acc);
}

export function calcularEstoqueAnaliseReferencias(
  referencias: Map<string, EstoqueAnaliseReferencia>, estoqueTotal: number, valorEstoqueTotal: number
) {
  const semVenda30 = estoqueAnaliseAccVazio();
  const envelhecidos60a90 = estoqueAnaliseAccVazio();
  const envelhecidos90Mais = estoqueAnaliseAccVazio();
  for (const [referenceCode, ref] of referencias) {
    // Uma cor/tamanho sem venda nao torna a referencia inteira sem venda.
    // Preserva os saldos com sinal antes de selecionar referencias com estoque.
    if (ref.venda30 === 0) acumularEstoqueAnalise(semVenda30, referenceCode, ref.quantidade, ref.valor);
    // Campos legados mantidos para clientes anteriores; a tela consolida em >30 dias.
    if (ref.venda60 <= 0 && ref.venda90 > 0) acumularEstoqueAnalise(envelhecidos60a90, referenceCode, ref.quantidade, ref.valor);
    if (ref.venda90 <= 0) acumularEstoqueAnalise(envelhecidos90Mais, referenceCode, ref.quantidade, ref.valor);
  }
  return {
    itensSemVenda30d: montarEstoqueAnaliseKpi(semVenda30, estoqueTotal, valorEstoqueTotal),
    itensEnvelhecidos60a90d: montarEstoqueAnaliseKpi(envelhecidos60a90, estoqueTotal, valorEstoqueTotal),
    itensEnvelhecidos90Mais: montarEstoqueAnaliseKpi(envelhecidos90Mais, estoqueTotal, valorEstoqueTotal),
  };
}

interface RupturaLinhaAcc {
  skus: number;
  totalSkus: number;
}

function rupturaLinhaAccVazio(): RupturaLinhaAcc {
  return { skus: 0, totalSkus: 0 };
}

export function acumularRuptura(
  basico: RupturaLinhaAcc,
  renovavel: RupturaLinhaAcc,
  linha: string | null,
  status: string | null,
  estoque: number
) {
  if (!skuAtivoDoMix(linha, status)) return;
  const bucket = linhaBucket(linha);
  const acc = bucket === LINHA_BUCKET_BASICO ? basico : bucket === LINHA_BUCKET_BASICO_RENOVAVEL ? renovavel : null;
  if (!acc) return;
  acc.totalSkus += 1;
  if (estoque <= 0) acc.skus += 1;
}

export function montarRupturaLinhaKpi(acc: RupturaLinhaAcc): RelatorioBaseRupturaLinhaKpi {
  return {
    skus: acc.skus,
    totalSkus: acc.totalSkus,
    percent: acc.totalSkus > 0 ? round((acc.skus / acc.totalSkus) * 100, 1) : 0,
  };
}

export interface RelatorioBaseFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  branches?: number[];
  search?: string;
  dataPosicao?: string;
  incluirComparativoAnoAnterior?: boolean;
  // Paginacao real por REFERENCIA (nao por SKU) - troca o antigo "rank" (Top 50/100/
  // 250/Todos) por pagina/tamanho de pagina, pedido do usuario ("nao ficar controlando
  // por rank... crie paginacoes"). pageSize grande (export) e um uso valido, nao um
  // caso especial - so significa "1 pagina com tudo".
  page?: number;
  pageSize?: number;
  // Quando true, o drill-down por cor usa o nome do grupo do Agrupamento de Cores
  // (cores originais unificadas viram uma linha so).
  agruparPorCorSalva?: boolean;
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
  // syncEmProducao). null = nao ha captura da pendencia para a data selecionada.
  emProducao: number | null;
  estPrevisto: null;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
}

// Drill-down da referencia: 1 linha por COR (nao por SKU). O detalhamento por SKU
// (cor x tamanho) foi removido do payload por consumo de memoria - uma referencia com 15
// cores e 8 tamanhos gerava 120 linhas. Por cor sao ~5 linhas, e com o Agrupamento de
// Cores ligado cai mais ainda (varias cores originais viram um grupo so), que e
// exatamente pra isso que o agrupamento existe. Tamanho nao aparece aqui de proposito -
// quem precisa de grade por tamanho usa a Analise de Grade.
export interface RelatorioBaseCorRow {
  cor: string;
  refCor: string;
  // Quantas cores originais do TOTVS esta linha representa: 1 no modo normal; >1 quando
  // o Agrupamento de Cores unificou varias cores nesse grupo.
  coresOriginais: number;
  totalSkus: number;
  custo: number | null;
  pdvRealVar: number | null;
  markupVar: number | null;
  pdvRealAta: number | null;
  markupAta: number | null;
  emProducao: number | null;
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
  emProducao: number | null;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
  skus: RelatorioBaseRow[];
  cores: RelatorioBaseCorRow[];
}

// KPIs atuais usam o universo da tabela detalhada. O valor do ano anterior usa
// todo o historico valido, aplicando os filtros sem restringir aos SKUs atuais.
// "Varejo" = qualquer filial real exceto Fabrica; "Atacado" = canal Atacado da
// Fabrica (mesmo channel-split ja usado no resto do relatorio).
export interface RelatorioBaseKpisExtra {
  coberturaGeral: number | null;
  coberturaVarejo: number | null;
  coberturaAtacado: number | null;
  giroAnualizado: number;
  valorEstoqueTotal: number;
  valorEstoqueAnoAnterior: number | null;
  valorEstoqueVariacaoPercent: number | null;
  // Critico = cobertura > 5 meses ou estoque sem venda liquida positiva em 30 dias.
  // Promocao = status com complemento, ex: "FORA DE LINHA BLACK FRIDAY 2025".
  estoqueMortoQtd: number;
  estoqueMortoValor: number;
  estoqueMortoPercent: number;
  estoquePromocaoQtd: number;
  estoquePromocaoValor: number;
  estoquePromocaoPercent: number;
  coberturaBasico: number | null;
  coberturaBasicoRenovavel: number | null;
  coberturaColecao: number | null;
  referenciasComEstoque: number;
  estoqueAtivos: RelatorioBaseEstoqueAtivos;
  itensSemVenda30d: RelatorioBaseEstoqueAnaliseKpi;
  itensEnvelhecidos60a90d: RelatorioBaseEstoqueAnaliseKpi;
  itensEnvelhecidos90Mais: RelatorioBaseEstoqueAnaliseKpi;
  ruptura: {
    basico: RelatorioBaseRupturaLinhaKpi;
    renovavel: RelatorioBaseRupturaLinhaKpi;
  };
  // Participacao por status consolidado (ATIVO/FORA DE LINHA/INATIVO -
  // "OUTROS" pega qualquer status novo/inesperado, nunca descarta silenciosamente).
  statusBreakdown: { status: string; estTt: number; percent: number }[];
}

export interface RelatorioBaseEstoqueAtivos {
  referencias: { comEstoque: number; totalAtivos: number; percent: number };
  skus: { comEstoque: number; totalAtivos: number; percent: number };
}

export interface RelatorioBaseEstoqueAnaliseKpi {
  quantidade: number;
  referencias: number;
  quantidadePercent: number;
  valor: number;
  valorPercent: number;
}

export interface RelatorioBaseRupturaLinhaKpi {
  skus: number;
  totalSkus: number;
  percent: number;
}

export interface RelatorioBaseMatrizLinha {
  referencias: ReferenciaAgrupamento[];
  label: string;
  estoqueVarejo: number;
  estoqueAtacado: number;
  estoqueTotal: number;
  valorEstoque: number;
  vendaVarejo: number;
  vendaAtacado: number;
  vendaTotal: number;
  coberturaVarejo: number | null;
  coberturaAtacado: number | null;
  coberturaGeral: number | null;
}

export interface RelatorioBaseResponse {
  dataPosicao: string;
  producao: ProducaoRelatorio;
  config: {
    giroDias: number;
    coberturaMeses: number;
    atacadoCoberturaBase: string;
    coberturaLimiteVerde: number;
    coberturaLimiteVermelho: number;
  };
  kpis: {
    giroTt1: number;
    giroTt3: number;
    giroTt6: number;
    giroTt30: number;
    giroTt60: number;
    giroTt90: number;
    estTt: number;
    skuCount: number;
  };
  kpisExtra: RelatorioBaseKpisExtra;
  matriz: {
    // "linha" agrupa em baldes (Basico / Basico Renovavel / Style) via linhaBucket, que
    // joga tudo que nao cai nesses tres em NAO CLASSIFICADO. "linhaCompleta" nao
    // agrupa: traz a linha como esta no cadastro (Brinde, Embalagem, Promocoes,
    // Teenkis...), com NAO CLASSIFICADO so pro que realmente nao tem linha - pedido da
    // devolutiva do cliente, que precisava enxergar as sete linhas reais.
    linha: RelatorioBaseMatrizLinha[];
    linhaCompleta: RelatorioBaseMatrizLinha[];
    categoria: RelatorioBaseMatrizLinha[];
    genero: RelatorioBaseMatrizLinha[];
    status: RelatorioBaseMatrizLinha[];
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

interface SaldoDiagnosticoTotalRow {
  variante: string;
  bruto: Decimal | null;
  arredondado_no_total: Decimal | null;
  arredondado_por_sku: Decimal | null;
  diferenca_arredondamento: Decimal | null;
  skus: bigint;
  skus_fracionados: bigint;
}

interface SaldoDiagnosticoCodigoRow {
  stock_code: number;
  bruto: Decimal | null;
  arredondado_no_total: Decimal | null;
  arredondado_por_sku: Decimal | null;
  diferenca_arredondamento: Decimal | null;
  skus: bigint;
  skus_fracionados: bigint;
}

interface SaldoDiagnosticoSkuRow {
  product_sku: string;
  saldo_1: Decimal | null;
  saldo_5: Decimal | null;
  saldo_8: Decimal | null;
  saldo_1_5_8: Decimal | null;
  captured_at: Date | null;
}

// Estoque atual por SKU x local, somando todos os saldos de todas as empresas.
// Somente a Fabrica e desmembrada em DPA (demais saldos) e ATACADO (saldo 8).
function dataBaseSql(dataPosicao?: string): Prisma.Sql {
  return dataPosicao ? Prisma.sql`${dataPosicao}::date` : Prisma.sql`CURRENT_DATE`;
}

export function dataLimiteSuperiorSql(dataPosicao?: string, anosOffset = 0): Prisma.Sql {
  const base = dataBaseSql(dataPosicao);
  return anosOffset === 0 ? base : Prisma.sql`(${base} + make_interval(years => ${anosOffset}::int))`;
}

async function getEstoqueRows(productSkus: string[] | null, dataPosicao?: string): Promise<EstoqueRow[]> {
  const dataCorte = dataLimiteSuperiorSql(dataPosicao);

  return prisma.$queryRaw<EstoqueRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, product_code, branch_code, stock_code, stock, captured_at
      FROM prd_saldo
      WHERE 1=1
        ${filtroProductSku(productSkus)}
        AND captured_at < ${dataCorte} + INTERVAL '1 day'
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    )
    SELECT us.product_sku, us.product_code,
           ${localEstoqueSql('us')} AS branch_code,
           COALESCE(SUM(COALESCE(us.stock,0)), 0) AS quantidade_estoque
    FROM ultimo_saldo us
    JOIN produto_analitico a ON a.product_sku = us.product_sku
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
      AND TRIM(UPPER(COALESCE(a.class_tipo, ''))) <> 'USO E CONSUMO'
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
    -- Agrupa por POSICAO. Repetir o CASE aqui nao funciona: cada ${'$'}{...} do Prisma
    -- vira um parametro posicional novo ($8, $9...), entao o Postgres nao reconhece
    -- as duas expressoes como iguais e exige us.branch_code no GROUP BY. Agrupar
    -- pelas colunas-base (branch_code, stock_code) tambem nao serve - quebraria DPA
    -- em uma linha por stock_code, e quem consome usa Map.set() (sobrescreve).
    GROUP BY 1, 2, 3
  `;
}

// Comparacao agregada independente das linhas/SKUs da posicao atual. Os filtros
// de classificacao/referencia incidem no catalogo completo de produtos validos.
// O CSV preserva as variacoes antigas; prd_saldo complementa com capturas da API.
// A antiga carga "CSV Virtual" da prd_saldo tinha uma unica posicao por chave e
// nao deve sobrescrever a serie historica completa dos CSVs numerados.
export function buildProdutosValidosAnoAnteriorSql(filtro: RelatorioBaseFiltro): Prisma.Sql {
  return Prisma.sql`
    produto_unico AS MATERIALIZED (
      SELECT DISTINCT ON (pa.product_code) pa.*
      FROM produto_analitico pa
      WHERE pa.product_code IS NOT NULL
      ORDER BY pa.product_code, (pa.product_sku LIKE 'PRODUCT_CODE:%'), pa.product_sku
    ), produtos_validos AS MATERIALIZED (
      SELECT a.product_code, a.product_sku, a.reference_code, a.class_linha AS linha, a.class_status AS status
      FROM produto_unico a
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
        AND TRIM(UPPER(COALESCE(a.class_tipo, ''))) <> 'USO E CONSUMO'
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
        ${buildIdentidadeFiltro(filtro)}
    )`;
}

export function buildEstoqueAnoAnteriorSql(
  filtro: RelatorioBaseFiltro, dataPosicao = filtro.dataPosicao, agrupamento: boolean | 'sku' = false
): Prisma.Sql {
  const dataCorte = dataLimiteSuperiorSql(dataPosicao, -1);
  const porLinha = agrupamento !== false;
  const porSku = agrupamento === 'sku';
  return Prisma.sql`
    WITH ${buildProdutosValidosAnoAnteriorSql(filtro)}, historico AS (
      SELECT s.product_code, s.branch_code, s.stock_code, s.stock,
             s.saldo_date::timestamp AS data_saldo, 2 AS prioridade,
             s.loaded_at AS data_carga, s.row_number::bigint AS sequencia,
             s.source_file AS arquivo
      FROM stg_saldo_virtual_csv s
      JOIN produtos_validos a ON a.product_code = s.product_code
      WHERE s.rejection_reason IS NULL
        AND s.saldo_date < ${dataCorte} + INTERVAL '1 day'
        ${filtroLocalEstoqueSql(filtro.branches, 's')}
      UNION ALL
      SELECT s.product_code, s.branch_code, s.stock_code, s.stock,
             s.captured_at AS data_saldo, 1 AS prioridade,
             s.captured_at AS data_carga, s.id AS sequencia, '' AS arquivo
      FROM prd_saldo s
      JOIN produtos_validos a ON a.product_code = s.product_code
      WHERE s.captured_at < ${dataCorte} + INTERVAL '1 day'
        AND s.stock_description IS DISTINCT FROM 'CSV Virtual'
        ${filtroLocalEstoqueSql(filtro.branches, 's')}
    ), ultimo_saldo AS (
      SELECT DISTINCT ON (product_code, branch_code, stock_code)
        product_code, branch_code, stock_code, stock
      FROM historico
      ORDER BY product_code, branch_code, stock_code, data_saldo DESC,
               prioridade DESC, data_carga DESC, sequencia DESC, arquivo DESC
    ), custos AS (
      SELECT product_code, MAX(valor) AS custo
      FROM produto_custos
      WHERE branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE} AND cost_code = ${CUSTO_PRODUCAO_CODE}
      GROUP BY product_code
    )
    SELECT COALESCE(SUM(s.stock), 0) AS quantidade,
           COALESCE(SUM(s.stock * COALESCE(c.custo, 0)), 0) AS valor
           ${porLinha ? Prisma.sql`, a.linha` : Prisma.empty}
           ${porSku ? Prisma.sql`, a.product_sku, a.reference_code, a.status` : Prisma.empty}
    FROM ultimo_saldo s
    LEFT JOIN custos c ON c.product_code = s.product_code
    ${porLinha ? Prisma.sql`JOIN produtos_validos a ON a.product_code = s.product_code
      GROUP BY a.linha ${porSku ? Prisma.sql`, a.product_sku, a.reference_code, a.status` : Prisma.empty}` : Prisma.empty}
  `;
}

export function buildEstoqueAnoAnteriorAnaliticoSql(filtro: RelatorioBaseFiltro, dataPosicao: string, agrupamento: boolean | 'sku' = false): Prisma.Sql {
  const porLinha = agrupamento !== false;
  const porSku = agrupamento === 'sku';
  return Prisma.sql`
    SELECT COALESCE(SUM(rb.estoque_ano_anterior * COALESCE(rb.custo_producao, 0)), 0) AS valor,
      COALESCE(SUM(rb.estoque_ano_anterior), 0) AS quantidade,
      EXISTS (
        SELECT 1 FROM pcp_relatorio_base_analitico_diario p
        WHERE p.data_posicao = ${dataPosicao}::date
      ) AND NOT EXISTS (
        SELECT 1 FROM pcp_relatorio_base_analitico_diario p
        WHERE p.data_posicao = ${dataPosicao}::date AND p.compoe_posicao_atual IS NULL
      ) AS completo
      ${porLinha ? Prisma.sql`, rb.linha` : Prisma.empty}
      ${porSku ? Prisma.sql`, rb.product_sku, rb.reference_code, rb.status` : Prisma.empty}
    FROM pcp_relatorio_base_analitico_diario rb
    WHERE rb.data_posicao = ${dataPosicao}::date
      ${buildAnaliticoFiltro(filtro)}
      ${porLinha ? Prisma.sql`GROUP BY rb.linha ${porSku ? Prisma.sql`, rb.product_sku, rb.reference_code, rb.status` : Prisma.empty}` : Prisma.empty}
  `;
}

async function getValorEstoqueAnoAnterior(
  filtro: RelatorioBaseFiltro, dataPosicao = filtro.dataPosicao, analiticoCompletoDisponivel = false
): Promise<number> {
  if (analiticoCompletoDisponivel && dataPosicao) {
    const rows = await prisma.$queryRaw<Array<{ valor: Decimal; completo: boolean }>>(
      buildEstoqueAnoAnteriorAnaliticoSql(filtro, dataPosicao)
    );
    if (rows[0]?.completo) return decimalToNumber(rows[0].valor);
  }
  // Dias ainda nao recalculados e consultas ao vivo preservam o historico completo.
  const rows = await prisma.$queryRaw<Array<{ valor: Decimal }>>(buildEstoqueAnoAnteriorSql(filtro, dataPosicao));
  return decimalToNumber(rows[0]?.valor);
}

export async function getDiagnosticoSaldoRelatorioBase(filtro: RelatorioBaseFiltro) {
  const identidadeRows = await getIdentidadeRows(filtro);
  const temFiltroClassificacao = !!(
    filtro.categoria?.length || filtro.linha?.length || filtro.genero?.length || filtro.status?.length || filtro.search?.trim()
  );
  const productSkusFiltro = temFiltroClassificacao ? identidadeRows.map((r) => r.product_sku) : null;
  const dataCorte = dataLimiteSuperiorSql(filtro.dataPosicao);
  const skusPrint = [
    '002 001 CST110',
    '012 BB CST001C',
    '006 BB CUE001C',
    '018 BB CST004T',
    '004 BB ACE002',
    '016 BB CST295B',
    '003 BB CST318',
    '001 BB ACE469',
    '014 BB MCL071',
    '026 BB ACE508',
    '026 BB ACE517',
    '006 BB ACE520',
    '009 BB TIA005',
    'VOUCHER BB VCH001',
    '021 BB BAZAR',
    '021 BB BAZAR 003',
    'SP 003 CNJ142',
    'SP 003 CNJ149',
    '010 BB BD192',
  ];

  const totais = await prisma.$queryRaw<SaldoDiagnosticoTotalRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, product_code, branch_code, stock_code, stock, captured_at
      FROM prd_saldo
      WHERE 1=1
        ${filtroProductSku(productSkusFiltro)}
        AND captured_at < ${dataCorte} + INTERVAL '1 day'
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    ),
    base AS (
      SELECT
        us.product_sku,
        ${localEstoqueSql('us')} AS branch_code,
        COALESCE(us.stock, 0)::numeric AS stock
      FROM ultimo_saldo us
      JOIN produto_analitico a ON a.product_sku = us.product_sku
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
        AND TRIM(UPPER(COALESCE(a.class_tipo, ''))) <> 'USO E CONSUMO'
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
    ),
    por_sku_branch AS (
      SELECT product_sku, branch_code, SUM(stock) AS stock
      FROM base
      GROUP BY product_sku, branch_code
    ),
    variantes AS (
      SELECT 'todas'::text AS variante, product_sku, SUM(stock) AS stock
      FROM por_sku_branch
      GROUP BY product_sku
      UNION ALL
      SELECT 'filial_02_dpa_atacado'::text AS variante, product_sku, SUM(stock) AS stock
      FROM por_sku_branch
      WHERE branch_code IN (${DPA_BRANCH_CODE}, ${ATACADO_BRANCH_CODE})
      GROUP BY product_sku
      UNION ALL
      SELECT 'dpa_saldos_1_5'::text AS variante, product_sku, SUM(stock) AS stock
      FROM por_sku_branch
      WHERE branch_code = ${DPA_BRANCH_CODE}
      GROUP BY product_sku
      UNION ALL
      SELECT 'atacado_saldo_8'::text AS variante, product_sku, SUM(stock) AS stock
      FROM por_sku_branch
      WHERE branch_code = ${ATACADO_BRANCH_CODE}
      GROUP BY product_sku
    )
    SELECT
      variante,
      SUM(stock) AS bruto,
      ROUND(SUM(stock), 0) AS arredondado_no_total,
      SUM(ROUND(stock, 0)) AS arredondado_por_sku,
      SUM(ROUND(stock, 0)) - ROUND(SUM(stock), 0) AS diferenca_arredondamento,
      COUNT(*) AS skus,
      COUNT(*) FILTER (WHERE stock <> ROUND(stock, 0)) AS skus_fracionados
    FROM variantes
    GROUP BY variante
    ORDER BY variante
  `;

  const saldosFilial02 = await prisma.$queryRaw<SaldoDiagnosticoCodigoRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, product_code, branch_code, stock_code, stock, captured_at
      FROM prd_saldo
      WHERE branch_code = ${FABRICA_BRANCH_CODE}
        ${filtroProductSku(productSkusFiltro)}
        AND captured_at < ${dataCorte} + INTERVAL '1 day'
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    ),
    base AS (
      SELECT us.product_sku, us.stock_code, COALESCE(us.stock, 0)::numeric AS stock
      FROM ultimo_saldo us
      JOIN produto_analitico a ON a.product_sku = us.product_sku
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
        AND TRIM(UPPER(COALESCE(a.class_tipo, ''))) <> 'USO E CONSUMO'
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
    )
    SELECT
      stock_code,
      SUM(stock) AS bruto,
      ROUND(SUM(stock), 0) AS arredondado_no_total,
      SUM(ROUND(stock, 0)) AS arredondado_por_sku,
      SUM(ROUND(stock, 0)) - ROUND(SUM(stock), 0) AS diferenca_arredondamento,
      COUNT(*) AS skus,
      COUNT(*) FILTER (WHERE stock <> ROUND(stock, 0)) AS skus_fracionados
    FROM base
    GROUP BY stock_code
    ORDER BY stock_code
  `;

  const skus = await prisma.$queryRaw<SaldoDiagnosticoSkuRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, product_code, branch_code, stock_code, stock, captured_at
      FROM prd_saldo
      WHERE branch_code = ${FABRICA_BRANCH_CODE}
        AND product_sku IN (${Prisma.join(skusPrint)})
        AND captured_at < ${dataCorte} + INTERVAL '1 day'
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    )
    SELECT
      product_sku,
      SUM(stock) FILTER (WHERE stock_code = 1) AS saldo_1,
      SUM(stock) FILTER (WHERE stock_code = 5) AS saldo_5,
      SUM(stock) FILTER (WHERE stock_code = 8) AS saldo_8,
      SUM(stock) AS saldo_1_5_8,
      MAX(captured_at) AS captured_at
    FROM ultimo_saldo
    GROUP BY product_sku
    ORDER BY product_sku
  `;

  return {
    dataPosicao: filtro.dataPosicao || new Date().toISOString().slice(0, 10),
    totais: totais.map((row) => ({
      variante: row.variante,
      bruto: round(decimalToNumber(row.bruto), 3),
      arredondadoNoTotal: round(decimalToNumber(row.arredondado_no_total), 0),
      arredondadoPorSku: round(decimalToNumber(row.arredondado_por_sku), 0),
      diferencaArredondamento: round(decimalToNumber(row.diferenca_arredondamento), 0),
      skus: Number(row.skus),
      skusFracionados: Number(row.skus_fracionados),
    })),
    filial02PorCodigoSaldo: saldosFilial02.map((row) => ({
      stockCode: row.stock_code,
      bruto: round(decimalToNumber(row.bruto), 3),
      arredondadoNoTotal: round(decimalToNumber(row.arredondado_no_total), 0),
      arredondadoPorSku: round(decimalToNumber(row.arredondado_por_sku), 0),
      diferencaArredondamento: round(decimalToNumber(row.diferenca_arredondamento), 0),
      skus: Number(row.skus),
      skusFracionados: Number(row.skus_fracionados),
    })),
    skusPrint: skus.map((row) => ({
      sku: row.product_sku,
      saldo1: round(decimalToNumber(row.saldo_1), 3),
      saldo5: round(decimalToNumber(row.saldo_5), 3),
      saldo8: round(decimalToNumber(row.saldo_8), 3),
      saldo158: round(decimalToNumber(row.saldo_1_5_8), 3),
      capturedAt: row.captured_at?.toISOString() || null,
    })),
  };
}

interface ProductCodeAggRow {
  product_code: number;
  branch_code: number;
  quantidade: Decimal;
}

// Giro (peca vendida, liquido de devolucao) por product_code x filial, ultimos `dias` dias
async function getGiroRows(dias: number, productCodes: number[] | null, dataPosicao?: string): Promise<ProductCodeAggRow[]> {
  const dataBase = dataBaseSql(dataPosicao);
  return prisma.$queryRaw<ProductCodeAggRow[]>`
    SELECT ti.product_code,
      CASE
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%' THEN ${ATACADO_BRANCH_CODE}
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} THEN ${DPA_BRANCH_CODE}
        ELSE t.branch_code
      END::int AS branch_code,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE ${DATA_VENDA} >= ${dataBase} - make_interval(days => ${dias}::int)
      AND ${DATA_VENDA} < ${dataBase} + INTERVAL '1 day'
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    -- Agrupa por POSICAO (ver comentario em getEstoqueRows): repetir o CASE cria
    -- parametros posicionais novos e o Postgres passa a exigir t.branch_code aqui.
    GROUP BY 1, 2
  `;
}

// Total agregado de giro em dias para cards executivos. Evita materializar um Map
// product_code x filial quando a tela so precisa do total.
async function getGiroTotalDias(dias: number, productCodes: number[] | null, branchCodes: number[] | null, dataPosicao?: string): Promise<number> {
  const dataBase = dataBaseSql(dataPosicao);
  const filtroBranch = branchCodes && branchCodes.length > 0
    ? Prisma.sql`AND venda.branch_code IN (${Prisma.join(branchCodes)})`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ quantidade: Decimal | null }>>`
    SELECT COALESCE(SUM(venda.quantidade), 0) AS quantidade
    FROM (
      SELECT
        CASE
          WHEN t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%' THEN ${ATACADO_BRANCH_CODE}
          WHEN t.branch_code = ${FABRICA_BRANCH_CODE} THEN ${DPA_BRANCH_CODE}
          ELSE t.branch_code
        END::int AS branch_code,
        ${QUANTIDADE_COM_SINAL} AS quantidade
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
      ${OPERACAO_JOIN}
      WHERE ${DATA_VENDA} >= ${dataBase} - make_interval(days => ${dias}::int)
        AND ${DATA_VENDA} < ${dataBase} + INTERVAL '1 day'
        AND t.status = 4
        AND ${SALE_OPERATION_FILTER}
        ${filtroProductCodeTi(productCodes)}
        -- Sem filtro de classificacao, os totais tambem precisam respeitar o
        -- universo da tabela. EXISTS evita multiplicar produto com placeholder.
        AND EXISTS (
          SELECT 1 FROM produto_analitico a
          LEFT JOIN produtos p ON p.product_sku = a.product_sku
          WHERE a.product_code = ti.product_code
            AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
            AND TRIM(UPPER(COALESCE(a.class_tipo, ''))) <> 'USO E CONSUMO'
            ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
        )
    ) venda
    WHERE 1 = 1
      ${filtroBranch}
  `;
  return decimalToNumber(rows[0]?.quantidade);
}

// Giro do canal Atacado (channel-split real, so branch_code=2), mesmo padrao de
// getVendasFabricaDividida/getDevolucoesFabricaDividida em vendas.service.ts
async function getGiroAtacadoRows(dias: number, productCodes: number[] | null, dataPosicao?: string): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  const dataBase = dataBaseSql(dataPosicao);
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE ${DATA_VENDA} >= ${dataBase} - make_interval(days => ${dias}::int)
      AND ${DATA_VENDA} < ${dataBase} + INTERVAL '1 day'
      AND t.status = 4
      AND t.branch_code = ${FABRICA_BRANCH_CODE}
      AND co.description ILIKE '%ATACADO%'
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code
  `;
}

// Total vendido por product_code x filial na janela de cobertura. Para bater com os
// cards "Giro TT 30/60/90 dias", 1 mes de cobertura equivale a 30 dias.
async function getVendaPorMesesRows(meses: number, productCodes: number[] | null, dataPosicao?: string): Promise<ProductCodeAggRow[]> {
  const dataBase = dataBaseSql(dataPosicao);
  const dias = meses * 30;
  return prisma.$queryRaw<ProductCodeAggRow[]>`
    SELECT ti.product_code,
      CASE
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%' THEN ${ATACADO_BRANCH_CODE}
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} THEN ${DPA_BRANCH_CODE}
        ELSE t.branch_code
      END::int AS branch_code,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE ${DATA_VENDA} >= ${dataBase} - make_interval(days => ${dias}::int)
      AND ${DATA_VENDA} < ${dataBase} + INTERVAL '1 day'
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    -- Agrupa por POSICAO (ver comentario em getEstoqueRows): repetir o CASE cria
    -- parametros posicionais novos e o Postgres passa a exigir t.branch_code aqui.
    GROUP BY 1, 2
  `;
}

// Total vendido do canal Atacado na janela de cobertura - usado como denominador da
// cobertura do Atacado quando atacadoCoberturaBase = 'atacado_only'.
async function getVendaAtacadoPorMesesRows(meses: number, productCodes: number[] | null, dataPosicao?: string): Promise<Array<{ product_code: number; quantidade: Decimal }>> {
  const dataBase = dataBaseSql(dataPosicao);
  const dias = meses * 30;
  return prisma.$queryRaw<Array<{ product_code: number; quantidade: Decimal }>>`
    SELECT ti.product_code, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE ${DATA_VENDA} >= ${dataBase} - make_interval(days => ${dias}::int)
      AND ${DATA_VENDA} < ${dataBase} + INTERVAL '1 day'
      AND t.status = 4
      AND t.branch_code = ${FABRICA_BRANCH_CODE}
      AND co.description ILIKE '%ATACADO%'
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code
  `;
}

// Giro TT por product_code x branch_code, nas janelas de 30/90/180 dias. Retorna detalhado
// por filial pra permitir que os cards KPIs respeitem o filtro de loja selecionado.
async function getGiroTtRows(meses: number, productCodes: number[] | null, dataPosicao?: string): Promise<ProductCodeAggRow[]> {
  const dataBase = dataBaseSql(dataPosicao);
  const dias = meses * 30;
  return prisma.$queryRaw<ProductCodeAggRow[]>`
    SELECT ti.product_code,
      CASE
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%' THEN ${ATACADO_BRANCH_CODE}
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} THEN ${DPA_BRANCH_CODE}
        ELSE t.branch_code
      END::int AS branch_code,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE ${DATA_VENDA} >= ${dataBase} - make_interval(days => ${dias}::int)
      AND ${DATA_VENDA} < ${dataBase} + INTERVAL '1 day'
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${filtroProductCodeTi(productCodes)}
    -- Agrupa por POSICAO (ver comentario em getEstoqueRows): repetir o CASE cria
    -- parametros posicionais novos e o Postgres passa a exigir t.branch_code aqui.
    GROUP BY 1, 2
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
async function getCustoPrecoRows(precoCustoBranchCode: number, pdvVarejoCode: number, pdvAtacadoCode: number, productCodes: number[] | null): Promise<CustoPrecoRow[]> {
  return prisma.$queryRaw<CustoPrecoRow[]>`
    SELECT
      base.product_code,
      c.valor AS custo,
      pv.valor AS pdv_var,
      pa.valor AS pdv_ata
    FROM (
      SELECT DISTINCT product_code FROM produto_custos WHERE branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE} ${filtroProductCode(productCodes)}
      UNION
      SELECT DISTINCT product_code FROM produto_precos WHERE branch_code = ${precoCustoBranchCode} ${filtroProductCode(productCodes)}
    ) base
    LEFT JOIN produto_custos c ON c.product_code = base.product_code AND c.branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE} AND c.cost_code = ${CUSTO_PRODUCAO_CODE}
    LEFT JOIN produto_precos pv ON pv.product_code = base.product_code AND pv.branch_code = ${precoCustoBranchCode} AND pv.price_code = ${pdvVarejoCode}
    LEFT JOIN produto_precos pa ON pa.product_code = base.product_code AND pa.branch_code = ${precoCustoBranchCode} AND pa.price_code = ${pdvAtacadoCode}
  `;
}

// Markup: (preco - custo) / custo * 100. Null se nao tem custo (ou custo <= 0) ou nao
// tem preco - nao faz sentido calcular markup sem os dois.
export function markupPercentual(preco: number | null, custo: number | null): number | null {
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
export const CUSTO_PRODUCAO_CODE = 1;
export const CUSTO_PRODUCAO_BRANCH_CODE = 1;

export async function getCustoRows(precoCustoBranchCode: number, custoCode: number, productCodes: number[] | null): Promise<Array<{ product_code: number; valor: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; valor: Decimal }>>`
    SELECT product_code, valor FROM produto_custos
    WHERE branch_code = ${precoCustoBranchCode} AND cost_code = ${custoCode}
      ${filtroProductCode(productCodes)}
  `;
}

export async function getCustoUltimaCompraRows(precoCustoBranchCode: number, productCodes: number[] | null): Promise<Array<{ product_code: number; valor: Decimal }>> {
  return getCustoRows(precoCustoBranchCode, CUSTO_ULTIMA_COMPRA_CODE, productCodes);
}

// Custo de PRODUCAO (costCode=1, fixo) - achado na investigacao do Performance Colecao
// (16/09/2026): CUSTO_ULTIMA_COMPRA_CODE (2) tem cobertura boa no catalogo geral (~87%)
// mas fica zerado em colecoes especificas (ex: sem "ultima compra" registrada ainda).
// cost_code=1 ("PRODUCAO" no TOTVS) tem cobertura quase total (99,8% dos produtos,
// branch_code=1) e e semanticamente o que um relatorio de PCP quer (custo de produzir
// a peca, nao preco da ultima compra de matéria-prima/mercadoria).
export async function getCustoProducaoRows(productCodes: number[] | null): Promise<Array<{ product_code: number; valor: Decimal }>> {
  return prisma.$queryRaw<Array<{ product_code: number; valor: Decimal }>>`
    SELECT product_code, valor FROM produto_custos
    WHERE branch_code = ${CUSTO_PRODUCAO_BRANCH_CODE} AND cost_code = ${CUSTO_PRODUCAO_CODE}
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
export async function getUltimaEntradaRows(productCodes: number[] | null, dataPosicao?: string): Promise<Array<{ product_code: number; ultima_entrada: Date }>> {
  const dataBase = dataBaseSql(dataPosicao);
  return prisma.$queryRaw<Array<{ product_code: number; ultima_entrada: Date }>>`
    SELECT ti.product_code, MAX(t.transaction_date) AS ultima_entrada
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
    ${OPERACAO_JOIN}
    WHERE t.status = 4 AND co.operations_type = 'E'
      AND t.transaction_date < ${dataBase} + INTERVAL '1 day'
      ${filtroProductCodeTi(productCodes)}
    GROUP BY ti.product_code
  `;
}

// Ausencia de fotografia nao significa pendencia zero. Explicita a indisponibilidade
// em todos os niveis do payload, inclusive no detalhamento usado pelo Excel.
function aplicarDisponibilidadeProducao(rows: RelatorioBaseReferenciaRow[], info: ProducaoRelatorio): RelatorioBaseReferenciaRow[] {
  if (!info.disponivel) for (const row of rows) {
    row.emProducao = null;
    for (const cor of row.cores) cor.emProducao = null;
    for (const sku of row.skus) sku.emProducao = null;
  }
  return rows;
}

interface IdentidadeRow {
  product_sku: string;
  product_code: number | null;
  reference_code: string | null;
  reference_name: string | null;
  color_code: string | null;
  color_name: string | null;
  cor_agrupada: string | null;
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

interface RelatorioBaseAnaliticoRow {
  data_posicao: string;
  product_sku: string;
  product_code: number | null;
  reference_code: string | null;
  reference_name: string | null;
  product_name: string | null;
  descricao_completa: string | null;
  color_code: string | null;
  color_name: string | null;
  size: string | null;
  cor_agrupada: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  modelo: string | null;
  status: string | null;
  lancamento: string | null;
  branch_code: number;
  estoque: Decimal | null;
  giro_30d: Decimal | null;
  giro_60d: Decimal | null;
  giro_90d: Decimal | null;
  giro_1m: Decimal | null;
  giro_3m: Decimal | null;
  giro_6m: Decimal | null;
  venda_cobertura_periodo: Decimal | null;
  custo_producao: Decimal | null;
  pdv_varejo: Decimal | null;
  pdv_atacado: Decimal | null;
  ultima_entrada: Date | null;
  em_producao: Decimal | null;
  valor_estoque_custo_producao: Decimal | null;
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

function normalizarClassificacao(valor: string | null): string {
  return (valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

const LINHA_BUCKET_BASICO = 'B\u00e1sico';
const LINHA_BUCKET_BASICO_RENOVAVEL = 'B\u00e1sico Renov\u00e1vel';
const LINHA_BUCKET_COLECAO = 'Style';

// Básico Renovável entra separado de Básico (pedido do usuario); resto da linha
// (TEENKIS/PROMOCOES/BRINDE/MODA PRAIA/EMBALAGEM/CASUAL/PROTECAO) fica de fora da
// matriz por linha, mesma politica que ja existia no visaoGeral.service.ts antigo.
export function linhaBucket(linha: string | null): string | null {
  const l = normalizarClassificacao(linha);
  if (l === 'BASICA' || l === 'BASICO') return LINHA_BUCKET_BASICO;
  if (l === 'BASICA RENOVAVEL' || l === 'BASICO RENOVAVEL') return LINHA_BUCKET_BASICO_RENOVAVEL;
  if (l === 'STYLE' || l === 'COLECAO') return LINHA_BUCKET_COLECAO;
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
    condicoes.push(Prisma.sql`(a.reference_code ILIKE ${termo} OR a.product_sku ILIKE ${termo} OR a.reference_name ILIKE ${termo} OR a.product_name ILIKE ${termo})`);
  }
  if (condicoes.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(condicoes, ' AND ')}`;
}

function buildAnaliticoFiltro(filtro: RelatorioBaseFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(rb.categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(rb.linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(rb.genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`TRIM(rb.status) IN (${Prisma.join(filtro.status)})`);
  if (filtro.branches?.length) condicoes.push(Prisma.sql`rb.branch_code IN (${Prisma.join(filtro.branches)})`);
  if (filtro.search?.trim()) {
    const termo = `%${filtro.search.trim()}%`;
    condicoes.push(Prisma.sql`(
      rb.product_sku ILIKE ${termo}
      OR rb.reference_code ILIKE ${termo}
      OR rb.reference_name ILIKE ${termo}
      OR rb.product_name ILIKE ${termo}
    )`);
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

// Universo padrao para estoque liquido PCP:
// 1) produtos normais do TOTVS: product_code < 1000000
// 2) embalagens: product_code >= 1000000 somente quando categoria = EMBALAGEM
// Outros product_code >= 1000000 sao subprodutos/componentes internos e ficam fora
// dos calculos de estoque para nao inflar os paineis.
export const PCP_ESTOQUE_LIQUIDO_SKU_FILTER = Prisma.sql`
  AND (
    a.product_code < 1000000
    OR (
      a.product_code >= 1000000
      AND TRIM(UPPER(COALESCE(a.class_categoria, ''))) = 'EMBALAGEM'
    )
  )
`;

// Agrupamento de Cores (tabelas agrupamento_grupos/agrupamento_membros, configurado na
// tela /pcp/agrupamento-cores): junta variacoes de cor de uma referencia num grupo
// logico, sem alterar dado do TOTVS. Um membro = um par (reference_code, cor) apontando
// pra um grupo; a chave de casamento e color_code, com fallback pra color_name
// (colorMatchKeyOf no apps/api). Espera alias "a" pra produto_analitico e devolve o
// nome do grupo em ag.nome - use com COR_AGRUPADA_SELECT.
// Padrao ja usado por estoque.service.ts (cor_de_para) e raioX.service.ts (cor_agrupada);
// extraido aqui pra nao repetir o par de LEFT JOIN em cada relatorio novo.
export const AGRUPAMENTO_COR_JOIN = Prisma.sql`
  LEFT JOIN agrupamento_membros am
    ON am.tipo = 'cor_produto'
    AND am.reference_code = a.reference_code
    AND am.color_match_key = COALESCE(NULLIF(TRIM(a.color_code), ''), NULLIF(TRIM(a.color_name), ''))
  LEFT JOIN agrupamento_grupos ag
    ON ag.id = am.grupo_id
    AND ag.tipo = am.tipo
`;

// Nome do grupo de cor (NULL quando aquela cor nao foi agrupada ainda).
export const COR_AGRUPADA_SELECT = Prisma.sql`NULLIF(TRIM(ag.nome), '')`;

// Cor "de exibicao": o grupo quando existe, senao a cor original. Usar no GROUP BY
// quando o relatorio estiver no modo "agrupar por Agrupamento de Cores".
export const COR_EXIBICAO_SELECT = Prisma.sql`
  COALESCE(
    NULLIF(TRIM(ag.nome), ''),
    NULLIF(TRIM(a.color_name), ''),
    NULLIF(TRIM(a.color_code), ''),
    'SEM COR'
  )
`;

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
      ${COR_AGRUPADA_SELECT} as cor_agrupada,
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
    ${AGRUPAMENTO_COR_JOIN}
    WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${filtroSql}
  `;
}

async function resolveDataAnalitica(filtro: RelatorioBaseFiltro): Promise<string | null> {
  if (filtro.dataPosicao) {
    const rows = await prisma.$queryRaw<Array<{ data_posicao: string }>>`
      SELECT to_char(data_posicao, 'YYYY-MM-DD') AS data_posicao
      FROM pcp_relatorio_base_analitico_diario
      WHERE data_posicao = ${filtro.dataPosicao}::date
      LIMIT 1
    `;
    return rows[0]?.data_posicao || null;
  }

  const rows = await prisma.$queryRaw<Array<{ data_posicao: string | null }>>`
    SELECT to_char(MAX(data_posicao), 'YYYY-MM-DD') AS data_posicao
    FROM pcp_relatorio_base_analitico_diario
    WHERE data_posicao < CURRENT_DATE
  `;
  return rows[0]?.data_posicao || null;
}

function giroAnaliticoDaConfig(row: RelatorioBaseAnaliticoRow, dias: number): number {
  if (dias <= 30) return decimalToNumber(row.giro_30d);
  if (dias <= 60) return decimalToNumber(row.giro_60d);
  return decimalToNumber(row.giro_90d);
}

function dateToIsoDate(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

async function getRelatorioBaseAnalitico(
  filtro: RelatorioBaseFiltro,
  config: Awaited<ReturnType<typeof getConfig>>
): Promise<RelatorioBaseResponse | null> {
  const dataAnalitica = await resolveDataAnalitica(filtro);
  if (!dataAnalitica) return null;

  // Compatibilidade durante a publicacao: o backend pode subir antes da rotina.
  const [schema] = await prisma.$queryRaw<Array<{ possui_marcador: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pcp_relatorio_base_analitico_diario'
        AND column_name = 'compoe_posicao_atual'
    ) AS possui_marcador
  `;
  const possuiMarcador = schema.possui_marcador;
  const filtroPosicaoAtual = possuiMarcador
    ? Prisma.sql`AND rb.compoe_posicao_atual IS DISTINCT FROM false`
    : Prisma.empty;
  const filtroSql = buildAnaliticoFiltro(filtro);
  const rowsAnaliticas = await prisma.$queryRaw<RelatorioBaseAnaliticoRow[]>`
    SELECT
      to_char(rb.data_posicao, 'YYYY-MM-DD') AS data_posicao,
      rb.product_sku,
      rb.product_code,
      rb.reference_code,
      rb.reference_name,
      rb.product_name,
      COALESCE(NULLIF(TRIM(a.description), ''), NULLIF(TRIM(rb.product_name), ''), NULLIF(TRIM(rb.reference_name), ''), rb.product_sku) AS descricao_completa,
      NULLIF(TRIM(a.color_code), '') AS color_code,
      NULLIF(TRIM(a.color_name), '') AS color_name,
      NULLIF(TRIM(a.size), '') AS size,
      rb.categoria,
      rb.linha,
      rb.genero,
      rb.modelo,
      rb.status,
      rb.lancamento,
      rb.branch_code,
      rb.estoque,
      rb.giro_30d,
      rb.giro_60d,
      rb.giro_90d,
      rb.giro_1m,
      rb.giro_3m,
      rb.giro_6m,
      rb.venda_cobertura_periodo,
      rb.custo_producao,
      rb.pdv_varejo,
      rb.pdv_atacado,
      rb.ultima_entrada,
      rb.em_producao,
      rb.valor_estoque_custo_producao,
      ${COR_AGRUPADA_SELECT} AS cor_agrupada
    FROM pcp_relatorio_base_analitico_diario rb
    LEFT JOIN produto_analitico a ON a.product_sku = rb.product_sku
    ${AGRUPAMENTO_COR_JOIN}
    WHERE rb.data_posicao = ${dataAnalitica}::date
      ${filtroPosicaoAtual}
      ${filtroSql}
  `;

  // Ignora em_producao de materializacoes antigas contaminadas pela carga atual.
  // A captura da data e a fonte unica tanto no caminho analitico quanto ao vivo.
  const producao = await getProducaoRelatorio(dataAnalitica);
  const pendencias = new Map(producao.rows.map(r => [r.product_code, decimalToNumber(r.quantidade)]));
  const identidadesProducao = producao.info.disponivel ? await getIdentidadeRows(filtro) : [];
  const canonicosProducao = skusCanonicosProducao(identidadesProducao);
  const presentes = new Set(rowsAnaliticas.map(r => r.product_sku));
  for (const i of identidadesProducao) {
    if (i.product_code === null || !pendencias.has(i.product_code)
      || canonicosProducao.get(i.product_code) !== i.product_sku || presentes.has(i.product_sku)) continue;
    rowsAnaliticas.push({
      ...i, data_posicao: dataAnalitica, product_name: i.descricao,
      branch_code: filtro.branches?.[0] ?? DPA_BRANCH_CODE,
      estoque: null, giro_30d: null, giro_60d: null, giro_90d: null,
      giro_1m: null, giro_3m: null, giro_6m: null, venda_cobertura_periodo: null,
      custo_producao: null, pdv_varejo: null, pdv_atacado: null,
      ultima_entrada: null, em_producao: null, valor_estoque_custo_producao: null,
    });
    presentes.add(i.product_sku);
  }

  const branchFiltro = filtro.branches && filtro.branches.length > 0 ? new Set(filtro.branches) : null;
  const colunasAtivas = (await getColunasEstoque()).filter((c) => !branchFiltro || branchFiltro.has(c.branchCode));

  function coberturaDe(estoque: number, mediaMensal: number): number | null {
    if (mediaMensal <= 0) return null;
    return round(estoque / mediaMensal, 2);
  }

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
    const bucket = chave?.trim() || MATRIZ_SEM_CLASSIFICACAO;
    const acc = mapa.get(bucket) || bucketVazio();
    acc.estVarejo += valores.estVarejo;
    acc.estAtacado += valores.estAtacado;
    acc.vendaVarejo += valores.vendaVarejo;
    acc.vendaAtacado += valores.vendaAtacado;
    acc.valorEstoque += valores.valorEstoque;
    mapa.set(bucket, acc);
  }

  interface ConsistencyState {
    value: number | null | undefined;
    inconsistent: boolean;
  }
  type ConsistencyKey = 'custo' | 'pdvAtual' | 'pdvRealVar' | 'markupVar' | 'pdvRealAta' | 'markupAta';
  function emptyConsistency(): Record<ConsistencyKey, ConsistencyState> {
    return {
      custo: { value: undefined, inconsistent: false },
      pdvAtual: { value: undefined, inconsistent: false },
      pdvRealVar: { value: undefined, inconsistent: false },
      markupVar: { value: undefined, inconsistent: false },
      pdvRealAta: { value: undefined, inconsistent: false },
      markupAta: { value: undefined, inconsistent: false },
    };
  }
  function addConsistency(state: ConsistencyState, value: number | null) {
    if (value === null || state.inconsistent) return;
    if (state.value === undefined) state.value = value;
    else if (state.value !== value) state.inconsistent = true;
  }
  function getConsistency(state: ConsistencyState): number | null {
    if (state.inconsistent) return null;
    return state.value ?? null;
  }

  interface SkuAgg {
    productSku: string;
    productCode: number | null;
    referenceCode: string;
    referenceName: string;
    productName: string;
    descricaoCompleta: string;
    cor: string;
    corAgrupada: string | null;
    tamanho: string;
    categoria: string | null;
    linha: string | null;
    genero: string | null;
    modelo: string | null;
    status: string | null;
    lancamento: string | null;
    ultimaEntrada: string | null;
    custo: number | null;
    pdvVar: number | null;
    pdvAta: number | null;
    emProducao: number;
    estTt: number;
    valorEstoque: number;
    giro30: number;
    giro60: number;
    giro90: number;
    giroTt1: number;
    giroTt3: number;
    giroTt6: number;
    branchesAgg: Map<number, { est: number; giro: number; vendaCobertura: number; giro30: number }>;
  }

  const skus = new Map<string, SkuAgg>();
  for (const row of rowsAnaliticas) {
    const sku = row.product_sku;
    const referenceCode = row.reference_code || sku;
    const referenceName = row.reference_name || referenceCode;
    const custo = row.custo_producao !== null ? decimalToNumber(row.custo_producao) : null;
    const estoque = decimalToNumber(row.estoque);
    const vendaCobertura = decimalToNumber(row.venda_cobertura_periodo);
    const valorEstoque = row.valor_estoque_custo_producao !== null
      ? decimalToNumber(row.valor_estoque_custo_producao)
      : estoque * (custo ?? 0);
    const ultimaEntrada = dateToIsoDate(row.ultima_entrada);

    const agg = skus.get(sku) || {
      productSku: sku,
      productCode: row.product_code,
      referenceCode,
      referenceName,
      productName: row.product_name || referenceName,
      descricaoCompleta: row.descricao_completa || row.product_name || referenceName,
      cor: row.color_name || row.color_code || '-',
      corAgrupada: row.cor_agrupada,
      tamanho: row.size || '-',
      categoria: row.categoria,
      linha: row.linha,
      genero: row.genero,
      modelo: row.modelo,
      status: row.status,
      lancamento: formatarLancamento(row.lancamento),
      ultimaEntrada: null,
      custo,
      pdvVar: row.pdv_varejo !== null ? decimalToNumber(row.pdv_varejo) : null,
      pdvAta: row.pdv_atacado !== null ? decimalToNumber(row.pdv_atacado) : null,
      emProducao: row.product_code !== null && canonicosProducao.get(row.product_code) === sku
        ? pendencias.get(row.product_code) ?? 0 : 0,
      estTt: 0,
      valorEstoque: 0,
      giro30: 0,
      giro60: 0,
      giro90: 0,
      giroTt1: 0,
      giroTt3: 0,
      giroTt6: 0,
      branchesAgg: new Map<number, { est: number; giro: number; vendaCobertura: number; giro30: number }>(),
    };

    agg.estTt += estoque;
    agg.valorEstoque += valorEstoque;
    agg.giro30 += decimalToNumber(row.giro_30d);
    agg.giro60 += decimalToNumber(row.giro_60d);
    agg.giro90 += decimalToNumber(row.giro_90d);
    agg.giroTt1 += decimalToNumber(row.giro_1m);
    agg.giroTt3 += decimalToNumber(row.giro_3m);
    agg.giroTt6 += decimalToNumber(row.giro_6m);
    if (ultimaEntrada && (!agg.ultimaEntrada || ultimaEntrada > agg.ultimaEntrada)) agg.ultimaEntrada = ultimaEntrada;
    if (agg.custo === null && custo !== null) agg.custo = custo;
    if (agg.pdvVar === null && row.pdv_varejo !== null) agg.pdvVar = decimalToNumber(row.pdv_varejo);
    if (agg.pdvAta === null && row.pdv_atacado !== null) agg.pdvAta = decimalToNumber(row.pdv_atacado);

    const branch = agg.branchesAgg.get(row.branch_code) || { est: 0, giro: 0, vendaCobertura: 0, giro30: 0 };
    branch.est += estoque;
    branch.giro += giroAnaliticoDaConfig(row, config.giroDias);
    branch.vendaCobertura += vendaCobertura;
    branch.giro30 += decimalToNumber(row.giro_30d);
    agg.branchesAgg.set(row.branch_code, branch);

    skus.set(sku, agg);
  }

  const referenciasMatriz = new ReferenciasMatriz();
  const matrizLinhaAgg = new Map<string, BucketAcc>();
  const matrizLinhaCompletaAgg = new Map<string, BucketAcc>();
  const matrizCategoriaAgg = new Map<string, BucketAcc>();
  const matrizGeneroAgg = new Map<string, BucketAcc>();
  const matrizStatusAgg = new Map<string, BucketAcc>();
  const statusAgg = new Map<string, number>();
  let valorEstoqueTotal = 0;
  let estVarejoTotal = 0;
  let estAtacadoTotal = 0;
  let vendaVarejoTotal = 0;
  let vendaAtacadoTotal = 0;
  let estoqueMortoQtd = 0;
  let estoqueMortoValor = 0;
  let estoquePromocaoQtd = 0;
  let estoquePromocaoValor = 0;
  const estoqueAnaliseReferencias = new Map<string, EstoqueAnaliseReferencia>();
  const rupturaBasicoAcc = rupturaLinhaAccVazio();
  const rupturaRenovavelAcc = rupturaLinhaAccVazio();
  const estoqueAtivosAcc = new Map<string, EstoqueAtivoSku>();
  const lojasComValores = new Set<number>();
  const kpis = { giroTt1: 0, giroTt3: 0, giroTt6: 0, giroTt30: 0, giroTt60: 0, giroTt90: 0, estTt: 0, skuCount: 0 };

  // Acumulado de uma COR dentro da referencia - alimenta o drill-down/visao por cor da
  // tela. coresOriginais e um Set pra saber quantas cores do TOTVS caíram nesse grupo
  // quando o Agrupamento de Cores esta ligado.
  interface CorAcumuladoAnalitico {
    coresOriginais: Set<string>;
    totalSkus: number;
    emProducao: number;
    estTt: number;
    giroTt1: number;
    giroTt3: number;
    giroTt6: number;
    consistency: Record<ConsistencyKey, ConsistencyState>;
    branchesAgg: Map<number, { est: number; giro: number; mediaMensalSum: number }>;
  }

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
    totalSkus: number;
    consistency: Record<ConsistencyKey, ConsistencyState>;
    branchesAgg: Map<number, { est: number; giro: number; mediaMensalSum: number }>;
    coresAgg: Map<string, CorAcumuladoAnalitico>;
  }
  const referenciaAgg = new Map<string, RefAgg>();
  const agruparPorCorSalva = filtro.agruparPorCorSalva ?? false;

  for (const sku of skus.values()) {
    const estAtacadoSku = sku.branchesAgg.get(ATACADO_BRANCH_CODE)?.est ?? 0;
    let estVarejoSku = 0;
    let vendaVarejoSku = 0;
    for (const [branchCode, valores] of sku.branchesAgg) {
      if (valores.est !== 0 || valores.giro !== 0) lojasComValores.add(branchCode);
      if (branchCode === ATACADO_BRANCH_CODE) continue;
      estVarejoSku += valores.est;
      vendaVarejoSku += valores.giro30;
    }
    const vendaAtacadoSku = sku.branchesAgg.get(ATACADO_BRANCH_CODE)?.giro30 ?? 0;
    const custo = sku.custo;

    valorEstoqueTotal += sku.valorEstoque;
    estVarejoTotal += estVarejoSku;
    estAtacadoTotal += estAtacadoSku;
    vendaVarejoTotal += vendaVarejoSku;
    vendaAtacadoTotal += vendaAtacadoSku;

    kpis.giroTt1 += round(sku.giroTt1, 0);
    kpis.giroTt3 += round(sku.giroTt3, 0);
    kpis.giroTt6 += round(sku.giroTt6, 0);
    kpis.estTt += round(sku.estTt, 0);
    kpis.skuCount += 1;
    kpis.giroTt30 += sku.giro30;
    kpis.giroTt60 += sku.giro60;
    kpis.giroTt90 += sku.giro90;

    const statusTrim = sku.status?.trim().replace(/\s+/g, ' ').toUpperCase() || null;
    let statusBucketKey: string;
    if (statusTrim === 'FORA DE LINHA') statusBucketKey = 'FORA DE LINHA';
    else if (statusTrim?.startsWith('FORA DE LINHA')) statusBucketKey = 'FORA DE LINHA PROMOCAO';
    else if (statusTrim === 'ATIVO') statusBucketKey = 'ATIVO';
    else if (statusTrim === 'INATIVO') statusBucketKey = 'INATIVO';
    else statusBucketKey = 'OUTROS';
    const statusApresentacao = statusBucketKey.startsWith('FORA DE LINHA') ? 'FORA DE LINHA' : statusBucketKey;
    statusAgg.set(statusApresentacao, (statusAgg.get(statusApresentacao) || 0) + sku.estTt);
    if (temCoberturaCritica(sku.estTt, sku.giro30)) {
      estoqueMortoQtd += sku.estTt;
      estoqueMortoValor += sku.valorEstoque;
    }
    acumularEstoqueAnaliseReferencia(estoqueAnaliseReferencias, sku.referenceCode, sku.estTt, sku.valorEstoque, sku.giro30, sku.giro60, sku.giro90);
    acumularRuptura(rupturaBasicoAcc, rupturaRenovavelAcc, sku.linha, sku.status, sku.estTt);
    acumularEstoqueAtivos(estoqueAtivosAcc, sku.productSku, sku.referenceCode, sku.linha, sku.status, sku.estTt);
    if (statusBucketKey === 'FORA DE LINHA PROMOCAO') {
      estoquePromocaoQtd += sku.estTt;
      estoquePromocaoValor += sku.valorEstoque;
    }

    const bucketValores: BucketAcc = {
      estVarejo: estVarejoSku,
      estAtacado: estAtacadoSku,
      vendaVarejo: vendaVarejoSku,
      vendaAtacado: vendaAtacadoSku,
      valorEstoque: sku.valorEstoque,
    };
    acumularBucket(matrizLinhaAgg, linhaBucket(sku.linha), bucketValores);
    acumularBucket(matrizLinhaCompletaAgg, sku.linha?.trim() || null, bucketValores);
    acumularBucket(matrizCategoriaAgg, sku.categoria?.trim() || null, bucketValores);
    acumularBucket(matrizGeneroAgg, sku.genero?.trim() || null, bucketValores);
    acumularBucket(matrizStatusAgg, agruparStatus(sku.status), bucketValores);
    for (const [dimensao, label] of [
      ['linha', linhaBucket(sku.linha)], ['linhaCompleta', sku.linha],
      ['categoria', sku.categoria], ['genero', sku.genero],
      ['status', agruparStatus(sku.status)],
    ] as const) {
      referenciasMatriz.acumular(dimensao, label, sku.referenceCode, sku.referenceName,
        sku.status, estVarejoSku + estAtacadoSku);
    }

    const referenceCode = sku.referenceCode;
    const markupVar = markupPercentual(sku.pdvVar, custo);
    const markupAta = markupPercentual(sku.pdvAta, custo);
    const agg = referenciaAgg.get(referenceCode) || {
      referenceName: sku.referenceName,
      categoria: sku.categoria,
      linha: sku.linha,
      genero: sku.genero,
      modelo: sku.modelo,
      status: sku.status,
      lancamento: sku.lancamento,
      ultimaEntrada: null,
      emProducao: 0,
      estTt: 0,
      giroTt1: 0,
      giroTt3: 0,
      giroTt6: 0,
      totalSkus: 0,
      consistency: emptyConsistency(),
      branchesAgg: new Map<number, { est: number; giro: number; mediaMensalSum: number }>(),
      coresAgg: new Map<string, CorAcumuladoAnalitico>(),
    };
    agg.emProducao += round(sku.emProducao, 0);
    agg.estTt += round(sku.estTt, 0);
    agg.giroTt1 += round(sku.giroTt1, 0);
    agg.giroTt3 += round(sku.giroTt3, 0);
    agg.giroTt6 += round(sku.giroTt6, 0);
    agg.totalSkus += 1;
    addConsistency(agg.consistency.custo, custo);
    addConsistency(agg.consistency.pdvAtual, sku.pdvVar);
    addConsistency(agg.consistency.pdvRealVar, sku.pdvVar);
    addConsistency(agg.consistency.markupVar, markupVar);
    addConsistency(agg.consistency.pdvRealAta, sku.pdvAta);
    addConsistency(agg.consistency.markupAta, markupAta);
    if (sku.ultimaEntrada && (!agg.ultimaEntrada || sku.ultimaEntrada > agg.ultimaEntrada)) agg.ultimaEntrada = sku.ultimaEntrada;
    for (const [branchCode, valores] of sku.branchesAgg) {
      const acumulado = agg.branchesAgg.get(branchCode) || { est: 0, giro: 0, mediaMensalSum: 0 };
      acumulado.est += valores.est;
      acumulado.giro += valores.giro;
      acumulado.mediaMensalSum += valores.giro30;
      agg.branchesAgg.set(branchCode, acumulado);
    }

    // Mesmo acumulado, um nivel abaixo: por COR. No modo agrupado a chave e o nome do
    // grupo do Agrupamento de Cores (com fallback pra cor original quando aquela cor
    // ainda nao foi agrupada), senao e sempre a cor original do TOTVS.
    const corOriginal = sku.cor || 'SEM COR';
    const corExibicao = agruparPorCorSalva ? (sku.corAgrupada?.trim() || corOriginal) : corOriginal;
    const corAgg = agg.coresAgg.get(corExibicao) || {
      coresOriginais: new Set<string>(),
      totalSkus: 0,
      emProducao: 0,
      estTt: 0,
      giroTt1: 0,
      giroTt3: 0,
      giroTt6: 0,
      consistency: emptyConsistency(),
      branchesAgg: new Map<number, { est: number; giro: number; mediaMensalSum: number }>(),
    };
    corAgg.coresOriginais.add(corOriginal);
    corAgg.totalSkus += 1;
    corAgg.emProducao += round(sku.emProducao, 0);
    corAgg.estTt += round(sku.estTt, 0);
    corAgg.giroTt1 += round(sku.giroTt1, 0);
    corAgg.giroTt3 += round(sku.giroTt3, 0);
    corAgg.giroTt6 += round(sku.giroTt6, 0);
    addConsistency(corAgg.consistency.custo, custo);
    addConsistency(corAgg.consistency.pdvRealVar, sku.pdvVar);
    addConsistency(corAgg.consistency.markupVar, markupVar);
    addConsistency(corAgg.consistency.pdvRealAta, sku.pdvAta);
    addConsistency(corAgg.consistency.markupAta, markupAta);
    for (const [branchCode, valores] of sku.branchesAgg) {
      const acumulado = corAgg.branchesAgg.get(branchCode) || { est: 0, giro: 0, mediaMensalSum: 0 };
      acumulado.est += valores.est;
      acumulado.giro += valores.giro;
      acumulado.mediaMensalSum += valores.giro30;
      corAgg.branchesAgg.set(branchCode, acumulado);
    }
    agg.coresAgg.set(corExibicao, corAgg);

    referenciaAgg.set(referenceCode, agg);
  }

  // A posicao materializada guarda SKUs com saldo ou movimento, nao o cadastro
  // inteiro. Os ativos ausentes compoem a base da ruptura e dos indicadores de
  // referencias/SKUs, com estoque zero na selecao consultada.
  for (const identidade of await getIdentidadeRows(filtro)) {
    if (skus.has(identidade.product_sku)) continue;
    acumularRuptura(rupturaBasicoAcc, rupturaRenovavelAcc, identidade.linha, identidade.status, 0);
    acumularEstoqueAtivos(estoqueAtivosAcc, identidade.product_sku, identidade.reference_code || identidade.product_sku, identidade.linha, identidade.status, 0);
  }

  const rows: RelatorioBaseReferenciaRow[] = [];
  for (const [referenceCode, agg] of referenciaAgg) {
    const branches: Record<number, RelatorioBaseColunaFilial> = {};
    for (const coluna of colunasAtivas) {
      const valores = agg.branchesAgg.get(coluna.branchCode) || { est: 0, giro: 0, mediaMensalSum: 0 };
      branches[coluna.branchCode] = {
        est: round(valores.est, 0),
        giro: round(valores.giro, 0),
        cob: coberturaDe(valores.est, valores.mediaMensalSum),
      };
    }
    rows.push({
      referenceCode,
      referenceName: agg.referenceName,
      totalSkus: agg.totalSkus,
      descricao: agg.referenceName,
      descricaoCompleta: agg.referenceName,
      categoria: agg.categoria,
      linha: agg.linha,
      genero: agg.genero,
      modelo: agg.modelo,
      status: agg.status,
      lancamento: agg.lancamento,
      ultimaEntrada: agg.ultimaEntrada,
      custo: getConsistency(agg.consistency.custo),
      pdvAtual: getConsistency(agg.consistency.pdvAtual),
      pdvRealVar: getConsistency(agg.consistency.pdvRealVar),
      markupVar: getConsistency(agg.consistency.markupVar),
      pdvRealAta: getConsistency(agg.consistency.pdvRealAta),
      markupAta: getConsistency(agg.consistency.markupAta),
      emProducao: round(agg.emProducao, 0),
      estTt: round(agg.estTt, 0),
      giroTt1: round(agg.giroTt1, 0),
      giroTt3: round(agg.giroTt3, 0),
      giroTt6: round(agg.giroTt6, 0),
      branches,
      skus: [],
      cores: [],
    });
  }

  rows.sort(ordenarPorEstoque);
  const pageSize = filtro.pageSize && filtro.pageSize > 0 ? filtro.pageSize : 15;
  const totalReferencias = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalReferencias / pageSize));
  const page = filtro.page && filtro.page > 0 ? Math.min(filtro.page, totalPages) : 1;
  const rowsPaginadas = rows.slice((page - 1) * pageSize, page * pageSize);
  const rowsPorReferencia = new Map(rowsPaginadas.map((row) => [row.referenceCode, row]));
  for (const sku of skus.values()) {
    const row = rowsPorReferencia.get(sku.referenceCode);
    if (!row) continue;

    const custo = sku.custo;
    const markupVar = markupPercentual(sku.pdvVar, custo);
    const markupAta = markupPercentual(sku.pdvAta, custo);
    const skuBranches: Record<number, RelatorioBaseColunaFilial> = {};
    for (const coluna of colunasAtivas) {
      const valores = sku.branchesAgg.get(coluna.branchCode) || { est: 0, giro: 0, vendaCobertura: 0, giro30: 0 };
      skuBranches[coluna.branchCode] = {
        est: round(valores.est, 0),
        giro: round(valores.giro, 0),
        cob: coberturaDe(valores.est, valores.giro30),
      };
    }

    row.skus.push({
      sku: sku.productSku,
      codigo: sku.productCode,
      referenceCode: sku.referenceCode,
      cor: sku.cor,
      tamanho: sku.tamanho,
      refCorTam: buildRefCorTam(sku.referenceCode, sku.cor, sku.tamanho),
      descricao: sku.productName,
      descricaoCompleta: sku.descricaoCompleta,
      categoria: sku.categoria,
      linha: sku.linha,
      genero: sku.genero,
      modelo: sku.modelo,
      status: sku.status,
      lancamento: sku.lancamento,
      ultimaEntrada: sku.ultimaEntrada,
      custo,
      pdvAtual: sku.pdvVar,
      pdvRealVar: sku.pdvVar,
      markupVar,
      pdvRealAta: sku.pdvAta,
      markupAta,
      estDisponivel: null,
      emProducao: round(sku.emProducao, 0),
      estPrevisto: null,
      estTt: round(sku.estTt, 0),
      giroTt1: round(sku.giroTt1, 0),
      giroTt3: round(sku.giroTt3, 0),
      giroTt6: round(sku.giroTt6, 0),
      branches: skuBranches,
    });
  }
  for (const row of rowsPaginadas) {
    row.skus.sort((a, b) => a.sku.localeCompare(b.sku));

    // Drill-down/visao por COR: materializado so pras referencias desta pagina (o
    // acumulado existe pra todas, mas virar objeto no payload so pras ~15 da pagina
    // mantem a resposta pequena - mesma razao de o detalhe por SKU ser paginado).
    const agg = referenciaAgg.get(row.referenceCode);
    row.cores = !agg
      ? []
      : [...agg.coresAgg.entries()]
          .map(([cor, corAgg]) => {
            const branchesCor: Record<number, RelatorioBaseColunaFilial> = {};
            for (const coluna of colunasAtivas) {
              const valores = corAgg.branchesAgg.get(coluna.branchCode) || { est: 0, giro: 0, mediaMensalSum: 0 };
              branchesCor[coluna.branchCode] = {
                est: round(valores.est, 0),
                giro: round(valores.giro, 0),
                cob: coberturaDe(valores.est, valores.mediaMensalSum),
              };
            }
            return {
              cor,
              refCor: `${row.referenceCode} - ${cor}`,
              coresOriginais: corAgg.coresOriginais.size,
              totalSkus: corAgg.totalSkus,
              custo: getConsistency(corAgg.consistency.custo),
              pdvRealVar: getConsistency(corAgg.consistency.pdvRealVar),
              markupVar: getConsistency(corAgg.consistency.markupVar),
              pdvRealAta: getConsistency(corAgg.consistency.pdvRealAta),
              markupAta: getConsistency(corAgg.consistency.markupAta),
              emProducao: round(corAgg.emProducao, 0),
              estTt: round(corAgg.estTt, 0),
              giroTt1: round(corAgg.giroTt1, 0),
              giroTt3: round(corAgg.giroTt3, 0),
              giroTt6: round(corAgg.giroTt6, 0),
              branches: branchesCor,
            };
          })
          .sort((a, b) => b.giroTt3 - a.giroTt3 || a.cor.localeCompare(b.cor, 'pt-BR'));
  }

  function montarLinhaMatriz(label: string, acc: BucketAcc): RelatorioBaseMatrizLinha {
    const mediaMensalVarejo = acc.vendaVarejo;
    const mediaMensalAtacado = acc.vendaAtacado;
    const mediaMensalGeral = acc.vendaVarejo + acc.vendaAtacado;
    return {
      label,
      referencias: [],
      estoqueVarejo: round(acc.estVarejo, 0),
      estoqueAtacado: round(acc.estAtacado, 0),
      estoqueTotal: round(acc.estVarejo + acc.estAtacado, 0),
      valorEstoque: round(acc.valorEstoque, 2),
      vendaVarejo: round(acc.vendaVarejo, 0),
      vendaAtacado: round(acc.vendaAtacado, 0),
      vendaTotal: round(acc.vendaVarejo + acc.vendaAtacado, 0),
      coberturaVarejo: coberturaDe(acc.estVarejo, mediaMensalVarejo),
      coberturaAtacado: coberturaDe(acc.estAtacado, mediaMensalAtacado),
      coberturaGeral: coberturaDe(acc.estVarejo + acc.estAtacado, mediaMensalGeral),
    };
  }

  function buildMatriz(agg: Map<string, BucketAcc>, dimensao: string): RelatorioBaseMatrizLinha[] {
    const entradas = [...agg.entries()].sort(
      (a, b) => b[1].estVarejo + b[1].estAtacado - (a[1].estVarejo + a[1].estAtacado) || a[0].localeCompare(b[0], 'pt-BR')
    );
    const linhas = entradas.map(([label, acc]) => ({
      ...montarLinhaMatriz(label, acc), referencias: referenciasMatriz.consultar(dimensao, label),
    }));
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

  const matrizLinha = buildMatriz(matrizLinhaAgg, 'linha');
  const matrizLinhaCompleta = buildMatriz(matrizLinhaCompletaAgg, 'linhaCompleta');
  const matrizCategoria = buildMatriz(matrizCategoriaAgg, 'categoria');
  const matrizGenero = buildMatriz(matrizGeneroAgg, 'genero');
  const matrizStatus = buildMatriz(matrizStatusAgg, 'status');
  function coberturaPorLabel(linhas: RelatorioBaseMatrizLinha[], label: string): number | null {
    const labelNormalizado = normalizarClassificacao(label);
    return linhas.find((l) => normalizarClassificacao(l.label) === labelNormalizado)?.coberturaGeral ?? null;
  }

  const statusBreakdown = [...statusAgg.entries()]
    .map(([status, qtd]) => ({
      status,
      estTt: round(qtd, 0),
      percent: kpis.estTt > 0 ? round((qtd / kpis.estTt) * 100, 1) : 0,
    }))
    .sort((a, b) => b.estTt - a.estTt);
  const giroAnualizado =
    kpis.estTt > 0 && kpis.giroTt1 > 0 ? round((kpis.giroTt1 * 12) / kpis.estTt, 2) : 0;
  const valorEstoqueAnoAnterior = filtro.incluirComparativoAnoAnterior === false
    ? null : await getValorEstoqueAnoAnterior(filtro, dataAnalitica, possuiMarcador);
  const valorEstoqueVariacaoPercent =
    valorEstoqueAnoAnterior !== null && valorEstoqueAnoAnterior > 0 ? round(((valorEstoqueTotal - valorEstoqueAnoAnterior) / valorEstoqueAnoAnterior) * 100, 1) : null;
  const estoqueAtivos = montarIndicadoresEstoqueAtivos(estoqueAtivosAcc);

  return {
    dataPosicao: dataAnalitica,
    producao: producao.info,
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
      giroTt30: round(kpis.giroTt30, 0),
      giroTt60: round(kpis.giroTt60, 0),
      giroTt90: round(kpis.giroTt90, 0),
      estTt: round(kpis.estTt, 0),
      skuCount: kpis.skuCount,
    },
    kpisExtra: {
      coberturaGeral: coberturaDe(estVarejoTotal + estAtacadoTotal, vendaVarejoTotal + vendaAtacadoTotal),
      coberturaVarejo: coberturaDe(estVarejoTotal, vendaVarejoTotal),
      coberturaAtacado: coberturaDe(estAtacadoTotal, vendaAtacadoTotal),
      giroAnualizado,
      valorEstoqueTotal: round(valorEstoqueTotal, 2),
      valorEstoqueAnoAnterior: valorEstoqueAnoAnterior === null ? null : round(valorEstoqueAnoAnterior, 2),
      valorEstoqueVariacaoPercent,
      estoqueMortoQtd: round(estoqueMortoQtd, 0),
      estoqueMortoValor: round(estoqueMortoValor, 2),
      estoqueMortoPercent: kpis.estTt > 0 ? round((round(estoqueMortoQtd, 0) / kpis.estTt) * 100, 2) : 0,
      estoquePromocaoQtd: round(estoquePromocaoQtd, 0),
      estoquePromocaoValor: round(estoquePromocaoValor, 2),
      estoquePromocaoPercent: valorEstoqueTotal > 0 ? round((estoquePromocaoValor / valorEstoqueTotal) * 100, 1) : 0,
      coberturaBasico: coberturaPorLabel(matrizLinha, LINHA_BUCKET_BASICO),
      coberturaBasicoRenovavel: coberturaPorLabel(matrizLinha, LINHA_BUCKET_BASICO_RENOVAVEL),
      coberturaColecao: coberturaPorLabel(matrizLinha, LINHA_BUCKET_COLECAO),
      referenciasComEstoque: estoqueAtivos.referencias.comEstoque,
      estoqueAtivos,
      ...calcularEstoqueAnaliseReferencias(estoqueAnaliseReferencias, kpis.estTt, valorEstoqueTotal),
      ruptura: {
        basico: montarRupturaLinhaKpi(rupturaBasicoAcc),
        renovavel: montarRupturaLinhaKpi(rupturaRenovavelAcc),
      },
      statusBreakdown,
    },
    matriz: {
      linha: matrizLinha,
      linhaCompleta: matrizLinhaCompleta,
      categoria: matrizCategoria,
      genero: matrizGenero,
      status: matrizStatus,
    },
    pagination: { page, pageSize, totalReferencias, totalPages },
    colunas: selecionarColunasRelatorioBase(colunasAtivas, lojasComValores),
    rows: aplicarDisponibilidadeProducao(rowsPaginadas, producao.info),
  };
}

export async function getRelatorioBase(filtro: RelatorioBaseFiltro): Promise<RelatorioBaseResponse> {
  const config = await getConfig();
  const analitico = await getRelatorioBaseAnalitico(filtro, config);
  if (analitico) return analitico;

  if (!filtro.dataPosicao) {
    const [data] = await prisma.$queryRaw<Array<{ data: string }>>`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS data`;
    filtro = { ...filtro, dataPosicao: data.data };
  }

  const branchFiltro = filtro.branches && filtro.branches.length > 0 ? new Set(filtro.branches) : null;

  // Mapeamento de branch para busca de dados: ATACADO_BRANCH_CODE (-2) é um código sintético
  // que representa o canal Atacado. Os dados de estoque/giro estão gravados com
  // FABRICA_BRANCH_CODE (2). Quando o usuário filtra por Atacado, precisamos buscar os
  // dados da Fábrica. Este Set é usado para verificar se um branch_code do banco bate
  // com o filtro do usuário, mapeando -2 -> 2.
  // As queries normalizam a filial 02 para DPA (-1) ou ATACADO (-2).
  const branchFiltroParaDados = branchFiltro;

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

  // Limita as consultas simultaneas: disparar as 16 de uma vez esgotava o pool
  // enquanto as consultas mais longas ainda estavam rodando (Prisma P2024).
  const [estoqueRows, valorEstoqueAnoAnterior, giroRows, giroAtacadoRows] = await Promise.all([
    getEstoqueRows(productSkusFiltro, filtro.dataPosicao),
    filtro.incluirComparativoAnoAnterior === false ? Promise.resolve(null) : getValorEstoqueAnoAnterior(filtro),
    getGiroRows(config.giroDias, productCodesFiltro, filtro.dataPosicao),
    getGiroAtacadoRows(config.giroDias, productCodesFiltro, filtro.dataPosicao),
  ]);
  const [vendaMesesRows, vendaAtacadoMesesRows, giroTt30Total, giroTt60Total] = await Promise.all([
    getVendaPorMesesRows(config.coberturaMeses, productCodesFiltro, filtro.dataPosicao),
    config.atacadoCoberturaBase === 'atacado_only' ? getVendaAtacadoPorMesesRows(config.coberturaMeses, productCodesFiltro, filtro.dataPosicao) : Promise.resolve([]),
    getGiroTotalDias(30, productCodesFiltro, filtro.branches || null, filtro.dataPosicao),
    getGiroTotalDias(60, productCodesFiltro, filtro.branches || null, filtro.dataPosicao),
  ]);
  const [giroTt90Total, giroTt1Rows, giroTt2Rows, giroTt3Rows, giroTt6Rows] = await Promise.all([
    getGiroTotalDias(90, productCodesFiltro, filtro.branches || null, filtro.dataPosicao),
    getGiroTtRows(1, productCodesFiltro, filtro.dataPosicao),
    getGiroTtRows(2, productCodesFiltro, filtro.dataPosicao),
    getGiroTtRows(3, productCodesFiltro, filtro.dataPosicao),
    getGiroTtRows(6, productCodesFiltro, filtro.dataPosicao),
  ]);
  const [custoPrecoRows, ultimaEntradaRows, custoSelecionadoRows, producao] = await Promise.all([
    getCustoPrecoRows(config.precoCustoBranchCode, config.pdvVarejoCode, config.pdvAtacadoCode, productCodesFiltro),
    getUltimaEntradaRows(productCodesFiltro, filtro.dataPosicao),
    getCustoProducaoRows(productCodesFiltro),
    getProducaoRelatorio(filtro.dataPosicao!),
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

  // Giro TT por product_code x branch_code, permitindo filtrar por loja nos cards KPIs
  // (SKUs, Estoque Total, Giro TT 1/3/6).
  const giroTt1PorProductCode = new Map<number, Map<number, number>>();
  for (const r of giroTt1Rows) {
    const mapa = giroTt1PorProductCode.get(r.product_code) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade));
    giroTt1PorProductCode.set(r.product_code, mapa);
  }
  const giroTt2PorProductCode = new Map<number, Map<number, number>>();
  for (const r of giroTt2Rows) {
    const mapa = giroTt2PorProductCode.get(r.product_code) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade));
    giroTt2PorProductCode.set(r.product_code, mapa);
  }
  const giroTt3PorProductCode = new Map<number, Map<number, number>>();
  for (const r of giroTt3Rows) {
    const mapa = giroTt3PorProductCode.get(r.product_code) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade));
    giroTt3PorProductCode.set(r.product_code, mapa);
  }
  const giroTt6PorProductCode = new Map<number, Map<number, number>>();
  for (const r of giroTt6Rows) {
    const mapa = giroTt6PorProductCode.get(r.product_code) || new Map<number, number>();
    mapa.set(r.branch_code, decimalToNumber(r.quantidade));
    giroTt6PorProductCode.set(r.product_code, mapa);
  }

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

  const custoSelecionadoPorProductCode = new Map<number, number>();
  for (const r of custoSelecionadoRows) custoSelecionadoPorProductCode.set(r.product_code, decimalToNumber(r.valor));

  const emProducaoPorProductCode = new Map<number, number>();
  for (const r of producao.rows) emProducaoPorProductCode.set(r.product_code, decimalToNumber(r.quantidade));
  const canonicosProducao = skusCanonicosProducao(identidadeRows);

  // Soma valores de um mapa branch_code -> valor, respeitando o filtro de filiais.
  // Se branchFiltro for null (nenhum filtro), soma todas as filiais.
  function somaMapaFiltrado(mapa: Map<number, number> | undefined, filtro: Set<number> | null): number {
    if (!mapa) return 0;
    let soma = 0;
    if (filtro) {
      for (const [branchCode, valor] of mapa) {
        if (filtro.has(branchCode)) soma += valor;
      }
    } else {
      for (const valor of mapa.values()) soma += valor;
    }
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
    const bucket = chave?.trim() || MATRIZ_SEM_CLASSIFICACAO;
    const acc = mapa.get(bucket) || bucketVazio();
    acc.estVarejo += valores.estVarejo;
    acc.estAtacado += valores.estAtacado;
    acc.vendaVarejo += valores.vendaVarejo;
    acc.vendaAtacado += valores.vendaAtacado;
    acc.valorEstoque += valores.valorEstoque;
    mapa.set(bucket, acc);
  }

  const referenciasMatriz = new ReferenciasMatriz();
  const matrizLinhaAgg = new Map<string, BucketAcc>();
  const matrizLinhaCompletaAgg = new Map<string, BucketAcc>();
  const matrizCategoriaAgg = new Map<string, BucketAcc>();
  const matrizGeneroAgg = new Map<string, BucketAcc>();
  const matrizStatusAgg = new Map<string, BucketAcc>();
  const statusAgg = new Map<string, number>(); // balde de status -> soma de estTt
  let valorEstoqueTotal = 0;
  let estVarejoTotal = 0;
  let estAtacadoTotal = 0;
  let vendaVarejoTotal = 0;
  let vendaAtacadoTotal = 0;
  let estoqueMortoQtd = 0;
  let estoqueMortoValor = 0;
  let estoquePromocaoQtd = 0;
  let estoquePromocaoValor = 0;
  const estoqueAnaliseReferencias = new Map<string, EstoqueAnaliseReferencia>();
  const rupturaBasicoAcc = rupturaLinhaAccVazio();
  const rupturaRenovavelAcc = rupturaLinhaAccVazio();
  const estoqueAtivosAcc = new Map<string, EstoqueAtivoSku>();
  const lojasComValores = new Set<number>();

  const colunasAtivas = (await getColunasEstoque()).filter((c) => !branchFiltro || branchFiltro.has(c.branchCode));

  // Agregacao por referencia, construida no mesmo loop dos SKUs pra nao duplicar os
  // lookups - cada referencia acumula est/giro por filial (pra recalcular cobertura
  // certa, nao so somar a cobertura ja arredondada de cada SKU). Nao guardamos todos
  // os SKUs detalhados na memoria; isso estourava heap no Render antes da paginacao.
  interface ConsistencyState {
    value: number | null | undefined;
    inconsistent: boolean;
  }
  type ConsistencyKey = 'custo' | 'pdvAtual' | 'pdvRealVar' | 'markupVar' | 'pdvRealAta' | 'markupAta';
  function emptyConsistency(): Record<ConsistencyKey, ConsistencyState> {
    return {
      custo: { value: undefined, inconsistent: false },
      pdvAtual: { value: undefined, inconsistent: false },
      pdvRealVar: { value: undefined, inconsistent: false },
      markupVar: { value: undefined, inconsistent: false },
      pdvRealAta: { value: undefined, inconsistent: false },
      markupAta: { value: undefined, inconsistent: false },
    };
  }
  function addConsistency(state: ConsistencyState, value: number | null) {
    if (value === null || state.inconsistent) return;
    if (state.value === undefined) state.value = value;
    else if (state.value !== value) state.inconsistent = true;
  }
  function getConsistency(state: ConsistencyState): number | null {
    if (state.inconsistent) return null;
    return state.value ?? null;
  }

  // Acumulado de uma COR dentro da referencia (drill-down leve, no lugar do antigo por
  // SKU). coresOriginais e um Set pra saber quantas cores do TOTVS viraram essa linha
  // quando o Agrupamento de Cores esta ligado.
  interface CorAcumulado {
    coresOriginais: Set<string>;
    totalSkus: number;
    emProducao: number;
    estTt: number;
    giroTt1: number;
    giroTt3: number;
    giroTt6: number;
    consistency: Record<ConsistencyKey, ConsistencyState>;
    branchesAgg: Map<number, { est: number; giro: number; mediaMensalSum: number }>;
  }

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
    totalSkus: number;
    consistency: Record<ConsistencyKey, ConsistencyState>;
    branchesAgg: Map<number, { est: number; giro: number; mediaMensalSum: number }>;
    coresAgg: Map<string, CorAcumulado>;
  }
  const referenciaAgg = new Map<string, RefAgg>();
  const kpis = { giroTt1: 0, giroTt3: 0, giroTt6: 0, estTt: 0, skuCount: 0 };
  const agruparPorCorSalva = filtro.agruparPorCorSalva ?? false;

  for (const identidade of identidadeRows) {
    const sku = identidade.product_sku;
    const productCode = identidade.product_code;
    const estoqueDoSku = estoquePorSku.get(sku) || new Map<number, number>();
    const giroDoProduto = productCode !== null ? giroPorProductCode.get(productCode) : undefined;
    const vendaMesesDoProduto = productCode !== null ? vendaMesesPorProductCode.get(productCode) : undefined;

    // EST.TT = soma das filiais selecionadas no filtro (ou todas se nenhuma selecionada).
    // Quando ha filtro de branch, soma so o estoque das lojas filtradas - assim os cards
    // "SKUs" e "Estoque Total" refletem a selecao do usuario.
    // Usa branchFiltroParaDados que mapeia ATACADO (-2) -> FABRICA (2) pois os dados do
    // banco usam branch_code=2 para a Fabrica/Atacado.
    let estTt = 0;
    if (branchFiltroParaDados) {
      for (const [branchCode, valor] of estoqueDoSku) {
        if (branchFiltroParaDados.has(branchCode)) estTt += valor;
      }
    } else {
      for (const valor of estoqueDoSku.values()) estTt += valor;
    }

    const branches: Record<number, RelatorioBaseColunaFilial> = {};
    const mediaMensalPorBranchDoSku = new Map<number, number>();
    const venda30PorBranchDoSku = new Map<number, number>();
    const giroTt1DoProduto = productCode !== null ? giroTt1PorProductCode.get(productCode) : undefined;
    for (const coluna of colunasAtivas) {
      if (coluna.branchCode === ATACADO_BRANCH_CODE) {
        const estFabrica = estoqueDoSku.get(ATACADO_BRANCH_CODE) || 0;
        const giroAtacado = productCode !== null ? giroAtacadoPorProductCode.get(productCode) || 0 : 0;
        const mediaMensalAtacado =
          config.atacadoCoberturaBase === 'atacado_only'
            ? (productCode !== null ? vendaAtacadoMesesPorProductCode.get(productCode) || 0 : 0) / config.coberturaMeses
            : (vendaMesesDoProduto?.get(ATACADO_BRANCH_CODE) || 0) / config.coberturaMeses;

        branches[coluna.branchCode] = {
          giro: round(giroAtacado, 0),
          est: round(estFabrica, 0),
          cob: coberturaDe(estFabrica, mediaMensalAtacado),
        };
        mediaMensalPorBranchDoSku.set(coluna.branchCode, mediaMensalAtacado);
        venda30PorBranchDoSku.set(coluna.branchCode, giroTt1DoProduto?.get(ATACADO_BRANCH_CODE) || 0);
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
      venda30PorBranchDoSku.set(coluna.branchCode, giroTt1DoProduto?.get(coluna.branchCode) || 0);
    }

    // Giro TT respeita o filtro de loja - se filtrado por branch, soma so o giro das
    // lojas selecionadas. Assim os cards "Giro TT 1/3/6" ficam coerentes com "Estoque Total".
    // Usa branchFiltroParaDados que mapeia ATACADO (-2) -> FABRICA (2).
    const giroTt1 = productCode !== null ? somaMapaFiltrado(giroTt1PorProductCode.get(productCode), branchFiltroParaDados) : 0;
    const giroTt2 = productCode !== null ? somaMapaFiltrado(giroTt2PorProductCode.get(productCode), branchFiltroParaDados) : 0;
    const giroTt3 = productCode !== null ? somaMapaFiltrado(giroTt3PorProductCode.get(productCode), branchFiltroParaDados) : 0;
    const giroTt6 = productCode !== null ? somaMapaFiltrado(giroTt6PorProductCode.get(productCode), branchFiltroParaDados) : 0;

    const custoPreco = productCode !== null ? custoPrecoPorProductCode.get(productCode) : undefined;
    const custo = custoPreco?.custo ?? null;
    const pdvRealVar = custoPreco?.pdvVar ?? null;
    const pdvRealAta = custoPreco?.pdvAta ?? null;

    const ultimaEntradaData = productCode !== null ? ultimaEntradaPorProductCode.get(productCode) : undefined;
    const ultimaEntrada = ultimaEntradaData ? ultimaEntradaData.toISOString().slice(0, 10) : null;

    const custoSelecionado = productCode !== null ? custoSelecionadoPorProductCode.get(productCode) ?? null : null;
    const emProducao = productCode !== null && canonicosProducao.get(productCode) === sku
      ? emProducaoPorProductCode.get(productCode) || 0 : 0;

    // Totais brutos: todo SKU elegivel entra na tabela/card, mesmo com estoque zero,
    // estoque negativo ou sem venda/giro recente. Isso evita divergencia entre o card
    // Estoque Total e os totalizadores das tabelas.
    const estAtacadoSku = branches[ATACADO_BRANCH_CODE]?.est ?? 0;
    let estVarejoSku = 0;
    let vendaVarejoSku = 0;
    for (const coluna of colunasAtivas) {
      const valores = branches[coluna.branchCode];
      if (valores && (valores.est !== 0 || valores.giro !== 0)) lojasComValores.add(coluna.branchCode);
      if (coluna.branchCode === ATACADO_BRANCH_CODE) continue;
      estVarejoSku += branches[coluna.branchCode]?.est ?? 0;
      vendaVarejoSku += venda30PorBranchDoSku.get(coluna.branchCode) || 0;
    }
    const vendaAtacadoSku = venda30PorBranchDoSku.get(ATACADO_BRANCH_CODE) || 0;
    const valorEstoqueSku = estTt * (custo ?? 0);

    valorEstoqueTotal += valorEstoqueSku;
    estVarejoTotal += estVarejoSku;
    estAtacadoTotal += estAtacadoSku;
    vendaVarejoTotal += vendaVarejoSku;
    vendaAtacadoTotal += vendaAtacadoSku;

    const statusTrim = identidade.status?.trim().replace(/\s+/g, ' ').toUpperCase() || null;
    let statusBucketKey: string;
    if (statusTrim === 'FORA DE LINHA') statusBucketKey = 'FORA DE LINHA';
    else if (statusTrim?.startsWith('FORA DE LINHA')) statusBucketKey = 'FORA DE LINHA PROMOCAO';
    else if (statusTrim === 'ATIVO') statusBucketKey = 'ATIVO';
    else if (statusTrim === 'INATIVO') statusBucketKey = 'INATIVO';
    else statusBucketKey = 'OUTROS';
    const statusApresentacao = statusBucketKey.startsWith('FORA DE LINHA') ? 'FORA DE LINHA' : statusBucketKey;
    statusAgg.set(statusApresentacao, (statusAgg.get(statusApresentacao) || 0) + estTt);
    if (temCoberturaCritica(estTt, giroTt1)) {
      estoqueMortoQtd += estTt;
      estoqueMortoValor += valorEstoqueSku;
    }
    const referenceCodeParaKpi = identidade.reference_code || sku;
    acumularEstoqueAnaliseReferencia(estoqueAnaliseReferencias, referenceCodeParaKpi, estTt, valorEstoqueSku, giroTt1, giroTt2, giroTt3);
    acumularRuptura(rupturaBasicoAcc, rupturaRenovavelAcc, identidade.linha, identidade.status, estTt);
    acumularEstoqueAtivos(estoqueAtivosAcc, sku, referenceCodeParaKpi, identidade.linha, identidade.status, estTt);
    if (statusBucketKey === 'FORA DE LINHA PROMOCAO') {
      estoquePromocaoQtd += estTt;
      estoquePromocaoValor += valorEstoqueSku;
    }

    const bucketValores: BucketAcc = {
      estVarejo: estVarejoSku,
      estAtacado: estAtacadoSku,
      vendaVarejo: vendaVarejoSku,
      vendaAtacado: vendaAtacadoSku,
      valorEstoque: valorEstoqueSku,
    };
    acumularBucket(matrizLinhaAgg, linhaBucket(identidade.linha), bucketValores);
    acumularBucket(matrizLinhaCompletaAgg, identidade.linha?.trim() || null, bucketValores);
    acumularBucket(matrizCategoriaAgg, identidade.categoria?.trim() || null, bucketValores);
    acumularBucket(matrizGeneroAgg, identidade.genero?.trim() || null, bucketValores);
    acumularBucket(matrizStatusAgg, agruparStatus(identidade.status), bucketValores);
    for (const [dimensao, label] of [
      ['linha', linhaBucket(identidade.linha)], ['linhaCompleta', identidade.linha],
      ['categoria', identidade.categoria], ['genero', identidade.genero],
      ['status', agruparStatus(identidade.status)],
    ] as const) {
      referenciasMatriz.acumular(dimensao, label, identidade.reference_code || sku, identidade.reference_name || identidade.reference_code || sku,
        identidade.status, estVarejoSku + estAtacadoSku);
    }

    // Referencia/cor/tamanho vem do produto_analitico - fallback pro proprio SKU quando
    // reference_code vier nulo (dado incompleto), pra nao perder a linha, so vira uma
    // "referencia" de 1 SKU so.
    const referenceCode = identidade.reference_code || sku;
    const referenceName = identidade.reference_name || referenceCode;
    const emProducaoRound = round(emProducao, 0);
    const estTtRound = round(estTt, 0);
    const giroTt1Round = round(giroTt1, 0);
    const giroTt3Round = round(giroTt3, 0);
    const giroTt6Round = round(giroTt6, 0);
    const markupVar = markupPercentual(pdvRealVar, custoSelecionado);
    const markupAta = markupPercentual(pdvRealAta, custoSelecionado);

    kpis.giroTt1 += giroTt1Round;
    kpis.giroTt3 += giroTt3Round;
    kpis.giroTt6 += giroTt6Round;
    kpis.estTt += estTtRound;
    kpis.skuCount += 1;

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
      totalSkus: 0,
      consistency: emptyConsistency(),
      branchesAgg: new Map<number, { est: number; giro: number; mediaMensalSum: number }>(),
      coresAgg: new Map<string, CorAcumulado>(),
    };

    // Drill-down por COR (substitui o antigo por SKU, que foi removido por memoria): a
    // cor e o nome do grupo do Agrupamento de Cores quando o toggle esta ligado e
    // aquela cor foi agrupada, senao a cor original do TOTVS.
    const corOriginal = identidade.color_name?.trim() || identidade.color_code?.trim() || 'SEM COR';
    const corExibicao = agruparPorCorSalva ? (identidade.cor_agrupada?.trim() || corOriginal) : corOriginal;
    const corAgg = agg.coresAgg.get(corExibicao) || {
      coresOriginais: new Set<string>(),
      totalSkus: 0,
      emProducao: 0,
      estTt: 0,
      giroTt1: 0,
      giroTt3: 0,
      giroTt6: 0,
      consistency: emptyConsistency(),
      branchesAgg: new Map<number, { est: number; giro: number; mediaMensalSum: number }>(),
    };
    corAgg.coresOriginais.add(corOriginal);
    corAgg.totalSkus += 1;
    corAgg.emProducao += emProducaoRound;
    corAgg.estTt += estTtRound;
    corAgg.giroTt1 += giroTt1Round;
    corAgg.giroTt3 += giroTt3Round;
    corAgg.giroTt6 += giroTt6Round;
    addConsistency(corAgg.consistency.custo, custo);
    addConsistency(corAgg.consistency.pdvRealVar, pdvRealVar);
    addConsistency(corAgg.consistency.markupVar, markupVar);
    addConsistency(corAgg.consistency.pdvRealAta, pdvRealAta);
    addConsistency(corAgg.consistency.markupAta, markupAta);
    for (const coluna of colunasAtivas) {
      const acumulado = corAgg.branchesAgg.get(coluna.branchCode) || { est: 0, giro: 0, mediaMensalSum: 0 };
      acumulado.est += branches[coluna.branchCode].est;
      acumulado.giro += branches[coluna.branchCode].giro;
      acumulado.mediaMensalSum += mediaMensalPorBranchDoSku.get(coluna.branchCode) || 0;
      corAgg.branchesAgg.set(coluna.branchCode, acumulado);
    }
    agg.coresAgg.set(corExibicao, corAgg);
    agg.emProducao += emProducaoRound;
    agg.estTt += estTtRound;
    agg.giroTt1 += giroTt1Round;
    agg.giroTt3 += giroTt3Round;
    agg.giroTt6 += giroTt6Round;
    agg.totalSkus += 1;
    addConsistency(agg.consistency.custo, custo);
    addConsistency(agg.consistency.pdvAtual, pdvRealVar);
    addConsistency(agg.consistency.pdvRealVar, pdvRealVar);
    addConsistency(agg.consistency.markupVar, markupVar);
    addConsistency(agg.consistency.pdvRealAta, pdvRealAta);
    addConsistency(agg.consistency.markupAta, markupAta);
    if (ultimaEntrada && (!agg.ultimaEntrada || ultimaEntrada > agg.ultimaEntrada)) agg.ultimaEntrada = ultimaEntrada;
    for (const coluna of colunasAtivas) {
      const acumulado = agg.branchesAgg.get(coluna.branchCode) || { est: 0, giro: 0, mediaMensalSum: 0 };
      acumulado.est += branches[coluna.branchCode].est;
      acumulado.giro += branches[coluna.branchCode].giro;
      acumulado.mediaMensalSum += mediaMensalPorBranchDoSku.get(coluna.branchCode) || 0;
      agg.branchesAgg.set(coluna.branchCode, acumulado);
    }
    referenciaAgg.set(referenceCode, agg);
  }

  // Materializa as linhas de cor de uma referencia. Chamado so pras referencias da
  // pagina atual (ver mais abaixo) - o mapa de acumulados existe pra todas, mas virar
  // objeto no payload so pra ~15 referencias mantem a resposta pequena.
  function materializarCores(agg: RefAgg, referenceCode: string): RelatorioBaseCorRow[] {
    return [...agg.coresAgg.entries()]
      .map(([cor, corAgg]) => {
        const branchesCor: Record<number, RelatorioBaseColunaFilial> = {};
        for (const [branchCode, valores] of corAgg.branchesAgg) {
          branchesCor[branchCode] = {
            est: round(valores.est, 0),
            giro: round(valores.giro, 0),
            cob: coberturaDe(valores.est, valores.mediaMensalSum),
          };
        }
        return {
          cor,
          refCor: `${referenceCode} - ${cor}`,
          coresOriginais: corAgg.coresOriginais.size,
          totalSkus: corAgg.totalSkus,
          custo: getConsistency(corAgg.consistency.custo),
          pdvRealVar: getConsistency(corAgg.consistency.pdvRealVar),
          markupVar: getConsistency(corAgg.consistency.markupVar),
          pdvRealAta: getConsistency(corAgg.consistency.pdvRealAta),
          markupAta: getConsistency(corAgg.consistency.markupAta),
          emProducao: round(corAgg.emProducao, 0),
          estTt: round(corAgg.estTt, 0),
          giroTt1: round(corAgg.giroTt1, 0),
          giroTt3: round(corAgg.giroTt3, 0),
          giroTt6: round(corAgg.giroTt6, 0),
          branches: branchesCor,
        };
      })
      .sort((a, b) => b.giroTt3 - a.giroTt3 || a.cor.localeCompare(b.cor, 'pt-BR'));
  }

  const rows: RelatorioBaseReferenciaRow[] = [];
  const aggPorReferencia = new Map<string, RefAgg>();
  for (const [referenceCode, agg] of referenciaAgg) {
    const branches: Record<number, RelatorioBaseColunaFilial> = {};
    for (const [branchCode, valores] of agg.branchesAgg) {
      branches[branchCode] = {
        est: round(valores.est, 0),
        giro: round(valores.giro, 0),
        cob: coberturaDe(valores.est, valores.mediaMensalSum),
      };
    }
    aggPorReferencia.set(referenceCode, agg);
    rows.push({
      referenceCode,
      referenceName: agg.referenceName,
      totalSkus: agg.totalSkus,
      descricao: agg.referenceName,
      descricaoCompleta: agg.referenceName,
      categoria: agg.categoria,
      linha: agg.linha,
      genero: agg.genero,
      modelo: agg.modelo,
      status: agg.status,
      lancamento: agg.lancamento,
      ultimaEntrada: agg.ultimaEntrada,
      custo: getConsistency(agg.consistency.custo),
      pdvAtual: getConsistency(agg.consistency.pdvAtual),
      pdvRealVar: getConsistency(agg.consistency.pdvRealVar),
      markupVar: getConsistency(agg.consistency.markupVar),
      pdvRealAta: getConsistency(agg.consistency.pdvRealAta),
      markupAta: getConsistency(agg.consistency.markupAta),
      emProducao: round(agg.emProducao, 0),
      estTt: round(agg.estTt, 0),
      giroTt1: round(agg.giroTt1, 0),
      giroTt3: round(agg.giroTt3, 0),
      giroTt6: round(agg.giroTt6, 0),
      branches,
      skus: [],
      cores: [],
    });
  }

  // A ordem por estoque precisa ser aplicada antes de selecionar a página.
  rows.sort(ordenarPorEstoque);

  // Paginacao real por referencia (substitui o antigo "rank" Top 50/100/250/Todos, que
  // o usuario pediu pra tirar - "muito ruim... crie paginacoes"). pageSize grande e um
  // uso valido (ex: exportar tudo numa pagina so), nao precisa de sentinel especial.
  const pageSize = filtro.pageSize && filtro.pageSize > 0 ? filtro.pageSize : 15;
  const totalReferencias = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalReferencias / pageSize));
  const page = filtro.page && filtro.page > 0 ? Math.min(filtro.page, totalPages) : 1;
  const rowsPaginadas = rows.slice((page - 1) * pageSize, page * pageSize);
  const rowsPorReferencia = new Map(rowsPaginadas.map((row) => [row.referenceCode, row]));
  for (const identidade of identidadeRows) {
    const referenceCode = identidade.reference_code || identidade.product_sku;
    const row = rowsPorReferencia.get(referenceCode);
    if (!row) continue;

    const sku = identidade.product_sku;
    const productCode = identidade.product_code;
    const estoqueDoSku = estoquePorSku.get(sku) || new Map<number, number>();
    const giroDoProduto = productCode !== null ? giroPorProductCode.get(productCode) : undefined;
    const vendaMesesDoProduto = productCode !== null ? vendaMesesPorProductCode.get(productCode) : undefined;

    let estTt = 0;
    if (branchFiltroParaDados) {
      for (const [branchCode, valor] of estoqueDoSku) {
        if (branchFiltroParaDados.has(branchCode)) estTt += valor;
      }
    } else {
      for (const valor of estoqueDoSku.values()) estTt += valor;
    }

    const branches: Record<number, RelatorioBaseColunaFilial> = {};
    for (const coluna of colunasAtivas) {
      if (coluna.branchCode === ATACADO_BRANCH_CODE) {
        const estFabrica = estoqueDoSku.get(ATACADO_BRANCH_CODE) || 0;
        const giroAtacado = productCode !== null ? giroAtacadoPorProductCode.get(productCode) || 0 : 0;
        const mediaMensalAtacado =
          config.atacadoCoberturaBase === 'atacado_only'
            ? (productCode !== null ? vendaAtacadoMesesPorProductCode.get(productCode) || 0 : 0) / config.coberturaMeses
            : (vendaMesesDoProduto?.get(ATACADO_BRANCH_CODE) || 0) / config.coberturaMeses;

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

    const giroTt1 = productCode !== null ? somaMapaFiltrado(giroTt1PorProductCode.get(productCode), branchFiltroParaDados) : 0;
    const giroTt3 = productCode !== null ? somaMapaFiltrado(giroTt3PorProductCode.get(productCode), branchFiltroParaDados) : 0;
    const giroTt6 = productCode !== null ? somaMapaFiltrado(giroTt6PorProductCode.get(productCode), branchFiltroParaDados) : 0;
    const custoPreco = productCode !== null ? custoPrecoPorProductCode.get(productCode) : undefined;
    const custo = custoPreco?.custo ?? null;
    const pdvRealVar = custoPreco?.pdvVar ?? null;
    const pdvRealAta = custoPreco?.pdvAta ?? null;
    const custoSelecionado = productCode !== null ? custoSelecionadoPorProductCode.get(productCode) ?? null : null;
    const ultimaEntradaData = productCode !== null ? ultimaEntradaPorProductCode.get(productCode) : undefined;
    const ultimaEntrada = ultimaEntradaData ? ultimaEntradaData.toISOString().slice(0, 10) : null;
    const emProducao = productCode !== null && canonicosProducao.get(productCode) === sku
      ? emProducaoPorProductCode.get(productCode) || 0 : 0;

    const cor = identidade.color_name || identidade.color_code || 'SEM COR';
    const tamanho = identidade.size || 'SEM TAM';
    row.skus.push({
      sku,
      codigo: productCode,
      referenceCode,
      cor,
      tamanho,
      refCorTam: buildRefCorTam(referenceCode, cor, tamanho),
      descricao: identidade.descricao || identidade.reference_name || sku,
      descricaoCompleta: identidade.descricao_completa || identidade.descricao || identidade.reference_name || sku,
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
      markupVar: markupPercentual(pdvRealVar, custoSelecionado),
      pdvRealAta,
      markupAta: markupPercentual(pdvRealAta, custoSelecionado),
      estDisponivel: null,
      emProducao: round(emProducao, 0),
      estPrevisto: null,
      estTt: round(estTt, 0),
      giroTt1: round(giroTt1, 0),
      giroTt3: round(giroTt3, 0),
      giroTt6: round(giroTt6, 0),
      branches,
    });
  }
  for (const row of rowsPaginadas) {
    row.skus.sort((a, b) => a.refCorTam.localeCompare(b.refCorTam));
  }

  // Drill-down por cor entra so nas referencias que vao de fato na resposta - foi por
  // isso que o detalhamento por SKU foi removido (payload/heap). Por cor ja e ~1 ordem
  // de grandeza menor, e limitar a pagina mantem o custo baixo mesmo em export grande.
  for (const row of rowsPaginadas) {
    const agg = aggPorReferencia.get(row.referenceCode);
    if (agg) row.cores = materializarCores(agg, row.referenceCode);
  }

  // Monta uma linha da matriz (usada tanto por linha/categoria/genero quanto pro
  // "Total" agregado) - cobertura recalculada aqui, nao somada ja arredondada.
  function montarLinhaMatriz(label: string, acc: BucketAcc): RelatorioBaseMatrizLinha {
    const mediaMensalVarejo = acc.vendaVarejo;
    const mediaMensalAtacado = acc.vendaAtacado;
    const mediaMensalGeral = acc.vendaVarejo + acc.vendaAtacado;
    return {
      label,
      referencias: [],
      estoqueVarejo: round(acc.estVarejo, 0),
      estoqueAtacado: round(acc.estAtacado, 0),
      estoqueTotal: round(acc.estVarejo + acc.estAtacado, 0),
      valorEstoque: round(acc.valorEstoque, 2),
      vendaVarejo: round(acc.vendaVarejo, 0),
      vendaAtacado: round(acc.vendaAtacado, 0),
      vendaTotal: round(acc.vendaVarejo + acc.vendaAtacado, 0),
      coberturaVarejo: coberturaDe(acc.estVarejo, mediaMensalVarejo),
      coberturaAtacado: coberturaDe(acc.estAtacado, mediaMensalAtacado),
      coberturaGeral: coberturaDe(acc.estVarejo + acc.estAtacado, mediaMensalGeral),
    };
  }

  // Estoque total decrescente, com "Total" sempre por último.
  function buildMatriz(agg: Map<string, BucketAcc>, dimensao: string): RelatorioBaseMatrizLinha[] {
    const entradas = [...agg.entries()].sort(
      (a, b) => b[1].estVarejo + b[1].estAtacado - (a[1].estVarejo + a[1].estAtacado) || a[0].localeCompare(b[0], 'pt-BR')
    );
    const linhas = entradas.map(([label, acc]) => ({
      ...montarLinhaMatriz(label, acc), referencias: referenciasMatriz.consultar(dimensao, label),
    }));
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

  const matrizLinha = buildMatriz(matrizLinhaAgg, 'linha');
  const matrizLinhaCompleta = buildMatriz(matrizLinhaCompletaAgg, 'linhaCompleta');
  const matrizCategoria = buildMatriz(matrizCategoriaAgg, 'categoria');
  const matrizGenero = buildMatriz(matrizGeneroAgg, 'genero');
  const matrizStatus = buildMatriz(matrizStatusAgg, 'status');

  function coberturaPorLabel(linhas: RelatorioBaseMatrizLinha[], label: string): number | null {
    const labelNormalizado = normalizarClassificacao(label);
    return linhas.find((l) => normalizarClassificacao(l.label) === labelNormalizado)?.coberturaGeral ?? null;
  }

  const statusBreakdown = [...statusAgg.entries()]
    .map(([status, qtd]) => ({
      status,
      estTt: round(qtd, 0),
      percent: kpis.estTt > 0 ? round((qtd / kpis.estTt) * 100, 1) : 0,
    }))
    .sort((a, b) => b.estTt - a.estTt);

  // Giro anual em vezes/ano usando 12 periodos de 30 dias, igual ao BI:
  // cobertura em meses = estoque / venda 30d; giro anual = 12 / cobertura.
  const giroAnualizado =
    kpis.estTt > 0 && kpis.giroTt1 > 0 ? round((kpis.giroTt1 * 12) / kpis.estTt, 2) : 0;
  const valorEstoqueVariacaoPercent =
    valorEstoqueAnoAnterior !== null && valorEstoqueAnoAnterior > 0 ? round(((valorEstoqueTotal - valorEstoqueAnoAnterior) / valorEstoqueAnoAnterior) * 100, 1) : null;

  const estoqueAtivos = montarIndicadoresEstoqueAtivos(estoqueAtivosAcc);
  const kpisExtra: RelatorioBaseKpisExtra = {
    coberturaGeral: coberturaDe(estVarejoTotal + estAtacadoTotal, vendaVarejoTotal + vendaAtacadoTotal),
    coberturaVarejo: coberturaDe(estVarejoTotal, vendaVarejoTotal),
    coberturaAtacado: coberturaDe(estAtacadoTotal, vendaAtacadoTotal),
    giroAnualizado,
    valorEstoqueTotal: round(valorEstoqueTotal, 2),
    valorEstoqueAnoAnterior: valorEstoqueAnoAnterior === null ? null : round(valorEstoqueAnoAnterior, 2),
    valorEstoqueVariacaoPercent,
    estoqueMortoQtd: round(estoqueMortoQtd, 0),
    estoqueMortoValor: round(estoqueMortoValor, 2),
    estoqueMortoPercent: kpis.estTt > 0 ? round((round(estoqueMortoQtd, 0) / kpis.estTt) * 100, 2) : 0,
    estoquePromocaoQtd: round(estoquePromocaoQtd, 0),
    estoquePromocaoValor: round(estoquePromocaoValor, 2),
    estoquePromocaoPercent: valorEstoqueTotal > 0 ? round((estoquePromocaoValor / valorEstoqueTotal) * 100, 1) : 0,
    coberturaBasico: coberturaPorLabel(matrizLinha, LINHA_BUCKET_BASICO),
    coberturaBasicoRenovavel: coberturaPorLabel(matrizLinha, LINHA_BUCKET_BASICO_RENOVAVEL),
    coberturaColecao: coberturaPorLabel(matrizLinha, LINHA_BUCKET_COLECAO),
    referenciasComEstoque: estoqueAtivos.referencias.comEstoque,
    estoqueAtivos,
    ...calcularEstoqueAnaliseReferencias(estoqueAnaliseReferencias, kpis.estTt, valorEstoqueTotal),
    ruptura: {
      basico: montarRupturaLinhaKpi(rupturaBasicoAcc),
      renovavel: montarRupturaLinhaKpi(rupturaRenovavelAcc),
    },
    statusBreakdown,
  };

  return {
    dataPosicao: filtro.dataPosicao!,
    producao: producao.info,
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
      giroTt30: round(giroTt30Total, 0),
      giroTt60: round(giroTt60Total, 0),
      giroTt90: round(giroTt90Total, 0),
      estTt: round(kpis.estTt, 0),
      skuCount: kpis.skuCount,
    },
    kpisExtra,
    matriz: {
      linha: matrizLinha,
      linhaCompleta: matrizLinhaCompleta,
      categoria: matrizCategoria,
      genero: matrizGenero,
      status: matrizStatus,
    },
    pagination: { page, pageSize, totalReferencias, totalPages },
    colunas: selecionarColunasRelatorioBase(colunasAtivas, lojasComValores),
    rows: aplicarDisponibilidadeProducao(rowsPaginadas, producao.info),
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
    colunas: ordenarColunasRelatorioBase(await getColunasEstoque()),
  };
}

