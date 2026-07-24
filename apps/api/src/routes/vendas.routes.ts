import { Router, Request, Response, NextFunction } from 'express';
import * as vendasService from '../services/vendas.service.js';
import { ProdutoFiltro } from '../services/vendas.service.js';
import * as produtosService from '../services/produtos.service.js';
import { getVendedoresApi, syncClassificacaoOperacoes, garantirClassificacaoAtualizada } from '../services/totvs.service.js';
import { authMiddleware, adminOnly } from '../middleware/auth.middleware.js';

const router = Router();

// Antes de qualquer calculo de faturamento, garante que nao apareceu operation_code
// novo sem classificacao (o TOTVS ja criou operacao nova sem avisar varias vezes) -
// so bate no banco de verdade a cada 10 min (cache em memoria), entao nao pesa em
// toda requisicao. Se achar codigo novo, sincroniza sozinho antes de responder.
router.use(async (_req: Request, _res: Response, next: NextFunction) => {
  await garantirClassificacaoAtualizada();
  next();
});

// Resolve o filtro de classificacao de produto a partir da query string, ex:
// ?categoria=CAMISA,BLUSA&genero=FEMININO - undefined quando nada foi passado.
function resolveProdutoFiltro(req: Request): ProdutoFiltro | undefined {
  function parseLista(chave: string): string[] | undefined {
    const valor = req.query[chave] as string | undefined;
    if (!valor) return undefined;
    const itens = valor.split(',').map((v) => v.trim()).filter(Boolean);
    return itens.length > 0 ? itens : undefined;
  }

  const filtro: ProdutoFiltro = {
    categoria: parseLista('categoria'),
    genero: parseLista('genero'),
    status: parseLista('status'),
    linha: parseLista('linha'),
    colecao: parseLista('colecao'),
    tecido: parseLista('tecido'),
  };

  const temAlgo = Object.values(filtro).some((v) => v && v.length > 0);
  return temAlgo ? filtro : undefined;
}

// Vendas de hoje
router.get('/vendas/hoje/:branchCode?', async (req: Request, res: Response) => {
  try {
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filiais = await vendasService.getVendasPeriodo(today, today, branchCodes, produtoFiltro);

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
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const filiais = await vendasService.getVendasPeriodo(startMonth, today, branchCodes, produtoFiltro);

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
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);

    const startDate = new Date(start);
    const endDate = new Date(end);

    const filiais = await vendasService.getVendasPeriodo(startDate, endDate, branchCodes, produtoFiltro);

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
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);

    const startDate = new Date(start);
    const endDate = new Date(end);

    const dados = await vendasService.getVendasDiarias(startDate, endDate, branchCodes, produtoFiltro);

    res.json({
      periodo: { inicio: start, fim: end },
      dados,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Vendas mensais por período (usado quando o periodo filtrado passa de 1 mes)
router.get('/vendas/mensais/periodo/:start/:end/:branchCode?', async (req: Request, res: Response) => {
  try {
    const { start, end } = req.params;
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);

    const startDate = new Date(start);
    const endDate = new Date(end);

    const dados = await vendasService.getVendasMensais(startDate, endDate, branchCodes, produtoFiltro);

    res.json({
      periodo: { inicio: start, fim: end },
      dados,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Resolve as filiais filtradas: aceita ?branches=1,3,4 (multiplas) ou o :branchCode
// antigo da URL (uma so), com prioridade pro query param. undefined = todas as filiais.
function resolveBranchCodes(req: Request): number[] | undefined {
  const branchesQuery = req.query.branches as string | undefined;
  if (branchesQuery) {
    const codes = branchesQuery.split(',').map(c => parseInt(c.trim())).filter(c => !isNaN(c));
    return codes.length > 0 ? codes : undefined;
  }

  const branchCode = req.params.branchCode ? parseInt(req.params.branchCode) : undefined;
  return branchCode ? [branchCode] : undefined;
}

// Resolve o periodo a partir de ?start=&end= na query string, com fallback pro mes atual
function resolvePeriodo(req: Request): { startDate: Date; endDate: Date } {
  const today = new Date();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = req.query.start as string | undefined;
  const end = req.query.end as string | undefined;

  return {
    startDate: start ? new Date(start) : startMonth,
    endDate: end ? new Date(end) : today,
  };
}

// Top produtos
router.get('/top-produtos/:branchCode?', async (req: Request, res: Response) => {
  try {
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);
    const { startDate, endDate } = resolvePeriodo(req);

    const produtos = await vendasService.getTopProdutos(startDate, endDate, branchCodes, 10, produtoFiltro);

    res.json({
      periodo: {
        inicio: startDate.toISOString().split('T')[0],
        fim: endDate.toISOString().split('T')[0],
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
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);
    const { startDate, endDate } = resolvePeriodo(req);

    const vendedores = await vendasService.getVendasVendedor(startDate, endDate, branchCodes, produtoFiltro);

    // Buscar nomes dos vendedores da API TOTVS
    const nomes = await getVendedoresApi();

    // Adicionar nomes
    const vendedoresComNomes = vendedores.map(v => ({
      ...v,
      seller_name: nomes.get(v.seller_code) || `Vendedor ${v.seller_code}`,
    }));

    res.json({
      periodo: {
        inicio: startDate.toISOString().split('T')[0],
        fim: endDate.toISOString().split('T')[0],
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

// Vendedores ativos numa filial nos 3 meses anteriores ao mes de referencia
// (usado para distribuir a meta da loja entre os vendedores que realmente venderam la)
router.get('/vendedores-por-filial/:branchCode/:ano/:mes', async (req: Request, res: Response) => {
  try {
    const branchCode = parseInt(req.params.branchCode);
    const ano = parseInt(req.params.ano);
    const mes = parseInt(req.params.mes);

    // Ex: meta de julho/2026 -> considera abril, maio e junho/2026
    const startDate = new Date(ano, mes - 4, 1);
    const endDate = new Date(ano, mes - 1, 0);

    const vendedores = await vendasService.getVendasVendedor(startDate, endDate, [branchCode]);
    const nomes = await getVendedoresApi();

    const vendedoresComNomes = vendedores
      .map(v => ({
        seller_code: v.seller_code,
        seller_name: nomes.get(v.seller_code) || `Vendedor ${v.seller_code}`,
        faturamento: v.faturamento,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);

    res.json({
      periodo: {
        inicio: startDate.toISOString().split('T')[0],
        fim: endDate.toISOString().split('T')[0],
      },
      vendedores: vendedoresComNomes,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Comparativo ano
router.get('/comparativo-ano/:start?/:end?', async (req: Request, res: Response) => {
  try {
    const branchCodes = resolveBranchCodes(req);
    const produtoFiltro = resolveProdutoFiltro(req);
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

    const ano = endAtual.getFullYear();
    const mes = endAtual.getMonth() + 1;
    const ultimoDiaMes = new Date(ano, mes, 0);
    const diasRestantes = Math.max(ultimoDiaMes.getDate() - endAtual.getDate(), 0);

    const [
      filiaisAtual,
      filiaisAnterior,
      devolucoesMap,
      clientesNovosMap,
      metasMap,
    ] = await Promise.all([
      vendasService.getVendasPeriodo(startAtual, endAtual, branchCodes, produtoFiltro),
      vendasService.getVendasPeriodo(startAnterior, endAnterior, branchCodes, produtoFiltro),
      vendasService.getDevolucoesPorFilial(startAtual, endAtual, produtoFiltro),
      vendasService.getClientesNovosPorFilial(startAtual, endAtual, produtoFiltro),
      vendasService.getMetasPorFilial(ano, mes),
    ]);

    const anteriorDict = new Map(filiaisAnterior.map(f => [f.branch_code, f]));

    const totalFaturamentoAtual = filiaisAtual.reduce((sum, f) => sum + f.faturamento, 0);
    const totalPecasAtual = filiaisAtual.reduce((sum, f) => sum + f.pecas, 0);

    const filiaisComparativo = filiaisAtual.map(f => {
      const ant = anteriorDict.get(f.branch_code) || {
        faturamento: 0,
        pecas: 0,
        transacoes: 0,
        pa: 0,
        tm: 0,
        clientes: 0,
        pm: 0,
        tm_cliente: 0,
        pac: 0,
      };

      const varFat = vendasService.calcularVariacao(f.faturamento, ant.faturamento);
      const varPecas = vendasService.calcularVariacao(f.pecas, ant.pecas);
      const varTrans = vendasService.calcularVariacao(f.transacoes, ant.transacoes);
      const varClientes = vendasService.calcularVariacao(f.clientes, ant.clientes);
      const varPm = vendasService.calcularVariacao(f.pm, ant.pm);
      const varTm = vendasService.calcularVariacao(f.tm, ant.tm);
      const varTmCliente = vendasService.calcularVariacao(f.tm_cliente, ant.tm_cliente);
      const varPa = vendasService.calcularVariacao(f.pa, ant.pa);
      const varPac = vendasService.calcularVariacao(f.pac, ant.pac);

      const devolucao = devolucoesMap.get(f.branch_code) || { valor: 0, qtde: 0 };
      const clientesNovos = clientesNovosMap.get(f.branch_code) || { qtde: 0, faturamento: 0 };
      const metaValor = metasMap.get(f.branch_code) || 0;

      return {
        branch_code: f.branch_code,
        branch_name: f.branch_name,
        atual: {
          faturamento: f.faturamento,
          pecas: f.pecas,
          transacoes: f.transacoes,
          pa: f.pa,
          tm: f.tm,
          clientes: f.clientes,
          pm: f.pm,
          tm_cliente: f.tm_cliente,
          pac: f.pac,
          pct_tt_faturamento: totalFaturamentoAtual > 0 ? Math.round((f.faturamento / totalFaturamentoAtual) * 1000) / 10 : 0,
          pct_tt_pecas: totalPecasAtual > 0 ? Math.round((f.pecas / totalPecasAtual) * 1000) / 10 : 0,
        },
        ano_anterior: {
          faturamento: ant.faturamento,
          pecas: ant.pecas,
          transacoes: ant.transacoes,
          pa: ant.pa,
          tm: ant.tm,
          clientes: ant.clientes,
          pm: ant.pm,
          tm_cliente: ant.tm_cliente,
          pac: ant.pac,
        },
        variacao: {
          faturamento: varFat.percentual,
          pecas: varPecas.percentual,
          transacoes: varTrans.percentual,
          clientes: varClientes.percentual,
          pm: varPm.percentual,
          tm: varTm.percentual,
          tm_cliente: varTmCliente.percentual,
          pa: varPa.percentual,
          pac: varPac.percentual,
        },
        devolucoes: {
          valor: devolucao.valor,
          qtde: devolucao.qtde,
          pct: f.faturamento + devolucao.valor > 0
            ? Math.round((devolucao.valor / (f.faturamento + devolucao.valor)) * 1000) / 10
            : 0,
        },
        clientes_novos: {
          qtde: clientesNovos.qtde,
          faturamento: clientesNovos.faturamento,
          pct: f.clientes > 0 ? Math.round((clientesNovos.qtde / f.clientes) * 1000) / 10 : 0,
        },
        meta: {
          valor: metaValor,
          pct: metaValor > 0 ? Math.round((f.faturamento / metaValor) * 1000) / 10 : 0,
          meta_dia: metaValor > 0 && diasRestantes > 0
            ? Math.round(((metaValor - f.faturamento) / diasRestantes) * 100) / 100
            : 0,
        },
      };
    });

    const totalAtual = vendasService.calcularTotais(filiaisAtual);
    const totalAnterior = vendasService.calcularTotais(filiaisAnterior);

    const varTotalFat = vendasService.calcularVariacao(totalAtual.faturamento, totalAnterior.faturamento);
    const varTotalPecas = vendasService.calcularVariacao(totalAtual.pecas, totalAnterior.pecas);
    const varTotalTrans = vendasService.calcularVariacao(totalAtual.transacoes, totalAnterior.transacoes);
    const varTotalClientes = vendasService.calcularVariacao(totalAtual.clientes, totalAnterior.clientes);
    const varTotalTm = vendasService.calcularVariacao(totalAtual.tm, totalAnterior.tm);
    const varTotalPa = vendasService.calcularVariacao(totalAtual.pa, totalAnterior.pa);
    const varTotalPm = vendasService.calcularVariacao(totalAtual.pm, totalAnterior.pm);

    filiaisComparativo.sort((a, b) => a.branch_code - b.branch_code);

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
          clientes: varTotalClientes,
          tm: varTotalTm,
          pa: varTotalPa,
          pm: varTotalPm,
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
    const produtoFiltro = resolveProdutoFiltro(req);
    const projecao = await vendasService.getProjecaoMes(branchCode, produtoFiltro);
    res.json(projecao);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Projeção por filiais
router.get('/projecao-filiais', async (req: Request, res: Response) => {
  try {
    const produtoFiltro = resolveProdutoFiltro(req);
    const projecao = await vendasService.getProjecaoFiliais(produtoFiltro);
    res.json(projecao);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Opcoes de classificacao de produto (categoria, genero, grupo, linha, colecao,
// tecido) pra montar os filtros do Dashboard Comercial
router.get('/produtos/classificacoes', async (_req: Request, res: Response) => {
  try {
    const dimensoes = await produtosService.getClassificacoes();
    res.json({ dimensoes });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Resincroniza a classificacao de operacoes (venda/devolucao/nenhuma) direto da API
// do TOTVS pra todo operation_code ja visto no historico - roda sob demanda quando
// aparecer numero estranho, pra pegar operacao nova que o TOTVS criou sem avisar.
router.post('/produtos/sincronizar-classificacao-operacoes', authMiddleware, adminOnly, async (_req: Request, res: Response) => {
  try {
    const codigos = await vendasService.getTodosOperationCodes();
    const atualizados = await syncClassificacaoOperacoes(codigos);
    res.json({ codigos_encontrados: codigos.length, atualizados });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
