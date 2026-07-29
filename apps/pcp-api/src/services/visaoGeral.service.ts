import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import {
  OPERACAO_JOIN,
  SALE_OPERATION_FILTER,
  QUANTIDADE_COM_SINAL,
  FABRICA_BRANCH_CODE,
} from './relatorioBase.service.js';

const RELATORIO_BASE_KEY = 'relatorio_base';
const META_VISAO_GERAL_KEY = 'visao_geral';

// Linhas que compoem a matriz Basico x Colecao (decisao confirmada com o usuario -
// anotacao no mockup: "Colecao = Style"). Outras linhas (TEENKIS, PROMOCOES, BRINDE,
// MODA PRAIA, EMBALAGEM, CASUAL, PROTECAO) ficam fora dessa matriz especifica.
const LINHAS_BASICO = ['BASICA', 'BASICA RENOVAVEL'];
const LINHAS_COLECAO = ['STYLE'];

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

async function getConfigs() {
  const [config, meta] = await Promise.all([
    prisma.pcpRelatorioConfig.upsert({
      where: { relatorio: RELATORIO_BASE_KEY },
      create: { relatorio: RELATORIO_BASE_KEY },
      update: {},
    }),
    prisma.pcpMetaVisaoGeral.upsert({
      where: { relatorio: META_VISAO_GERAL_KEY },
      create: { relatorio: META_VISAO_GERAL_KEY },
      update: {},
    }),
  ]);
  return { config, meta };
}

export interface VisaoGeralFiltro {
  branches?: number[];
  genero?: string[];
}

interface EstoqueCanalRow {
  product_code: number | null;
  class_linha: string | null;
  class_categoria: string | null;
  class_genero: string | null;
  canal: 'varejo' | 'atacado';
  estoque: Decimal;
}

// Estoque atual por SKU, com canal (Fabrica inteira = atacado, resto = varejo - mesma
// convencao ja usada no Relatorio Base) e as dimensoes de classificacao pra poder
// agrupar por linha/categoria/genero depois em memoria.
async function getEstoqueCanalRows(branchFiltro?: number[]): Promise<EstoqueCanalRow[]> {
  const filtroBranch =
    branchFiltro && branchFiltro.length > 0
      ? Prisma.sql`AND branch_code IN (${Prisma.join(branchFiltro)})`
      : Prisma.empty;

  return prisma.$queryRaw<EstoqueCanalRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku, branch_code, stock
      FROM prd_saldo
      WHERE 1=1 ${filtroBranch}
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    ),
    estoque_sku_canal AS (
      SELECT product_sku,
        CASE WHEN branch_code = ${FABRICA_BRANCH_CODE} THEN 'atacado' ELSE 'varejo' END AS canal,
        SUM(COALESCE(stock, 0)) FILTER (WHERE COALESCE(stock, 0) > 0) AS estoque
      FROM ultimo_saldo
      GROUP BY product_sku, canal
    )
    SELECT a.product_code, a.class_linha, a.class_categoria, a.class_genero,
      es.canal, es.estoque
    FROM estoque_sku_canal es
    JOIN produto_analitico a ON a.product_sku = es.product_sku
    WHERE es.estoque > 0
  `;
}

interface VendaCanalRow {
  product_code: number;
  canal: 'varejo' | 'atacado';
  quantidade: Decimal;
}

// Venda liquida de devolucao por product_code, com o mesmo channel-split (Fabrica +
// descricao ATACADO = atacado; resto = varejo), numa janela de `meses` meses.
async function getVendaCanalRows(meses: number, generoFiltro?: string[]): Promise<VendaCanalRow[]> {
  const generoSql =
    generoFiltro && generoFiltro.length > 0
      ? Prisma.sql`AND TRIM(a.class_genero) IN (${Prisma.join(generoFiltro)})`
      : Prisma.empty;

  return prisma.$queryRaw<VendaCanalRow[]>`
    SELECT ti.product_code,
      CASE WHEN t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%' THEN 'atacado'
           ELSE 'varejo' END AS canal,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    LEFT JOIN produto_analitico a ON a.product_code = ti.product_code
    WHERE t.transaction_date >= CURRENT_DATE - make_interval(months => ${meses}::int)
      AND t.status = 4 AND ${SALE_OPERATION_FILTER}
      AND (t.branch_code != ${FABRICA_BRANCH_CODE} OR co.description ILIKE '%ATACADO%')
      ${generoSql}
    GROUP BY ti.product_code, canal
  `;
}

interface MatrizCelula {
  estoque: number;
  vendaPeriodo: number;
  cobertura: number | null;
}

function coberturaDe(estoque: number, vendaPeriodo: number, meses: number): number | null {
  const mediaMensal = vendaPeriodo / meses;
  if (mediaMensal <= 0) return null;
  return round(estoque / mediaMensal, 2);
}

// Monta a matriz [dimensao] x [varejo|atacado|total] + linha Total, a partir das linhas
// de estoque/venda ja agregadas por product_code/canal. `bucketFn` mapeia cada
// linha/categoria/genero pro rotulo de linha da matriz (ou null pra excluir).
function montarMatriz(
  estoqueRows: EstoqueCanalRow[],
  vendaRows: VendaCanalRow[],
  coberturaMeses: number,
  bucketFn: (row: EstoqueCanalRow) => string | null,
  vendaBucketPorProductCode: Map<number, string | null>
): { linhas: string[]; matriz: Record<string, Record<'varejo' | 'atacado' | 'total', MatrizCelula>> } {
  const acumulado = new Map<string, Record<'varejo' | 'atacado', { estoque: number; venda: number }>>();

  function garantir(bucket: string) {
    if (!acumulado.has(bucket)) {
      acumulado.set(bucket, { varejo: { estoque: 0, venda: 0 }, atacado: { estoque: 0, venda: 0 } });
    }
    return acumulado.get(bucket)!;
  }

  for (const row of estoqueRows) {
    const bucket = bucketFn(row);
    if (bucket === null) continue;
    garantir(bucket)[row.canal].estoque += decimalToNumber(row.estoque);
  }

  for (const row of vendaRows) {
    const bucket = vendaBucketPorProductCode.get(row.product_code);
    if (!bucket) continue;
    garantir(bucket)[row.canal].venda += decimalToNumber(row.quantidade);
  }

  const linhas = [...acumulado.keys()].sort();
  const matriz: Record<string, Record<'varejo' | 'atacado' | 'total', MatrizCelula>> = {};
  const totalPorCanal = { varejo: { estoque: 0, venda: 0 }, atacado: { estoque: 0, venda: 0 } };

  for (const linha of linhas) {
    const dados = acumulado.get(linha)!;
    const totalLinha = { estoque: dados.varejo.estoque + dados.atacado.estoque, venda: dados.varejo.venda + dados.atacado.venda };
    matriz[linha] = {
      varejo: { estoque: dados.varejo.estoque, vendaPeriodo: dados.varejo.venda, cobertura: coberturaDe(dados.varejo.estoque, dados.varejo.venda, coberturaMeses) },
      atacado: { estoque: dados.atacado.estoque, vendaPeriodo: dados.atacado.venda, cobertura: coberturaDe(dados.atacado.estoque, dados.atacado.venda, coberturaMeses) },
      total: { estoque: totalLinha.estoque, vendaPeriodo: totalLinha.venda, cobertura: coberturaDe(totalLinha.estoque, totalLinha.venda, coberturaMeses) },
    };
    totalPorCanal.varejo.estoque += dados.varejo.estoque;
    totalPorCanal.varejo.venda += dados.varejo.venda;
    totalPorCanal.atacado.estoque += dados.atacado.estoque;
    totalPorCanal.atacado.venda += dados.atacado.venda;
  }

  matriz['Total'] = {
    varejo: { estoque: totalPorCanal.varejo.estoque, vendaPeriodo: totalPorCanal.varejo.venda, cobertura: coberturaDe(totalPorCanal.varejo.estoque, totalPorCanal.varejo.venda, coberturaMeses) },
    atacado: { estoque: totalPorCanal.atacado.estoque, vendaPeriodo: totalPorCanal.atacado.venda, cobertura: coberturaDe(totalPorCanal.atacado.estoque, totalPorCanal.atacado.venda, coberturaMeses) },
    total: {
      estoque: totalPorCanal.varejo.estoque + totalPorCanal.atacado.estoque,
      vendaPeriodo: totalPorCanal.varejo.venda + totalPorCanal.atacado.venda,
      cobertura: coberturaDe(totalPorCanal.varejo.estoque + totalPorCanal.atacado.estoque, totalPorCanal.varejo.venda + totalPorCanal.atacado.venda, coberturaMeses),
    },
  };

  return { linhas: [...linhas, 'Total'], matriz };
}

function bucketLinha(row: EstoqueCanalRow): string | null {
  const linha = row.class_linha?.trim().toUpperCase() || '';
  if (LINHAS_BASICO.includes(linha)) return 'Básico';
  if (LINHAS_COLECAO.includes(linha)) return 'Coleção';
  return null;
}

function bucketCategoria(row: EstoqueCanalRow): string | null {
  return row.class_categoria?.trim() || null;
}

function bucketGenero(row: EstoqueCanalRow): string | null {
  return row.class_genero?.trim() || null;
}

interface MetaGap {
  valor: number;
  meta: number;
  gap: number;
}

function metaGap(valor: number, meta: number): MetaGap {
  return { valor: round(valor, 2), meta: round(meta, 2), gap: round(valor - meta, 2) };
}

export async function getVisaoGeral(filtro: VisaoGeralFiltro = {}) {
  const { config, meta } = await getConfigs();
  const coberturaMeses = config.coberturaMeses;

  const [estoqueRows, vendaCoberturaRows, venda12mRows, estoqueMortoRows, custoRows] = await Promise.all([
    getEstoqueCanalRows(filtro.branches),
    getVendaCanalRows(coberturaMeses, filtro.genero),
    getVendaCanalRows(12, filtro.genero),
    getVendaCanalRows(meta.estoqueMortoDias / 30, filtro.genero), // aproximacao mensal - ver nota abaixo
    prisma.produtoCusto.findMany({ where: { branchCode: config.precoCustoBranchCode, costCode: config.custoCode }, select: { productCode: true, valor: true } }),
  ]);

  // Nota: estoqueMortoDias e em dias (default 180), mas a query de venda usa janela em
  // MESES (make_interval months) - convertido pra meses fracionarios (180/30=6) porque
  // reaproveita a mesma funcao de venda por canal das outras metricas. Erro de
  // arredondamento e desprezivel pra essa finalidade (sinalizar estoque sem giro
  // recente, nao um calculo financeiro exato).

  const vendaBucketPorProductCode = new Map<number, string | null>();
  for (const row of estoqueRows) {
    if (row.product_code !== null) {
      const bucket = bucketLinha(row);
      if (bucket) vendaBucketPorProductCode.set(row.product_code, bucket);
    }
  }

  const coberturaPorLinhaCanal = montarMatriz(estoqueRows, vendaCoberturaRows, coberturaMeses, bucketLinha, vendaBucketPorProductCode);

  const vendaBucketCategoria = new Map<number, string | null>();
  for (const row of estoqueRows) {
    if (row.product_code !== null) vendaBucketCategoria.set(row.product_code, bucketCategoria(row));
  }
  const coberturaPorCategoriaCanal = montarMatriz(estoqueRows, vendaCoberturaRows, coberturaMeses, bucketCategoria, vendaBucketCategoria);

  const vendaBucketGenero = new Map<number, string | null>();
  for (const row of estoqueRows) {
    if (row.product_code !== null) vendaBucketGenero.set(row.product_code, bucketGenero(row));
  }
  const coberturaPorGeneroCanal = montarMatriz(estoqueRows, vendaCoberturaRows, coberturaMeses, bucketGenero, vendaBucketGenero);

  // KPIs gerais - rede inteira (todas as linhas, nao so Basico/Colecao)
  const estoqueTotalPorProductCode = new Map<number, number>();
  const estoqueTotalGeral = { valor: 0 };
  for (const row of estoqueRows) {
    estoqueTotalGeral.valor += decimalToNumber(row.estoque);
    if (row.product_code !== null) {
      estoqueTotalPorProductCode.set(row.product_code, (estoqueTotalPorProductCode.get(row.product_code) || 0) + decimalToNumber(row.estoque));
    }
  }

  let vendaCoberturaGeral = 0;
  for (const row of vendaCoberturaRows) vendaCoberturaGeral += decimalToNumber(row.quantidade);
  let venda12mGeral = 0;
  for (const row of venda12mRows) venda12mGeral += decimalToNumber(row.quantidade);

  const custoPorProductCode = new Map<number, number>();
  for (const row of custoRows) custoPorProductCode.set(row.productCode, decimalToNumber(row.valor));

  let valorEstoque = 0;
  for (const [productCode, qtd] of estoqueTotalPorProductCode) {
    const custo = custoPorProductCode.get(productCode);
    if (custo) valorEstoque += qtd * custo;
  }

  const vendaRecentePorProductCode = new Set<number>();
  for (const row of estoqueMortoRows) {
    if (decimalToNumber(row.quantidade) > 0) vendaRecentePorProductCode.add(row.product_code);
  }
  let estoqueMortoQtd = 0;
  let estoqueMortoValor = 0;
  for (const [productCode, qtd] of estoqueTotalPorProductCode) {
    if (!vendaRecentePorProductCode.has(productCode)) {
      estoqueMortoQtd += qtd;
      const custo = custoPorProductCode.get(productCode);
      if (custo) estoqueMortoValor += qtd * custo;
    }
  }

  const coberturaGeral = coberturaDe(estoqueTotalGeral.valor, vendaCoberturaGeral, coberturaMeses) ?? 0;
  const giroAnualizado = estoqueTotalGeral.valor > 0 ? round(venda12mGeral / estoqueTotalGeral.valor, 2) : 0;
  const estoqueMortoPercent = estoqueTotalGeral.valor > 0 ? round((estoqueMortoQtd / estoqueTotalGeral.valor) * 100, 1) : 0;
  const coberturaBasico = coberturaPorLinhaCanal.matriz['Básico']?.total.cobertura ?? 0;
  const coberturaColecao = coberturaPorLinhaCanal.matriz['Coleção']?.total.cobertura ?? 0;

  return {
    config: { coberturaMeses },
    kpis: {
      coberturaGeral: metaGap(coberturaGeral, decimalToNumber(meta.metaCoberturaGeralMeses)),
      giroAnualizado: metaGap(giroAnualizado, decimalToNumber(meta.metaGiroAnualizado)),
      estoqueMortoPercent: metaGap(estoqueMortoPercent, decimalToNumber(meta.metaEstoqueMortoPercent)),
      coberturaBasico: metaGap(coberturaBasico, decimalToNumber(meta.metaCoberturaBasicoMeses)),
      coberturaColecao: metaGap(coberturaColecao, decimalToNumber(meta.metaCoberturaColecaoMeses)),
      valorEstoque: round(valorEstoque, 2),
      estoqueMortoValor: round(estoqueMortoValor, 2),
      skusAtivos: estoqueTotalPorProductCode.size,
    },
    coberturaPorLinhaCanal,
    coberturaPorCategoriaCanal,
    coberturaPorGeneroCanal,
  };
}
