import { Prisma, PcpRedistribuicaoJob } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { FILIAIS } from '../config/constants.js';
import {
  PCP_ESTOQUE_LIQUIDO_SKU_FILTER,
  OPERACAO_JOIN,
  SALE_OPERATION_FILTER,
  QUANTIDADE_COM_SINAL,
} from './relatorioBase.service.js';

const CURVA_ABC_CONFIG_KEY = 'curva_abc';

// ============================================================================
// TIPOS
// ============================================================================

export interface RedistribuicaoFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  referencia?: string;
  branches?: number[];
}

export interface RedistribuicaoConfig {
  maturacaoDias: number;
  coberturaIdealMeses: number;
  estoqueMinimoPecas: number;
  pesos: {
    cobertura: number;
    curva: number;
    giro: number;
  };
  lojasRemetentes: number[];
  lojasDestinatarias: number[];
}

export interface RedistribuicaoSugestao {
  sku: string;
  productCode: number;
  referenceCode: string;
  referenceName: string;
  cor: string | null;
  tamanho: string;
  curva: 'A' | 'B' | 'C' | null;

  origem: {
    branchCode: number;
    branchName: string;
    estoqueAtual: number;
    coberturaMeses: number | null;
    giro3m: number;
    mediaMensal: number;
    primeiraEntrada: string | null;
  };

  destino: {
    branchCode: number;
    branchName: string;
    estoqueAtual: number;
    coberturaMeses: number | null;
    giro3m: number;
    mediaMensal: number;
    vendeu: boolean;
  };

  quantidadeSugerida: number;
  scorePrioridade: number;
  motivoScore: string;
}

export interface RedistribuicaoResultado {
  calculadoEm: string;
  configSnapshot: RedistribuicaoConfig;
  kpis: {
    skusAnalisados: number;
    skusElegiveis: number;
    sugestoesCriadas: number;
    pecasASugerir: number;
  };
  sugestoes: RedistribuicaoSugestao[];
}

export interface DadosBaseResponse {
  config: RedistribuicaoConfig;
  resumo: {
    skusComEstoque: number;
    lojasAtivas: number;
  };
  distribuicaoPorLoja: Array<{
    branchCode: number;
    branchName: string;
    skusExcesso: number;
    skusRuptura: number;
    estoqueTotal: number;
  }>;
}

export interface JobStatusResponse {
  jobId: number;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  resultado?: RedistribuicaoResultado;
  errorMessage?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function getBranchName(branchCode: number): string {
  return FILIAIS[branchCode] || `Loja ${branchCode}`;
}

// Buscar configuracao da curva ABC (mesma usada em curvaAbc.service.ts)
async function getCurvaAbcConfig(): Promise<{ curvaALimitePercent: number; curvaBLimitePercent: number; curvaCLimitePercent: number }> {
  const config = await prisma.pcpCurvaAbcConfig.upsert({
    where: { relatorio: CURVA_ABC_CONFIG_KEY },
    create: { relatorio: CURVA_ABC_CONFIG_KEY },
    update: {},
  });
  const a = Number(config.curvaALimitePercent);
  const b = Number(config.curvaBLimitePercent);
  const c = Number(config.curvaCLimitePercent);
  // Valida limites - se invalido, usa defaults
  if (!(a > 0 && a < b && b < c && c <= 100)) {
    return { curvaALimitePercent: 80, curvaBLimitePercent: 95, curvaCLimitePercent: 100 };
  }
  return { curvaALimitePercent: a, curvaBLimitePercent: b, curvaCLimitePercent: c };
}

// ============================================================================
// DADOS BASE
// ============================================================================

export async function getDadosBase(): Promise<DadosBaseResponse> {
  // Buscar config
  const configDb = await prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: 'redistribuicao' },
    create: { relatorio: 'redistribuicao' },
    update: {},
  });

  const config: RedistribuicaoConfig = {
    maturacaoDias: configDb.maturacaoDias,
    coberturaIdealMeses: decimalToNumber(configDb.coberturaLimiteVerde),
    estoqueMinimoPecas: configDb.redistribuicaoEstoqueMinimo ?? 1,
    pesos: {
      cobertura: 0.4,
      curva: 0.3,
      giro: 0.3,
    },
    lojasRemetentes: configDb.redistribuicaoLojasRemetentes ?? [],
    lojasDestinatarias: configDb.redistribuicaoLojasDestinatarias ?? [],
  };

  // Query resumo por loja
  interface ResumoLojaRow {
    branch_code: number;
    skus_excesso: bigint;
    skus_ruptura: bigint;
    estoque_total: Decimal;
  }

  const resumoLojas = await prisma.$queryRaw<ResumoLojaRow[]>`
    WITH estoque_cobertura AS (
      SELECT
        ps.branch_code,
        ps.product_sku,
        COALESCE(SUM(ps.stock), 0) as estoque,
        COALESCE(e.cobertura_meses, 0) as cobertura_meses
      FROM prd_saldo ps
      LEFT JOIN pcp_estoque_sem_giro_analitico e
        ON e.product_sku = ps.product_sku AND e.branch_code = ps.branch_code
      WHERE ps.is_full_snapshot = true
        AND ps.stock_code = 1
        AND ps.branch_code != 2
      GROUP BY ps.branch_code, ps.product_sku, e.cobertura_meses
      HAVING COALESCE(SUM(ps.stock), 0) > 0
    )
    SELECT
      branch_code,
      COUNT(*) FILTER (WHERE cobertura_meses > ${config.coberturaIdealMeses}) as skus_excesso,
      COUNT(*) FILTER (WHERE cobertura_meses < ${config.coberturaIdealMeses} AND cobertura_meses > 0) as skus_ruptura,
      SUM(estoque) as estoque_total
    FROM estoque_cobertura
    GROUP BY branch_code
    ORDER BY branch_code
  `;

  // Total de SKUs com estoque
  const totalSkus = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT product_sku) as count
    FROM prd_saldo
    WHERE is_full_snapshot = true
      AND stock_code = 1
      AND branch_code != 2
      AND stock > 0
  `;

  return {
    config,
    resumo: {
      skusComEstoque: Number(totalSkus[0]?.count || 0),
      lojasAtivas: resumoLojas.length,
    },
    distribuicaoPorLoja: resumoLojas.map((row) => ({
      branchCode: row.branch_code,
      branchName: getBranchName(row.branch_code),
      skusExcesso: Number(row.skus_excesso),
      skusRuptura: Number(row.skus_ruptura),
      estoqueTotal: decimalToNumber(row.estoque_total),
    })),
  };
}

// ============================================================================
// JOBS
// ============================================================================

export async function criarJob(
  userId: number,
  filtros: RedistribuicaoFiltro
): Promise<{ jobId: number }> {
  // Verificar se usuario ja tem job pendente ou em execucao
  const jobExistente = await prisma.pcpRedistribuicaoJob.findFirst({
    where: {
      createdById: userId,
      status: { in: ['pending', 'running'] },
    },
  });

  if (jobExistente) {
    throw new Error('Voce ja possui um calculo em andamento. Aguarde a conclusao.');
  }

  // Buscar config atual
  const configDb = await prisma.pcpRelatorioConfig.upsert({
    where: { relatorio: 'redistribuicao' },
    create: { relatorio: 'redistribuicao' },
    update: {},
  });

  // Criar job
  const job = await prisma.pcpRedistribuicaoJob.create({
    data: {
      createdById: userId,
      status: 'pending',
      filtroCategoria: filtros.categoria || [],
      filtroLinha: filtros.linha || [],
      filtroGenero: filtros.genero || [],
      filtroReferencia: filtros.referencia || null,
      filtroBranches: filtros.branches || [],
      configMaturacaoDias: configDb.maturacaoDias,
      configCoberturaIdealMeses: configDb.coberturaLimiteVerde,
    },
  });

  // Disparar processamento em background (sem await)
  processarJob(job.id).catch((err) => {
    console.error(`Erro ao processar job ${job.id}:`, err);
  });

  return { jobId: job.id };
}

export async function getJobStatus(jobId: number, userId: number): Promise<JobStatusResponse> {
  const job = await prisma.pcpRedistribuicaoJob.findFirst({
    where: {
      id: jobId,
      createdById: userId,
    },
  });

  if (!job) {
    throw new Error('Job nao encontrado');
  }

  const response: JobStatusResponse = {
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() || null,
    completedAt: job.completedAt?.toISOString() || null,
  };

  if (job.status === 'completed' && job.resultadoJson) {
    response.resultado = job.resultadoJson as unknown as RedistribuicaoResultado;
  }

  if (job.status === 'failed' || job.status === 'timeout') {
    response.errorMessage = job.errorMessage || 'Erro desconhecido';
  }

  return response;
}

export async function listarJobs(
  userId: number,
  limit: number = 10
): Promise<
  Array<{
    jobId: number;
    status: string;
    createdAt: string;
    completedAt: string | null;
    resultadoSkusTotal: number | null;
    resultadoSugestoesTotal: number | null;
  }>
> {
  const jobs = await prisma.pcpRedistribuicaoJob.findMany({
    where: { createdById: userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true,
      resultadoSkusTotal: true,
      resultadoSugestoesTotal: true,
    },
  });

  return jobs.map((job) => ({
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() || null,
    resultadoSkusTotal: job.resultadoSkusTotal,
    resultadoSugestoesTotal: job.resultadoSugestoesTotal,
  }));
}

// ============================================================================
// PROCESSAMENTO DO JOB
// ============================================================================

async function processarJob(jobId: number): Promise<void> {
  const TIMEOUT_MS = 120000; // 2 minutos
  let timeoutId: NodeJS.Timeout | null = null;
  let timedOut = false;

  try {
    // Marcar como running
    const job = await prisma.pcpRedistribuicaoJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date() },
    });

    // Configurar timeout
    timeoutId = setTimeout(() => {
      timedOut = true;
    }, TIMEOUT_MS);

    // Buscar config atual (inclusive lojas remetentes/destinatarias)
    const configDb = await prisma.pcpRelatorioConfig.upsert({
      where: { relatorio: 'redistribuicao' },
      create: { relatorio: 'redistribuicao' },
      update: {},
    });

    const config: RedistribuicaoConfig = {
      maturacaoDias: job.configMaturacaoDias,
      coberturaIdealMeses: decimalToNumber(job.configCoberturaIdealMeses),
      estoqueMinimoPecas: configDb.redistribuicaoEstoqueMinimo ?? 1,
      pesos: {
        cobertura: decimalToNumber(job.configPesoCobertura),
        curva: decimalToNumber(job.configPesoCurva),
        giro: decimalToNumber(job.configPesoGiro),
      },
      lojasRemetentes: configDb.redistribuicaoLojasRemetentes ?? [],
      lojasDestinatarias: configDb.redistribuicaoLojasDestinatarias ?? [],
    };

    // 1. Buscar SKUs elegiveis para ENVIO (origem)
    const skusEnvio = await getSkusElegiveisEnvio(job, config);
    if (timedOut) throw new Error('Timeout');

    // 2. Buscar lojas que podem RECEBER cada SKU
    const destinosPorSku = await getDestinosElegiveis(job, config);
    if (timedOut) throw new Error('Timeout');

    // 3. Gerar sugestoes
    // Mapa para rastrear estoque ja comprometido: chave = "sku:branchCode", valor = quantidade ja alocada
    const estoqueComprometido = new Map<string, number>();

    const sugestoes: RedistribuicaoSugestao[] = [];
    let skusElegiveis = 0;

    for (const sku of skusEnvio) {
      if (timedOut) throw new Error('Timeout');

      const destinos = destinosPorSku.get(sku.productCode);
      if (!destinos || destinos.length === 0) continue;

      skusElegiveis++;

      // Ordenar destinos por prioridade (maior giro mensal primeiro)
      const destinosOrdenados = [...destinos].sort((a, b) => b.mediaMensal - a.mediaMensal);

      for (const destino of destinosOrdenados) {
        // Nao transferir para mesma loja
        if (destino.branchCode === sku.branchCode) continue;

        // Calcular estoque disponivel considerando o que ja foi comprometido e o estoque minimo
        const chaveOrigem = `${sku.productSku}:${sku.branchCode}`;
        const jaComprometido = estoqueComprometido.get(chaveOrigem) || 0;
        // Estoque disponivel = atual - ja comprometido - minimo que deve ficar
        const estoqueDisponivel = sku.estoque - jaComprometido - config.estoqueMinimoPecas;

        // Se nao tem estoque disponivel para enviar, pular
        if (estoqueDisponivel <= 0) continue;

        const quantidade = calcularQuantidadeSugerida(
          estoqueDisponivel,
          sku.mediaMensal,
          destino.estoque,
          destino.mediaMensal,
          config.coberturaIdealMeses
        );

        if (quantidade <= 0) continue;

        // Registrar o estoque comprometido
        estoqueComprometido.set(chaveOrigem, jaComprometido + quantidade);

        const { score, motivo } = calcularScorePrioridade(
          sku.curva,
          sku.coberturaMeses,
          destino.coberturaMeses,
          destino.mediaMensal,
          config.pesos
        );

        sugestoes.push({
          sku: sku.productSku,
          productCode: sku.productCode,
          referenceCode: sku.referenceCode,
          referenceName: sku.referenceName,
          cor: sku.colorName,
          tamanho: sku.size,
          curva: sku.curva,
          origem: {
            branchCode: sku.branchCode,
            branchName: getBranchName(sku.branchCode),
            estoqueAtual: sku.estoque,
            coberturaMeses: sku.coberturaMeses,
            giro3m: sku.giro3m,
            mediaMensal: sku.mediaMensal,
            primeiraEntrada: sku.primeiraEntrada?.toISOString() || null,
          },
          destino: {
            branchCode: destino.branchCode,
            branchName: getBranchName(destino.branchCode),
            estoqueAtual: destino.estoque,
            coberturaMeses: destino.coberturaMeses,
            giro3m: destino.giro3m,
            mediaMensal: destino.mediaMensal,
            vendeu: destino.vendeu,
          },
          quantidadeSugerida: quantidade,
          scorePrioridade: score,
          motivoScore: motivo,
        });
      }
    }

    // Ordenar por score e limitar
    sugestoes.sort((a, b) => b.scorePrioridade - a.scorePrioridade);
    const topSugestoes = sugestoes.slice(0, 5000);

    const resultado: RedistribuicaoResultado = {
      calculadoEm: new Date().toISOString(),
      configSnapshot: config,
      kpis: {
        skusAnalisados: skusEnvio.length,
        skusElegiveis,
        sugestoesCriadas: topSugestoes.length,
        pecasASugerir: topSugestoes.reduce((acc, s) => acc + s.quantidadeSugerida, 0),
      },
      sugestoes: topSugestoes,
    };

    // Salvar resultado
    await prisma.pcpRedistribuicaoJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        resultadoJson: resultado as unknown as Prisma.InputJsonValue,
        resultadoSkusTotal: skusEnvio.length,
        resultadoSugestoesTotal: topSugestoes.length,
      },
    });
  } catch (error) {
    const isTimeout = (error as Error).message === 'Timeout';
    await prisma.pcpRedistribuicaoJob.update({
      where: { id: jobId },
      data: {
        status: isTimeout ? 'timeout' : 'failed',
        completedAt: new Date(),
        errorMessage: (error as Error).message,
      },
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ============================================================================
// QUERIES DO ALGORITMO
// ============================================================================

interface SkuEnvio {
  productSku: string;
  productCode: number;
  referenceCode: string;
  referenceName: string;
  colorName: string | null;
  size: string;
  branchCode: number;
  estoque: number;
  coberturaMeses: number | null;
  mediaMensal: number;
  giro3m: number;
  curva: 'A' | 'B' | 'C' | null;
  primeiraEntrada: Date | null;
}

interface SkuDestino {
  productCode: number;
  branchCode: number;
  estoque: number;
  coberturaMeses: number | null;
  mediaMensal: number;
  giro3m: number;
  vendeu: boolean;
}

async function getSkusElegiveisEnvio(
  job: PcpRedistribuicaoJob,
  config: RedistribuicaoConfig
): Promise<SkuEnvio[]> {
  // Buscar configuracao da curva ABC
  const curvaAbcConfig = await getCurvaAbcConfig();

  // Filtros dinamicos
  const whereCategoria =
    job.filtroCategoria.length > 0
      ? Prisma.sql`AND a.class_categoria = ANY(${job.filtroCategoria})`
      : Prisma.sql``;

  const whereLinha =
    job.filtroLinha.length > 0 ? Prisma.sql`AND a.class_linha = ANY(${job.filtroLinha})` : Prisma.sql``;

  const whereGenero =
    job.filtroGenero.length > 0
      ? Prisma.sql`AND a.class_genero = ANY(${job.filtroGenero})`
      : Prisma.sql``;

  const whereReferencia = job.filtroReferencia
    ? Prisma.sql`AND p.reference_code ILIKE ${`%${job.filtroReferencia}%`}`
    : Prisma.sql``;

  // Filtro de lojas: prioriza o filtro do job, mas se nao tiver usa as lojas remetentes da config
  const lojasRemetentesEfetivas =
    job.filtroBranches.length > 0
      ? job.filtroBranches
      : config.lojasRemetentes.length > 0
        ? config.lojasRemetentes
        : [];

  const whereBranches =
    lojasRemetentesEfetivas.length > 0
      ? Prisma.sql`AND ps.branch_code = ANY(${lojasRemetentesEfetivas})`
      : Prisma.sql``;

  interface SkuEnvioRow {
    product_sku: string;
    product_code: number;
    reference_code: string;
    reference_name: string | null;
    color_name: string | null;
    size: string | null;
    branch_code: number;
    estoque: Decimal;
    cobertura_meses: Decimal | null;
    media_mensal: Decimal;
    giro_3m: Decimal;
    curva: string | null;
    primeira_entrada: Date | null;
  }

  const rows = await prisma.$queryRaw<SkuEnvioRow[]>`
    WITH primeira_entrada AS (
      SELECT
        ti.product_code,
        t.branch_code,
        MIN(t.transaction_date) as data
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
      ${OPERACAO_JOIN}
      WHERE t.status = 4
        AND co.operations_type = 'E'
        AND t.branch_code != 2
      GROUP BY ti.product_code, t.branch_code
    ),
    vendas_3m AS (
      SELECT
        ti.product_code,
        t.branch_code,
        SUM(${QUANTIDADE_COM_SINAL}) as quantidade,
        SUM(CASE WHEN (co.operations_type = 'E' AND co.operation_mode = '3') THEN -ABS(ti.net_value) ELSE ti.net_value END) as valor
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
      ${OPERACAO_JOIN}
      WHERE t.status = 4
        AND ${SALE_OPERATION_FILTER}
        AND t.transaction_date >= CURRENT_DATE - INTERVAL '3 months'
        AND t.branch_code != 2
        AND t.customer_code < 110000000
      GROUP BY ti.product_code, t.branch_code
    ),
    vendas_totais_por_product AS (
      SELECT product_code, SUM(valor) as valor_total
      FROM vendas_3m
      GROUP BY product_code
    ),
    valor_total_geral AS (
      SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas_totais_por_product WHERE valor_total > 0
    ),
    curva_abc AS (
      -- Curva ABC por valor acumulado de venda (mesma logica de curvaAbc.service.ts)
      SELECT
        product_code,
        CASE
          WHEN valor_acumulado_percent <= ${curvaAbcConfig.curvaALimitePercent} THEN 'A'
          WHEN valor_acumulado_percent <= ${curvaAbcConfig.curvaBLimitePercent} THEN 'B'
          ELSE 'C'
        END as curva
      FROM (
        SELECT
          product_code,
          valor_total,
          SUM(valor_total) OVER (ORDER BY valor_total DESC ROWS UNBOUNDED PRECEDING) /
            NULLIF((SELECT total FROM valor_total_geral), 0) * 100 as valor_acumulado_percent
        FROM vendas_totais_por_product
        WHERE valor_total > 0
      ) ranked
    )
    SELECT
      p.product_sku,
      p.product_code,
      p.reference_code,
      p.reference_name,
      p.color_name,
      p.size,
      ps.branch_code,
      COALESCE(SUM(ps.stock), 0) as estoque,
      -- Cobertura = estoque / media mensal (venda 3m / 3)
      CASE
        WHEN COALESCE(v.quantidade, 0) > 0
        THEN COALESCE(SUM(ps.stock), 0) / (v.quantidade / 3.0)
        ELSE NULL
      END as cobertura_meses,
      COALESCE(v.quantidade / 3, 0) as media_mensal,
      COALESCE(v.quantidade, 0) as giro_3m,
      c.curva,
      pe.data as primeira_entrada
    FROM produtos p
    JOIN produto_analitico a ON a.product_sku = p.product_sku
    JOIN prd_saldo ps ON ps.product_sku = p.product_sku
      AND ps.is_full_snapshot = true
      AND ps.stock_code = 1
    LEFT JOIN vendas_3m v ON v.product_code = p.product_code AND v.branch_code = ps.branch_code
    LEFT JOIN curva_abc c ON c.product_code = p.product_code
    LEFT JOIN primeira_entrada pe ON pe.product_code = p.product_code AND pe.branch_code = ps.branch_code
    WHERE ps.branch_code != 2
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      ${PCP_ESTOQUE_LIQUIDO_SKU_FILTER}
      ${whereCategoria}
      ${whereLinha}
      ${whereGenero}
      ${whereReferencia}
      ${whereBranches}
    GROUP BY
      p.product_sku, p.product_code, p.reference_code, p.reference_name,
      p.color_name, p.size, ps.branch_code,
      v.quantidade, c.curva, pe.data
    HAVING COALESCE(SUM(ps.stock), 0) > 1
      -- Cobertura > ideal (estoque / media mensal > X meses)
      AND (
        COALESCE(v.quantidade, 0) = 0
        OR COALESCE(SUM(ps.stock), 0) / (v.quantidade / 3.0) > ${config.coberturaIdealMeses}
      )
      AND (pe.data IS NULL OR CURRENT_DATE - pe.data::date >= ${config.maturacaoDias})
    ORDER BY
      CASE
        WHEN COALESCE(v.quantidade, 0) > 0
        THEN COALESCE(SUM(ps.stock), 0) / (v.quantidade / 3.0)
        ELSE 9999
      END DESC
    LIMIT 10000
  `;

  return rows.map((row) => ({
    productSku: row.product_sku,
    productCode: row.product_code,
    referenceCode: row.reference_code,
    referenceName: row.reference_name || row.reference_code,
    colorName: row.color_name,
    size: row.size || 'UNICO',
    branchCode: row.branch_code,
    estoque: decimalToNumber(row.estoque),
    coberturaMeses: row.cobertura_meses ? decimalToNumber(row.cobertura_meses) : null,
    mediaMensal: decimalToNumber(row.media_mensal),
    giro3m: decimalToNumber(row.giro_3m),
    curva: (row.curva as 'A' | 'B' | 'C') || null,
    primeiraEntrada: row.primeira_entrada,
  }));
}

async function getDestinosElegiveis(
  job: PcpRedistribuicaoJob,
  config: RedistribuicaoConfig
): Promise<Map<number, SkuDestino[]>> {
  // Filtro de lojas destinatarias: prioriza o filtro do job, mas se nao tiver usa a config
  const lojasDestinatariasEfetivas =
    job.filtroBranches.length > 0
      ? job.filtroBranches
      : config.lojasDestinatarias.length > 0
        ? config.lojasDestinatarias
        : [];

  const whereBranches =
    lojasDestinatariasEfetivas.length > 0
      ? Prisma.sql`AND t.branch_code = ANY(${lojasDestinatariasEfetivas})`
      : Prisma.sql``;

  interface DestinoRow {
    product_code: number;
    branch_code: number;
    estoque: Decimal;
    cobertura_meses: Decimal | null;
    media_mensal: Decimal;
    giro_3m: Decimal;
  }

  // SKUs que cada loja JA VENDEU (regra de elegibilidade para receber)
  const rows = await prisma.$queryRaw<DestinoRow[]>`
    WITH vendas_historico AS (
      SELECT DISTINCT ti.product_code, t.branch_code
      FROM transacao_itens ti
      JOIN transacoes t ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
      ${OPERACAO_JOIN}
      WHERE t.status = 4
        AND ${SALE_OPERATION_FILTER}
        AND t.branch_code != 2
        AND t.customer_code < 110000000
        ${whereBranches}
    ),
    vendas_3m AS (
      SELECT
        ti.product_code,
        t.branch_code,
        SUM(${QUANTIDADE_COM_SINAL}) as quantidade
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
      ${OPERACAO_JOIN}
      WHERE t.status = 4
        AND ${SALE_OPERATION_FILTER}
        AND t.transaction_date >= CURRENT_DATE - INTERVAL '3 months'
        AND t.branch_code != 2
        AND t.customer_code < 110000000
        ${whereBranches}
      GROUP BY ti.product_code, t.branch_code
    ),
    estoque_atual AS (
      SELECT
        p.product_code,
        ps.branch_code,
        COALESCE(SUM(ps.stock), 0) as estoque
      FROM produtos p
      LEFT JOIN prd_saldo ps ON ps.product_sku = p.product_sku
        AND ps.is_full_snapshot = true
        AND ps.stock_code = 1
      WHERE ps.branch_code != 2
      GROUP BY p.product_code, ps.branch_code
    )
    SELECT
      vh.product_code,
      vh.branch_code,
      COALESCE(ea.estoque, 0) as estoque,
      -- Cobertura = estoque / media mensal (venda 3m / 3)
      CASE
        WHEN COALESCE(v.quantidade, 0) > 0
        THEN COALESCE(ea.estoque, 0) / (v.quantidade / 3.0)
        ELSE 0
      END as cobertura_meses,
      COALESCE(v.quantidade / 3, 0) as media_mensal,
      COALESCE(v.quantidade, 0) as giro_3m
    FROM vendas_historico vh
    LEFT JOIN estoque_atual ea ON ea.product_code = vh.product_code AND ea.branch_code = vh.branch_code
    LEFT JOIN vendas_3m v ON v.product_code = vh.product_code AND v.branch_code = vh.branch_code
    WHERE (
      -- Cobertura < ideal (ou sem venda recente mas com historico)
      COALESCE(v.quantidade, 0) = 0
      OR COALESCE(ea.estoque, 0) / (v.quantidade / 3.0) < ${config.coberturaIdealMeses}
    )
  `;

  // Agrupar por product_code
  const mapa = new Map<number, SkuDestino[]>();

  for (const row of rows) {
    if (!mapa.has(row.product_code)) {
      mapa.set(row.product_code, []);
    }
    mapa.get(row.product_code)!.push({
      productCode: row.product_code,
      branchCode: row.branch_code,
      estoque: decimalToNumber(row.estoque),
      coberturaMeses: row.cobertura_meses ? decimalToNumber(row.cobertura_meses) : null,
      mediaMensal: decimalToNumber(row.media_mensal),
      giro3m: decimalToNumber(row.giro_3m),
      vendeu: true,
    });
  }

  return mapa;
}

// ============================================================================
// CALCULOS
// ============================================================================

function calcularQuantidadeSugerida(
  estoqueOrigem: number,
  mediaMensalOrigem: number,
  estoqueDestino: number,
  mediaMensalDestino: number,
  coberturaIdealMeses: number
): number {
  // Quantidade maxima que origem pode enviar sem ficar abaixo do ideal
  const estoqueIdealOrigem = mediaMensalOrigem * coberturaIdealMeses;
  const maxEnviar = Math.max(0, estoqueOrigem - estoqueIdealOrigem - 1); // -1 pra manter pelo menos 1

  // Quantidade que destino precisa para atingir ideal
  const estoqueIdealDestino = mediaMensalDestino * coberturaIdealMeses;
  const necessidadeDestino = Math.max(0, estoqueIdealDestino - estoqueDestino);

  // Transferir o menor entre maxEnviar e necessidadeDestino
  return Math.floor(Math.min(maxEnviar, necessidadeDestino));
}

function calcularScorePrioridade(
  curva: 'A' | 'B' | 'C' | null,
  coberturaOrigem: number | null,
  coberturaDestino: number | null,
  giroDestinoMensal: number,
  pesos: { cobertura: number; curva: number; giro: number }
): { score: number; motivo: string } {
  const difCobertura = (coberturaOrigem || 0) - (coberturaDestino || 0);

  // Normalizar diferenca de cobertura (0-100)
  const scoreCobertura = Math.min(100, Math.max(0, (difCobertura / 12) * 100));

  // Score de curva: A=100, B=60, C=30, null=10
  const scoreCurva = curva === 'A' ? 100 : curva === 'B' ? 60 : curva === 'C' ? 30 : 10;

  // Normalizar giro (0-100), assumindo giro mensal max de 50
  const scoreGiro = Math.min(100, (giroDestinoMensal / 50) * 100);

  const scoreTotal =
    scoreCobertura * pesos.cobertura + scoreCurva * pesos.curva + scoreGiro * pesos.giro;

  // Gerar motivo legivel
  const motivos: string[] = [];
  if (difCobertura > 6) motivos.push(`diferenca de ${difCobertura.toFixed(1)} meses de cobertura`);
  if (curva === 'A') motivos.push('produto curva A');
  if (giroDestinoMensal > 10) motivos.push(`giro alto no destino (${giroDestinoMensal.toFixed(0)} pcs/mes)`);

  return {
    score: Math.round(scoreTotal),
    motivo: motivos.join(', ') || 'balanceamento de estoque',
  };
}
