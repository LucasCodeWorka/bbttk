import { Router, Request, Response } from 'express';
import { getCurvaAbcResumo, getCurvaAbcResumoPorSku, getCurvaAbcSkus, CurvaAbcFiltro, CurvaAbcSkuFiltro } from '../services/curvaAbc.service.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseFiltro(req: Request): CurvaAbcFiltro {
  return {
    categoria: parseList(req.query.categoria),
    linha: parseList(req.query.linha),
    genero: parseList(req.query.genero),
    status: parseList(req.query.status),
    familia: parseList(req.query.familia),
  };
}

router.get('/curva-abc', async (req: Request, res: Response) => {
  try {
    res.json(await getCurvaAbcResumo(parseFiltro(req)));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/curva-abc/resumo-sku', async (req: Request, res: Response) => {
  try {
    res.json(await getCurvaAbcResumoPorSku(parseFiltro(req)));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/curva-abc/skus', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 20));

    const filtro: CurvaAbcSkuFiltro = {
      ...parseFiltro(req),
      referencia: typeof req.query.referencia === 'string' ? req.query.referencia : undefined,
      page,
      pageSize,
    };

    res.json(await getCurvaAbcSkus(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
