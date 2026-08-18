import { Router, Request, Response } from 'express';
import { getPesosGrades, buscarReferenciasPesosGrades, PesosGradesFiltro, TipoAnalisePesosGrades } from '../services/pesosGrades.service.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

router.get('/pesos-grades/referencias', async (req: Request, res: Response) => {
  try {
    const referencias = await buscarReferenciasPesosGrades({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      status: parseList(req.query.status),
      limit: Number(req.query.limit) || undefined,
    });
    res.json({ referencias });
  } catch (error) {
    console.error('Erro em /pesos-grades/referencias:', error);
    res.status(500).json({ error: String(error) });
  }
});

router.get('/pesos-grades', async (req: Request, res: Response) => {
  try {
    const tipoAnalise: TipoAnalisePesosGrades = req.query.tipoAnalise === 'categoria' ? 'categoria' : 'item';
    const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : '';
    const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : '';
    const fatorDivisor = Number(req.query.fatorDivisor);

    if (!dataInicio || !dataFim) {
      res.status(400).json({ error: 'dataInicio e dataFim sao obrigatorios' });
      return;
    }

    const filtro: PesosGradesFiltro = {
      tipoAnalise,
      referencias: parseList(req.query.referencias),
      categorias: parseList(req.query.categorias),
      dataInicio,
      dataFim,
      fatorDivisor,
    };

    res.json(await getPesosGrades(filtro));
  } catch (error) {
    console.error('Erro em /pesos-grades:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
