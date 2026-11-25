const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const metas = require('../dist/services/metas.service.js');
const totvs = require('../dist/services/totvs.service.js');
const vendas = require('../dist/services/vendas.service.js');
const router = require('../dist/routes/vendas.routes.js').default;

const filial = (branch_code, faturamento) => ({
  branch_code, branch_name: `Filial ${branch_code}`, faturamento,
  transacoes: 1, pecas: 1, pa: 1, tm: faturamento, clientes: 1, pm: faturamento, tm_cliente: faturamento, pac: 1,
});

test('Comparativo calcula a Meta Dia planejada pela data final e mantém o rateio da Meta do período', async (t) => {
  const metasMensais = {
    '2026-10': [[1, 310_000], [3, 62_000]],
    '2026-11': [[1, 100_000], [2, 90_000]],
    '2024-2': [[1, 100_000]],
    '2025-2': [[1, 100_000]],
  };
  t.mock.method(metas, 'getMetas', async (ano, mes) =>
    (metasMensais[`${ano}-${mes}`] ?? []).map(([branch_code, nivel_3]) => ({
      branch_code, nivel_3, seller_code: null,
    }))
  );
  t.mock.method(totvs, 'garantirClassificacaoAtualizada', async () => {});
  t.mock.method(vendas, 'getVendasPeriodo', async () => [filial(1, 50_000), filial(3, 15_000)]);
  t.mock.method(vendas, 'getVendasFabricaDividida', async () => [filial(2, 1000), filial(2.3, 30_000)]);
  t.mock.method(vendas, 'getClientesNovosPorFilial', async () => new Map());
  t.mock.method(vendas, 'getDevolucoesPorFilial', async () => new Map());
  t.mock.method(vendas, 'getDevolucoesFabricaDividida', async () => new Map());

  const server = express().use('/api', router).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  async function consultar(inicio, fim) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/comparativo-ano/${inicio}/${fim}`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return new Map(body.filiais.map(({ branch_code, meta }) => [branch_code, meta]));
  }

  const dia15 = await consultar('2026-11-10', '2026-11-15');
  assert.deepEqual(dia15.get(1), { valor: 20_000, pct: 250, meta_dia: 4000 });
  assert.equal(dia15.get(2.3).meta_dia, 3600);
  assert.deepEqual(dia15.get(2), { valor: 0, pct: 0, meta_dia: 0 });

  const dia16 = await consultar('2026-11-10', '2026-11-16');
  assert.equal(dia16.get(1).meta_dia, 2666.67);
  assert.equal(dia16.get(2.3).meta_dia, 2400);

  const variosMeses = await consultar('2026-10-31', '2026-11-30');
  assert.equal(variosMeses.get(1).valor, 110_000);
  assert.equal(variosMeses.get(1).meta_dia, 2666.67);
  assert.deepEqual(variosMeses.get(3), { valor: 2000, pct: 750, meta_dia: 0 });

  const mesesComDiasDiferentes = [
    ['2026-10-31', 7750],
    ['2024-02-29', 2857.14],
    ['2025-02-28', 3076.92],
  ];
  for (const [data, valor] of mesesComDiasDiferentes) {
    assert.equal((await consultar(data, data)).get(1).meta_dia, valor);
  }
});
