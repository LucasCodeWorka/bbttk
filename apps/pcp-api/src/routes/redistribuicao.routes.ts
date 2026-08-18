import { Router, Request, Response } from 'express';
import {
  getDadosBase,
  criarJob,
  getJobStatus,
  listarJobs,
  RedistribuicaoFiltro,
} from '../services/redistribuicao.service.js';

const router = Router();

// GET /redistribuicao/dados-base - Dados iniciais para a tela
router.get('/redistribuicao/dados-base', async (req: Request, res: Response) => {
  try {
    const resultado = await getDadosBase();
    res.json(resultado);
  } catch (error) {
    console.error('Erro em /redistribuicao/dados-base:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// POST /redistribuicao/jobs - Iniciar novo calculo de sugestao
router.post('/redistribuicao/jobs', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Usuario nao autenticado' });
      return;
    }

    const filtros: RedistribuicaoFiltro = {
      categoria: Array.isArray(req.body.categoria) ? req.body.categoria : undefined,
      linha: Array.isArray(req.body.linha) ? req.body.linha : undefined,
      genero: Array.isArray(req.body.genero) ? req.body.genero : undefined,
      referencia: typeof req.body.referencia === 'string' ? req.body.referencia : undefined,
      branches: Array.isArray(req.body.branches) ? req.body.branches : undefined,
    };

    const resultado = await criarJob(userId, filtros);
    res.status(201).json(resultado);
  } catch (error) {
    console.error('Erro em POST /redistribuicao/jobs:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// GET /redistribuicao/jobs - Listar jobs do usuario
router.get('/redistribuicao/jobs', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Usuario nao autenticado' });
      return;
    }

    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const resultado = await listarJobs(userId, limit);
    res.json(resultado);
  } catch (error) {
    console.error('Erro em GET /redistribuicao/jobs:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// GET /redistribuicao/jobs/:jobId - Consultar status/resultado de um job
router.get('/redistribuicao/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Usuario nao autenticado' });
      return;
    }

    const jobId = parseInt(req.params.jobId, 10);
    if (isNaN(jobId)) {
      res.status(400).json({ error: 'jobId invalido' });
      return;
    }

    const resultado = await getJobStatus(jobId, userId);
    res.json(resultado);
  } catch (error) {
    console.error('Erro em GET /redistribuicao/jobs/:jobId:', error);
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('nao encontrado')) {
      res.status(404).json({ error: message });
      return;
    }

    res.status(500).json({ error: message });
  }
});

export default router;
