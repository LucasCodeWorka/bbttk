import { Router, Request, Response } from 'express';
import { EstoqueTransitoFiltro, EstoqueTransitoStatus, getEstoqueTransito, getFiltrosEstoqueTransito } from '../services/estoqueTransito.service.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseNumbers(value: unknown): number[] | undefined {
  const values = parseList(value);
  if (!values) return undefined;
  const parsed = values.map(Number).filter((item) => Number.isFinite(item));
  return parsed.length > 0 ? parsed : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

router.get('/estoque-transito/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosEstoqueTransito());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/estoque-transito', async (req: Request, res: Response) => {
  try {
    const filtro: EstoqueTransitoFiltro = {
      status: parseList(req.query.status) as EstoqueTransitoStatus[] | undefined,
      branches: parseNumbers(req.query.branches),
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      statusProduto: parseList(req.query.statusProduto),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      idadeMin: parseNumber(req.query.idadeMin),
      idadeMax: parseNumber(req.query.idadeMax),
      apenasPendentes: req.query.apenasPendentes !== 'false',
      confiabilidade:
        req.query.confiabilidade === 'vinculo' || req.query.confiabilidade === 'sem_vinculo'
          ? req.query.confiabilidade
          : undefined,
      ordenarPor: typeof req.query.ordenarPor === 'string' ? req.query.ordenarPor : undefined,
      direcao: req.query.direcao === 'asc' ? 'asc' : req.query.direcao === 'desc' ? 'desc' : undefined,
      offset: parseNumber(req.query.offset),
      limite: parseNumber(req.query.limite),
      prazoDias: parseNumber(req.query.prazoDias),
    };

    res.json(await getEstoqueTransito(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
