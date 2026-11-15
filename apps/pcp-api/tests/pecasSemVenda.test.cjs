const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  acumularEstoqueAnaliseReferencia,
  calcularEstoqueAnaliseReferencias,
} = require('../dist/services/relatorioBase.service.js');

function calcular(skus, estoqueTotal = 100, valorTotal = 1000) {
  const referencias = new Map();
  for (const sku of skus) {
    acumularEstoqueAnaliseReferencia(referencias, sku.ref, sku.estoque, sku.valor,
      sku.venda30, sku.venda60 ?? sku.venda30, sku.venda90 ?? sku.venda30);
  }
  return calcularEstoqueAnaliseReferencias(referencias, estoqueTotal, valorTotal);
}

test('a venda de qualquer cor ou tamanho exclui toda a referência do card sem venda', () => {
  const result = calcular([
    { ref: 'COM-VENDA', estoque: 20, valor: 200, venda30: 0 },
    { ref: 'COM-VENDA', estoque: 0, valor: 0, venda30: 1 },
    { ref: 'SEM-VENDA', estoque: 6, valor: 60, venda30: 0 },
    { ref: 'SEM-VENDA', estoque: 4, valor: 40, venda30: 0 },
  ]);
  assert.deepEqual(result.itensSemVenda30d, {
    quantidade: 10, referencias: 1, quantidadePercent: 10, valor: 100, valorPercent: 10,
  });
});

test('a quantidade e o valor preservam saldos negativos antes de selecionar referências com estoque', () => {
  const result = calcular([
    { ref: 'SALDO-POSITIVO', estoque: 5, valor: 50, venda30: 0 },
    { ref: 'SALDO-POSITIVO', estoque: -2, valor: -20, venda30: 0 },
    { ref: 'SALDO-ZERO', estoque: 2, valor: 20, venda30: 0 },
    { ref: 'SALDO-ZERO', estoque: -2, valor: -20, venda30: 0 },
    { ref: 'SALDO-NEGATIVO', estoque: -1, valor: -10, venda30: 0 },
  ]);
  assert.deepEqual(result.itensSemVenda30d, {
    quantidade: 3, referencias: 1, quantidadePercent: 3, valor: 30, valorPercent: 3,
  });
});

test('o critério é venda líquida da referência igual a zero, sem incluir venda líquida negativa', () => {
  const result = calcular([
    { ref: 'VENDA-ZERO', estoque: 4, valor: 40, venda30: 2 },
    { ref: 'VENDA-ZERO', estoque: 1, valor: 10, venda30: -2 },
    { ref: 'DEVOLUCAO-LIQUIDA', estoque: 3, valor: 30, venda30: -1 },
  ]);
  assert.equal(result.itensSemVenda30d.quantidade, 5);
  assert.equal(result.itensSemVenda30d.referencias, 1);
});

test('o consolidado >30 dias inclui as faixas antigas sem somar ou duplicar seus cards', () => {
  const result = calcular([
    { ref: 'SEM-VENDA-30', estoque: 10, valor: 100, venda30: 0, venda60: 1, venda90: 2 },
    { ref: 'SEM-VENDA-60', estoque: 20, valor: 200, venda30: 0, venda60: 0, venda90: 1 },
    { ref: 'SEM-VENDA-90', estoque: 30, valor: 300, venda30: 0, venda60: 0, venda90: 0 },
  ]);
  assert.equal(result.itensSemVenda30d.quantidade, 60);
  assert.equal(result.itensSemVenda30d.referencias, 3);
  assert.equal(result.itensEnvelhecidos60a90d.quantidade, 20);
  assert.equal(result.itensEnvelhecidos90Mais.quantidade, 30);
});

test('sem referências ou sem total de estoque, não produz divisão por zero', () => {
  assert.deepEqual(calcular([], 0, 0).itensSemVenda30d, {
    quantidade: 0, referencias: 0, quantidadePercent: 0, valor: 0, valorPercent: 0,
  });
});
