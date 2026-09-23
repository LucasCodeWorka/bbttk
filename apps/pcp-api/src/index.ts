import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './config/database.js';
import { authMiddleware, moduleAccess } from './middleware/auth.middleware.js';
import estoqueRoutes from './routes/estoque.routes.js';
import relatorioBaseRoutes from './routes/relatorioBase.routes.js';
import visaoGeralRoutes from './routes/visaoGeral.routes.js';
import analiseGradeRoutes from './routes/analiseGrade.routes.js';
import curvaAbcRoutes from './routes/curvaAbc.routes.js';
import raioXRoutes from './routes/raioX.routes.js';
import redistribuicaoRoutes from './routes/redistribuicao.routes.js';
import performanceColecaoRoutes from './routes/performanceColecao.routes.js';
import emProducaoRoutes from './routes/emProducao.routes.js';
import vendaDiaRoutes from './routes/vendaDia.routes.js';
import sugestaoProducaoRoutes from './routes/sugestaoProducao.routes.js';
import pesosGradesRoutes from './routes/pesosGrades.routes.js';
import vendaDescontoRoutes from './routes/vendaDesconto.routes.js';
import dashboardEstoqueRoutes from './routes/dashboardEstoque.routes.js';
import agrupamentoCoresCoberturaRoutes from './routes/agrupamentoCoresCobertura.routes.js';

const app = express();
const PORT = process.env.PORT || process.env.PCP_API_PORT || 3002;

const DEFAULT_CORS_ORIGINS = [
  'https://bebettk.onrender.com',
  'https://bebetenkite-web.onrender.com',
];

const corsOrigins = [
  ...(process.env.CORS_ORIGIN
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) || []),
  ...DEFAULT_CORS_ORIGINS,
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : []),
];

const HEAVY_REPORT_PATHS = new Set([
  '/relatorio-base',
  '/visao-geral',
  '/analise-grade',
  '/analise-grade/curva-abc-tamanho',
  '/curva-abc',
  '/curva-abc/resumo-sku',
  '/curva-abc/skus',
  '/estoque-sem-giro',
  '/dashboard-estoque',
  '/raio-x',
  '/redistribuicao/dados-base',
  '/performance-colecao',
  '/sugestao-producao',
  '/pesos-grades',
  '/venda-dia',
  '/venda-dia/acompanhamento',
  '/venda-desconto',
]);

let heavyReportRunning = false;
const heavyReportQueue: Array<() => void> = [];

async function reserveHeavyReportSlot(): Promise<() => void> {
  if (heavyReportRunning) {
    await new Promise<void>((resolve) => heavyReportQueue.push(resolve));
  }
  heavyReportRunning = true;

  return () => {
    const next = heavyReportQueue.shift();
    if (next) next();
    else heavyReportRunning = false;
  };
}

function heapMegabytes(): string {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
}

async function monitorPcpRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
  const heavy = HEAVY_REPORT_PATHS.has(req.path);
  const startedAt = Date.now();
  const queuedAt = Date.now();
  let responseClosed = false;
  // A conexao pode ser fechada enquanto a requisicao aguarda sua vez. Marca isso
  // antes do await para nao deixar uma vaga da fila presa por um cliente que desistiu.
  res.once('close', () => {
    responseClosed = true;
  });
  const release = heavy ? await reserveHeavyReportSlot() : null;
  if (responseClosed || res.writableEnded) {
    release?.();
    return;
  }
  const queueMs = Date.now() - queuedAt;
  let finished = false;

  if (heavy) console.log(`[pcp] inicio ${req.method} ${req.path} | fila ${queueMs}ms | heap ${heapMegabytes()}MB`);

  const finish = () => {
    if (finished) return;
    finished = true;
    release?.();
    if (heavy) console.log(`[pcp] fim ${req.method} ${req.path} | ${res.statusCode} | ${Date.now() - startedAt}ms | heap ${heapMegabytes()}MB`);
  };

  res.once('finish', finish);
  res.once('close', finish);
  next();
}

app.use(cors(corsOrigins?.length ? { origin: corsOrigins } : undefined));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'pcp-api', status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/pcp', authMiddleware, moduleAccess('pcp_servico'), monitorPcpRequest);
app.use('/api/pcp', estoqueRoutes);
app.use('/api/pcp', dashboardEstoqueRoutes);
app.use('/api/pcp', relatorioBaseRoutes);
app.use('/api/pcp', visaoGeralRoutes);
app.use('/api/pcp', analiseGradeRoutes);
app.use('/api/pcp', curvaAbcRoutes);
app.use('/api/pcp', raioXRoutes);
app.use('/api/pcp', redistribuicaoRoutes);
app.use('/api/pcp', performanceColecaoRoutes);
app.use('/api/pcp', emProducaoRoutes);
app.use('/api/pcp', vendaDiaRoutes);
app.use('/api/pcp', sugestaoProducaoRoutes);
app.use('/api/pcp', pesosGradesRoutes);
app.use('/api/pcp', vendaDescontoRoutes);
app.use('/api/pcp', agrupamentoCoresCoberturaRoutes);

async function start() {
  try {
    await prisma.$connect();
    console.log('PCP API conectada ao PostgreSQL');
    app.listen(PORT, () => {
      console.log(`PCP API: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Erro ao iniciar PCP API:', error);
    process.exit(1);
  }
}

start();
