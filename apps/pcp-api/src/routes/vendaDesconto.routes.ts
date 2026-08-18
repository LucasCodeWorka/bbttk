import { Router, Request, Response } from 'express';
import {
  getVendaDesconto,
  getResumoPromocao,
  getFiltrosVendaDesconto,
  VendaDescontoFiltro,
} from '../services/vendaDesconto.service.js';

const router = Router();

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseBranchCodes(value: unknown): number[] | undefined {
  const values = parseList(value);
  if (!values) return undefined;
  const parsed = values.map(Number).filter((item) => Number.isFinite(item));
  return parsed.length > 0 ? parsed : undefined;
}

// GET /api/pcp/venda-desconto/filtros
// Retorna os valores disponíveis para os filtros
router.get('/venda-desconto/filtros', async (_req: Request, res: Response) => {
  try {
    const filtros = await getFiltrosVendaDesconto();
    res.json(filtros);
  } catch (error) {
    console.error('Erro ao buscar filtros de venda/desconto:', error);
    res.status(500).json({ error: String(error) });
  }
});

// GET /api/pcp/venda-desconto
// Relatório 5: Venda e Desconto por Classificação (detalhado)
router.get('/venda-desconto', async (req: Request, res: Response) => {
  try {
    const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : '';
    const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : '';

    if (!dataInicio || !dataFim) {
      res.status(400).json({ error: 'dataInicio e dataFim são obrigatórios' });
      return;
    }

    const classificacao = typeof req.query.classificacao === 'string'
      ? req.query.classificacao as VendaDescontoFiltro['classificacao']
      : 'status';

    const filtro: VendaDescontoFiltro = {
      dataInicio,
      dataFim,
      branches: parseBranchCodes(req.query.branches),
      agruparLojas: req.query.agruparLojas === 'true',
      classificacao,
      itensClassificacao: parseList(req.query.itensClassificacao),
    };

    const result = await getVendaDesconto(filtro);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar relatório venda/desconto:', error);
    res.status(500).json({ error: String(error) });
  }
});

// GET /api/pcp/resumo-promocao
// Relatório 5.1: Resumo da Promoção por Loja
router.get('/resumo-promocao', async (req: Request, res: Response) => {
  try {
    const dataInicio = typeof req.query.dataInicio === 'string' ? req.query.dataInicio : '';
    const dataFim = typeof req.query.dataFim === 'string' ? req.query.dataFim : '';

    if (!dataInicio || !dataFim) {
      res.status(400).json({ error: 'dataInicio e dataFim são obrigatórios' });
      return;
    }

    const filtro = {
      dataInicio,
      dataFim,
      branches: parseBranchCodes(req.query.branches),
      statusPromo: parseList(req.query.statusPromo),
    };

    const result = await getResumoPromocao(filtro);
    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar resumo de promoção:', error);
    res.status(500).json({ error: String(error) });
  }
});

export default router;
