import { Router, Request, Response } from 'express';
import { getTransferencia, TransferenciaFiltro } from '../services/transferencia.service.js';

const router = Router();

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
