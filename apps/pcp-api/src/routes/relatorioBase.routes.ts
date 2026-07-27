import { Router, Request, Response } from 'express';
import { getRelatorioBase, getFiltrosRelatorioBase, RelatorioBaseFiltro } from '../services/relatorioBase.service.js';

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

router.get('/relatorio-base/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosRelatorioBase());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/relatorio-base', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit === 'all' ? null : Number(req.query.limit || 50);

    const filtro: RelatorioBaseFiltro = {
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      status: parseList(req.query.status),
      branches: parseBranchCodes(req.query.branches),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: limit === null ? null : Number.isFinite(limit) ? limit : 50,
    };

    res.json(await getRelatorioBase(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
