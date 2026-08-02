import { Router, Request, Response } from 'express';
import { getRaioX, RaioXFiltro } from '../services/raioX.service.js';
import { prisma } from '../config/database.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseNumberList(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => Number(item.trim())).filter((n) => !isNaN(n));
}

function parseFiltro(req: Request): RaioXFiltro {
  const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : '';
  const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : '';
  const canal = req.query.canal === 'varejo' || req.query.canal === 'atacado' || req.query.canal === 'todos'
    ? req.query.canal
    : 'todos';
  const visao = req.query.visao === 'sintetico' || req.query.visao === 'analitico'
    ? req.query.visao
    : 'analitico';
  const agruparPorCor = req.query.agruparPorCor === 'true';

  return {
    dataInicio,
    dataFim,
    referencias: parseList(req.query.referencias),
    categorias: parseList(req.query.categorias),
    lojas: parseNumberList(req.query.lojas),
    canal,
    visao,
    agruparPorCor,
  };
}

router.get('/raio-x/produtos', async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    interface ProdutoSearchRow {
      reference_code: string;
      reference_name: string;
    }

    let produtos: ProdutoSearchRow[];

    if (search) {
      // Com filtro de busca
      produtos = await prisma.$queryRaw<ProdutoSearchRow[]>`
        SELECT DISTINCT
          reference_code,
          reference_name
        FROM produto_analitico
        WHERE reference_code IS NOT NULL
          AND (
            reference_code ILIKE ${`%${search}%`} OR
            reference_name ILIKE ${`%${search}%`}
          )
        ORDER BY reference_code
        LIMIT ${limit}
      `;
    } else {
      // Sem filtro, retorna lista inicial
      produtos = await prisma.$queryRaw<ProdutoSearchRow[]>`
        SELECT DISTINCT
          reference_code,
          reference_name
        FROM produto_analitico
        WHERE reference_code IS NOT NULL
        ORDER BY reference_code
        LIMIT ${limit}
      `;
    }

    res.json(produtos);
  } catch (error) {
    console.error('Erro em /raio-x/produtos:', error);
    res.status(500).json({ error: String(error) });
  }
});

router.get('/raio-x', async (req: Request, res: Response) => {
  try {
    const filtro = parseFiltro(req);

    // Validação básica
    if (!filtro.dataInicio || !filtro.dataFim) {
      res.status(400).json({ error: 'dataInicio e dataFim são obrigatórios' });
      return;
    }

    res.json(await getRaioX(filtro));
  } catch (error) {
    console.error('Erro em /raio-x:', error);
    res.status(500).json({ error: String(error) });
  }
});

export default router;
