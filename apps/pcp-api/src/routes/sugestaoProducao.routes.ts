import { Router, Request, Response } from 'express';
import { SugestaoProducaoFiltro, getSugestaoProducao, getFiltrosSugestaoProducao } from '../services/sugestaoProducao.service.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

router.get('/sugestao-producao/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosSugestaoProducao());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/sugestao-producao', async (req: Request, res: Response) => {
  try {
    const filtro: SugestaoProducaoFiltro = {
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      status: parseList(req.query.status),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      apenasComSugestao: parseBoolean(req.query.apenasComSugestao),
    };
    res.json(await getSugestaoProducao(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
