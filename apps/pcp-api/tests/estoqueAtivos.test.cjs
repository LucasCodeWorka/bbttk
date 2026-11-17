const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acumularEstoqueAtivos, montarIndicadoresEstoqueAtivos } = require('../dist/services/relatorioBase.service.js');
const { montarComparativoAnoAnterior } = require('../dist/services/relatorioBaseComparativo.service.js');

function calcular(rows) {
  const skus = new Map();
  for (const row of rows) {
    acumularEstoqueAtivos(skus, row.sku, row.ref, row.linha ?? 'BÁSICO', row.status ?? 'ATIVO', row.estoque);
  }
  return montarIndicadoresEstoqueAtivos(skus);
}

test('referências e SKUs consideram todas as linhas e status, exceto INATIVO', () => {
  const result = calcular([
    { sku: 'B', ref: 'B', estoque: 2 },
    { sku: 'R', ref: 'R', linha: ' básica renovável ', status: ' ativo ', estoque: 0 },
    ...['FORA DE LINHA', 'FORA DE LINHA XXXX', 'ATIVO PROMOÇÃO'].map((status, i) => ({
      sku: `INCLUIDO-${i}`, ref: `INCLUIDO-${i}`, status, estoque: 3,
    })),
    { sku: 'INATIVO', ref: 'INATIVO', status: ' inativo ', estoque: 3 },
    { sku: 'STYLE', ref: 'STYLE', linha: 'STYLE', estoque: 5 },
    { sku: 'OUTRA', ref: 'OUTRA', linha: 'CASUAL', estoque: 5 },
    { sku: 'SEM-STATUS', ref: 'SEM-STATUS', status: null, estoque: 0 },
  ]);
  // Fora: so o INATIVO. R e SEM-STATUS entram na base, mas estao zerados.
  assert.deepEqual(result.referencias, { comEstoque: 6, totalAtivos: 8, percent: 75 });
  assert.deepEqual(result.skus, { comEstoque: 6, totalAtivos: 8, percent: 75 });
});

test('referência com tamanhos positivos e negativos conta mesmo quando a soma é zero', () => {
  const result = calcular([
    { sku: 'P', ref: 'COMPENSADA', estoque: 5 },
    { sku: 'M', ref: 'COMPENSADA', estoque: -5 },
    { sku: 'ZERO', ref: 'ZERADA', estoque: 0 },
  ]);
  assert.deepEqual(result.referencias, { comEstoque: 1, totalAtivos: 2, percent: 50 });
  assert.deepEqual(result.skus, { comEstoque: 2, totalAtivos: 3, percent: 66.67 });
});

test('saldo negativo entra e as filiais do mesmo SKU são somadas antes da contagem', () => {
  const result = calcular([
    { sku: 'MESMO-SKU', ref: 'A', estoque: 3 },
    { sku: 'MESMO-SKU', ref: 'A', estoque: -3 },
    { sku: 'NEGATIVO', ref: 'B', estoque: -1 },
  ]);
  assert.deepEqual(result.referencias, { comEstoque: 1, totalAtivos: 2, percent: 50 });
  assert.deepEqual(result.skus, { comEstoque: 1, totalAtivos: 2, percent: 50 });
});

test('ativos sem entrada e sem saldo continuam na base, sem contar como estoque', () => {
  const result = calcular([
    { sku: 'COM-SALDO', ref: 'COM-SALDO', estoque: 4 },
    { sku: 'SEM-ENTRADA', ref: 'SEM-ENTRADA', estoque: 0, ultimaEntrada: null },
  ]);
  assert.equal(result.skus.totalAtivos, 2);
  assert.equal(result.skus.comEstoque, 1);
  assert.equal(result.referencias.percent, 50);
});

test('o AA conta SKUs e referências históricos elegíveis sem mudar quantidade e valor gerais', () => {
  const result = montarComparativoAnoAnterior([
    { product_sku: 'P', reference_code: 'HISTORICA', linha: 'BÁSICO', status: 'ATIVO', quantidade: 5, valor: 50 },
    { product_sku: 'M', reference_code: 'HISTORICA', linha: 'BÁSICO', status: 'ATIVO', quantidade: -5, valor: -50 },
    { product_sku: 'R', reference_code: 'RENOVAVEL', linha: 'BÁSICO RENOVÁVEL', status: 'ATIVO', quantidade: -2, valor: -20 },
    { product_sku: 'ZERO', reference_code: 'ZERADA', linha: 'BÁSICO', status: 'ATIVO', quantidade: 0, valor: 0 },
    { product_sku: 'FORA', reference_code: 'FORA', linha: 'BÁSICO', status: 'FORA DE LINHA', quantidade: 10, valor: 100 },
    { product_sku: 'STYLE', reference_code: 'STYLE', linha: 'STYLE', status: 'ATIVO', quantidade: 20, valor: 200 },
  ], []);
  // FORA DE LINHA e STYLE agora contam; so a ZERADA fica de fora.
  assert.deepEqual(result.estoqueAtivos, { referencias: 4, skus: 5 });
  assert.equal(result.estoque, 28);
  assert.equal(result.valorEstoque, 280);
});

test('base vazia produz contagem e percentual zero', () => {
  const expected = { comEstoque: 0, totalAtivos: 0, percent: 0 };
  assert.deepEqual(calcular([]), { referencias: expected, skus: expected });
});
