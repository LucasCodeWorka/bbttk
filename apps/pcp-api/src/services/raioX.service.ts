import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { FABRICA_BRANCH_CODE, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL, OPERACAO_JOIN } from './relatorioBase.service.js';

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
  transferencias: number;
  vendasVarejo: number;
  vendasAtacado: number;
  estoqueFinal: number;
  cobertura: number;
}

export interface RaioXLoja {
  branchCode: number;
  branchName: string;
  grades: RaioXGrade[];
  totais: {
    estoqueInicial: number;
    transferencias: number;
    vendasVarejo: number;
    vendasAtacado: number;
    estoqueFinal: number;
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
    transferencias: number;
    vendasVarejo: number;
    vendasAtacado: number;
    estoqueFinal: number;
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
  branchCodes: number[],
  data: string
): Promise<Map<string, number>> {
  if (productSkus.length === 0 || branchCodes.length === 0) {
    return new Map();
  }

  interface EstoqueRow {
    product_sku: string;
    branch_code: number;
    stock: Decimal | null;
  }

  const rows = await prisma.$queryRaw<EstoqueRow[]>`
    SELECT DISTINCT ON (product_sku, branch_code, stock_code)
      product_sku,
      branch_code,
      stock
    FROM prd_saldo
    WHERE product_sku IN (${Prisma.join(productSkus.map(sku => Prisma.sql`${sku}`))})
      AND branch_code IN (${Prisma.join(branchCodes.map(bc => Prisma.sql`${bc}`))})
      AND captured_at <= ${data}::date + INTERVAL '1 day'
    ORDER BY product_sku, branch_code, stock_code, captured_at DESC
  `;

  const result = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.product_sku}|${row.branch_code}`;
    result.set(key, decimalToNumber(row.stock));
  }

  return result;
}

/**
 * Busca as transferências de um produto em um período.
 * Transferências são movimentações de entrada/saída entre lojas.
 */
async function getTransferencias(
  productCode: number,
  branchCode: number,
  dataInicio: string,
  dataFim: string
): Promise<number> {
  // TODO: Implementar lógica de transferências quando soubermos onde isso está no banco
  // Por enquanto retorna 0
  return 0;
}

/**
 * Busca vendas de múltiplos produtos em múltiplas lojas em um período (EM LOTE).
 * Retorna um Map com chave "productCode|branchCode|canal" -> quantidade
 */
async function getVendasEmLote(
  productCodes: number[],
  branchCodes: number[],
  dataInicio: string,
  dataFim: string
): Promise<Map<string, number>> {
  if (productCodes.length === 0 || branchCodes.length === 0) {
    return new Map();
  }

  interface VendaRow {
    product_code: number;
    branch_code: number;
    quantidade: Decimal | null;
    is_atacado: boolean;
  }

  const rows = await prisma.$queryRaw<VendaRow[]>`
    SELECT
      ti.product_code,
      t.branch_code,
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
    GROUP BY ti.product_code, t.branch_code, is_atacado
  `;

  const result = new Map<string, number>();
  for (const row of rows) {
    const canal = row.is_atacado ? 'atacado' : 'varejo';
    const key = `${row.product_code}|${row.branch_code}|${canal}`;
    result.set(key, decimalToNumber(row.quantidade));
  }

  return result;
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
    size: string | null;
    class_motor_promocional: string | null;
  }

  let produtos: ProdutoRow[];

  if (filtro.referencias && filtro.referencias.length > 0) {
    // Filtra pelas referências selecionadas
    produtos = await prisma.$queryRaw<ProdutoRow[]>`
      SELECT DISTINCT
        product_sku,
        product_code,
        reference_code,
        reference_name,
        color_code,
        color_name,
        size,
        class_motor_promocional
      FROM produto_analitico
      WHERE reference_code IS NOT NULL
        AND reference_code IN (${Prisma.join(filtro.referencias.map(ref => Prisma.sql`${ref}`))})
      ORDER BY reference_code, color_code, size
    `;
  } else if (filtro.categorias && filtro.categorias.length > 0) {
    produtos = await prisma.$queryRaw<ProdutoRow[]>`
      SELECT DISTINCT
        product_sku,
        product_code,
        reference_code,
        reference_name,
        color_code,
        color_name,
        size,
        class_motor_promocional
      FROM produto_analitico
      WHERE reference_code IS NOT NULL
        AND class_categoria IN (${Prisma.join(filtro.categorias.map(cat => Prisma.sql`${cat}`))})
      ORDER BY reference_code, color_code, size
      LIMIT 10
    `;
  } else {
    // Sem filtros, retorna os primeiros 10
    produtos = await prisma.$queryRaw<ProdutoRow[]>`
      SELECT DISTINCT
        product_sku,
        product_code,
        reference_code,
        reference_name,
        color_code,
        color_name,
        size,
        class_motor_promocional
      FROM produto_analitico
      WHERE reference_code IS NOT NULL
      ORDER BY reference_code, color_code, size
      LIMIT 10
    `;
  }

  console.log(`[Raio X] Encontrados ${produtos.length} SKUs`);

  // Se não encontrou produtos, retorna vazio
  if (produtos.length === 0) {
    return {
      produtos: [],
      config: { coberturaLimiteVerde, coberturaLimiteVermelho },
    };
  }

  // Busca as lojas a serem analisadas
  let lojasQuery: number[];

  if (filtro.lojas && filtro.lojas.length > 0) {
    // Usa as lojas especificadas no filtro
    lojasQuery = filtro.lojas;
  } else {
    // Busca todas as lojas (exceto FABRICA)
    const todasLojas = await prisma.branches.findMany({
      where: {
        branch_code: { not: FABRICA_BRANCH_CODE },
      },
      orderBy: { branch_code: 'asc' },
    });
    lojasQuery = todasLojas.map(l => l.branch_code);
  }

  console.log(`[Raio X] Lojas selecionadas: ${lojasQuery.join(', ')}`);

  console.log(`[Raio X] Processando ${produtos.length} produtos em ${lojasQuery.length} lojas`);

  // Agrupa produtos:
  // - Se agruparPorCor = false: separa por referência+cor (cada cor é um grupo)
  // - Se agruparPorCor = true: agrupa por referência (todas cores juntas)
  const produtosMap = new Map<string, ProdutoRow[]>();

  for (const produto of produtos) {
    const key = filtro.agruparPorCor
      ? produto.reference_code
      : `${produto.reference_code}|${produto.color_code || produto.color_name || ''}`;

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
  const estoquesInicio = await getEstoquesEmLote(todosSKUs, lojasQuery, filtro.dataInicio);
  const estoquesFim = await getEstoquesEmLote(todosSKUs, lojasQuery, filtro.dataFim);

  console.log(`[Raio X] Buscando vendas em lote...`);
  const vendas = await getVendasEmLote(todosCodes, lojasQuery, filtro.dataInicio, filtro.dataFim);

  console.log(`[Raio X] Buscando informações das lojas...`);
  const lojas = await prisma.branches.findMany({
    where: { branch_code: { in: lojasQuery } },
  });
  const lojasMap = new Map(lojas.map(l => [l.branch_code, l]));

  console.log(`[Raio X] Montando resposta...`);

  // Monta a resposta
  const resultado: RaioXProduto[] = [];

  for (const [key, produtosGrupo] of produtosMap.entries()) {
    const primeiroProduto = produtosGrupo[0];

    const produtoResult: RaioXProduto = {
      referenceCode: primeiroProduto.reference_code,
      referenceName: primeiroProduto.reference_name,
      cor: !filtro.agruparPorCor ? (primeiroProduto.color_name || primeiroProduto.color_code || undefined) : undefined,
      productCode: primeiroProduto.product_code,
      emPromocao: primeiroProduto.class_motor_promocional ? true : false,
      lojas: [],
      totalGeral: {
        estoqueInicial: 0,
        transferencias: 0,
        vendasVarejo: 0,
        vendasAtacado: 0,
        estoqueFinal: 0,
        cobertura: 0,
      },
    };

    // Para cada loja
    for (const branchCode of lojasQuery) {
      const loja = lojasMap.get(branchCode);
      if (!loja) continue;

      const lojaResult: RaioXLoja = {
        branchCode,
        branchName: loja.branch_name,
        grades: [],
        totais: {
          estoqueInicial: 0,
          transferencias: 0,
          vendasVarejo: 0,
          vendasAtacado: 0,
          estoqueFinal: 0,
          cobertura: 0,
        },
      };

      // Para cada tamanho do produto
      for (const produto of produtosGrupo) {
        const estoqueInicial = estoquesInicio.get(`${produto.product_sku}|${branchCode}`) || 0;
        const transferencias = 0; // TODO: implementar quando soubermos onde está

        // Busca vendas no Map
        let vendasVarejo = vendas.get(`${produto.product_code}|${branchCode}|varejo`) || 0;
        let vendasAtacado = vendas.get(`${produto.product_code}|${branchCode}|atacado`) || 0;

        // Aplica filtro de canal
        if (filtro.canal === 'varejo') {
          vendasAtacado = 0;
        } else if (filtro.canal === 'atacado') {
          vendasVarejo = 0;
        }

        const estoqueFinal = estoquesFim.get(`${produto.product_sku}|${branchCode}`) || 0;
        const cobertura = calcularCobertura(estoqueFinal, vendasVarejo, vendasAtacado, filtro.dataInicio, filtro.dataFim);

        lojaResult.grades.push({
          tamanho: produto.size || '-',
          estoqueInicial,
          transferencias,
          vendasVarejo,
          vendasAtacado,
          estoqueFinal,
          cobertura,
        });

        lojaResult.totais.estoqueInicial += estoqueInicial;
        lojaResult.totais.transferencias += transferencias;
        lojaResult.totais.vendasVarejo += vendasVarejo;
        lojaResult.totais.vendasAtacado += vendasAtacado;
        lojaResult.totais.estoqueFinal += estoqueFinal;
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
