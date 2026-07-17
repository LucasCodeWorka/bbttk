import { Router, Request, Response } from 'express';
import { getEntregas } from '../services/entregas.service.js';

const router = Router();

router.get('/entregas', (_req: Request, res: Response) => {
  try {
    const entregas = getEntregas();
    res.json({ entregas });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
