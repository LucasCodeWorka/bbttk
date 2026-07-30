import { Router, Request, Response } from 'express';
import { getGrade, getCurvaAbcTamanho, AnaliseGradeFiltro } from '../services/analiseGrade.service.js';

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

function parseFiltro(req: Request): AnaliseGradeFiltro {
  return {
    referencia: typeof req.query.referencia === 'string' ? req.query.referencia : undefined,
    categoria: parseList(req.query.categoria),
    linha: parseList(req.query.linha),
    genero: parseList(req.query.genero),
    status: parseList(req.query.status),
    cor: parseList(req.query.cor),
    branches: parseBranchCodes(req.query.branches),
  };
}

router.get('/analise-grade', async (req: Request, res: Response) => {
  try {
    res.json(await getGrade(parseFiltro(req)));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/analise-grade/curva-abc-tamanho', async (req: Request, res: Response) => {
  try {
    res.json(await getCurvaAbcTamanho(parseFiltro(req)));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
