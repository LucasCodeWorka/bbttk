import { Router, Request, Response } from 'express';
import { getCoberturaAgrupamento } from '../services/agrupamentoCoresCobertura.service.js';

const router = Router();

router.get('/agrupamento-cores/cobertura', async (_req: Request, res: Response) => {
  try {
    res.json(await getCoberturaAgrupamento());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
