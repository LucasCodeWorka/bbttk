import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';

export interface TransferenciaFiltro {
  referencia?: string; // Busca por referência específica (opcional - vazio = todas)
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

// Agrupa linhas de uma mesma referência+cor (ou só referência se agruparPorCor=false)
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

/**
 * Relatório de Gestão de Transferência
 * Retorna distribuição de estoque por loja e tamanho
 * Se referencia não for informada, retorna TODAS as referências
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
  const dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - diasAnalise);

  // Query: busca estoque atual de todos os SKUs (TODAS as lojas, incluindo estoque = 0)
  // Se filtro.referencia estiver vazio, traz TODAS as referências
  const whereReferencia = temFiltroReferencia
    ? Prisma.sql`WHERE reference_code ILIKE ${`%${filtro.referencia}%`}`
    : Prisma.sql``;

  const queryEstoque = Prisma.sql`
    WITH skus_ref AS (
      SELECT DISTINCT product_sku, reference_code, product_name, color_name, size
      FROM produtos
      ${whereReferencia}
    ),
    lojas AS (
      SELECT branch_code, description
      FROM branches
      WHERE branch_code != 2
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
    LEFT JOIN prd_saldo ps ON ps.product_sku = s.product_sku
      AND ps.branch_code = l.branch_code
      AND ps.is_full_snapshot = true
      AND ps.stock_code = 1
    GROUP BY s.reference_code, s.product_name, s.color_name, s.size, l.branch_code, l.description
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
    WHERE t.status = 4
      AND t.transaction_date >= ${dataInicio}
      ${whereReferenciaVendas}
      AND ti.branch_code != 2
      AND t.customer_code < 110000000
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
    const branchName = row.branch_name || `Loja ${branchCode}`;
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

    // Adicionar tamanho se ainda não existe
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

    // Somar estoque e vendas no tamanho (se agruparPorCor=false, pode ter múltiplas cores somando)
    loja.estoquePorTamanho[tamanho] = (loja.estoquePorTamanho[tamanho] || 0) + estoque;
    loja.vendasPorTamanho[tamanho] = (loja.vendasPorTamanho[tamanho] || 0) + vendas;
    loja.estoqueTotal += estoque;
  }

  // Recalcular cobertura agregada por tamanho (agora que temos vendas e estoque somados)
  // Usar 9999 em vez de Infinity para facilitar serialização JSON e comparações
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

  // Ordenar tamanhos de forma lógica (P, M, G, 2, 4, 6, etc.)
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

  return {
    grupos: Array.from(gruposMap.values()),
  };
}
