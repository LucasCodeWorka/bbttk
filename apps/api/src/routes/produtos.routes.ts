import { Router, Request, Response } from 'express';
import * as produtosService from '../services/produtos.service.js';
import { authMiddleware, moduleAccess } from '../middleware/auth.middleware.js';
import { getProdutoImagens, ProdutoImagensError } from '../services/produtoImagens.service.js';

const router = Router();

router.use(authMiddleware, moduleAccess('pcp'));

router.get('/produtos/:productCode/imagens', async (req: Request, res: Response) => {
  const value = req.params.productCode;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    res.status(400).json({ error: 'Código de produto inválido.' });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    res.json(await getProdutoImagens(Number(value)));
  } catch (error) {
    res.status(error instanceof ProdutoImagensError ? error.statusCode : 502).json({
      error: error instanceof ProdutoImagensError ? error.message : 'Não foi possível carregar as fotos no momento.',
    });
  }
});

// Cores distintas cadastradas - ?tipo=cor_produto exclui cor ja usada em outro
// agrupamento; ?grupoId=X mantem visiveis as cores do proprio grupo (tela de edicao)
router.get('/produtos/cores', async (req: Request, res: Response) => {
  try {
    const tipo = req.query.tipo as string | undefined;
    const grupoId = req.query.grupoId ? parseInt(req.query.grupoId as string) : undefined;
    const cores = await produtosService.getCoresDistintas(tipo, grupoId);
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
