import { Router, Request, Response } from 'express';
import { getComparativoAnoAnterior } from '../services/relatorioBaseComparativo.service.js';
import {
  getDiagnosticoSaldoRelatorioBase,
  getFiltrosRelatorioBase,
  getRelatorioBase,
  RelatorioBaseFiltro,
} from '../services/relatorioBase.service.js';

const router = Router();

function resolveFiltro(req: Request): RelatorioBaseFiltro {
  return {
    categoria: parseList(req.query.categoria), linha: parseList(req.query.linha),
    genero: parseList(req.query.genero), status: parseList(req.query.status),
    branches: parseBranchCodes(req.query.branches),
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    dataPosicao: parseDate(req.query.dataPosicao),
  };
}

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

function parseDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

router.get('/relatorio-base/filtros', async (_req: Request, res: Response) => {
  try {
    res.json(await getFiltrosRelatorioBase());
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/relatorio-base/diagnostico-saldo', async (req: Request, res: Response) => {
  try {
    const filtro: RelatorioBaseFiltro = {
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      status: parseList(req.query.status),
      branches: parseBranchCodes(req.query.branches),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      dataPosicao: parseDate(req.query.dataPosicao),
    };

    res.json(await getDiagnosticoSaldoRelatorioBase(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/relatorio-base/comparativo-ano-anterior', async (req: Request, res: Response) => {
  try {
    res.json(await getComparativoAnoAnterior(resolveFiltro(req)));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Relacao dos itens em ruptura (botao do card da Visao Geral): referencias com SKU em
// ruptura, cada uma com seus SKUs da base. Mesmos filtros/data do relatorio.
router.get('/relatorio-base/ruptura-itens', async (req: Request, res: Response) => {
  try {
    const resultado = await getRelatorioBase({
      ...resolveFiltro(req), page: 1, pageSize: 1,
      incluirComparativoAnoAnterior: false, incluirItensRuptura: true,
    });
    res.json(resultado.rupturaItens);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/relatorio-base', async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 15);

    const filtro: RelatorioBaseFiltro = {
      categoria: parseList(req.query.categoria),
      linha: parseList(req.query.linha),
      genero: parseList(req.query.genero),
      status: parseList(req.query.status),
      branches: parseBranchCodes(req.query.branches),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      dataPosicao: parseDate(req.query.dataPosicao),
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 15,
      agruparPorCorSalva: req.query.agruparPorCorSalva === 'true',
      incluirComparativoAnoAnterior: req.query.incluirComparativoAnoAnterior !== 'false',
      alertaPreco: req.query.alertaPreco === 'preco_custo' || req.query.alertaPreco === 'markup_fora'
        ? req.query.alertaPreco : undefined,
    };

    res.json(await getRelatorioBase(filtro));
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
