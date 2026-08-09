import { Router, Request, Response } from 'express';
import { getVendaDia, getFiltrosVendaDia, TipoClassificacao, VendaDiaFiltro } from '../services/vendaDia.service.js';

const router = Router();

function parseArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

function parseNumberArray(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n));
}

router.get('/venda-dia', async (req: Request, res: Response) => {
  try {
    const tipoClassificacao = (req.query.tipoClassificacao as TipoClassificacao) || 'categoria';
    const classificacaoValores = parseArray(req.query.classificacaoValores as string);
    const branches = parseNumberArray(req.query.branches as string);
    const agruparLojas = req.query.agruparLojas === 'true';

    const filtro: VendaDiaFiltro = {
      tipoClassificacao,
      classificacaoValores,
      branches,
      agruparLojas,
    };

    const response = await getVendaDia(filtro);
    res.json(response);
  } catch (error) {
    console.error('Erro em /venda-dia:', error);
    res.status(500).json({ error: 'Erro ao buscar relatório de venda do dia' });
  }
});

router.get('/venda-dia/filtros', async (_req: Request, res: Response) => {
  try {
    const filtros = await getFiltrosVendaDia();
    res.json(filtros);
  } catch (error) {
    console.error('Erro em /venda-dia/filtros:', error);
    res.status(500).json({ error: 'Erro ao buscar filtros' });
  }
});

export default router;
