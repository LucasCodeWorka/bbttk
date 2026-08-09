import { Router, Request, Response } from 'express';
import { EmProducaoFiltro, getEmProducao, getFiltrosEmProducao } from '../services/emProducao.service.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseNumberList(value: unknown): number[] | undefined {
  const values = parseList(value);
  if (!values) return undefined;
  const parsed = values.map(Number).filter((item) => Number.isFinite(item));
  return parsed.length > 0 ? parsed : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function parseDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

router.get('/em-producao/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosEmProducao());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/em-producao', async (req: Request, res: Response) => {
  try {
    const filtro: EmProducaoFiltro = {
      status: parseNumberList(req.query.status),
      colecao: parseList(req.query.colecao),
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      statusProduto: parseList(req.query.statusProduto),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      dataInicio: parseDate(req.query.dataInicio),
      considerarSemReferencia: parseBoolean(req.query.considerarSemReferencia),
    };
    res.json(await getEmProducao(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
