import { Router, Request, Response } from 'express';
import { getTransferencia, TransferenciaFiltro, buscarReferencias } from '../services/transferencia.service.js';

const router = Router();

// Endpoint de busca de referências para o autocomplete
router.get('/transferencia/referencias', async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const resultado = await buscarReferencias(search, limit);
    res.json(resultado);
  } catch (error) {
    console.error('Erro em /transferencia/referencias:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get('/transferencia', async (req: Request, res: Response) => {
  try {
    const referencia = typeof req.query.referencia === 'string' && req.query.referencia.trim()
      ? req.query.referencia.trim()
      : undefined;

    const agruparPorCor = req.query.agruparPorCor === 'true' || req.query.agruparPorCor === '1';

    const filtro: TransferenciaFiltro = {
      referencia,
      agruparPorCor,
    };

    const resultado = await getTransferencia(filtro);
    res.json(resultado);
  } catch (error) {
    console.error('Erro em /transferencia:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
