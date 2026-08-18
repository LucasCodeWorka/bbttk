import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { OPERACAO_JOIN, IS_VENDA, IS_DEVOLUCAO, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL } from './relatorioBase.service.js';

// Relatório 5: Venda e Desconto por Classificação
// Relatório 5.1: Resumo da Promoção por Loja

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// ========== Interfaces ==========

export interface VendaDescontoFiltro {
  dataInicio: string; // YYYY-MM-DD
  dataFim: string;    // YYYY-MM-DD
  branches?: number[];
  agruparLojas?: boolean; // Se true, agrupa todas as lojas selecionadas em uma única linha
  classificacao: 'categoria' | 'linha' | 'colecao' | 'status';
  itensClassificacao?: string[]; // Valores específicos da classificação selecionada
}

export interface VendaDescontoRow {
  codigo: string;
  descricao: string;
  categoria: string | null;
  linha: string | null;
  status: string | null;
  colecao: string | null;
  custoProducao: number;
  pdvOriginal: number;
  pdvAtual: number;
  markup: number;
  descontoPct: number;
  pdvVenda: number; // Preço médio real de venda
  vendas: number; // Quantidade vendida
  estoqueFim: number; // Estoque final
  giro: number; // % (vendas / (vendas + estoque))
  ttEstqVdaOriginal: number; // Estoque * PDV Original
  ttEstqVdaAtual: number; // Estoque * PDV Atual
  pctDesconto: number; // % desconto do estoque
  ttVdaVda: number; // Faturamento das vendas
  ttDescontoVenda: number; // Desconto total concedido nas vendas
}

export interface VendaDescontoTotais {
  vendas: number;
  estoqueFim: number;
  giro: number;
  ttEstqVdaOriginal: number;
  ttEstqVdaAtual: number;
  pctDesconto: number;
  ttVdaVda: number;
  ttDescontoVenda: number;
}

export interface VendaDescontoGerais {
  vendaTotalGeralQtd: number;
  participacaoPromoQtd: number;
  vendaTotalGeralValor: number;
  participacaoPromoValor: number;
}

export interface VendaDescontoResponse {
  filtro: VendaDescontoFiltro;
  rows: VendaDescontoRow[];
  totais: VendaDescontoTotais;
  gerais: VendaDescontoGerais;
}

// ========== Relatório 5.1: Resumo por Loja ==========

export interface ResumoPromocaoLojaRow {
  branchCode: number;
  branchName: string;
  vendaTotalPromo: number;
  vendaTotalGeralPeriodo: number;
  participacaoPromoPct: number;
  estoqueFinalPromo: number;
  estoqueFinalGeralPecas: number;
  participacaoEstoquePromoPct: number;
}

export interface ResumoPromocaoResponse {
  filtro: Omit<VendaDescontoFiltro, 'classificacao' | 'itensClassificacao'> & {
    statusPromo?: string[];
  };
  rows: ResumoPromocaoLojaRow[];
}

// ========== Funções Auxiliares ==========

function buildBranchFilter(branches?: number[], alias = 't'): Prisma.Sql {
  if (!branches || branches.length === 0) {
    // Exclui Fábrica (branch_code = 2) por padrão
    if (alias === 'ps') return Prisma.sql`ps.branch_code != 2`;
    return Prisma.sql`t.branch_code != 2`;
  }
  if (alias === 'ps') return Prisma.sql`ps.branch_code IN (${Prisma.join(branches)})`;
  return Prisma.sql`t.branch_code IN (${Prisma.join(branches)})`;
}

function buildClassificacaoFilter(
  classificacao: VendaDescontoFiltro['classificacao'],
  itens?: string[]
): Prisma.Sql {
  if (!itens || itens.length === 0) {
    return Prisma.sql`TRUE`;
  }

  const coluna = {
    categoria: Prisma.sql`a.class_categoria`,
    linha: Prisma.sql`a.class_linha`,
    colecao: Prisma.sql`a.class_colecao`,
    status: Prisma.sql`a.class_status`,
  }[classificacao];

  return Prisma.sql`TRIM(${coluna}) IN (${Prisma.join(itens)})`;
}

// ========== Relatório 5: Detalhado ==========

export async function getVendaDesconto(filtro: VendaDescontoFiltro): Promise<VendaDescontoResponse> {
  const { dataInicio, dataFim, branches, classificacao, itensClassificacao } = filtro;

  const branchFilter = buildBranchFilter(branches);
  const classFilter = buildClassificacaoFilter(classificacao, itensClassificacao);

  // Query principal: vendas com desconto por produto
  // PDV Original = ti.value (preço cheio antes do desconto)
  // PDV Atual = ti.net_value (preço efetivo após desconto)
  // Quando não há promoção, PDV Atual = PDV Original
  const rows = await prisma.$queryRaw<Array<{
    codigo: string;
    descricao: string;
    categoria: string | null;
    linha: string | null;
    status: string | null;
    colecao: string | null;
    custo_producao: Decimal | null;
    pdv_original: Decimal;
    pdv_atual: Decimal;
    pdv_venda: Decimal;
    vendas: Decimal;
    estoque_fim: Decimal;
    tt_vda_vda: Decimal;
    tt_desconto_venda: Decimal;
  }>>`
    WITH vendas_periodo AS (
      SELECT
        p.product_sku AS codigo,
        COALESCE(p.reference_name, p.product_name, p.product_sku) AS descricao,
        TRIM(a.class_categoria) AS categoria,
        TRIM(a.class_linha) AS linha,
        TRIM(a.class_status) AS status,
        TRIM(a.class_colecao) AS colecao,
        p.product_code,
        -- Quantidade com sinal (devolução negativa)
        SUM(${QUANTIDADE_COM_SINAL}) AS vendas,
        -- Faturamento líquido
        SUM(
          CASE
            WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0))
            ELSE COALESCE(ti.net_value, ti.value, 0)
          END
        ) AS tt_vda_vda,
        -- PDV Original (preço cheio) - média ponderada
        CASE
          WHEN SUM(${QUANTIDADE_COM_SINAL}) != 0
          THEN SUM(COALESCE(ti.value, 0)) / NULLIF(SUM(ABS(${QUANTIDADE_COM_SINAL})), 0)
          ELSE 0
        END AS pdv_original,
        -- PDV Atual (preço após desconto) - média ponderada
        CASE
          WHEN SUM(${QUANTIDADE_COM_SINAL}) != 0
          THEN SUM(COALESCE(ti.net_value, ti.value, 0)) / NULLIF(SUM(ABS(${QUANTIDADE_COM_SINAL})), 0)
          ELSE 0
        END AS pdv_atual,
        -- Desconto total concedido
        SUM(
          CASE
            WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.value, 0) - COALESCE(ti.net_value, ti.value, 0))
            ELSE COALESCE(ti.value, 0) - COALESCE(ti.net_value, ti.value, 0)
          END
        ) AS tt_desconto_venda
      FROM transacoes t
      JOIN transacao_itens ti ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
      JOIN produtos p ON p.product_code = ti.product_code
      LEFT JOIN produto_analitico a ON a.product_sku = p.product_sku
      ${OPERACAO_JOIN}
      WHERE t.transaction_date BETWEEN ${dataInicio}::date AND ${dataFim}::date
        AND t.status = 4
        AND ${SALE_OPERATION_FILTER}
        AND t.customer_code < 110000000
        AND ${branchFilter}
        AND ${classFilter}
      GROUP BY
        p.product_sku, p.reference_name, p.product_name, p.product_code,
        a.class_categoria, a.class_linha, a.class_status, a.class_colecao
      HAVING SUM(${QUANTIDADE_COM_SINAL}) > 0
    ),
    estoque_atual AS (
      SELECT DISTINCT ON (ps.product_sku)
        ps.product_sku,
        ps.product_code,
        COALESCE(SUM(ps.stock) OVER (PARTITION BY ps.product_sku), 0) AS estoque
      FROM prd_saldo ps
      WHERE ps.stock_code = 1
      ORDER BY ps.product_sku, ps.captured_at DESC
    ),
    custos AS (
      SELECT DISTINCT ON (pc.product_code)
        pc.product_code,
        pc.valor AS custo
      FROM produto_custos pc
      WHERE pc.cost_code = 2
      ORDER BY pc.product_code, pc.synced_at DESC
    )
    SELECT
      v.codigo,
      v.descricao,
      v.categoria,
      v.linha,
      v.status,
      v.colecao,
      c.custo AS custo_producao,
      v.pdv_original,
      v.pdv_atual,
      -- Preço médio real de venda
      CASE WHEN v.vendas > 0 THEN v.tt_vda_vda / v.vendas ELSE 0 END AS pdv_venda,
      v.vendas,
      COALESCE(e.estoque, 0) AS estoque_fim,
      v.tt_vda_vda,
      v.tt_desconto_venda
    FROM vendas_periodo v
    LEFT JOIN estoque_atual e ON e.product_code = v.product_code
    LEFT JOIN custos c ON c.product_code = v.product_code
    ORDER BY v.vendas DESC
  `;

  // Processa os resultados
  const processedRows: VendaDescontoRow[] = rows.map((row) => {
    const custoProducao = decimalToNumber(row.custo_producao);
    const pdvOriginal = decimalToNumber(row.pdv_original);
    const pdvAtual = decimalToNumber(row.pdv_atual);
    const pdvVenda = decimalToNumber(row.pdv_venda);
    const vendas = decimalToNumber(row.vendas);
    const estoqueFim = decimalToNumber(row.estoque_fim);
    const ttVdaVda = decimalToNumber(row.tt_vda_vda);
    const ttDescontoVenda = decimalToNumber(row.tt_desconto_venda);

    // Markup = PDV Atual / Custo
    const markup = custoProducao > 0 ? round(pdvAtual / custoProducao, 2) : 0;

    // % Desconto = (PDV Original - PDV Atual) / PDV Original * 100
    const descontoPct = pdvOriginal > 0 ? round(((pdvOriginal - pdvAtual) / pdvOriginal) * 100, 2) : 0;

    // Giro = Vendas / (Vendas + Estoque) * 100
    const giro = vendas + estoqueFim > 0 ? round((vendas / (vendas + estoqueFim)) * 100, 2) : 0;

    // TT Estoque * PDV Original / Atual
    const ttEstqVdaOriginal = round(estoqueFim * pdvOriginal, 2);
    const ttEstqVdaAtual = round(estoqueFim * pdvAtual, 2);

    // % Desconto do estoque
    const pctDesconto = ttEstqVdaOriginal > 0
      ? round(((ttEstqVdaOriginal - ttEstqVdaAtual) / ttEstqVdaOriginal) * 100, 2)
      : 0;

    return {
      codigo: row.codigo,
      descricao: row.descricao,
      categoria: row.categoria,
      linha: row.linha,
      status: row.status,
      colecao: row.colecao,
      custoProducao: round(custoProducao, 2),
      pdvOriginal: round(pdvOriginal, 2),
      pdvAtual: round(pdvAtual, 2),
      markup,
      descontoPct,
      pdvVenda: round(pdvVenda, 2),
      vendas: round(vendas, 0),
      estoqueFim: round(estoqueFim, 0),
      giro,
      ttEstqVdaOriginal,
      ttEstqVdaAtual,
      pctDesconto,
      ttVdaVda: round(ttVdaVda, 2),
      ttDescontoVenda: round(ttDescontoVenda, 2),
    };
  });

  // Calcula totais
  const totais: VendaDescontoTotais = {
    vendas: processedRows.reduce((sum, r) => sum + r.vendas, 0),
    estoqueFim: processedRows.reduce((sum, r) => sum + r.estoqueFim, 0),
    giro: 0,
    ttEstqVdaOriginal: processedRows.reduce((sum, r) => sum + r.ttEstqVdaOriginal, 0),
    ttEstqVdaAtual: processedRows.reduce((sum, r) => sum + r.ttEstqVdaAtual, 0),
    pctDesconto: 0,
    ttVdaVda: processedRows.reduce((sum, r) => sum + r.ttVdaVda, 0),
    ttDescontoVenda: processedRows.reduce((sum, r) => sum + r.ttDescontoVenda, 0),
  };

  // Calcula giro e pct desconto dos totais
  totais.giro = totais.vendas + totais.estoqueFim > 0
    ? round((totais.vendas / (totais.vendas + totais.estoqueFim)) * 100, 2)
    : 0;
  totais.pctDesconto = totais.ttEstqVdaOriginal > 0
    ? round(((totais.ttEstqVdaOriginal - totais.ttEstqVdaAtual) / totais.ttEstqVdaOriginal) * 100, 2)
    : 0;

  // Busca totais gerais do período (todas as vendas, não apenas as filtradas)
  const geraisResult = await prisma.$queryRaw<Array<{
    total_qtd: Decimal;
    total_valor: Decimal;
  }>>`
    SELECT
      COALESCE(SUM(${QUANTIDADE_COM_SINAL}), 0) AS total_qtd,
      COALESCE(SUM(
        CASE
          WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0))
          ELSE COALESCE(ti.net_value, ti.value, 0)
        END
      ), 0) AS total_valor
    FROM transacoes t
    JOIN transacao_itens ti ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
    ${OPERACAO_JOIN}
    WHERE t.transaction_date BETWEEN ${dataInicio}::date AND ${dataFim}::date
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND t.customer_code < 110000000
      AND ${branchFilter}
  `;

  const vendaTotalGeralQtd = decimalToNumber(geraisResult[0]?.total_qtd);
  const vendaTotalGeralValor = decimalToNumber(geraisResult[0]?.total_valor);

  const gerais: VendaDescontoGerais = {
    vendaTotalGeralQtd: round(vendaTotalGeralQtd, 0),
    participacaoPromoQtd: vendaTotalGeralQtd > 0
      ? round((totais.vendas / vendaTotalGeralQtd) * 100, 2)
      : 0,
    vendaTotalGeralValor: round(vendaTotalGeralValor, 2),
    participacaoPromoValor: vendaTotalGeralValor > 0
      ? round((totais.ttVdaVda / vendaTotalGeralValor) * 100, 2)
      : 0,
  };

  return {
    filtro,
    rows: processedRows,
    totais,
    gerais,
  };
}

// ========== Relatório 5.1: Resumo por Loja ==========

export async function getResumoPromocao(filtro: {
  dataInicio: string;
  dataFim: string;
  branches?: number[];
  statusPromo?: string[]; // Status que identificam promoção (ex: "PROMOCAO", "LIQUIDACAO")
}): Promise<ResumoPromocaoResponse> {
  const { dataInicio, dataFim, branches, statusPromo } = filtro;

  // Se não especificou status de promoção, usa todos os status que NÃO são "ATIVO"
  // (assumindo que produtos em promoção têm status diferente de ATIVO)
  const statusFilter = statusPromo && statusPromo.length > 0
    ? Prisma.sql`TRIM(a.class_status) IN (${Prisma.join(statusPromo)})`
    : Prisma.sql`TRIM(a.class_status) NOT IN ('ATIVO', '')`;

  const branchFilter = buildBranchFilter(branches, 't');
  const branchFilterPs = buildBranchFilter(branches, 'ps');

  // Query para resumo por loja
  const rows = await prisma.$queryRaw<Array<{
    branch_code: number;
    branch_name: string;
    venda_promo_valor: Decimal;
    venda_total_valor: Decimal;
    estoque_promo_pecas: Decimal;
    estoque_total_pecas: Decimal;
  }>>`
    WITH vendas_por_loja AS (
      SELECT
        t.branch_code,
        MAX(TRIM(REGEXP_REPLACE(
          REGEXP_REPLACE(
            COALESCE(b.description, b.branch_name, ''),
            '^[[:space:]]*[0-9]+[[:space:]]*[-–—]?[[:space:]]*',
            ''
          ),
          '^BEBETENKITE[[:space:]]*-[[:space:]]*',
          '',
          'i'
        ))) AS branch_name,
        -- Faturamento em promoção
        SUM(
          CASE
            WHEN ${statusFilter} THEN
              CASE
                WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0))
                ELSE COALESCE(ti.net_value, ti.value, 0)
              END
            ELSE 0
          END
        ) AS venda_promo_valor,
        -- Faturamento total
        SUM(
          CASE
            WHEN ${IS_DEVOLUCAO} THEN -ABS(COALESCE(ti.net_value, ti.value, 0))
            ELSE COALESCE(ti.net_value, ti.value, 0)
          END
        ) AS venda_total_valor
      FROM transacoes t
      JOIN transacao_itens ti ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
      JOIN produtos p ON p.product_code = ti.product_code
      LEFT JOIN produto_analitico a ON a.product_sku = p.product_sku
      LEFT JOIN branches b ON b.branch_code = t.branch_code
      ${OPERACAO_JOIN}
      WHERE t.transaction_date BETWEEN ${dataInicio}::date AND ${dataFim}::date
        AND t.status = 4
        AND ${SALE_OPERATION_FILTER}
        AND t.customer_code < 110000000
        AND ${branchFilter}
      GROUP BY t.branch_code
    ),
    estoque_por_loja AS (
      SELECT
        ps.branch_code,
        -- Estoque em promoção
        SUM(
          CASE
            WHEN ${statusFilter} THEN COALESCE(ps.stock, 0)
            ELSE 0
          END
        ) AS estoque_promo_pecas,
        -- Estoque total
        SUM(COALESCE(ps.stock, 0)) AS estoque_total_pecas
      FROM (
        SELECT DISTINCT ON (product_sku, branch_code, stock_code)
          product_sku, branch_code, stock, product_code
        FROM prd_saldo
        WHERE stock_code = 1
        ORDER BY product_sku, branch_code, stock_code, captured_at DESC
      ) ps
      JOIN produtos p ON p.product_sku = ps.product_sku
      LEFT JOIN produto_analitico a ON a.product_sku = ps.product_sku
      WHERE ${branchFilterPs}
      GROUP BY ps.branch_code
    )
    SELECT
      v.branch_code,
      v.branch_name,
      COALESCE(v.venda_promo_valor, 0) AS venda_promo_valor,
      COALESCE(v.venda_total_valor, 0) AS venda_total_valor,
      COALESCE(e.estoque_promo_pecas, 0) AS estoque_promo_pecas,
      COALESCE(e.estoque_total_pecas, 0) AS estoque_total_pecas
    FROM vendas_por_loja v
    LEFT JOIN estoque_por_loja e ON e.branch_code = v.branch_code
    ORDER BY v.branch_code
  `;

  const processedRows: ResumoPromocaoLojaRow[] = rows.map((row) => {
    const vendaTotalPromo = decimalToNumber(row.venda_promo_valor);
    const vendaTotalGeralPeriodo = decimalToNumber(row.venda_total_valor);
    const estoqueFinalPromo = decimalToNumber(row.estoque_promo_pecas);
    const estoqueFinalGeralPecas = decimalToNumber(row.estoque_total_pecas);

    return {
      branchCode: row.branch_code,
      branchName: row.branch_name,
      vendaTotalPromo: round(vendaTotalPromo, 2),
      vendaTotalGeralPeriodo: round(vendaTotalGeralPeriodo, 2),
      participacaoPromoPct: vendaTotalGeralPeriodo > 0
        ? round((vendaTotalPromo / vendaTotalGeralPeriodo) * 100, 2)
        : 0,
      estoqueFinalPromo: round(estoqueFinalPromo, 0),
      estoqueFinalGeralPecas: round(estoqueFinalGeralPecas, 0),
      participacaoEstoquePromoPct: estoqueFinalGeralPecas > 0
        ? round((estoqueFinalPromo / estoqueFinalGeralPecas) * 100, 2)
        : 0,
    };
  });

  return {
    filtro: {
      dataInicio,
      dataFim,
      branches,
      statusPromo,
    },
    rows: processedRows,
  };
}

// ========== Filtros disponíveis ==========

export interface VendaDescontoFiltrosDisponiveis {
  categorias: string[];
  linhas: string[];
  colecoes: string[];
  status: string[];
  branches: Array<{ branch_code: number; branch_name: string }>;
}

export async function getFiltrosVendaDesconto(): Promise<VendaDescontoFiltrosDisponiveis> {
  const [categorias, linhas, colecoes, status, branches] = await Promise.all([
    prisma.$queryRaw<Array<{ valor: string }>>`
      SELECT DISTINCT TRIM(class_categoria) AS valor
      FROM produto_analitico
      WHERE class_categoria IS NOT NULL AND TRIM(class_categoria) != ''
      ORDER BY valor
    `,
    prisma.$queryRaw<Array<{ valor: string }>>`
      SELECT DISTINCT TRIM(class_linha) AS valor
      FROM produto_analitico
      WHERE class_linha IS NOT NULL AND TRIM(class_linha) != ''
      ORDER BY valor
    `,
    prisma.$queryRaw<Array<{ valor: string }>>`
      SELECT DISTINCT TRIM(class_colecao) AS valor
      FROM produto_analitico
      WHERE class_colecao IS NOT NULL AND TRIM(class_colecao) != ''
      ORDER BY valor
    `,
    prisma.$queryRaw<Array<{ valor: string }>>`
      SELECT DISTINCT TRIM(class_status) AS valor
      FROM produto_analitico
      WHERE class_status IS NOT NULL AND TRIM(class_status) != ''
      ORDER BY valor
    `,
    prisma.$queryRaw<Array<{ branch_code: number; branch_name: string }>>`
      SELECT
        branch_code,
        TRIM(REGEXP_REPLACE(
          REGEXP_REPLACE(
            COALESCE(description, branch_name, ''),
            '^[[:space:]]*[0-9]+[[:space:]]*[-–—]?[[:space:]]*',
            ''
          ),
          '^BEBETENKITE[[:space:]]*-[[:space:]]*',
          '',
          'i'
        )) AS branch_name
      FROM branches
      WHERE branch_code != 2
      ORDER BY branch_code
    `,
  ]);

  return {
    categorias: categorias.map((r) => r.valor),
    linhas: linhas.map((r) => r.valor),
    colecoes: colecoes.map((r) => r.valor),
    status: status.map((r) => r.valor),
    branches,
  };
}
