import { Router, Request, Response } from 'express';
import { getVisaoGeral, VisaoGeralFiltro } from '../services/visaoGeral.service.js';

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

router.get('/visao-geral', async (req: Request, res: Response) => {
  try {
    const filtro: VisaoGeralFiltro = {
      branches: parseBranchCodes(req.query.branches),
      genero: parseList(req.query.genero),
    };
    res.json(await getVisaoGeral(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
