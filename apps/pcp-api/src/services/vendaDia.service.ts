import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import {
  OPERACAO_JOIN,
  SALE_OPERATION_FILTER,
  QUANTIDADE_COM_SINAL,
  VALOR_COM_SINAL,
  PCP_ESTOQUE_LIQUIDO_SKU_FILTER,
  FABRICA_BRANCH_CODE,
} from './relatorioBase.service.js';

// Lojas de varejo (excluindo Fábrica que é produção)
const LOJAS_VAREJO = [1, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 17];

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export type TipoClassificacao = 'categoria' | 'linha' | 'colecao' | 'status';

export interface VendaDiaFiltro {
  tipoClassificacao: TipoClassificacao;
  classificacaoValores?: string[];
  branches?: number[];
  agruparLojas?: boolean; // true = soma tudo, false = uma linha por loja
}

export interface VendaDiaLinha {
  branchCode: number | null; // null quando agrupado
  branchName: string;
  branchAbrev: string;
  estoqueDiaAnterior: number;
  vendaDiaAnterior: number;
  vendaUltimaSemana: number;
  vendaMes: number;
  giroMes: number | null; // vendaMes / estoqueDiaAnterior (se >0)
}

export interface VendaDiaKpis {
  estoqueTotal: number;
  vendaDiaAnteriorTotal: number;
  vendaUltimaSemanaTotal: number;
  vendaMesTotal: number;
  giroMesTotal: number | null;
  ticketMedioDia: number | null;
  ticketMedioSemana: number | null;
  ticketMedioMes: number | null;
}

export interface VendaDiaResponse {
  dataReferencia: string; // data de "ontem"
  periodoSemana: { inicio: string; fim: string };
  periodoMes: { inicio: string; fim: string };
  tipoClassificacao: TipoClassificacao;
  classificacaoSelecionada: string[];
  agrupadoPorLoja: boolean;
  kpis: VendaDiaKpis;
  linhas: VendaDiaLinha[];
}

function buildClassificacaoFiltro(tipo: TipoClassificacao, valores?: string[]): Prisma.Sql {
  if (!valores || valores.length === 0) return Prisma.empty;

  const campo = {
    categoria: 'a.class_categoria',
    linha: 'a.class_linha',
    colecao: 'a.class_colecao',
    status: 'a.class_status',
  }[tipo];

  return Prisma.sql`AND TRIM(${Prisma.raw(campo)}) IN (${Prisma.join(valores)})`;
}

interface VendaRow {
  branch_code: number;
  quantidade: Decimal;
  transacoes: bigint;
}

interface EstoqueRow {
  branch_code: number;
  quantidade: Decimal;
}

interface BranchRow {
  branch_code: number;
  description: string;
  abrev: string | null;
}

// Vendas por filial em um período (apenas lojas de varejo)
async function getVendasPorPeriodo(
  dataInicio: string,
  dataFim: string,
  classificacaoFiltro: Prisma.Sql,
  branchesFiltro: number[] | null
): Promise<VendaRow[]> {
  const branchesClause = branchesFiltro && branchesFiltro.length > 0
    ? Prisma.sql`AND t.branch_code IN (${Prisma.join(branchesFiltro)})`
    : Prisma.sql`AND t.branch_code IN (${Prisma.join(LOJAS_VAREJO)})`;

  // Subconsulta evita multiplicar transacoes por linhas de produto_analitico e garante
  // que vendas e estoque usem o mesmo universo de SKUs do PCP.
  return prisma.$queryRaw<VendaRow[]>`
    WITH produtos_filtrados AS (
      SELECT DISTINCT a.product_code
      FROM produto_analitico a
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      WHERE a.product_code IS NOT NULL
        AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
        ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
        ${classificacaoFiltro}
    )
    SELECT
      t.branch_code,
      SUM(${QUANTIDADE_COM_SINAL}) AS quantidade,
      COUNT(DISTINCT t.transaction_code) AS transacoes
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    JOIN produtos_filtrados pf ON pf.product_code = ti.product_code
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= ${dataInicio}::date
      AND t.transaction_date <= ${dataFim}::date
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      ${branchesClause}
    GROUP BY t.branch_code
  `;
}

// Estoque por filial (último snapshot)
async function getEstoquePorFilial(
  classificacaoFiltro: Prisma.Sql,
  branchesFiltro: number[] | null
): Promise<EstoqueRow[]> {
  const branchesClause = branchesFiltro && branchesFiltro.length > 0
    ? Prisma.sql`AND us.branch_code IN (${Prisma.join(branchesFiltro)})`
    : Prisma.sql`AND us.branch_code IN (${Prisma.join(LOJAS_VAREJO)})`;

  return prisma.$queryRaw<EstoqueRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (ps.product_sku, ps.branch_code, ps.stock_code)
        ps.product_sku, ps.product_code, ps.branch_code, ps.stock, ps.captured_at
      FROM prd_saldo ps
      ORDER BY ps.product_sku, ps.branch_code, ps.stock_code, ps.captured_at DESC
    )
    SELECT
      us.branch_code,
      COALESCE(SUM(COALESCE(us.stock, 0)), 0) AS quantidade
    FROM ultimo_saldo us
    JOIN produto_analitico a ON a.product_sku = us.product_sku
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE 1=1
      ${branchesClause}
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${classificacaoFiltro}
    GROUP BY us.branch_code
  `;
}

// Lista de lojas com abreviação
async function getBranches(): Promise<BranchRow[]> {
  return prisma.$queryRaw<BranchRow[]>`
    SELECT branch_code, description, abrev
    FROM branches
    WHERE branch_code IN (${Prisma.join(LOJAS_VAREJO)})
    ORDER BY branch_code
  `;
}

export async function getVendaDia(filtro: VendaDiaFiltro): Promise<VendaDiaResponse> {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);

  // Períodos
  const dataOntem = ontem.toISOString().split('T')[0];

  // Última semana (7 dias terminando ontem)
  const inicioSemana = new Date(ontem);
  inicioSemana.setDate(inicioSemana.getDate() - 6);
  const dataInicioSemana = inicioSemana.toISOString().split('T')[0];

  // Mês (do dia 1 até ontem)
  const inicioMes = new Date(ontem.getFullYear(), ontem.getMonth(), 1);
  const dataInicioMes = inicioMes.toISOString().split('T')[0];

  const classificacaoFiltro = buildClassificacaoFiltro(filtro.tipoClassificacao, filtro.classificacaoValores);
  const branchesFiltro = filtro.branches && filtro.branches.length > 0 ? filtro.branches : null;

  const [branches, estoqueRows, vendaDiaRows, vendaSemanaRows, vendaMesRows] = await Promise.all([
    getBranches(),
    getEstoquePorFilial(classificacaoFiltro, branchesFiltro),
    getVendasPorPeriodo(dataOntem, dataOntem, classificacaoFiltro, branchesFiltro),
    getVendasPorPeriodo(dataInicioSemana, dataOntem, classificacaoFiltro, branchesFiltro),
    getVendasPorPeriodo(dataInicioMes, dataOntem, classificacaoFiltro, branchesFiltro),
  ]);

  // Mapas por branch_code
  const estoquePorBranch = new Map<number, number>();
  for (const r of estoqueRows) estoquePorBranch.set(r.branch_code, decimalToNumber(r.quantidade));

  const vendaDiaPorBranch = new Map<number, { qtd: number; txs: number }>();
  for (const r of vendaDiaRows) vendaDiaPorBranch.set(r.branch_code, { qtd: decimalToNumber(r.quantidade), txs: Number(r.transacoes) });

  const vendaSemanaPorBranch = new Map<number, { qtd: number; txs: number }>();
  for (const r of vendaSemanaRows) vendaSemanaPorBranch.set(r.branch_code, { qtd: decimalToNumber(r.quantidade), txs: Number(r.transacoes) });

  const vendaMesPorBranch = new Map<number, { qtd: number; txs: number }>();
  for (const r of vendaMesRows) vendaMesPorBranch.set(r.branch_code, { qtd: decimalToNumber(r.quantidade), txs: Number(r.transacoes) });

  // Filtrar branches conforme seleção
  const branchesFiltrados = branchesFiltro
    ? branches.filter(b => branchesFiltro.includes(b.branch_code))
    : branches;

  // Construir linhas
  let linhas: VendaDiaLinha[] = [];

  if (filtro.agruparLojas) {
    // Soma tudo em uma linha só
    let estoqueTotal = 0;
    let vendaDiaTotal = 0;
    let vendaSemanaTotal = 0;
    let vendaMesTotal = 0;

    for (const b of branchesFiltrados) {
      estoqueTotal += estoquePorBranch.get(b.branch_code) || 0;
      vendaDiaTotal += vendaDiaPorBranch.get(b.branch_code)?.qtd || 0;
      vendaSemanaTotal += vendaSemanaPorBranch.get(b.branch_code)?.qtd || 0;
      vendaMesTotal += vendaMesPorBranch.get(b.branch_code)?.qtd || 0;
    }

    linhas.push({
      branchCode: null,
      branchName: 'TODAS AS LOJAS',
      branchAbrev: 'TT',
      estoqueDiaAnterior: round(estoqueTotal, 0),
      vendaDiaAnterior: round(vendaDiaTotal, 0),
      vendaUltimaSemana: round(vendaSemanaTotal, 0),
      vendaMes: round(vendaMesTotal, 0),
      giroMes: estoqueTotal > 0 ? round((vendaMesTotal / estoqueTotal) * 100, 1) : null,
    });
  } else {
    // Uma linha por loja
    for (const b of branchesFiltrados) {
      const estoque = estoquePorBranch.get(b.branch_code) || 0;
      const vendaDia = vendaDiaPorBranch.get(b.branch_code)?.qtd || 0;
      const vendaSemana = vendaSemanaPorBranch.get(b.branch_code)?.qtd || 0;
      const vendaMes = vendaMesPorBranch.get(b.branch_code)?.qtd || 0;

      linhas.push({
        branchCode: b.branch_code,
        branchName: b.description,
        branchAbrev: b.abrev || b.description.substring(0, 3).toUpperCase(),
        estoqueDiaAnterior: round(estoque, 0),
        vendaDiaAnterior: round(vendaDia, 0),
        vendaUltimaSemana: round(vendaSemana, 0),
        vendaMes: round(vendaMes, 0),
        giroMes: estoque > 0 ? round((vendaMes / estoque) * 100, 1) : null,
      });
    }

    // Linha de total
    const totais = linhas.reduce(
      (acc, l) => ({
        estoque: acc.estoque + l.estoqueDiaAnterior,
        vendaDia: acc.vendaDia + l.vendaDiaAnterior,
        vendaSemana: acc.vendaSemana + l.vendaUltimaSemana,
        vendaMes: acc.vendaMes + l.vendaMes,
      }),
      { estoque: 0, vendaDia: 0, vendaSemana: 0, vendaMes: 0 }
    );

    linhas.push({
      branchCode: null,
      branchName: 'TOTAL',
      branchAbrev: 'TT',
      estoqueDiaAnterior: round(totais.estoque, 0),
      vendaDiaAnterior: round(totais.vendaDia, 0),
      vendaUltimaSemana: round(totais.vendaSemana, 0),
      vendaMes: round(totais.vendaMes, 0),
      giroMes: totais.estoque > 0 ? round((totais.vendaMes / totais.estoque) * 100, 1) : null,
    });
  }

  // KPIs
  const totalLinha = linhas.find(l => l.branchCode === null && (l.branchName === 'TOTAL' || l.branchName === 'TODAS AS LOJAS'));

  // Calcular transações totais para ticket médio
  let txsDiaTotal = 0;
  let txsSemanaTotal = 0;
  let txsMesTotal = 0;
  for (const b of branchesFiltrados) {
    txsDiaTotal += vendaDiaPorBranch.get(b.branch_code)?.txs || 0;
    txsSemanaTotal += vendaSemanaPorBranch.get(b.branch_code)?.txs || 0;
    txsMesTotal += vendaMesPorBranch.get(b.branch_code)?.txs || 0;
  }

  const kpis: VendaDiaKpis = {
    estoqueTotal: totalLinha?.estoqueDiaAnterior || 0,
    vendaDiaAnteriorTotal: totalLinha?.vendaDiaAnterior || 0,
    vendaUltimaSemanaTotal: totalLinha?.vendaUltimaSemana || 0,
    vendaMesTotal: totalLinha?.vendaMes || 0,
    giroMesTotal: totalLinha?.giroMes || null,
    ticketMedioDia: txsDiaTotal > 0 ? round((totalLinha?.vendaDiaAnterior || 0) / txsDiaTotal, 1) : null,
    ticketMedioSemana: txsSemanaTotal > 0 ? round((totalLinha?.vendaUltimaSemana || 0) / txsSemanaTotal, 1) : null,
    ticketMedioMes: txsMesTotal > 0 ? round((totalLinha?.vendaMes || 0) / txsMesTotal, 1) : null,
  };

  return {
    dataReferencia: dataOntem,
    periodoSemana: { inicio: dataInicioSemana, fim: dataOntem },
    periodoMes: { inicio: dataInicioMes, fim: dataOntem },
    tipoClassificacao: filtro.tipoClassificacao,
    classificacaoSelecionada: filtro.classificacaoValores || [],
    agrupadoPorLoja: filtro.agruparLojas || false,
    kpis,
    linhas,
  };
}

export interface VendaDiaFiltrosResponse {
  classificacoes: {
    tipo: TipoClassificacao;
    label: string;
    opcoes: { valor: string; qtd_skus: number }[];
  }[];
  lojas: { branchCode: number; label: string; abrev: string }[];
}

export async function getFiltrosVendaDia(): Promise<VendaDiaFiltrosResponse> {
  const dimensoes: { tipo: TipoClassificacao; coluna: string; label: string }[] = [
    { tipo: 'categoria', coluna: 'class_categoria', label: 'Categoria' },
    { tipo: 'linha', coluna: 'class_linha', label: 'Linha' },
    { tipo: 'colecao', coluna: 'class_colecao', label: 'Coleção' },
    { tipo: 'status', coluna: 'class_status', label: 'Status' },
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
      tipo: dim.tipo,
      label: dim.label,
      opcoes: rows.map((row) => ({ valor: row.valor, qtd_skus: Number(row.qtd) })),
    });
  }

  const branches = await getBranches();
  const lojas = branches.map(b => ({
    branchCode: b.branch_code,
    label: b.description,
    abrev: b.abrev || b.description.substring(0, 3).toUpperCase(),
  }));

  return { classificacoes, lojas };
}

// ============================================================================
// ACOMPANHAMENTO DIARIO POR CATEGORIA/LINHA/GENERO ("Rel. 1" - venda x ano
// anterior, cobertura, estoque fisico, peças em producao, por classificacao em
// vez de por loja). E a segunda aba de Venda do Dia - mesma tela, visao trocada.
// ============================================================================

export type TipoClassificacaoDiario = 'categoria' | 'linha' | 'genero';
export type Canal = 'varejo' | 'atacado' | 'todos';

export interface AcompanhamentoDiarioFiltro {
  tipoClassificacao: TipoClassificacaoDiario;
  canal?: Canal;
  branches?: number[];
  // Periodo escolhido pelo usuario (filtro de data "de/ate" na tela) - omitido cai no
  // default de sempre (dia 1 do mes atual ate ontem). O periodo do ano anterior e
  // sempre o MESMO intervalo, um ano antes, nunca escolhido separado.
  dataInicio?: string;
  dataFim?: string;
}

export interface AcompanhamentoDiarioLinha {
  classificacao: string;
  vendaValorAtual: number;
  vendaValorAnoAnterior: number;
  evolucaoValorPercent: number | null;
  vendaPecasAtual: number;
  vendaPecasAnoAnterior: number;
  evolucaoPecasPercent: number | null;
  participacaoPercent: number;
  coberturaMesesAtual: number | null;
  coberturaMesesAnoAnterior: number | null;
  estoqueFisico: number;
  pecasEmProducao: number;
}

export interface AcompanhamentoDiarioResponse {
  periodoAtual: { inicio: string; fim: string };
  periodoAnoAnterior: { inicio: string; fim: string };
  tipoClassificacao: TipoClassificacaoDiario;
  canal: Canal;
  kpis: {
    vendaValorTotal: number;
    vendaValorAnoAnteriorTotal: number;
    evolucaoValorPercent: number | null;
    estoqueFisicoTotal: number;
    pecasEmProducaoTotal: number;
  };
  linhas: AcompanhamentoDiarioLinha[];
}

const CAMPO_CLASSIFICACAO_DIARIO: Record<TipoClassificacaoDiario, string> = {
  categoria: 'a.class_categoria',
  linha: 'a.class_linha',
  genero: 'a.class_genero',
};

// Canal = universo de filiais (mesma logica ja usada em raioX.service.ts
// getCanalFilter): varejo exclui a Fabrica (que e producao, nao ponto de venda -
// regra de negocio do projeto inteiro), atacado e so a Fabrica, todos e as duas.
function getBranchesCanal(canal: Canal, branchesFiltro?: number[]): number[] {
  const universo = canal === 'atacado' ? [FABRICA_BRANCH_CODE] : canal === 'todos' ? [...LOJAS_VAREJO, FABRICA_BRANCH_CODE] : LOJAS_VAREJO;
  if (canal === 'atacado' || !branchesFiltro || branchesFiltro.length === 0) return universo;
  const filtrado = universo.filter((b) => branchesFiltro.includes(b));
  return filtrado.length > 0 ? filtrado : universo;
}

interface ClassificacaoAggRow {
  classificacao: string;
  valor: Decimal;
  pecas: Decimal;
}

// Venda (R$ liquido + pecas liquidas) agrupada por categoria/linha/genero, num
// intervalo de datas explicito - reaproveitada tanto pro periodo atual quanto pro
// mesmo intervalo do ano anterior (so troca as datas).
async function getVendaPorClassificacaoDiario(
  dataInicio: string,
  dataFim: string,
  tipo: TipoClassificacaoDiario,
  branches: number[]
): Promise<ClassificacaoAggRow[]> {
  const campo = Prisma.raw(CAMPO_CLASSIFICACAO_DIARIO[tipo]);
  return prisma.$queryRaw<ClassificacaoAggRow[]>`
    SELECT TRIM(${campo}) AS classificacao, SUM(${VALOR_COM_SINAL}) AS valor, SUM(${QUANTIDADE_COM_SINAL}) AS pecas
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    JOIN produto_analitico a ON a.product_code = ti.product_code
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= ${dataInicio}::date
      AND t.transaction_date <= ${dataFim}::date
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND t.branch_code IN (${Prisma.join(branches)})
      AND ${campo} IS NOT NULL AND TRIM(${campo}) NOT IN ('', '.')
    GROUP BY TRIM(${campo})
  `;
}

interface EstoqueClassificacaoRow {
  classificacao: string;
  quantidade: Decimal;
}

// Estoque FISICO (stock_code=1, mesmo codigo ja usado em transferencia.service.ts
// pra "estoque disponivel na loja") por categoria/linha/genero - snapshot mais
// recente ATE uma data de corte (null = agora). Usado tanto pro estoque atual
// quanto, com corte = mesmo dia do ano anterior, pro estoque comparativo.
async function getEstoqueFisicoPorClassificacaoDiario(
  tipo: TipoClassificacaoDiario,
  branches: number[],
  dataCorte: string | null
): Promise<EstoqueClassificacaoRow[]> {
  const campo = CAMPO_CLASSIFICACAO_DIARIO[tipo];
  const corteClause = dataCorte ? Prisma.sql`AND ps.captured_at <= ${dataCorte}::date + interval '1 day'` : Prisma.empty;

  return prisma.$queryRaw<EstoqueClassificacaoRow[]>`
    WITH ultimo_saldo AS (
      SELECT DISTINCT ON (ps.product_sku, ps.branch_code)
        ps.product_sku, ps.branch_code, ps.stock
      FROM prd_saldo ps
      WHERE ps.stock_code = 1
        AND ps.branch_code IN (${Prisma.join(branches)})
        ${corteClause}
      ORDER BY ps.product_sku, ps.branch_code, ps.captured_at DESC
    )
    SELECT TRIM(${Prisma.raw(campo)}) AS classificacao, COALESCE(SUM(COALESCE(us.stock, 0)), 0) AS quantidade
    FROM ultimo_saldo us
    JOIN produto_analitico a ON a.product_sku = us.product_sku
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      AND ${Prisma.raw(campo)} IS NOT NULL AND TRIM(${Prisma.raw(campo)}) NOT IN ('', '.')
    GROUP BY TRIM(${Prisma.raw(campo)})
  `;
}

// Pecas pendentes em Ordem de Producao aberta, por categoria/linha/genero -
// sempre rede inteira (producao nao e por loja), mesmo dado de ops_em_producao ja
// usado em relatorioBase.service.ts e sugestaoProducao.service.ts.
async function getEmProducaoPorClassificacaoDiario(tipo: TipoClassificacaoDiario): Promise<EstoqueClassificacaoRow[]> {
  const campo = CAMPO_CLASSIFICACAO_DIARIO[tipo];
  return prisma.$queryRaw<EstoqueClassificacaoRow[]>`
    SELECT TRIM(${Prisma.raw(campo)}) AS classificacao, SUM(o.quantidade_pendente) AS quantidade
    FROM ops_em_producao o
    JOIN produto_analitico a ON a.product_code = o.product_code
    WHERE ${Prisma.raw(campo)} IS NOT NULL AND TRIM(${Prisma.raw(campo)}) NOT IN ('', '.')
    GROUP BY TRIM(${Prisma.raw(campo)})
  `;
}

function diasEntre(inicio: string, fim: string): number {
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Cobertura sempre em MESES (pedido do usuario, "cobertura sempre em mes primeiro de
// tudo") - venda media mensal equivalente = pecas do periodo levadas pra uma base de
// 30 dias, cobertura = estoque / essa media.
function coberturaMeses(estoque: number, pecasPeriodo: number, dias: number): number | null {
  const mediaMensal = (pecasPeriodo / dias) * 30;
  if (mediaMensal <= 0) return null;
  return round(estoque / mediaMensal, 1);
}

export async function getAcompanhamentoDiario(filtro: AcompanhamentoDiarioFiltro): Promise<AcompanhamentoDiarioResponse> {
  const canal = filtro.canal || 'varejo';
  const branches = getBranchesCanal(canal, filtro.branches);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // Periodo atual: o que o usuario escolheu no filtro de data, ou o default de sempre
  // (dia 1 do mes atual ate ontem) quando ele nao mexeu no filtro.
  let dataInicio: string;
  let dataFim: string;
  if (filtro.dataInicio && filtro.dataFim) {
    dataInicio = filtro.dataInicio;
    dataFim = filtro.dataFim;
  } else {
    const hoje = new Date();
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);
    const inicioMes = new Date(ontem.getFullYear(), ontem.getMonth(), 1);
    dataInicio = fmt(inicioMes);
    dataFim = fmt(ontem);
  }

  // Ano anterior = MESMO intervalo de datas, um ano antes (nunca escolhido separado).
  const inicioDate = new Date(`${dataInicio}T00:00:00`);
  const fimDate = new Date(`${dataFim}T00:00:00`);
  const anoAnteriorInicio = new Date(inicioDate);
  anoAnteriorInicio.setFullYear(anoAnteriorInicio.getFullYear() - 1);
  const anoAnteriorFim = new Date(fimDate);
  anoAnteriorFim.setFullYear(anoAnteriorFim.getFullYear() - 1);
  const dataInicioAA = fmt(anoAnteriorInicio);
  const dataFimAA = fmt(anoAnteriorFim);

  const diasAtual = diasEntre(dataInicio, dataFim);
  const diasAnoAnterior = diasEntre(dataInicioAA, dataFimAA);

  const [vendaAtualRows, vendaAARows, estoqueRows, estoqueAARows, emProducaoRows] = await Promise.all([
    getVendaPorClassificacaoDiario(dataInicio, dataFim, filtro.tipoClassificacao, branches),
    getVendaPorClassificacaoDiario(dataInicioAA, dataFimAA, filtro.tipoClassificacao, branches),
    getEstoqueFisicoPorClassificacaoDiario(filtro.tipoClassificacao, branches, null),
    getEstoqueFisicoPorClassificacaoDiario(filtro.tipoClassificacao, branches, dataFimAA),
    getEmProducaoPorClassificacaoDiario(filtro.tipoClassificacao),
  ]);

  const vendaAtualMap = new Map(vendaAtualRows.map((r) => [r.classificacao, { valor: decimalToNumber(r.valor), pecas: decimalToNumber(r.pecas) }]));
  const vendaAAMap = new Map(vendaAARows.map((r) => [r.classificacao, { valor: decimalToNumber(r.valor), pecas: decimalToNumber(r.pecas) }]));
  const estoqueMap = new Map(estoqueRows.map((r) => [r.classificacao, decimalToNumber(r.quantidade)]));
  const estoqueAAMap = new Map(estoqueAARows.map((r) => [r.classificacao, decimalToNumber(r.quantidade)]));
  const emProducaoMap = new Map(emProducaoRows.map((r) => [r.classificacao, decimalToNumber(r.quantidade)]));

  const todasClassificacoes = new Set<string>([
    ...vendaAtualMap.keys(),
    ...vendaAAMap.keys(),
    ...estoqueMap.keys(),
    ...emProducaoMap.keys(),
  ]);

  const vendaValorTotalAtual = [...vendaAtualMap.values()].reduce((s, v) => s + v.valor, 0);

  const linhas: AcompanhamentoDiarioLinha[] = [];
  for (const classificacao of todasClassificacoes) {
    const vAtual = vendaAtualMap.get(classificacao) || { valor: 0, pecas: 0 };
    const vAA = vendaAAMap.get(classificacao) || { valor: 0, pecas: 0 };
    const estoqueFisico = round(estoqueMap.get(classificacao) || 0, 0);
    const estoqueFisicoAA = round(estoqueAAMap.get(classificacao) || 0, 0);
    const pecasEmProducao = round(emProducaoMap.get(classificacao) || 0, 0);

    const coberturaAtual = coberturaMeses(estoqueFisico, vAtual.pecas, diasAtual);
    const coberturaAA = coberturaMeses(estoqueFisicoAA, vAA.pecas, diasAnoAnterior);

    linhas.push({
      classificacao,
      vendaValorAtual: round(vAtual.valor, 0),
      vendaValorAnoAnterior: round(vAA.valor, 0),
      evolucaoValorPercent: vAA.valor > 0 ? round(((vAtual.valor - vAA.valor) / vAA.valor) * 100, 1) : null,
      vendaPecasAtual: round(vAtual.pecas, 0),
      vendaPecasAnoAnterior: round(vAA.pecas, 0),
      evolucaoPecasPercent: vAA.pecas > 0 ? round(((vAtual.pecas - vAA.pecas) / vAA.pecas) * 100, 1) : null,
      participacaoPercent: vendaValorTotalAtual > 0 ? round((vAtual.valor / vendaValorTotalAtual) * 100, 1) : 0,
      coberturaMesesAtual: coberturaAtual,
      coberturaMesesAnoAnterior: coberturaAA,
      estoqueFisico,
      pecasEmProducao,
    });
  }

  linhas.sort((a, b) => b.vendaValorAtual - a.vendaValorAtual);

  const vendaValorAnoAnteriorTotal = [...vendaAAMap.values()].reduce((s, v) => s + v.valor, 0);

  return {
    periodoAtual: { inicio: dataInicio, fim: dataFim },
    periodoAnoAnterior: { inicio: dataInicioAA, fim: dataFimAA },
    tipoClassificacao: filtro.tipoClassificacao,
    canal,
    kpis: {
      vendaValorTotal: round(vendaValorTotalAtual, 0),
      vendaValorAnoAnteriorTotal: round(vendaValorAnoAnteriorTotal, 0),
      evolucaoValorPercent: vendaValorAnoAnteriorTotal > 0 ? round(((vendaValorTotalAtual - vendaValorAnoAnteriorTotal) / vendaValorAnoAnteriorTotal) * 100, 1) : null,
      estoqueFisicoTotal: round([...estoqueMap.values()].reduce((s, v) => s + v, 0), 0),
      pecasEmProducaoTotal: round([...emProducaoMap.values()].reduce((s, v) => s + v, 0), 0),
    },
    linhas,
  };
}
