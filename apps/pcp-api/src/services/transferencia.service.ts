import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { FILIAIS } from '../config/constants.js';
import { PCP_ESTOQUE_LIQUIDO_SKU_FILTER } from './relatorioBase.service.js';

export interface TransferenciaFiltro {
  referencia?: string; // Busca por referÃªncia especÃ­fica (opcional - vazio = todas)
  agruparPorCor?: boolean; // true = uma linha por cor, false = agrupa tudo
}

// Cada linha representa UMA LOJA
export interface TransferenciaLoja {
  branchCode: number;
  branchName: string;
  // Map de tamanho -> quantidade em estoque
  estoquePorTamanho: Record<string, number>;
  estoqueTotal: number;
  // Map de tamanho -> quantidade vendida no periodo
  vendasPorTamanho: Record<string, number>;
  // Map de tamanho -> dias de cobertura
  coberturaPorTamanho: Record<string, number>;
}

// Agrupa linhas de uma mesma referÃªncia+cor (ou sÃ³ referÃªncia se agruparPorCor=false)
export interface TransferenciaGrupo {
  referencia: string;
  descricao: string;
  cor: string | null; // null se agruparPorCor=false
  tamanhos: string[]; // Lista ordenada de tamanhos que existem nesse grupo
  lojas: TransferenciaLoja[];
}

export interface TransferenciaResponse {
  grupos: TransferenciaGrupo[];
}

function decimalToNumber(value: Decimal | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}
function cleanBranchName(branchCode: number, branchName: string | null, referenceCode: string): string {
  const configuredName = FILIAIS[branchCode];
  if (configuredName) return configuredName;

  const fallback = branchName || `Loja ${branchCode}`;
  return fallback
    .replace(new RegExp(referenceCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
    .replace(/\s*[-|/]\s*$/g, '')
    .replace(/^\s*[-|/]\s*/g, '')
    .trim() || `Loja ${branchCode}`;
}

/**
 * RelatÃ³rio de GestÃ£o de TransferÃªncia
 * Retorna distribuiÃ§Ã£o de estoque por loja e tamanho
 * Se referencia nÃ£o for informada, retorna TODAS as referÃªncias
 */
export async function getTransferencia(filtro: TransferenciaFiltro): Promise<TransferenciaResponse> {
  const agruparPorCor = filtro.agruparPorCor ?? true;
  const temFiltroReferencia = filtro.referencia && filtro.referencia.trim();

  // Buscar configuracao para periodo de analise de vendas
  const config = await prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: 'gestao_transferencia' },
    create: { relatorio: 'gestao_transferencia' },
    update: {},
  });

  const diasAnalise = config.diasAnaliseVendas;
  const limiteVerde = config.transferenciaCoberturaDiasVerde;
  const limiteAmarelo = config.transferenciaCoberturaDiasAmarelo;
  const dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - diasAnalise);

  // Query: busca estoque atual de todos os SKUs (TODAS as lojas, incluindo estoque = 0)
  // Se filtro.referencia estiver vazio, traz TODAS as referÃªncias
  // OTIMIZAÃ‡ÃƒO: SÃ³ retorna SKUs que tÃªm oportunidade de transferÃªncia (verde ou vermelho em alguma loja)
  const whereReferencia = temFiltroReferencia
    ? Prisma.sql`AND p.reference_code ILIKE ${`%${filtro.referencia}%`}`
    : Prisma.sql``;

  const queryEstoque = Prisma.sql`
    WITH skus_ref AS (
      SELECT DISTINCT p.product_sku, p.reference_code, p.product_name, p.color_name, p.size
      FROM produtos p
      JOIN produto_analitico a ON a.product_sku = p.product_sku
      WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${whereReferencia}
    ),
    lojas AS (
      SELECT branch_code, description
      FROM branches
      WHERE branch_code != 2
    ),
    -- SKUs que jÃ¡ tiveram entrada em cada loja (transferÃªncias recebidas)
    skus_com_entrada AS (
      SELECT DISTINCT ti.product_code, ti.branch_code
      FROM transacao_itens ti
      INNER JOIN transacoes t ON t.transaction_code = ti.transaction_code AND t.branch_code = ti.branch_code
      INNER JOIN classificacao_operacoes co ON t.operation_code = co.operation_code
      WHERE co.operations_type = 'E'
        AND ti.branch_code != 2
    ),
    -- Vendas recentes por SKU e loja
    vendas_recentes AS (
      SELECT
        p.product_code,
        ti.branch_code,
        COALESCE(SUM(ti.quantity), 0) as quantidade_vendida
      FROM transacao_itens ti
      INNER JOIN transacoes t ON t.transaction_code = ti.transaction_code AND t.branch_code = ti.branch_code
      INNER JOIN produtos p ON ti.product_code = p.product_code
      WHERE t.status = 4
        AND t.transaction_date >= ${dataInicio}
        AND ti.branch_code != 2
        AND t.customer_code < 110000000
      GROUP BY p.product_code, ti.branch_code
    ),
    -- Calcula cobertura de cada SKU em cada loja
    cobertura_calc AS (
      SELECT
        p.product_code,
        sce.branch_code,
        COALESCE(SUM(ps.stock), 0) as estoque,
        COALESCE(vr.quantidade_vendida, 0) as vendas,
        CASE
          WHEN COALESCE(vr.quantidade_vendida, 0) > 0
            THEN (COALESCE(SUM(ps.stock), 0) / (COALESCE(vr.quantidade_vendida, 0) / ${diasAnalise}))
          WHEN COALESCE(SUM(ps.stock), 0) > 0
            THEN 9999
          ELSE 0
        END as cobertura_dias
      FROM skus_com_entrada sce
      INNER JOIN produtos p ON p.product_code = sce.product_code
      LEFT JOIN prd_saldo ps ON ps.product_sku = p.product_sku
        AND ps.branch_code = sce.branch_code
        AND ps.is_full_snapshot = true
        AND ps.stock_code = 1
      LEFT JOIN vendas_recentes vr ON vr.product_code = p.product_code
        AND vr.branch_code = sce.branch_code
      GROUP BY p.product_code, sce.branch_code, vr.quantidade_vendida
    ),
    -- Filtra apenas SKUs que tÃªm oportunidade real de transferÃªncia:
    -- Precisa ter pelo menos uma loja VERDE (precisa receber) E uma loja VERMELHA (pode enviar)
    skus_com_verde AS (
      SELECT DISTINCT product_code
      FROM cobertura_calc
      WHERE cobertura_dias > 0 AND cobertura_dias < ${limiteVerde}
    ),
    skus_com_vermelho AS (
      SELECT DISTINCT product_code
      FROM cobertura_calc
      WHERE cobertura_dias > ${limiteAmarelo}
    ),
    skus_com_oportunidade AS (
      SELECT product_code
      FROM skus_com_verde
      INTERSECT
      SELECT product_code
      FROM skus_com_vermelho
    )
    SELECT
      s.reference_code,
      s.product_name,
      s.color_name,
      s.size,
      l.branch_code,
      l.description as branch_name,
      COALESCE(SUM(ps.stock), 0) as estoque
    FROM skus_ref s
    CROSS JOIN lojas l
    INNER JOIN produtos p ON p.product_sku = s.product_sku
    -- Filtra SKUs que jÃ¡ tiveram entrada nesta loja
    INNER JOIN skus_com_entrada sce ON sce.product_code = p.product_code AND sce.branch_code = l.branch_code
    -- NOVO: Filtra apenas SKUs com oportunidade de transferÃªncia
    INNER JOIN skus_com_oportunidade sco ON sco.product_code = p.product_code
    LEFT JOIN prd_saldo ps ON ps.product_sku = s.product_sku
      AND ps.branch_code = l.branch_code
      AND ps.is_full_snapshot = true
      AND ps.stock_code = 1
    GROUP BY s.reference_code, s.product_name, s.color_name, s.size, l.branch_code, l.description
    HAVING COALESCE(SUM(ps.stock), 0) > 0
    ORDER BY s.reference_code, s.color_name, s.size, l.branch_code
  `;

  // Query: busca vendas dos ultimos N dias para calcular cobertura
  const whereReferenciaVendas = temFiltroReferencia
    ? Prisma.sql`AND p.reference_code ILIKE ${`%${filtro.referencia}%`}`
    : Prisma.sql``;

  const queryVendas = Prisma.sql`
    SELECT
      p.reference_code,
      p.color_name,
      p.size,
      ti.branch_code,
      COALESCE(SUM(ti.quantity), 0) as quantidade_vendida
    FROM transacao_itens ti
    INNER JOIN transacoes t ON t.transaction_code = ti.transaction_code AND t.branch_code = ti.branch_code
    INNER JOIN produtos p ON ti.product_code = p.product_code
    INNER JOIN produto_analitico a ON a.product_sku = p.product_sku
    WHERE t.status = 4
      AND t.transaction_date >= ${dataInicio}
      ${whereReferenciaVendas}
      AND ti.branch_code != 2
      AND t.customer_code < 110000000
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
    GROUP BY p.reference_code, p.color_name, p.size, ti.branch_code
  `;

  interface EstoqueRow {
    reference_code: string | null;
    product_name: string | null;
    color_name: string | null;
    size: string | null;
    branch_code: number;
    branch_name: string | null;
    estoque: Decimal;
  }

  interface VendasRow {
    reference_code: string | null;
    color_name: string | null;
    size: string | null;
    branch_code: number;
    quantidade_vendida: Decimal;
  }

  const [rowsEstoque, rowsVendas] = await Promise.all([
    prisma.$queryRaw<EstoqueRow[]>(queryEstoque),
    prisma.$queryRaw<VendasRow[]>(queryVendas),
  ]);

  if (rowsEstoque.length === 0) {
    return { grupos: [] };
  }

  // Construir mapa de vendas: ref|cor|tamanho|branchCode -> quantidade vendida
  const vendasMap = new Map<string, number>();
  for (const vRow of rowsVendas) {
    const key = `${vRow.reference_code || ''}|${vRow.color_name || ''}|${vRow.size || ''}|${vRow.branch_code}`;
    vendasMap.set(key, decimalToNumber(vRow.quantidade_vendida));
  }

  // Agrupar por (referencia, cor?) -> lojas -> tamanhos
  const gruposMap = new Map<string, TransferenciaGrupo>();

  for (const row of rowsEstoque) {
    const ref = row.reference_code || '';
    const cor = row.color_name;
    const tamanho = row.size || 'UNICO';
    const branchCode = row.branch_code;
    const branchName = cleanBranchName(branchCode, row.branch_name, ref);
    const estoque = decimalToNumber(row.estoque);

    // Chave do grupo: ref ou ref+cor dependendo do toggle
    const grupoKey = agruparPorCor && cor ? `${ref}|${cor}` : ref;

    if (!gruposMap.has(grupoKey)) {
      gruposMap.set(grupoKey, {
        referencia: ref,
        descricao: row.product_name || ref,
        cor: agruparPorCor ? cor : null,
        tamanhos: [],
        lojas: [],
      });
    }

    const grupo = gruposMap.get(grupoKey)!;

    // Adicionar tamanho se ainda nÃ£o existe
    if (!grupo.tamanhos.includes(tamanho)) {
      grupo.tamanhos.push(tamanho);
    }

    // Encontrar ou criar entrada da loja
    let loja = grupo.lojas.find((l) => l.branchCode === branchCode);
    if (!loja) {
      loja = {
        branchCode,
        branchName,
        estoquePorTamanho: {},
        estoqueTotal: 0,
        vendasPorTamanho: {},
        coberturaPorTamanho: {},
      };
      grupo.lojas.push(loja);
    }

    // Buscar vendas para este SKU/loja
    const vendasKey = `${ref}|${cor || ''}|${tamanho}|${branchCode}`;
    const vendas = vendasMap.get(vendasKey) || 0;

    // Somar estoque e vendas no tamanho (se agruparPorCor=false, pode ter mÃºltiplas cores somando)
    loja.estoquePorTamanho[tamanho] = (loja.estoquePorTamanho[tamanho] || 0) + estoque;
    loja.vendasPorTamanho[tamanho] = (loja.vendasPorTamanho[tamanho] || 0) + vendas;
    loja.estoqueTotal += estoque;
  }

  // Recalcular cobertura agregada por tamanho (agora que temos vendas e estoque somados)
  // Usar 9999 em vez de Infinity para facilitar serializaÃ§Ã£o JSON e comparaÃ§Ãµes
  const COBERTURA_SEM_VENDAS = 9999;

  for (const grupo of gruposMap.values()) {
    for (const loja of grupo.lojas) {
      for (const tamanho of grupo.tamanhos) {
        const estoque = loja.estoquePorTamanho[tamanho] || 0;
        const vendas = loja.vendasPorTamanho[tamanho] || 0;

        if (vendas > 0) {
          const vendasPorDia = vendas / diasAnalise;
          loja.coberturaPorTamanho[tamanho] = estoque / vendasPorDia;
        } else if (estoque > 0) {
          loja.coberturaPorTamanho[tamanho] = COBERTURA_SEM_VENDAS;
        } else {
          loja.coberturaPorTamanho[tamanho] = 0;
        }
      }
    }
  }

  // Remover lojas e tamanhos sem estoque antes de ordenar e responder.
  for (const grupo of gruposMap.values()) {
    grupo.lojas = grupo.lojas.filter((loja) => loja.estoqueTotal > 0);
    grupo.tamanhos = grupo.tamanhos.filter((tamanho) => {
      return grupo.lojas.some((loja) => (loja.estoquePorTamanho[tamanho] || 0) > 0);
    });
  }
  // Ordenar tamanhos de forma lÃ³gica (P, M, G, 2, 4, 6, etc.)
  for (const grupo of gruposMap.values()) {
    grupo.tamanhos.sort((a, b) => {
      const ordemPadrao = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'EG'];
      const aIdx = ordemPadrao.indexOf(a.toUpperCase());
      const bIdx = ordemPadrao.indexOf(b.toUpperCase());

      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;

      // Tentar comparar numericamente
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;

      return a.localeCompare(b);
    });

    // Ordenar lojas por branch_code
    grupo.lojas.sort((a, b) => a.branchCode - b.branchCode);
  }

  // Filtrar grupos que nÃ£o tÃªm estoque nenhum (todas as lojas com estoqueTotal = 0)
  const gruposComEstoque = Array.from(gruposMap.values()).filter((grupo) => {
    // Verificar se pelo menos uma loja tem estoqueTotal > 0
    return grupo.lojas.length > 0 && grupo.tamanhos.length > 0;
  });

  return {
    grupos: gruposComEstoque,
  };
}

/**
 * Busca referências disponíveis para o filtro de transferência
 * Retorna lista de referências com descrição e cor
 */
export interface ReferenciaSearchResult {
  referencia: string;
  descricao: string;
  cor?: string;
}

export async function buscarReferencias(
  search: string,
  limit: number = 20
): Promise<ReferenciaSearchResult[]> {
  const term = search.trim();

  // Se não tem termo, retorna as primeiras referências
  const whereClause = term
    ? Prisma.sql`WHERE reference_code ILIKE ${`%${term}%`} OR product_name ILIKE ${`%${term}%`}`
    : Prisma.sql``;

  interface RefRow {
    reference_code: string;
    product_name: string | null;
    color_name: string | null;
  }

  const rows = await prisma.$queryRaw<RefRow[]>`
    SELECT DISTINCT
      reference_code,
      MAX(product_name) as product_name,
      color_name
    FROM produtos
    ${whereClause}
    GROUP BY reference_code, color_name
    ORDER BY reference_code, color_name
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    referencia: row.reference_code,
    descricao: row.product_name || row.reference_code,
    cor: row.color_name || undefined,
  }));
}
