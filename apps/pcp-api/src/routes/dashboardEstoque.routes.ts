import { Router, Request, Response } from 'express';
import { DashboardEstoqueFiltro, buscarProdutosDashboardEstoque, getDashboardEstoque, getFiltrosDashboardEstoque } from '../services/dashboardEstoque.service.js';

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

router.get('/dashboard-estoque/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosDashboardEstoque());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/dashboard-estoque/produtos', async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    res.json({ produtos: await buscarProdutosDashboardEstoque(search) });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/dashboard-estoque', async (req: Request, res: Response) => {
  try {
    const data = req.query.data;
    if (!isDate(data)) {
      res.status(400).json({ error: 'data e obrigatoria no formato YYYY-MM-DD' });
      return;
    }

    const filtro: DashboardEstoqueFiltro = {
      data,
      branches: parseBranchCodes(req.query.branches),
      stockCodes: parseBranchCodes(req.query.stockCodes),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      produtos: parseList(req.query.produtos),
      tipo: parseList(req.query.tipo),
      categoria: parseList(req.query.categoria),
      grupo: parseList(req.query.grupo),
      linha: parseList(req.query.linha),
      colecao: parseList(req.query.colecao),
      genero: parseList(req.query.genero),
      modelo: parseList(req.query.modelo),
      tecido: parseList(req.query.tecido),
      lancamento: parseList(req.query.lancamento),
      status: parseList(req.query.status),
      motorPromocional: parseList(req.query.motorPromocional),
      campanha: parseList(req.query.campanha),
    };

    const resultado = await getDashboardEstoque(filtro, { refresh: req.query.refresh === '1' });
    res.setHeader('X-Dashboard-Estoque-Cache', resultado.fromCache ? 'HIT' : 'MISS');
    res.json(resultado.data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
