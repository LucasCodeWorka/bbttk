import { Router, Request, Response } from 'express';
import * as metaClassificacaoService from '../services/metaClassificacao.service.js';
import { authMiddleware, adminOnly } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware, adminOnly);

router.get('/pcp-meta-classificacao', async (req: Request, res: Response) => {
  try {
    const ano = parseInt(req.query.ano as string, 10);
    const mes = parseInt(req.query.mes as string, 10);
    if (!ano || !mes) {
      res.status(400).json({ error: 'ano e mes sao obrigatorios' });
      return;
    }
    const metas = await metaClassificacaoService.getMetasClassificacao(ano, mes);
    res.json({ metas });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/pcp-meta-classificacao', async (req: Request, res: Response) => {
  try {
    const { ano, mes, items } = req.body;
    if (!ano || !mes || !Array.isArray(items)) {
      res.status(400).json({ error: 'ano, mes e items sao obrigatorios' });
      return;
    }
    const metas = await metaClassificacaoService.upsertMetasClassificacao(ano, mes, items, req.user?.userId);
    res.json({ metas });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete('/pcp-meta-classificacao/:id', async (req: Request, res: Response) => {
  try {
    await metaClassificacaoService.deleteMetaClassificacao(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/pcp-meta-classificacao/valores/:tipo', async (req: Request, res: Response) => {
  try {
    const valores = await metaClassificacaoService.getValoresClassificacao(req.params.tipo);
    res.json({ valores });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
