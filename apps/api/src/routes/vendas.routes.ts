import { Router, Request, Response } from 'express';
import * as vendasService from '../services/vendas.service.js';
import { getVendedoresApi } from '../services/totvs.service.js';

const router = Router();

// Vendas de hoje
router.get('/vendas/hoje/:branchCode?', async (req: Request, res: Response) => {
  try {
    const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filiais = await vendasService.getVendasPeriodo(today, today, branchCode);

    if (branchCode && filiais.length > 0) {
      res.json(filiais[0]);
      return;
    }

    const total = vendasService.calcularTotais(filiais);

    res.json({
      periodo: { inicio: today.toISOString().split('T')[0], fim: today.toISOString().split('T')[0] },
      filiais,
      total,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Vendas do mês
router.get('/vendas/mes/:branchCode?', async (req: Request, res: Response) => {
  try {
    const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const filiais = await vendasService.getVendasPeriodo(startMonth, today, branchCode);

    if (branchCode && filiais.length > 0) {
      res.json(filiais[0]);
      return;
    }

    const total = vendasService.calcularTotais(filiais);

    res.json({
      periodo: {
        inicio: startMonth.toISOString().split('T')[0],
        fim: today.toISOString().split('T')[0],
      },
      filiais,
      total,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Vendas por período
router.get('/vendas/periodo/:start/:end/:branchCode?', async (req: Request, res: Response) => {
  try {
    const { start, end } = req.params;
    const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;

    const startDate = new Date(start);
    const endDate = new Date(end);

    const filiais = await vendasService.getVendasPeriodo(startDate, endDate, branchCode);

    if (branchCode && filiais.length > 0) {
      res.json(filiais[0]);
      return;
    }

    const total = vendasService.calcularTotais(filiais);

    res.json({
      periodo: { inicio: start, fim: end },
      filiais,
      total,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Vendas diárias por período
router.get('/vendas/diarias/periodo/:start/:end/:branchCode?', async (req: Request, res: Response) => {
  try {
    const { start, end } = req.params;
    const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;

    const startDate = new Date(start);
    const endDate = new Date(end);

    const dados = await vendasService.getVendasDiarias(startDate, endDate, branchCode);

    res.json({
      periodo: { inicio: start, fim: end },
      dados,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Top produtos
router.get('/top-produtos/:branchCode?', async (req: Request, res: Response) => {
  try {
    const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const produtos = await vendasService.getTopProdutos(startMonth, today, branchCode);

    res.json({
      periodo: {
        inicio: startMonth.toISOString().split('T')[0],
        fim: today.toISOString().split('T')[0],
      },
      produtos,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Vendedores
router.get('/vendedores/:branchCode?', async (req: Request, res: Response) => {
  try {
    const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const vendedores = await vendasService.getVendasVendedor(startMonth, today, branchCode);

    // Buscar nomes dos vendedores da API TOTVS
    const nomes = await getVendedoresApi();

    // Adicionar nomes
    const vendedoresComNomes = vendedores.map(v => ({
      ...v,
      seller_name: nomes.get(v.seller_code) || `Vendedor ${v.seller_code}`,
    }));

    res.json({
      periodo: {
        inicio: startMonth.toISOString().split('T')[0],
        fim: today.toISOString().split('T')[0],
      },
      vendedores: vendedoresComNomes,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Lista de vendedores (para select)
router.get('/vendedores-lista', async (_req: Request, res: Response) => {
  try {
    const nomes = await getVendedoresApi();
    const vendedores = Array.from(nomes.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ vendedores });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Comparativo ano
router.get('/comparativo-ano/:start?/:end?', async (req: Request, res: Response) => {
  try {
    const today = new Date();
    let startAtual: Date;
    let endAtual: Date;

    if (req.params.start && req.params.end) {
      startAtual = new Date(req.params.start);
      endAtual = new Date(req.params.end);
    } else {
      startAtual = new Date(today.getFullYear(), today.getMonth(), 1);
      endAtual = today;
    }

    const startAnterior = new Date(startAtual);
    startAnterior.setFullYear(startAnterior.getFullYear() - 1);
    const endAnterior = new Date(endAtual);
    endAnterior.setFullYear(endAnterior.getFullYear() - 1);

    const filiaisAtual = await vendasService.getVendasPeriodo(startAtual, endAtual);
    const filiaisAnterior = await vendasService.getVendasPeriodo(startAnterior, endAnterior);

    const anteriorDict = new Map(filiaisAnterior.map(f => [f.branch_code, f]));

    const filiaisComparativo = filiaisAtual.map(f => {
      const ant = anteriorDict.get(f.branch_code) || {
        faturamento: 0,
        pecas: 0,
        transacoes: 0,
        pa: 0,
        tm: 0,
      };

      const varFat = vendasService.calcularVariacao(f.faturamento, ant.faturamento);
      const varPecas = vendasService.calcularVariacao(f.pecas, ant.pecas);
      const varTrans = vendasService.calcularVariacao(f.transacoes, ant.transacoes);

      return {
        branch_code: f.branch_code,
        branch_name: f.branch_name,
        atual: {
          faturamento: f.faturamento,
          pecas: f.pecas,
          transacoes: f.transacoes,
          pa: f.pa,
          tm: f.tm,
        },
        ano_anterior: {
          faturamento: ant.faturamento,
          pecas: ant.pecas,
          transacoes: ant.transacoes,
          pa: ant.pa,
          tm: ant.tm,
        },
        variacao: {
          faturamento: varFat.percentual,
          pecas: varPecas.percentual,
          transacoes: varTrans.percentual,
        },
      };
    });

    const totalAtual = vendasService.calcularTotais(filiaisAtual);
    const totalAnterior = vendasService.calcularTotais(filiaisAnterior);

    const varTotalFat = vendasService.calcularVariacao(totalAtual.faturamento, totalAnterior.faturamento);
    const varTotalPecas = vendasService.calcularVariacao(totalAtual.pecas, totalAnterior.pecas);
    const varTotalTrans = vendasService.calcularVariacao(totalAtual.transacoes, totalAnterior.transacoes);

    res.json({
      periodo_atual: {
        inicio: startAtual.toISOString().split('T')[0],
        fim: endAtual.toISOString().split('T')[0],
      },
      periodo_anterior: {
        inicio: startAnterior.toISOString().split('T')[0],
        fim: endAnterior.toISOString().split('T')[0],
      },
      filiais: filiaisComparativo,
      total: {
        atual: totalAtual,
        ano_anterior: totalAnterior,
        variacao: {
          faturamento: varTotalFat,
          pecas: varTotalPecas,
          transacoes: varTotalTrans,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Projeção do mês
router.get('/projecao-mes/:branchCode?', async (req: Request, res: Response) => {
  try {
    const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;
    const projecao = await vendasService.getProjecaoMes(branchCode);
    res.json(projecao);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Projeção por filiais
router.get('/projecao-filiais', async (_req: Request, res: Response) => {
  try {
    const projecao = await vendasService.getProjecaoFiliais();
    res.json(projecao);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
