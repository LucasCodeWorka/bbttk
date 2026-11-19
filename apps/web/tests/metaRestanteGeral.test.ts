import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMISSAO_VAZIA,
  VendedorState,
  calcularRestanteLoja,
  participaDivisao,
  valorEfetivoVendedor,
} from '../src/components/metas/VendedoresLojaTable';

function vendedor(overrides: Partial<VendedorState> = {}): VendedorState {
  return {
    sellerCode: 1000,
    sellerName: 'VENDEDORA',
    historico3m: 0,
    valor: 0,
    editadaManualmente: false,
    comissaoAtiva: false,
    comissaoOverride: { ...COMISSAO_VAZIA },
    isGerente: false,
    ...overrides,
  };
}

const GERAL = vendedor({ sellerCode: 50, sellerName: 'GERAL', isGeral: true, valor: 999 });

test('GERAL nao participa da divisao automatica', () => {
  assert.equal(participaDivisao(GERAL), false);
  assert.equal(participaDivisao(vendedor()), true);
  assert.equal(participaDivisao(vendedor({ isGerente: true })), false);
});

test('GERAL recebe a sobra quando as vendedoras nao somam a meta da loja', () => {
  const vs = [vendedor({ sellerCode: 1, valor: 40000 }), vendedor({ sellerCode: 2, valor: 35000.5 }), GERAL];
  const r = calcularRestanteLoja(100000, vs, 'cheio');
  assert.equal(r.distribuido, 75000.5);
  assert.equal(r.valorGeral, 24999.5);
  assert.equal(r.quemAbsorve, 'geral');
  // o valor guardado no estado do GERAL e ignorado: vale o calculado
  assert.equal(valorEfetivoVendedor(GERAL, r), 24999.5);
  // soma enviada ao backend bate com a meta da loja (validacao sem gerente)
  const somaRegulares = vs.reduce((s, v) => s + valorEfetivoVendedor(v, r), 0);
  assert.equal(somaRegulares, 100000);
});

test('GERAL fica com zero quando as vendedoras dividem tudo', () => {
  const r = calcularRestanteLoja(100000, [vendedor({ valor: 100000 }), GERAL], 'cheio');
  assert.equal(r.valorGeral, 0);
  assert.equal(r.absorveSobra, true);
});

test('vendedoras acima da meta: GERAL nao fica negativo e a sobra negativa aparece', () => {
  const r = calcularRestanteLoja(100000, [vendedor({ valor: 100500 }), GERAL], 'cheio');
  assert.equal(r.valorGeral, 0);
  assert.equal(r.sobra, -500);
});

test('gerente em "assume o restante" continua com a sobra e o GERAL fica com zero', () => {
  const gerente = vendedor({ sellerCode: 9, isGerente: true });
  const r = calcularRestanteLoja(100000, [vendedor({ valor: 70000 }), gerente, GERAL], 'restante');
  assert.equal(r.quemAbsorve, 'gerente');
  assert.equal(r.valorGerente, 30000);
  assert.equal(r.valorGeral, 0);
});

test('gerente com valor cheio nao impede o GERAL de receber a sobra', () => {
  const gerente = vendedor({ sellerCode: 9, isGerente: true });
  const r = calcularRestanteLoja(100000, [vendedor({ valor: 70000 }), gerente, GERAL], 'cheio');
  assert.equal(r.valorGerente, 100000);
  assert.equal(r.valorGeral, 30000);
});

test('sem GERAL e sem gerente absorvendo, ninguem absorve a sobra', () => {
  const r = calcularRestanteLoja(100000, [vendedor({ valor: 70000 })], 'cheio');
  assert.equal(r.absorveSobra, false);
  assert.equal(r.sobra, 30000);
});
