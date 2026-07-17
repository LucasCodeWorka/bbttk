import { Router, Request, Response } from 'express';
import * as produtosService from '../services/produtos.service.js';
import { authMiddleware, moduleAccess } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware, moduleAccess('pcp'));

// Cores distintas cadastradas
router.get('/produtos/cores', async (_req: Request, res: Response) => {
  try {
    const cores = await produtosService.getCoresDistintas();
    res.json({ cores });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Impacto de um agrupamento: quais referencia+cor seriam afetadas
router.post('/produtos/impacto-agrupamento', async (req: Request, res: Response) => {
  try {
    const { tipo, cores, excluirGrupoId } = req.body;

    if (!tipo || !Array.isArray(cores)) {
      res.status(400).json({ error: 'tipo e cores sao obrigatorios' });
      return;
    }

    const impacto = await produtosService.getImpactoAgrupamento(tipo, cores, excluirGrupoId);
    res.json({ impacto });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
