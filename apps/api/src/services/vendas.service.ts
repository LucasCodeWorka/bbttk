import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';
import { FILIAIS, EXCLUDED_OPERATIONS, EXCLUDED_BRANCH_CODES, DEVOLUTION_OPERATIONS } from '../config/constants.js';
import { Decimal } from '@prisma/client/runtime/library';
import * as metasService from './metas.service.js';

// Operações de negócio (não venda, não devolução) sempre excluídas do cálculo
const EXCLUDED_OPERATIONS_LIST = [...EXCLUDED_OPERATIONS];
const DEVOLUTION_OPERATIONS_LIST = [...DEVOLUTION_OPERATIONS];
const EXCLUDED_BRANCH_LIST = [...EXCLUDED_BRANCH_CODES];

// Filtro reutilizado: transação não cancelada, operação de negócio válida.
// Inclui devoluções (elas entram com sinal negativo via DEVOLUTION_SIGN, não são excluídas).
const SALE_OPERATION_FILTER = Prisma.sql`(t.operation_code IS NULL OR t.operation_code NOT IN (${Prisma.join(EXCLUDED_OPERATIONS_LIST)}))`;
// Sinal: -1 para devolução (TOTVS operationMode='3'/operationsType='E'), +1 para venda
const DEVOLUTION_SIGN = Prisma.sql`(CASE WHEN t.operation_code IN (${Prisma.join(DEVOLUTION_OPERATIONS_LIST)}) THEN -1 ELSE 1 END)`;
// Só conta como "venda" (transação/cliente) quando não é devolução
const IS_SALE = Prisma.sql`t.operation_code IS NULL OR t.operation_code NOT IN (${Prisma.join(DEVOLUTION_OPERATIONS_LIST)})`;
// Filtro reutilizado: filial de venda (exclui Fábrica)
const STORE_BRANCH_FILTER = Prisma.sql`t.branch_code NOT IN (${Prisma.join(EXCLUDED_BRANCH_LIST)})`;

interface VendasFilial {
  branch_code: number;
  branch_name: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
  pa: number;
  tm: number;
  clientes: number;
  pm: number;
  tm_cliente: number;
  pac: number;
}

interface VendasDiarias {
  data: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
}

interface VendasVendedor {
  seller_code: number;
  seller_name?: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
  pa: number;
  tm: number;
}

interface Produto {
  referencia: string;
  nome: string;
  quantidade: number;
  valor: number;
}

// Helpers
function decimalToNumber(value: Decimal | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Vendas por período (por filial de venda, exclui Fábrica e devoluções)
export async function getVendasPeriodo(
  startDate: Date,
  endDate: Date,
  branchCode?: number
): Promise<VendasFilial[]> {
  const branchFilter = branchCode ? Prisma.sql`AND t.branch_code = ${branchCode}` : Prisma.empty;

  const results = await prisma.$queryRaw<Array<{
    branch_code: number;
    branch_name: string;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
    clientes: bigint;
  }>>`
    SELECT
      t.branch_code,
      t.branch_name,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN t.transaction_code END) as transacoes,
      COALESCE(SUM(ti.quantity * ${DEVOLUTION_SIGN}), 0) as pecas,
      COALESCE(SUM(ti.net_value * ${DEVOLUTION_SIGN}), 0) as faturamento,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN t.customer_code END) as clientes
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status != 6
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
    GROUP BY t.branch_code, t.branch_name
    ORDER BY faturamento DESC
  `;

  return results.map(row => {
    const transacoes = Number(row.transacoes);
    const pecas = decimalToNumber(row.pecas);
    const faturamento = decimalToNumber(row.faturamento);
    const clientes = Number(row.clientes);

    return {
      branch_code: row.branch_code,
      branch_name: row.branch_name || FILIAIS[row.branch_code] || `Filial ${row.branch_code}`,
      transacoes,
      pecas: Math.round(pecas),
      faturamento: round(faturamento),
      pa: transacoes > 0 ? round(pecas / transacoes) : 0,
      tm: transacoes > 0 ? round(faturamento / transacoes) : 0,
      clientes,
      pm: pecas > 0 ? round(faturamento / pecas) : 0,
      tm_cliente: clientes > 0 ? round(faturamento / clientes) : 0,
      pac: clientes > 0 ? round(pecas / clientes) : 0,
    };
  });
}

// Vendas diárias (por filial de venda, exclui Fábrica e devoluções)
export async function getVendasDiarias(
  startDate: Date,
  endDate: Date,
  branchCode?: number
): Promise<VendasDiarias[]> {
  const branchFilter = branchCode ? Prisma.sql`AND t.branch_code = ${branchCode}` : Prisma.empty;

  const results = await prisma.$queryRaw<Array<{
    data: Date;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
  }>>`
    SELECT
      t.transaction_date as data,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN t.transaction_code END) as transacoes,
      COALESCE(SUM(ti.quantity * ${DEVOLUTION_SIGN}), 0) as pecas,
      COALESCE(SUM(ti.net_value * ${DEVOLUTION_SIGN}), 0) as faturamento
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status != 6
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
      ${branchFilter}
    GROUP BY t.transaction_date
    ORDER BY t.transaction_date
  `;

  return results.map(row => ({
    data: row.data.toISOString().split('T')[0],
    transacoes: Number(row.transacoes),
    pecas: Math.round(decimalToNumber(row.pecas)),
    faturamento: round(decimalToNumber(row.faturamento)),
  }));
}

// Vendas por vendedor
export async function getVendasVendedor(
  startDate: Date,
  endDate: Date,
  branchCode?: number
): Promise<VendasVendedor[]> {
  const branchFilter = branchCode ? Prisma.sql`AND t.branch_code = ${branchCode}` : Prisma.empty;

  const results = await prisma.$queryRaw<Array<{
    seller_code: number;
    transacoes: bigint;
    pecas: Decimal;
    faturamento: Decimal;
  }>>`
    SELECT
      ti.seller_code,
      COUNT(DISTINCT CASE WHEN ${IS_SALE} THEN (ti.branch_code, ti.transaction_code) END) as transacoes,
      SUM(ti.quantity * ${DEVOLUTION_SIGN}) as pecas,
      SUM(ti.net_value * ${DEVOLUTION_SIGN}) as faturamento
    FROM transacao_itens ti
    JOIN transacoes t ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status != 6
      AND ti.seller_code != 1
      AND ti.seller_code IS NOT NULL
      AND ${SALE_OPERATION_FILTER}
      ${branchFilter}
    GROUP BY ti.seller_code
    ORDER BY faturamento DESC
  `;

  return results.map(row => {
    const transacoes = Number(row.transacoes);
    const pecas = decimalToNumber(row.pecas);
    const faturamento = decimalToNumber(row.faturamento);

    return {
      seller_code: row.seller_code,
      transacoes,
      pecas: Math.round(pecas),
      faturamento: round(faturamento),
      pa: transacoes > 0 ? round(pecas / transacoes) : 0,
      tm: transacoes > 0 ? round(faturamento / transacoes) : 0,
    };
  });
}

// Top produtos
export async function getTopProdutos(
  startDate: Date,
  endDate: Date,
  branchCode?: number,
  limit: number = 10
): Promise<Produto[]> {
  const branchFilter = branchCode ? Prisma.sql`AND t.branch_code = ${branchCode}` : Prisma.empty;

  const results = await prisma.$queryRaw<Array<{
    referencia: string;
    nome: string;
    quantidade: Decimal;
    valor: Decimal;
  }>>`
    SELECT
      COALESCE(p.reference_code, ti.product_code::text) as referencia,
      COALESCE(p.reference_name, p.product_name, 'Produto ' || ti.product_code) as nome,
      SUM(ti.quantity * ${DEVOLUTION_SIGN}) as quantidade,
      SUM(ti.net_value * ${DEVOLUTION_SIGN}) as valor
    FROM transacao_itens ti
    JOIN transacoes t ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
    LEFT JOIN produtos p ON p.product_code = ti.product_code
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status != 6
      AND ti.seller_code != 1
      AND ${SALE_OPERATION_FILTER}
      AND (p.is_finished_product = true OR p.product_code IS NULL)
      ${branchFilter}
    GROUP BY COALESCE(p.reference_code, ti.product_code::text),
             COALESCE(p.reference_name, p.product_name, 'Produto ' || ti.product_code)
    ORDER BY valor DESC
    LIMIT ${limit}
  `;

  return results.map(row => ({
    referencia: row.referencia,
    nome: row.nome,
    quantidade: Math.round(decimalToNumber(row.quantidade)),
    valor: round(decimalToNumber(row.valor)),
  }));
}

// Devoluções por filial (operações com operationsType='E' e operationMode='3' no TOTVS)
export async function getDevolucoesPorFilial(
  startDate: Date,
  endDate: Date
): Promise<Map<number, { valor: number; qtde: number }>> {
  const results = await prisma.$queryRaw<Array<{
    branch_code: number;
    qtde_dev: bigint;
    valor_dev: Decimal;
  }>>`
    SELECT
      t.branch_code,
      COUNT(DISTINCT t.transaction_code) as qtde_dev,
      COALESCE(SUM(ti.net_value), 0) as valor_dev
    FROM transacoes t
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status != 6
      AND t.operation_code IN (${Prisma.join(DEVOLUTION_OPERATIONS_LIST)})
      AND ${STORE_BRANCH_FILTER}
    GROUP BY t.branch_code
  `;

  const map = new Map<number, { valor: number; qtde: number }>();
  for (const row of results) {
    map.set(row.branch_code, {
      valor: round(decimalToNumber(row.valor_dev)),
      qtde: Number(row.qtde_dev),
    });
  }
  return map;
}

// Clientes novos por filial: customer_code cuja primeira compra válida (em toda a história)
// cai dentro do período. Faturamento CN = receita desses clientes no período, na filial onde compraram.
export async function getClientesNovosPorFilial(
  startDate: Date,
  endDate: Date
): Promise<Map<number, { qtde: number; faturamento: number }>> {
  const results = await prisma.$queryRaw<Array<{
    branch_code: number;
    clientes_novos: bigint;
    faturamento_cn: Decimal;
  }>>`
    WITH primeira_compra AS (
      SELECT t.customer_code, MIN(t.transaction_date) as primeira_data
      FROM transacoes t
      WHERE t.customer_code IS NOT NULL
        AND t.status != 6
        AND ${SALE_OPERATION_FILTER}
        AND ${IS_SALE}
        AND ${STORE_BRANCH_FILTER}
      GROUP BY t.customer_code
    ),
    novos AS (
      SELECT customer_code FROM primeira_compra
      WHERE primeira_data BETWEEN ${startDate} AND ${endDate}
    )
    SELECT
      t.branch_code,
      COUNT(DISTINCT t.customer_code) as clientes_novos,
      COALESCE(SUM(ti.net_value * ${DEVOLUTION_SIGN}), 0) as faturamento_cn
    FROM transacoes t
    JOIN novos n ON n.customer_code = t.customer_code
    LEFT JOIN transacao_itens ti ON t.branch_code = ti.branch_code
      AND t.transaction_code = ti.transaction_code
      AND ti.seller_code != 1
    WHERE t.transaction_date BETWEEN ${startDate} AND ${endDate}
      AND t.status != 6
      AND ${SALE_OPERATION_FILTER}
      AND ${STORE_BRANCH_FILTER}
    GROUP BY t.branch_code
  `;

  const map = new Map<number, { qtde: number; faturamento: number }>();
  for (const row of results) {
    map.set(row.branch_code, {
      qtde: Number(row.clientes_novos),
      faturamento: round(decimalToNumber(row.faturamento_cn)),
    });
  }
  return map;
}

// Meta (nível 3 = 100%) por filial, apenas metas de loja (seller_code IS NULL)
export async function getMetasPorFilial(ano: number, mes: number): Promise<Map<number, number>> {
  const metas = await metasService.getMetas(ano, mes);
  const map = new Map<number, number>();
  for (const m of metas) {
    if (m.seller_code === null) {
      map.set(m.branch_code, m.nivel_3);
    }
  }
  return map;
}

// Calcular totais
export function calcularTotais(filiais: VendasFilial[]) {
  const totalFaturamento = filiais.reduce((sum, f) => sum + f.faturamento, 0);
  const totalPecas = filiais.reduce((sum, f) => sum + f.pecas, 0);
  const totalTransacoes = filiais.reduce((sum, f) => sum + f.transacoes, 0);
  const totalClientes = filiais.reduce((sum, f) => sum + f.clientes, 0);

  return {
    faturamento: round(totalFaturamento),
    pecas: totalPecas,
    transacoes: totalTransacoes,
    pa: totalTransacoes > 0 ? round(totalPecas / totalTransacoes) : 0,
    tm: totalTransacoes > 0 ? round(totalFaturamento / totalTransacoes) : 0,
    clientes: totalClientes,
    pm: totalPecas > 0 ? round(totalFaturamento / totalPecas) : 0,
    tm_cliente: totalClientes > 0 ? round(totalFaturamento / totalClientes) : 0,
    pac: totalClientes > 0 ? round(totalPecas / totalClientes) : 0,
  };
}

// Calcular variação
export function calcularVariacao(atual: number, anterior: number) {
  let percentual: number;
  if (anterior === 0) {
    percentual = atual > 0 ? 100 : 0;
  } else {
    percentual = ((atual - anterior) / anterior) * 100;
  }

  return {
    atual,
    anterior,
    diferenca: round(atual - anterior),
    percentual: round(percentual),
  };
}

// Projeção do mês (caminhada)
export async function getProjecaoMes(branchCode?: number) {
  const today = new Date();
  const diaAtual = today.getDate();

  const startAtual = new Date(today.getFullYear(), today.getMonth(), 1);
  const endAtual = today;

  const startAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const endAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), diaAtual);

  const ultimoDiaAntCompleto = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);
  const startAntCompleto = new Date(today.getFullYear() - 1, today.getMonth(), 1);

  // Buscar dados
  const vendasAtual = await getVendasPeriodo(startAtual, endAtual, branchCode);
  const vendasAntParcial = await getVendasPeriodo(startAntParcial, endAntParcial, branchCode);
  const vendasAntCompleto = await getVendasPeriodo(startAntCompleto, ultimoDiaAntCompleto, branchCode);

  const totalAtual = calcularTotais(vendasAtual);
  const totalAntParcial = calcularTotais(vendasAntParcial);
  const totalAntCompleto = calcularTotais(vendasAntCompleto);

  // Calcular caminhada
  let caminhadaFat: number;
  if (totalAntCompleto.faturamento > 0) {
    caminhadaFat = totalAntParcial.faturamento / totalAntCompleto.faturamento;
  } else {
    caminhadaFat = diaAtual / ultimoDiaAntCompleto.getDate();
  }
  caminhadaFat = Math.max(caminhadaFat, 0.01);

  const projecaoFaturamento = totalAtual.faturamento / caminhadaFat;
  const faltaFaturamento = projecaoFaturamento - totalAtual.faturamento;

  const ultimoDia = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const diasRestantes = Math.max(ultimoDia.getDate() - diaAtual, 0);

  const mediaDiariaNecessaria = diasRestantes > 0 ? faltaFaturamento / diasRestantes : 0;

  let varProjecaoVsAnt = 0;
  if (totalAntCompleto.faturamento > 0) {
    varProjecaoVsAnt = ((projecaoFaturamento - totalAntCompleto.faturamento) / totalAntCompleto.faturamento) * 100;
  }

  return {
    periodo_atual: {
      inicio: startAtual.toISOString().split('T')[0],
      fim: endAtual.toISOString().split('T')[0],
      dias_decorridos: diaAtual,
      dias_restantes: diasRestantes,
      dias_total: ultimoDia.getDate(),
    },
    realizado: {
      faturamento: totalAtual.faturamento,
      pecas: totalAtual.pecas,
      transacoes: totalAtual.transacoes,
      tm: totalAtual.tm,
      pa: totalAtual.pa,
    },
    caminhada: round(caminhadaFat * 100, 1),
    projecao: {
      faturamento: round(projecaoFaturamento),
    },
    falta_vender: {
      faturamento: round(faltaFaturamento),
      media_diaria_necessaria: round(mediaDiariaNecessaria),
    },
    variacao_vs_ano_anterior: round(varProjecaoVsAnt, 1),
  };
}

// Projeção por filiais
export async function getProjecaoFiliais() {
  const today = new Date();
  const diaAtual = today.getDate();

  const startAtual = new Date(today.getFullYear(), today.getMonth(), 1);
  const endAtual = today;

  const startAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const endAntParcial = new Date(today.getFullYear() - 1, today.getMonth(), diaAtual);

  const ultimoDiaAntCompleto = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);
  const startAntCompleto = new Date(today.getFullYear() - 1, today.getMonth(), 1);

  const ultimoDia = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const diasRestantes = Math.max(ultimoDia.getDate() - diaAtual, 0);

  // Buscar dados de todas as filiais
  const filiaisAtual = await getVendasPeriodo(startAtual, endAtual);
  const filiaisAntParcial = await getVendasPeriodo(startAntParcial, endAntParcial);
  const filiaisAntCompleto = await getVendasPeriodo(startAntCompleto, ultimoDiaAntCompleto);

  // Criar dicionários para lookup
  const antParcialDict = new Map(filiaisAntParcial.map(f => [f.branch_code, f]));
  const antCompletoDict = new Map(filiaisAntCompleto.map(f => [f.branch_code, f]));

  // Calcular projeção por filial
  const projecoes = filiaisAtual.map(f => {
    const antParcial = antParcialDict.get(f.branch_code) || { faturamento: 0 };
    const antCompleto = antCompletoDict.get(f.branch_code) || { faturamento: 0 };

    let caminhada: number;
    if (antCompleto.faturamento > 0) {
      caminhada = antParcial.faturamento / antCompleto.faturamento;
    } else {
      caminhada = diaAtual / ultimoDia.getDate();
    }
    caminhada = Math.max(caminhada, 0.01);

    const projecaoFat = f.faturamento / caminhada;
    const falta = projecaoFat - f.faturamento;

    let varVsAnt = 0;
    if (antCompleto.faturamento > 0) {
      varVsAnt = ((projecaoFat - antCompleto.faturamento) / antCompleto.faturamento) * 100;
    }

    return {
      branch_code: f.branch_code,
      branch_name: f.branch_name,
      realizado: round(f.faturamento),
      caminhada: round(caminhada * 100, 1),
      projecao: round(projecaoFat),
      falta: round(falta),
      ano_anterior_completo: round(antCompleto.faturamento),
      variacao_vs_ano_anterior: round(varVsAnt, 1),
    };
  });

  // Calcular totais
  const totalRealizado = projecoes.reduce((sum, p) => sum + p.realizado, 0);
  const totalProjecao = projecoes.reduce((sum, p) => sum + p.projecao, 0);
  const totalFalta = projecoes.reduce((sum, p) => sum + p.falta, 0);
  const totalAntCompleto = projecoes.reduce((sum, p) => sum + p.ano_anterior_completo, 0);

  let totalVar = 0;
  if (totalAntCompleto > 0) {
    totalVar = ((totalProjecao - totalAntCompleto) / totalAntCompleto) * 100;
  }

  return {
    periodo: {
      inicio: startAtual.toISOString().split('T')[0],
      fim: endAtual.toISOString().split('T')[0],
      dias_decorridos: diaAtual,
      dias_restantes: diasRestantes,
    },
    filiais: projecoes,
    total: {
      realizado: round(totalRealizado),
      projecao: round(totalProjecao),
      falta: round(totalFalta),
      ano_anterior_completo: round(totalAntCompleto),
      variacao_vs_ano_anterior: round(totalVar, 1),
    },
  };
}
