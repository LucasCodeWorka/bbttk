import { Router, Request, Response } from 'express';
import { getEstoqueSemGiro, getFiltrosEstoqueSemGiro, CoberturaFiltro, ProdutoFiltro } from '../services/estoque.service.js';

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

router.get('/estoque-sem-giro/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosEstoqueSemGiro());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/estoque-sem-giro', async (req: Request, res: Response) => {
  try {
    const diasParam = Number(req.query.dias || 91);
    const dias = Number.isFinite(diasParam) ? diasParam : 91;
    const cobertura = typeof req.query.cobertura === 'string' ? req.query.cobertura as CoberturaFiltro : undefined;

    const produtoFiltro: ProdutoFiltro = {
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
    };

    const limit = req.query.limit === 'all' ? null : Number(req.query.limit || 10);

    res.json(await getEstoqueSemGiro({
      dias,
      cobertura,
      produtoFiltro,
      branchCodes: parseBranchCodes(req.query.branches),
      limit: limit === null ? null : Number.isFinite(limit) ? limit : 10,
    }));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
