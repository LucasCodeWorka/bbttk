import { Router, Request, Response } from 'express';
import {
  getFiltrosPerformanceColecao,
  getPerformanceColecao,
  PerformanceColecaoFiltro,
} from '../services/performanceColecao.service.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseBranchCodes(value: unknown): number[] | undefined {
  const values = parseList(value);
  if (!values) return undefined;
  const parsed = values.map(Number).filter((item) => Number.isFinite(item));
  return parsed.length > 0 ? parsed : undefined;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

router.get('/performance-colecao/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosPerformanceColecao());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/performance-colecao', async (req: Request, res: Response) => {
  try {
    const dataInicio = req.query.dataInicio;
    const dataFim = req.query.dataFim;
    if (!isDate(dataInicio) || !isDate(dataFim)) {
      res.status(400).json({ error: 'dataInicio e dataFim sao obrigatorias no formato YYYY-MM-DD' });
      return;
    }
    if (dataInicio > dataFim) {
      res.status(400).json({ error: 'dataInicio nao pode ser maior que dataFim' });
      return;
    }

    const filtro: PerformanceColecaoFiltro = {
      dataInicio,
      dataFim,
      colecao: parseList(req.query.colecao),
      branches: parseBranchCodes(req.query.branches),
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      status: parseList(req.query.status),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    };

    res.json(await getPerformanceColecao(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
