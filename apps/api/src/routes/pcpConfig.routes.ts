import { Router, Request, Response } from 'express';
import * as pcpConfigService from '../services/pcpConfig.service.js';
import { syncEmProducao, iniciarCustoPrecoSyncJob, getCustoPrecoSyncJobStatus } from '../services/totvs.service.js';
import { authMiddleware, adminOnly } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware, adminOnly);

// Config global do relatorio (dias de giro, meses de cobertura, base da cobertura do Atacado)
router.get('/pcp-config', async (req: Request, res: Response) => {
  try {
    const relatorio = (req.query.relatorio as string) || 'relatorio_base';
    const config = await pcpConfigService.getConfig(relatorio);
    res.json({ config });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/pcp-config', async (req: Request, res: Response) => {
  try {
    const { relatorio, giroDias, coberturaMeses, riscoCoberturaMeses, atacadoCoberturaBase, custoCode, pdvVarejoCode, pdvAtacadoCode, precoCustoBranchCode } = req.body;
    if (!relatorio) {
      res.status(400).json({ error: 'relatorio e obrigatorio' });
      return;
    }

    const config = await pcpConfigService.updateConfig(
      { relatorio, giroDias, coberturaMeses, riscoCoberturaMeses, atacadoCoberturaBase, custoCode, pdvVarejoCode, pdvAtacadoCode, precoCustoBranchCode },
      req.user?.userId
    );
    res.json({ config });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Codigos de custo/preco ja sincronizados (pra popular os selects do configurador)
router.get('/pcp-config/codigos', async (_req: Request, res: Response) => {
  try {
    const codigos = await pcpConfigService.getCodigosDisponiveis();
    res.json(codigos);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Resincroniza custo e preco de todos os produtos direto da API do TOTVS
// (product/v2/costs|prices/search) - dispara ASSINCRONO (nao espera terminar dentro do
// request HTTP, que estourava o timeout do proxy do Render com ~130+ paginas pro
// TOTVS) - retorna na hora, o frontend acompanha via GET .../status (polling).
router.post('/pcp-config/sincronizar-custos-precos', (_req: Request, res: Response) => {
  const { jaEmAndamento } = iniciarCustoPrecoSyncJob();
  res.json({ jaEmAndamento });
});

// Status/progresso da sincronizacao disparada acima - poll a cada poucos segundos.
router.get('/pcp-config/sincronizar-custos-precos/status', (_req: Request, res: Response) => {
  res.json({ job: getCustoPrecoSyncJobStatus() });
});

// Resincroniza o snapshot de Ordens de Producao abertas direto da API do TOTVS
// (production-order/v2/orders/search) - alimenta a coluna "Em Producao" do Relatorio Base.
router.post('/pcp-config/sincronizar-em-producao', async (_req: Request, res: Response) => {
  try {
    const resumo = await syncEmProducao();
    res.json(resumo);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Cobertura ideal por filial (lista esparsa - so os overrides ja salvos)
router.get('/pcp-config/cobertura-ideal', async (req: Request, res: Response) => {
  try {
    const relatorio = (req.query.relatorio as string) || 'relatorio_base';
    const items = await pcpConfigService.getCoberturaIdeal(relatorio);
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/pcp-config/cobertura-ideal', async (req: Request, res: Response) => {
  try {
    const { relatorio, items } = req.body;
    if (!relatorio || !Array.isArray(items)) {
      res.status(400).json({ error: 'relatorio e items sao obrigatorios' });
      return;
    }

    const salvos = await pcpConfigService.upsertCoberturaIdeal(relatorio, items, req.user?.userId);
    res.json({ items: salvos });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Metas da tela Visao Geral (cards com meta/gap)
router.get('/pcp-config/meta-visao-geral', async (req: Request, res: Response) => {
  try {
    const relatorio = (req.query.relatorio as string) || 'visao_geral';
    const meta = await pcpConfigService.getMetaVisaoGeral(relatorio);
    res.json({ meta });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/pcp-config/meta-visao-geral', async (req: Request, res: Response) => {
  try {
    const {
      relatorio,
      metaCoberturaGeralMeses,
      metaGiroAnualizado,
      metaEstoqueMortoPercent,
      metaCoberturaBasicoMeses,
      metaCoberturaColecaoMeses,
      estoqueMortoDias,
    } = req.body;
    if (!relatorio) {
      res.status(400).json({ error: 'relatorio e obrigatorio' });
      return;
    }

    const meta = await pcpConfigService.updateMetaVisaoGeral(
      {
        relatorio,
        metaCoberturaGeralMeses,
        metaGiroAnualizado,
        metaEstoqueMortoPercent,
        metaCoberturaBasicoMeses,
        metaCoberturaColecaoMeses,
        estoqueMortoDias,
      },
      req.user?.userId
    );
    res.json({ meta });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Limiares da Curva ABC(D)
router.get('/pcp-config/curva-abc', async (req: Request, res: Response) => {
  try {
    const relatorio = (req.query.relatorio as string) || 'curva_abc';
    const config = await pcpConfigService.getCurvaAbcConfig(relatorio);
    res.json({ config });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/pcp-config/curva-abc', async (req: Request, res: Response) => {
  try {
    const { relatorio, giroDias, curvaALimitePercent, curvaBLimitePercent, curvaCLimitePercent } = req.body;
    if (!relatorio) {
      res.status(400).json({ error: 'relatorio e obrigatorio' });
      return;
    }

    const config = await pcpConfigService.updateCurvaAbcConfig(
      { relatorio, giroDias, curvaALimitePercent, curvaBLimitePercent, curvaCLimitePercent },
      req.user?.userId
    );
    res.json({ config });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Configuracoes do Estoque Sem Giro (maturacao e limiares de cobertura)
router.get('/pcp-config/estoque-sem-giro', async (req: Request, res: Response) => {
  try {
    const relatorio = (req.query.relatorio as string) || 'estoque_sem_giro';
    const config = await pcpConfigService.getEstoqueSemGiroConfig(relatorio);
    res.json({ config });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/pcp-config/estoque-sem-giro', async (req: Request, res: Response) => {
  try {
    const { relatorio, maturacaoDias, coberturaLimiteVerde, coberturaLimiteVermelho } = req.body;
    if (!relatorio) {
      res.status(400).json({ error: 'relatorio e obrigatorio' });
      return;
    }

    const config = await pcpConfigService.updateEstoqueSemGiroConfig(
      { relatorio, maturacaoDias, coberturaLimiteVerde, coberturaLimiteVermelho },
      req.user?.userId
    );
    res.json({ config });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Configuracoes da Gestao de Transferencia (periodo de analise de vendas)
router.get('/pcp-config/transferencia', async (req: Request, res: Response) => {
  try {
    const relatorio = (req.query.relatorio as string) || 'gestao_transferencia';
    const config = await pcpConfigService.getTransferenciaConfig(relatorio);
    res.json({ config });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/pcp-config/transferencia', async (req: Request, res: Response) => {
  try {
    const { relatorio, diasAnaliseVendas, transferenciaCoberturaDiasVerde, transferenciaCoberturaDiasAmarelo } = req.body;
    if (!relatorio) {
      res.status(400).json({ error: 'relatorio e obrigatorio' });
      return;
    }

    const config = await pcpConfigService.updateTransferenciaConfig(
      { relatorio, diasAnaliseVendas, transferenciaCoberturaDiasVerde, transferenciaCoberturaDiasAmarelo },
      req.user?.userId
    );
    res.json({ config });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
