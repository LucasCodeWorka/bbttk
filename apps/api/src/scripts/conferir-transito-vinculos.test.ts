import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferir } from './conferir-transito-vinculos';

const saida = (transactionCode = 1, destinos = [{ branchCodeDestination: 6, transactionCodeDestination: 2 }]) => ({
  branchCode: 2, transactionCode, transactionDate: '2026-07-01', items: [{ productCode: 9, quantity: 10 }], originDestination: { destination: destinos },
});
const entrada = (quantity = 7) => ({ branchCode: 6, transactionCode: 2, transactionDate: '2026-07-02',
  items: [{ productCode: 9, quantity }], originDestination: { branchCodeOrigin: 2, transactionCodeOrigin: 1 } });
test('baixa somente documento vinculado e preserva recebimento parcial', () => {
  const r = conferir([saida()], [entrada()], [{ documento: 1, produto: 9, saida: 10, recebida: 10, aberto: 0 }]);
  assert.equal(r.resumo.pecasRecebidasPorVinculo, 7);
  assert.equal(r.resumo.diferencaTotal, 3);
});
test('destino vazio não recebe baixa de entrada equivalente por FIFO', () => {
  const r = conferir([saida(1, [])], [entrada(10)], []);
  assert.equal(r.resumo.pecasRecebidasPorVinculo, 0);
  assert.equal(r.rows[0].situacao, 'sem_destino_na_api');
});
test('origem divergente impede baixa', () => {
  const doc = entrada(); doc.originDestination.transactionCodeOrigin = 999;
  const r = conferir([saida()], [doc], []);
  assert.equal(r.resumo.pecasRecebidasPorVinculo, 0);
  assert.equal(r.rows[0].situacao, 'origem_divergente');
});
test('entrada compartilhada não duplica recebimento nem inventa rateio', () => {
  const doc = { ...entrada(15), originDestination: {} };
  const r = conferir([saida(), saida(3)], [doc], []);
  assert.equal(r.resumo.pecasRecebidasPorVinculo, 0);
  assert.ok(r.rows.every(row => row.situacao === 'entrada_compartilhada'));
});
test('agrega itens do mesmo produto e ignora vínculos repetidos', () => {
  const doc = saida(); doc.items.push({ productCode: 9, quantity: 5 });
  doc.originDestination.destination.push(doc.originDestination.destination[0]);
  const r = conferir([doc], [entrada(20)], []);
  assert.equal(r.rows.length, 1);
  assert.equal(r.resumo.pecasRecebidasPorVinculo, 15);
  assert.equal(r.rows[0].excessoEntrada, 5);
});
