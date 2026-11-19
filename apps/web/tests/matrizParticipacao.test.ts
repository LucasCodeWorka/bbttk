import assert from 'node:assert/strict';
import test from 'node:test';
import { participacaoMatriz } from '../src/lib/matrizParticipacao';
import { formatNumber } from '../src/lib/utils';

const pct = (valor: number, total: number) => formatNumber(participacaoMatriz(valor, total)!, 2);

// Exemplo da devolutiva (secao 7), posicao 08/11/2026, estoque varejo total 76.604.
test('valida o exemplo de estoque varejo da devolutiva', () => {
  assert.equal(pct(29149, 76604), '38,05');
  assert.equal(pct(28392, 76604), '37,06');
  assert.equal(pct(11672, 76604), '15,24');
  assert.equal(pct(7391, 76604), '9,65');
});

test('na visao por linha, o antigo "Nao classificado" se abre e soma os mesmos 9,65%', () => {
  const abertos = [5024, 1646, 677, 44]; // embalagem, brinde, promocoes, teenkis
  assert.equal(abertos.reduce((s, v) => s + v, 0), 7391);
  const soma = abertos.reduce((s, v) => s + participacaoMatriz(v, 76604)!, 0);
  assert.equal(formatNumber(soma, 2), '9,65');
});

test('total zero ou valor ausente nao vira participacao', () => {
  assert.equal(participacaoMatriz(10, 0), null);
  assert.equal(participacaoMatriz(null, 100), null);
  assert.equal(participacaoMatriz(5, null), null);
});

test('venda negativa (devolucao maior que venda) aparece com sinal', () => {
  assert.equal(pct(-12, 400), '-3,00');
});
