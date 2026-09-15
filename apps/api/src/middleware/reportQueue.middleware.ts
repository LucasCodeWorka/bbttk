import { Request, Response, NextFunction } from 'express';

type ReleaseSlot = () => void;

const DEFAULT_MAX_CONCURRENT_REPORTS = 2;

const HEAVY_REPORT_PREFIXES = [
  '/comparativo-ano',
  '/historico-lojas',
  '/metas/comissoes',
  '/projecao-filiais',
  '/projecao-mes',
  '/top-produtos',
  '/vendas/dia-semana',
  '/vendas/diarias',
  '/vendas/hoje',
  '/vendas/horarias',
  '/vendas/mensais',
  '/vendas/mes',
  '/vendas/periodo',
  '/vendedores',
  '/vendedores-historico',
  '/vendedores-por-filial',
];

let activeReports = 0;
const reportQueue: Array<() => void> = [];

function maxConcurrentReports(): number {
  const configured = Number(process.env.COMERCIAL_REPORT_CONCURRENCY);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_CONCURRENT_REPORTS;
}

function isHeavyReportPath(path: string): boolean {
  return HEAVY_REPORT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

async function reserveReportSlot(): Promise<ReleaseSlot> {
  if (activeReports >= maxConcurrentReports()) {
    await new Promise<void>((resolve) => reportQueue.push(resolve));
  }
  activeReports++;

  return () => {
    activeReports = Math.max(activeReports - 1, 0);
    const next = reportQueue.shift();
    if (next) next();
  };
}

export async function reportQueueMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isHeavyReportPath(req.path)) {
    next();
    return;
  }

  let responseClosed = false;
  res.once('close', () => {
    responseClosed = true;
  });

  const startedAt = Date.now();
  const release = await reserveReportSlot();
  if (responseClosed || res.writableEnded) {
    release();
    return;
  }

  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    release();
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 5000) {
      console.log(`[api] relatorio ${req.method} ${req.path} finalizado em ${elapsedMs}ms`);
    }
  };

  res.once('finish', finish);
  res.once('close', finish);
  next();
}
