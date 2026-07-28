import { Router, Request, Response } from 'express';
import * as metasService from '../services/metas.service.js';
import * as comissoesService from '../services/comissoes.service.js';
import * as vendasService from '../services/vendas.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Buscar níveis de meta
router.get('/meta-niveis', async (_req: Request, res: Response) => {
  try {
    const niveis = await metasService.getMetaNiveis();
    res.json({ niveis });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Atualizar níveis de meta
router.post('/meta-niveis', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { niveis } = req.body;
    await metasService.updateMetaNiveis(niveis);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Buscar metas
router.get('/metas', async (req: Request, res: Response) => {
  try {
    const ano = parseInt(req.query.ano as string) || new Date().getFullYear();
    const mes = parseInt(req.query.mes as string) || new Date().getMonth() + 1;
    const branchCode = req.query.branch_code ? parseInt(req.query.branch_code as string) : undefined;

    const metas = await metasService.getMetas(ano, mes, branchCode);
    res.json({ metas, ano, mes });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Salvar meta
router.post('/metas', authMiddleware, async (req: Request, res: Response) => {
  try {
    const {
      ano, mes, branch_code, seller_code, nivel_1, nivel_2, nivel_3, nivel_4, nivel_5,
      comissao_nivel_1, comissao_nivel_2, comissao_nivel_3, comissao_nivel_4, comissao_nivel_5,
    } = req.body;

    await metasService.saveMeta({
      ano,
      mes,
      branch_code,
      seller_code: seller_code || null,
      nivel_1: nivel_1 || 0,
      nivel_2: nivel_2 || 0,
      nivel_3: nivel_3 || 0,
      nivel_4: nivel_4 || 0,
      nivel_5: nivel_5 || 0,
      comissao_nivel_1: comissao_nivel_1 === '' || comissao_nivel_1 === undefined ? null : comissao_nivel_1,
      comissao_nivel_2: comissao_nivel_2 === '' || comissao_nivel_2 === undefined ? null : comissao_nivel_2,
      comissao_nivel_3: comissao_nivel_3 === '' || comissao_nivel_3 === undefined ? null : comissao_nivel_3,
      comissao_nivel_4: comissao_nivel_4 === '' || comissao_nivel_4 === undefined ? null : comissao_nivel_4,
      comissao_nivel_5: comissao_nivel_5 === '' || comissao_nivel_5 === undefined ? null : comissao_nivel_5,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Deletar meta
router.delete('/metas/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await metasService.deleteMeta(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Criar distribuição de metas
router.post('/metas/distribuir', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, ano, mes, totalValue, distributionType, items } = req.body;

    const distribution = await metasService.createDistribution({
      name,
      ano,
      mes,
      totalValue,
      distributionType,
      createdById: req.user?.userId,
      items,
    });

    res.json({ success: true, distribution });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Buscar distribuições
router.get('/metas/distribuicoes', async (req: Request, res: Response) => {
  try {
    const ano = parseInt(req.query.ano as string) || new Date().getFullYear();
    const mes = parseInt(req.query.mes as string) || new Date().getMonth() + 1;

    const distributions = await metasService.getDistributions(ano, mes);
    res.json({ distributions });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Deletar distribuição
router.delete('/metas/distribuicoes/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await metasService.deleteDistribution(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Relatorio de comissao por vendedor (Realizado vs Meta, niveis atingidos, comissao calculada)
router.get('/metas/comissoes', async (req: Request, res: Response) => {
  try {
    const ano = parseInt(req.query.ano as string) || new Date().getFullYear();
    const mes = parseInt(req.query.mes as string) || new Date().getMonth() + 1;
    const branchesQuery = req.query.branches as string | undefined;
    const branchCodes = branchesQuery
      ? branchesQuery.split(',').map((c) => parseInt(c.trim())).filter((c) => !isNaN(c))
      : undefined;
    const diaInicio = req.query.dia_inicio ? parseInt(req.query.dia_inicio as string) : undefined;
    const diaFim = req.query.dia_fim ? parseInt(req.query.dia_fim as string) : undefined;

    const relatorio = await comissoesService.getRelatorioComissao(ano, mes, branchCodes, diaInicio, diaFim);
    const nomes = await vendasService.getVendedoresMap();

    const comNomes = {
      ...relatorio,
      vendedores: relatorio.vendedores.map((v) => ({
        ...v,
        seller_name: nomes.get(v.seller_code) || `Vendedor ${v.seller_code}`,
      })),
      top3: relatorio.top3.map((v) => ({
        ...v,
        seller_name: nomes.get(v.seller_code) || `Vendedor ${v.seller_code}`,
      })),
    };

    res.json(comNomes);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
