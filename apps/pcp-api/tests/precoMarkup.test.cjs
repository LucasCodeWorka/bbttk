const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  markupMultiplicador, precoAtual, promocaoAplicavel, situacaoPrecoSku,
  alertasPrecoAccVazio, acumularAlertaPreco, montarAlertasPreco, filtrarPorAlertaPreco,
  getRelatorioBase,
} = require('../dist/services/relatorioBase.service.js');
const database = require('../dist/config/database.js');

// Exemplo da devolutiva (secao 9): CNJ398, custo de producao 60,3973.
const CUSTO_CNJ398 = 60.3973;

test('markup e PRECO / CUSTO com duas casas, sem percentual (CNJ398)', () => {
  assert.equal(markupMultiplicador(99.99, CUSTO_CNJ398), 1.66);
  assert.equal(markupMultiplicador(119.99, CUSTO_CNJ398), 1.99);
  assert.equal(markupMultiplicador(199.99, CUSTO_CNJ398), 3.31);
});

test('markup sem preco ou sem custo positivo fica vazio', () => {
  assert.equal(markupMultiplicador(null, 10), null);
  assert.equal(markupMultiplicador(10, null), null);
  assert.equal(markupMultiplicador(10, 0), null);
});

test('PDV ATUAL usa o promocional so quando ha promocao (> 0)', () => {
  assert.equal(precoAtual(199.99, 99.99), 99.99);
  assert.equal(precoAtual(119.99, 0), 119.99);
  assert.equal(precoAtual(119.99, null), 119.99);
  assert.equal(precoAtual(119.99, undefined), 119.99);
  assert.equal(precoAtual(null, null), null);
});

test('a promocao vale para posicoes de ate 7 dias antes da foto', () => {
  assert.equal(promocaoAplicavel('2026-11-16', '2026-11-18'), true);
  assert.equal(promocaoAplicavel('2026-11-18', '2026-11-18'), true);
  assert.equal(promocaoAplicavel('2026-11-11', '2026-11-18'), true);
  assert.equal(promocaoAplicavel('2026-11-10', '2026-11-18'), false);
  assert.equal(promocaoAplicavel(undefined, '2026-11-18'), true);
  assert.equal(promocaoAplicavel('2026-11-17', null), false);
});

test('situacao do preco segue a mesma ordem da tela', () => {
  const base = { custo: 50, pdvOriginal: 150, pdvAtualVar: 150, pdvAtualAta: 110, markupVar: 3, markupAta: 2.2, estTt: 5, giroTt6: 3 };
  assert.equal(situacaoPrecoSku(base), 'ok');
  // Promocao abaixo do custo vence tudo, inclusive SKU parado.
  assert.equal(situacaoPrecoSku({ ...base, pdvAtualVar: 45, markupVar: 0.9, giroTt6: 0 }), 'preco_custo');
  // Parado com estoque fica neutro, mesmo com markup baixo.
  assert.equal(situacaoPrecoSku({ ...base, markupVar: 1.5, giroTt6: 0 }), 'sem_movimento');
  assert.equal(situacaoPrecoSku({ ...base, markupVar: 1.99 }), 'markup_baixo');
  assert.equal(situacaoPrecoSku({ ...base, markupVar: 2 }), 'ok');
  // Sem preco de varejo, avalia o markup do atacado.
  assert.equal(situacaoPrecoSku({ ...base, pdvOriginal: null, pdvAtualVar: null, markupVar: null, markupAta: 1.4 }), 'markup_baixo');
});

test('alertas contam SKUs e referencias distintas, e o filtro devolve so as referencias marcadas', () => {
  const acc = alertasPrecoAccVazio();
  acumularAlertaPreco(acc, 'A', 'preco_custo');
  acumularAlertaPreco(acc, 'A', 'markup_baixo');
  acumularAlertaPreco(acc, 'B', 'markup_baixo');
  acumularAlertaPreco(acc, 'C', 'sem_movimento');
  acumularAlertaPreco(acc, 'D', 'ok');
  assert.deepEqual(montarAlertasPreco(acc), {
    precoAbaixoCusto: { skus: 1, referencias: 1 },
    markupFora: { skus: 3, referencias: 2 },
  });
  const rows = ['A', 'B', 'C', 'D'].map(referenceCode => ({ referenceCode }));
  assert.deepEqual(filtrarPorAlertaPreco(rows, acc, 'preco_custo').map(r => r.referenceCode), ['A']);
  assert.deepEqual(filtrarPorAlertaPreco(rows, acc, 'markup_fora').map(r => r.referenceCode), ['A', 'B']);
  assert.equal(filtrarPorAlertaPreco(rows, acc, undefined).length, 4);
});

function instalarBancoFake(t, { sincronizadoEm, promocoes }) {
  const original = database.prisma;
  t.after(() => { database.prisma = original; });
  function posicao(sku, productCode, referencia, estoque, pdvVarejo, pdvAtacado, custo, giro6 = 5) {
    return {
      data_posicao: '2026-11-17', product_sku: sku, product_code: productCode,
      reference_code: referencia, reference_name: referencia, product_name: sku,
      descricao_completa: sku, color_code: '001', color_name: 'AZUL', size: '10',
      categoria: 'CONJUNTO', linha: 'STYLE', genero: 'FEMININO', modelo: null,
      status: 'ATIVO', lancamento: null, branch_code: 1, estoque,
      giro_30d: 1, giro_60d: 1, giro_90d: 1, giro_1m: 1, giro_3m: 1, giro_6m: giro6,
      venda_cobertura_periodo: 1, custo_producao: custo, pdv_varejo: pdvVarejo,
      pdv_atacado: pdvAtacado, ultima_entrada: null, em_producao: 0,
      valor_estoque_custo_producao: estoque * custo, cor_agrupada: null,
    };
  }
  const snapshot = [
    // CNJ398: tabela 199,99 / atacado 119,99, promocao de varejo 99,99.
    posicao('CNJ-10', 60985, 'CNJ398', 30, 199.99, 119.99, CUSTO_CNJ398),
    // Referencia saudavel com mais estoque (ordena primeiro).
    posicao('OK-10', 70000, 'OK001', 50, 100, 60, 20),
    // Preco de tabela abaixo do custo.
    posicao('RUIM-10', 80000, 'RUIM01', 10, 15, 12, 20),
  ];
  database.prisma = {
    pcpRelatorioConfig: { upsert: async () => ({
      giroDias: 30, coberturaMeses: 1, atacadoCoberturaBase: 'atacado_only',
      coberturaLimiteVerde: 3, coberturaLimiteVermelho: 6,
      precoCustoBranchCode: 1, pdvVarejoCode: 1, pdvAtacadoCode: 3,
    }) },
    $queryRaw: async (sql) => {
      const text = Array.isArray(sql) ? sql.join('?') : sql.text;
      if (text.includes("to_regclass('public.produto_precos_promocionais_sync')")) return [{ existe: sincronizadoEm !== null }];
      if (text.includes('FROM produto_precos_promocionais_sync')) return [{ sincronizado_em: `${sincronizadoEm}T07:00:00`, data: sincronizadoEm }];
      if (text.includes('FROM produto_precos_promocionais')) return promocoes;
      if (text.includes('AS possui_diario')) return [{ possui_diario: false, hoje: '2026-11-18' }];
      if (text.includes('information_schema.columns')) return [{ possui_marcador: true }];
      if (text.includes('to_char(data_posicao') && text.includes('LIMIT 1')) return [{ data_posicao: '2026-11-17' }];
      if (text.includes('rb.giro_30d')) return snapshot;
      if (text.includes('FROM produto_analitico a')) return [];
      if (text.includes('FROM branches')) return [];
      throw new Error(`Consulta não prevista no teste: ${text}`);
    },
  };
}

test('relatorio: PDV ORIGINAL fica com a tabela, PDV ATUAL com a promocao, e o markup acompanha', async (t) => {
  instalarBancoFake(t, {
    sincronizadoEm: '2026-11-18',
    promocoes: [{ product_code: 60985, price_code: 1, preco_promocional: 99.99 }],
  });
  const result = await getRelatorioBase({ dataPosicao: '2026-11-17', incluirComparativoAnoAnterior: false, pageSize: 10 });
  const cnj = result.rows.find(r => r.referenceCode === 'CNJ398');
  assert.equal(cnj.pdvAtual, 199.99);
  assert.equal(cnj.pdvRealVar, 99.99);
  assert.equal(cnj.pdvRealAta, 119.99);
  assert.equal(cnj.markupVar, 1.66);
  assert.equal(cnj.markupAta, 1.99);
  assert.equal(cnj.skus[0].pdvAtual, 199.99);
  assert.equal(cnj.skus[0].pdvRealVar, 99.99);
  assert.equal(cnj.cores[0].pdvAtual, 199.99);
  assert.equal(cnj.cores[0].pdvRealVar, 99.99);
  assert.deepEqual(result.precosPromocionais, { sincronizadoEm: '2026-11-18T07:00:00', aplicado: true, skusEmPromocao: 1 });
});

test('relatorio: alertas contam o recorte inteiro e o filtro pagina so as referencias com alerta', async (t) => {
  instalarBancoFake(t, {
    sincronizadoEm: '2026-11-18',
    promocoes: [{ product_code: 60985, price_code: 1, preco_promocional: 99.99 }],
  });
  // pageSize 1: a pagina so traz OK001 (maior estoque), mas os alertas olham tudo.
  const geral = await getRelatorioBase({ dataPosicao: '2026-11-17', incluirComparativoAnoAnterior: false, pageSize: 1 });
  assert.deepEqual(geral.rows.map(r => r.referenceCode), ['OK001']);
  assert.deepEqual(geral.kpisExtra.alertasPreco, {
    precoAbaixoCusto: { skus: 1, referencias: 1 },
    markupFora: { skus: 2, referencias: 2 },
  });

  const filtrado = await getRelatorioBase({ dataPosicao: '2026-11-17', incluirComparativoAnoAnterior: false, pageSize: 10, alertaPreco: 'markup_fora' });
  assert.deepEqual(filtrado.rows.map(r => r.referenceCode), ['CNJ398', 'RUIM01']);
  assert.equal(filtrado.pagination.totalReferencias, 2);
  // Os KPIs nao mudam com o filtro de alerta: continuam descrevendo o recorte inteiro.
  assert.equal(filtrado.kpis.estTt, geral.kpis.estTt);
});

test('relatorio: posicao anterior a foto de promocoes mostra o preco de tabela', async (t) => {
  instalarBancoFake(t, {
    sincronizadoEm: '2026-12-01',
    promocoes: [{ product_code: 60985, price_code: 1, preco_promocional: 99.99 }],
  });
  const result = await getRelatorioBase({ dataPosicao: '2026-11-17', incluirComparativoAnoAnterior: false, pageSize: 10 });
  const cnj = result.rows.find(r => r.referenceCode === 'CNJ398');
  assert.equal(cnj.pdvRealVar, 199.99);
  assert.equal(cnj.markupVar, 3.31);
  assert.equal(result.precosPromocionais.aplicado, false);
});

test('relatorio: sem tabela de promocoes ainda, o relatorio funciona com o preco de tabela', async (t) => {
  instalarBancoFake(t, { sincronizadoEm: null, promocoes: [] });
  const result = await getRelatorioBase({ dataPosicao: '2026-11-17', incluirComparativoAnoAnterior: false, pageSize: 10 });
  const cnj = result.rows.find(r => r.referenceCode === 'CNJ398');
  assert.equal(cnj.pdvAtual, 199.99);
  assert.equal(cnj.pdvRealVar, 199.99);
  assert.deepEqual(result.precosPromocionais, { sincronizadoEm: null, aplicado: false, skusEmPromocao: 0 });
});
