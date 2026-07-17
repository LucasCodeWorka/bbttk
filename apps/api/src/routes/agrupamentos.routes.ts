import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as agrupamentosService from '../services/agrupamentos.service.js';
import * as produtosService from '../services/produtos.service.js';
import { authMiddleware, moduleAccess } from '../middleware/auth.middleware.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.use(authMiddleware, moduleAccess('pcp'));

// Listar grupos de um tipo
router.get('/agrupamentos', async (req: Request, res: Response) => {
  try {
    const tipo = (req.query.tipo as string) || 'cor_produto';
    const grupos = await agrupamentosService.getGrupos(tipo);
    res.json({ grupos });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Criar grupo
router.post('/agrupamentos', async (req: Request, res: Response) => {
  try {
    const { tipo, nome, membros } = req.body;

    if (!tipo || !nome || !Array.isArray(membros) || membros.length === 0) {
      res.status(400).json({ error: 'tipo, nome e membros sao obrigatorios' });
      return;
    }

    const grupo = await agrupamentosService.createGrupo({
      tipo,
      nome,
      membros,
      createdById: req.user?.userId,
    });

    res.json({ grupo });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Excluir grupo
router.delete('/agrupamentos/:id', async (req: Request, res: Response) => {
  try {
    await agrupamentosService.deleteGrupo(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Excluir um membro especifico de um grupo
router.delete('/agrupamentos/membros/:id', async (req: Request, res: Response) => {
  try {
    await agrupamentosService.deleteMembro(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Upload de CSV com nomes/codigos de cor, retorna as cores cadastradas que bateram
router.post('/agrupamentos/cores/csv', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado' });
      return;
    }

    const conteudo = req.file.buffer.toString('utf-8');
    const linhas = conteudo
      .split(/\r?\n/)
      .map(l => l.replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);

    const cores = await produtosService.getCoresDistintas();
    const coresEncontradas = produtosService.matchColorsFromCsv(linhas, cores);

    res.json({ cores: coresEncontradas, total_linhas: linhas.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
