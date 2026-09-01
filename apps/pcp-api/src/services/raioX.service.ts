import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { ATACADO_BRANCH_CODE, ATACADO_STOCK_CODE, DPA_BRANCH_CODE, DPA_STOCK_CODES, RELATORIO_BASE_BRANCH_ORDER } from '../config/constants.js';
import { FABRICA_BRANCH_CODE, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL, OPERACAO_JOIN, PCP_ESTOQUE_LIQUIDO_SKU_FILTER } from './relatorioBase.service.js';

// Tipos de filtros
export interface RaioXFiltro {
  dataInicio: string; // formato YYYY-MM-DD
  dataFim: string; // formato YYYY-MM-DD
  referencias?: string[]; // array de reference_code
  categorias?: string[]; // array de categorias
  lojas?: number[]; // array de branch_codes (vazio = todas)
  canal?: 'varejo' | 'atacado' | 'todos'; // filtro de canal
  visao?: 'sintetico' | 'analitico'; // analítico mostra por item, sintético mostra total
  agruparPorCor?: boolean; // se false, separa por cor; se true, agrupa todas as cores juntas
}

// Interfaces de resposta
export interface RaioXGrade {
  tamanho: string;
  estoqueInicial: number;
  transferencias: number; // Movimento de estoque reconciliado: estoqueFinal - estoqueInicial + vendas
  vendasVarejo: number;
  vendasAtacado: number;
  estoqueFinal: number;
  pecasEmProducao: number;
  cobertura: number;
}

export interface RaioXLoja {
  branchCode: number;
  branchName: string;
  grades: RaioXGrade[];
  totais: {
    estoqueInicial: number;
    transferencias: number; // Movimento de estoque reconciliado: estoqueFinal - estoqueInicial + vendas
    vendasVarejo: number;
    vendasAtacado: number;
    estoqueFinal: number;
    pecasEmProducao: number;
    cobertura: number;
  };
}

export interface RaioXProduto {
  productSku?: string;
  referenceCode: string;
  referenceName: string;
  productCode?: number;
  cor?: string; // presente quando agruparPorCor = true
  fotoUrl?: string | null;
  emPromocao?: boolean;
  lojas: RaioXLoja[];
  totalGeral: {
    estoqueInicial: number;
    transferencias: number; // Movimento de estoque reconciliado: estoqueFinal - estoqueInicial + vendas
    vendasVarejo: number;
    vendasAtacado: number;
    estoqueFinal: number;
    pecasEmProducao: number;
    cobertura: number;
  };
}

export interface RaioXResponse {
  produtos: RaioXProduto[];
  config: {
    coberturaLimiteVerde: number;
    coberturaLimiteVermelho: number;
  };
}

function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Decimal) return value.toNumber();
  return Number(value);
}

interface LocalRaioX {
  branchCode: number;
  branchName: string;
  branchFisica: number;
}

function totaisVazios() {
  return { estoqueInicial: 0, transferencias: 0, vendasVarejo: 0, vendasAtacado: 0, estoqueFinal: 0, pecasEmProducao: 0, cobertura: 0 };
}

// A filial física 02 nunca é apresentada diretamente: ela é desmembrada em
// DPA (físico + segunda qualidade) e ATACADO, como nos demais relatórios PCP.
function locaisDoRelatorio(selecao?: number[]): LocalRaioX[] {
  const selecionados = selecao?.length ? new Set(selecao) : null;
  return RELATORIO_BASE_BRANCH_ORDER
    .filter(({ branchCode }) => !selecionados || selecionados.has(branchCode) || (branchCode < 0 && selecionados.has(FABRICA_BRANCH_CODE)))
    .map(({ branchCode, label }) => ({
      branchCode,
      branchName: branchCode === DPA_BRANCH_CODE ? 'FÁBRICA (DPA)' : label,
      branchFisica: branchCode < 0 ? FABRICA_BRANCH_CODE : branchCode,
    }));
}

// Helper para converter canal string em verificação SQL
function getCanalFilter(canal: 'varejo' | 'atacado' | 'todos'): string {
  if (canal === 'varejo') return `AND t.branch_code != ${FABRICA_BRANCH_CODE}`;
  if (canal === 'atacado') return `AND t.branch_code = ${FABRICA_BRANCH_CODE}`;
  return ''; // todos
}

/**
 * Busca o estoque de múltiplos produtos em múltiplas lojas em uma data específica (EM LOTE).
 * Retorna um Map com chave "productSku|branchCode" -> estoque
 */
async function getEstoquesEmLote(
  productSkus: string[],
  locais: LocalRaioX[],
  data: string
): Promise<Map<string, number>> {
  if (productSkus.length === 0 || locais.length === 0) {
    return new Map();
  }
  const branchCodes = [...new Set(locais.map(local => local.branchFisica))];

  interface EstoqueRow {
    product_sku: string;
    local_code: number;
    stock: Decimal | null;
  }

  const rows = await prisma.$queryRaw<EstoqueRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (product_sku, branch_code, stock_code)
        product_sku,
        branch_code,
        stock_code,
        stock
      FROM prd_saldo
      WHERE product_sku IN (${Prisma.join(productSkus.map(sku => Prisma.sql`${sku}`))})
        AND branch_code IN (${Prisma.join(branchCodes.map(bc => Prisma.sql`${bc}`))})
        AND captured_at <= ${data}::date + INTERVAL '1 day'
      ORDER BY product_sku, branch_code, stock_code, captured_at DESC
    )
    SELECT product_sku,
      CASE
        WHEN branch_code = ${FABRICA_BRANCH_CODE} AND stock_code IN (${Prisma.join(DPA_STOCK_CODES.map(code => Prisma.sql`${code}`))}) THEN ${DPA_BRANCH_CODE}
        WHEN branch_code = ${FABRICA_BRANCH_CODE} AND stock_code = ${ATACADO_STOCK_CODE} THEN ${ATACADO_BRANCH_CODE}
        ELSE branch_code
      END AS local_code,
      COALESCE(SUM(COALESCE(stock, 0)), 0) AS stock
    FROM ultimo_saldo
    WHERE (branch_code <> ${FABRICA_BRANCH_CODE} AND stock_code = 1)
       OR (branch_code = ${FABRICA_BRANCH_CODE} AND stock_code IN (${Prisma.join([...DPA_STOCK_CODES, ATACADO_STOCK_CODE].map(code => Prisma.sql`${code}`))}))
    GROUP BY product_sku, local_code
  `;

  const result = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.product_sku}|${row.local_code}`;
    result.set(key, decimalToNumber(row.stock));
  }

  return result;
}

/**
 * Busca vendas de múltiplos produtos em múltiplas lojas em um período (EM LOTE).
 * Retorna um Map com chave "productCode|branchCode|canal" -> quantidade
 */
async function getVendasEmLote(
  productCodes: number[],
  locais: LocalRaioX[],
  dataInicio: string,
  dataFim: string
): Promise<Map<string, number>> {
  if (productCodes.length === 0 || locais.length === 0) {
    return new Map();
  }
  const branchCodes = [...new Set(locais.map(local => local.branchFisica))];

  interface VendaRow {
    product_code: number;
    local_code: number;
    quantidade: Decimal | null;
    is_atacado: boolean;
  }

  const rows = await prisma.$queryRaw<VendaRow[]>`
    SELECT
      ti.product_code,
      CASE
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} AND co.description ILIKE '%ATACADO%' THEN ${ATACADO_BRANCH_CODE}
        WHEN t.branch_code = ${FABRICA_BRANCH_CODE} THEN ${DPA_BRANCH_CODE}
        ELSE t.branch_code
      END AS local_code,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade,
      CASE WHEN co.description ILIKE '%ATACADO%' THEN true ELSE false END AS is_atacado
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${OPERACAO_JOIN}
    WHERE ti.product_code IN (${Prisma.join(productCodes.map(pc => Prisma.sql`${pc}`))})
      AND t.branch_code IN (${Prisma.join(branchCodes.map(bc => Prisma.sql`${bc}`))})
      AND t.transaction_date >= ${dataInicio}::date
      AND t.transaction_date <= ${dataFim}::date
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
    GROUP BY ti.product_code, local_code, is_atacado
  `;

  const result = new Map<string, number>();
  for (const row of rows) {
    const canal = row.is_atacado ? 'atacado' : 'varejo';
    const key = `${row.product_code}|${row.local_code}|${canal}`;
    result.set(key, decimalToNumber(row.quantidade));
  }

  return result;
}

// Produção é da Fábrica/DPA; não deve ser repetida nas lojas ou no Atacado.
async function getProducaoEmLote(productCodes: number[]): Promise<Map<number, number>> {
  if (!productCodes.length) return new Map();

  interface ProducaoRow { product_code: number; quantidade: Decimal | null }
  const rows = await prisma.$queryRaw<ProducaoRow[]>`
    SELECT o.product_code, COALESCE(SUM(o.quantidade_pendente), 0) AS quantidade
    FROM ops_em_producao o
    JOIN produto_analitico a ON a.product_code = o.product_code
    WHERE o.product_code IN (${Prisma.join(productCodes.map(code => Prisma.sql`${code}`))})
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
    GROUP BY o.product_code
  `;
  return new Map(rows.map(row => [row.product_code, decimalToNumber(row.quantidade)]));
}

/**
 * Calcula a cobertura em meses para um produto.
 * Cobertura = estoqueFinal / ((vendasVarejo + vendasAtacado) / dias do período * 30)
 */
function calcularCobertura(
  estoqueFinal: number,
  vendasVarejo: number,
  vendasAtacado: number,
  dataInicio: string,
  dataFim: string
): number {
  const totalVendas = vendasVarejo + vendasAtacado;
  if (totalVendas === 0) return 999; // Sem vendas = cobertura infinita

  // Calcula os dias do período
  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  const dias = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Média de vendas por mês (30 dias)
  const mediaMensal = (totalVendas / dias) * 30;

  if (mediaMensal === 0) return 999;

  return estoqueFinal / mediaMensal;
}

/**
 * Função principal para buscar os dados do Raio X
 */
export async function getRaioX(filtro: RaioXFiltro): Promise<RaioXResponse> {
  // Busca configurações
  const config = await prisma.pcpRelatorioConfig.findFirst({
    where: { relatorio: 'raio_x' },
  });

  const coberturaLimiteVerde = config?.coberturaLimiteVerde ? decimalToNumber(config.coberturaLimiteVerde) : 4.0;
  const coberturaLimiteVermelho = config?.coberturaLimiteVermelho ? decimalToNumber(config.coberturaLimiteVermelho) : 4.01;

  // Busca os produtos a serem analisados - LIMITA A 10 produtos por vez para evitar timeout
  interface ProdutoRow {
    product_sku: string;
    product_code: number;
    reference_code: string;
    reference_name: string;
    color_code: string | null;
    color_name: string | null;
    cor_agrupada: string | null;
    size: string | null;
    class_motor_promocional: string | null;
  }

  let produtos: ProdutoRow[];

  if (filtro.referencias && filtro.referencias.length > 0) {
    // Filtra pelas referências selecionadas
    produtos = await prisma.$queryRaw<ProdutoRow[]>`
      SELECT DISTINCT
        a.product_sku,
        a.product_code,
        a.reference_code,
        a.reference_name,
        a.color_code,
        a.color_name,
        NULLIF(TRIM(ag.nome), '') AS cor_agrupada,
        a.size,
        a.class_motor_promocional
      FROM produto_analitico a
      LEFT JOIN agrupamento_membros am
        ON am.tipo = 'cor_produto'
        AND am.reference_code = a.reference_code
        AND am.color_match_key = COALESCE(NULLIF(TRIM(a.color_code), ''), NULLIF(TRIM(a.color_name), ''))
      LEFT JOIN agrupamento_grupos ag
        ON ag.id = am.grupo_id
        AND ag.tipo = am.tipo
      WHERE a.reference_code IS NOT NULL
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
        AND a.reference_code IN (${Prisma.join(filtro.referencias.map(ref => Prisma.sql`${ref}`))})
      ORDER BY a.reference_code, a.color_code, a.size
    `;
  } else if (filtro.categorias && filtro.categorias.length > 0) {
    produtos = await prisma.$queryRaw<ProdutoRow[]>`
      SELECT DISTINCT
        a.product_sku,
        a.product_code,
        a.reference_code,
        a.reference_name,
        a.color_code,
        a.color_name,
        NULLIF(TRIM(ag.nome), '') AS cor_agrupada,
        a.size,
        a.class_motor_promocional
      FROM produto_analitico a
      LEFT JOIN agrupamento_membros am
        ON am.tipo = 'cor_produto'
        AND am.reference_code = a.reference_code
        AND am.color_match_key = COALESCE(NULLIF(TRIM(a.color_code), ''), NULLIF(TRIM(a.color_name), ''))
      LEFT JOIN agrupamento_grupos ag
        ON ag.id = am.grupo_id
        AND ag.tipo = am.tipo
      WHERE a.reference_code IS NOT NULL
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
        AND a.class_categoria IN (${Prisma.join(filtro.categorias.map(cat => Prisma.sql`${cat}`))})
      ORDER BY a.reference_code, a.color_code, a.size
      LIMIT 10
    `;
  } else {
    return { produtos: [], config: { coberturaLimiteVerde, coberturaLimiteVermelho } };
  }

  console.log(`[Raio X] Encontrados ${produtos.length} SKUs`);

  // Se não encontrou produtos, retorna vazio
  if (produtos.length === 0) {
    return {
      produtos: [],
      config: { coberturaLimiteVerde, coberturaLimiteVermelho },
    };
  }

  const locais = locaisDoRelatorio(filtro.lojas);

  console.log(`[Raio X] Lojas selecionadas: ${locais.map(local => local.branchName).join(', ')}`);

  console.log(`[Raio X] Processando ${produtos.length} produtos em ${locais.length} lojas`);

  // Agrupa produtos:
  // - Se agruparPorCor = false: separa por referência+cor (cada cor é um grupo)
  // - Se agruparPorCor = true: agrupa por referência (todas cores juntas)
  const produtosMap = new Map<string, ProdutoRow[]>();

  for (const produto of produtos) {
    const corOriginal = produto.color_name?.trim() || produto.color_code?.trim() || 'SEM COR';
    const corExibicao = produto.cor_agrupada?.trim() || corOriginal;
    const key = `${produto.reference_code}|${corExibicao}`;

    if (!produtosMap.has(key)) {
      produtosMap.set(key, []);
    }
    produtosMap.get(key)!.push(produto);
  }

  console.log(`[Raio X] ${produtosMap.size} grupos de produtos para processar`);

  // BUSCA TODOS OS DADOS EM LOTE (uma única query por tipo de dado)
  const todosSKUs = produtos.map(p => p.product_sku);
  const todosCodes = produtos.map(p => p.product_code);

  console.log(`[Raio X] Buscando estoques em lote...`);
  const estoquesInicio = await getEstoquesEmLote(todosSKUs, locais, filtro.dataInicio);
  const estoquesFim = await getEstoquesEmLote(todosSKUs, locais, filtro.dataFim);

  console.log(`[Raio X] Buscando vendas em lote...`);
  const [vendas, producao] = await Promise.all([
    getVendasEmLote(todosCodes, locais, filtro.dataInicio, filtro.dataFim),
    getProducaoEmLote(todosCodes),
  ]);

  console.log(`[Raio X] Montando resposta...`);

  // Monta a resposta
  const resultado: RaioXProduto[] = [];

  for (const [key, produtosGrupo] of produtosMap.entries()) {
    const primeiroProduto = produtosGrupo[0];
    const corOriginal = primeiroProduto.color_name?.trim() || primeiroProduto.color_code?.trim() || 'SEM COR';

    const produtoResult: RaioXProduto = {
      referenceCode: primeiroProduto.reference_code,
      referenceName: primeiroProduto.reference_name,
      cor: primeiroProduto.cor_agrupada?.trim() || corOriginal,
      productCode: primeiroProduto.product_code,
      emPromocao: primeiroProduto.class_motor_promocional ? true : false,
      lojas: [],
      totalGeral: {
        estoqueInicial: 0,
        transferencias: 0,
        vendasVarejo: 0,
        vendasAtacado: 0,
        estoqueFinal: 0,
        pecasEmProducao: 0,
        cobertura: 0,
      },
    };

    // Para cada loja
    for (const local of locais) {

      const lojaResult: RaioXLoja = {
        branchCode: local.branchCode,
        branchName: local.branchName,
        grades: [],
        totais: {
          estoqueInicial: 0,
          transferencias: 0,
          vendasVarejo: 0,
          vendasAtacado: 0,
          estoqueFinal: 0,
          pecasEmProducao: 0,
          cobertura: 0,
        },
      };

      const gradesPorTamanho = new Map<string, RaioXGrade>();

      // Para cada tamanho do produto
      for (const produto of produtosGrupo) {
        const estoqueInicial = estoquesInicio.get(`${produto.product_sku}|${local.branchCode}`) || 0;

        // Busca vendas no Map
        let vendasVarejo = vendas.get(`${produto.product_code}|${local.branchCode}|varejo`) || 0;
        let vendasAtacado = vendas.get(`${produto.product_code}|${local.branchCode}|atacado`) || 0;

        // Aplica filtro de canal
        if (filtro.canal === 'varejo') {
          vendasAtacado = 0;
        } else if (filtro.canal === 'atacado') {
          vendasVarejo = 0;
        }

        const estoqueFinal = estoquesFim.get(`${produto.product_sku}|${local.branchCode}`) || 0;
        // Mantém o nome do campo por compatibilidade com o contrato atual da API,
        // mas o valor representa o movimento necessário para reconciliar o saldo.
        const transferencias = estoqueFinal - estoqueInicial + vendasVarejo + vendasAtacado;
        const tamanho = produto.size || '-';
        const grade = gradesPorTamanho.get(tamanho) || {
          tamanho,
          estoqueInicial: 0,
          transferencias: 0,
          vendasVarejo: 0,
          vendasAtacado: 0,
          estoqueFinal: 0,
          pecasEmProducao: 0,
          cobertura: 0,
        };

        grade.estoqueInicial += estoqueInicial;
        grade.transferencias += transferencias;
        grade.vendasVarejo += vendasVarejo;
        grade.vendasAtacado += vendasAtacado;
        grade.estoqueFinal += estoqueFinal;
        grade.pecasEmProducao += local.branchCode === DPA_BRANCH_CODE ? producao.get(produto.product_code) || 0 : 0;
        gradesPorTamanho.set(tamanho, grade);

        lojaResult.totais.estoqueInicial += estoqueInicial;
        lojaResult.totais.transferencias += transferencias;
        lojaResult.totais.vendasVarejo += vendasVarejo;
        lojaResult.totais.vendasAtacado += vendasAtacado;
        lojaResult.totais.estoqueFinal += estoqueFinal;
        lojaResult.totais.pecasEmProducao += local.branchCode === DPA_BRANCH_CODE ? producao.get(produto.product_code) || 0 : 0;
      }

      lojaResult.grades = [...gradesPorTamanho.values()];
      for (const grade of lojaResult.grades) {
        grade.cobertura = calcularCobertura(
          grade.estoqueFinal,
          grade.vendasVarejo,
          grade.vendasAtacado,
          filtro.dataInicio,
          filtro.dataFim
        );
      }

      // Calcula cobertura total da loja
      lojaResult.totais.cobertura = calcularCobertura(
        lojaResult.totais.estoqueFinal,
        lojaResult.totais.vendasVarejo,
        lojaResult.totais.vendasAtacado,
        filtro.dataInicio,
        filtro.dataFim
      );

      produtoResult.lojas.push(lojaResult);

      // Acumula no total geral
      produtoResult.totalGeral.estoqueInicial += lojaResult.totais.estoqueInicial;
      produtoResult.totalGeral.transferencias += lojaResult.totais.transferencias;
      produtoResult.totalGeral.vendasVarejo += lojaResult.totais.vendasVarejo;
      produtoResult.totalGeral.vendasAtacado += lojaResult.totais.vendasAtacado;
      produtoResult.totalGeral.estoqueFinal += lojaResult.totais.estoqueFinal;
      produtoResult.totalGeral.pecasEmProducao += lojaResult.totais.pecasEmProducao;
    }

    // Calcula cobertura total geral
    produtoResult.totalGeral.cobertura = calcularCobertura(
      produtoResult.totalGeral.estoqueFinal,
      produtoResult.totalGeral.vendasVarejo,
      produtoResult.totalGeral.vendasAtacado,
      filtro.dataInicio,
      filtro.dataFim
    );

    resultado.push(produtoResult);
  }

  return {
    produtos: resultado,
    config: {
      coberturaLimiteVerde,
      coberturaLimiteVermelho,
    },
  };
}
