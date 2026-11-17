const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const auth = require('../dist/services/auth.service.js');
const vendas = require('../dist/services/vendas.service.js');
const totvs = require('../dist/services/totvs.service.js');
const router = require('../dist/routes/vendas.routes.js').default;

test('exportacao de clientes exige autenticacao e respeita filiais e filtros', async t => {
  const originais = { verificar: auth.verifyToken, listar: vendas.getClientesPeriodo, classificar: totvs.garantirClassificacaoAtualizada };
  const chamadas = [];
  auth.verifyToken = token => ({
    admin: { role: 'admin', branchCodes: [] },
    loja: { role: 'gerente', branchCodes: [1] },
    fabrica: { role: 'gerente', branchCodes: [2] },
    vazio: { role: 'gerente', branchCodes: [] },
  })[token] || null;
  totvs.garantirClassificacaoAtualizada = async () => {};
  vendas.getClientesPeriodo = async (...args) => { chamadas.push(args); return []; };
  const server = express().use('/api', router).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    auth.verifyToken = originais.verificar;
    vendas.getClientesPeriodo = originais.listar;
    totvs.garantirClassificacaoAtualizada = originais.classificar;
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/vendas/clientes/periodo/2026-11-10/2026-11-11`;
  const get = (token, query = '', url = base) => fetch(url + query, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  assert.equal((await get()).status, 401);
  assert.equal((await get('invalido')).status, 401);
  assert.equal(chamadas.length, 0);

  const admin = await get('admin');
  assert.equal(admin.status, 200);
  assert.deepEqual(await admin.json(), { periodo: { inicio: '2026-11-10', fim: '2026-11-11' }, compras: [], devolucoes: [] });
  assert.equal(chamadas.at(-1)[2], undefined);

  assert.equal((await get('loja')).status, 200);
  assert.deepEqual(chamadas.at(-1)[2], [1]);
  let count = chamadas.length;
  assert.equal((await get('loja', '?branches=3')).status, 403);
  assert.equal((await get('loja', '?branches=1,3')).status, 403);
  assert.equal((await get('vazio')).status, 403);
  assert.equal(chamadas.length, count);

  assert.equal((await get('fabrica')).status, 200);
  assert.deepEqual(chamadas.at(-1)[2], [2,2.3]);
  assert.equal((await get('fabrica', '?branches=2.3')).status, 200);
  assert.deepEqual(chamadas.at(-1)[2], [2.3]);

  assert.equal((await get('loja', '?branches=1&categoria=BLUSA,CALCA&linha=BASICO&diasExcluidos=2026-11-10')).status, 200);
  assert.deepEqual(chamadas.at(-1).slice(2), [
    [1], { categoria: ['BLUSA','CALCA'], genero: undefined, status: undefined,
      linha: ['BASICO'], colecao: undefined, tecido: undefined }, ['2026-11-10'],
  ]);
  const consultaVazia = vendas.getClientesPeriodo;
  vendas.getClientesPeriodo = async (...args) => {
    chamadas.push(args);
    return [{ tipo: 'compra', codigo: 100 }, { tipo: 'devolucao', codigo: 100 }, { tipo: 'devolucao', codigo: 200 }];
  };
  const separado = await (await get('admin')).json();
  assert.deepEqual(separado.compras, [{ tipo: 'compra', codigo: 100 }]);
  assert.deepEqual(separado.devolucoes, [{ tipo: 'devolucao', codigo: 100 }, { tipo: 'devolucao', codigo: 200 }]);
  vendas.getClientesPeriodo = consultaVazia;
  count = chamadas.length;
  for (const query of ['?branches=abc', '?branches=2.4', '?branches=1foo', '?branches=0']) {
    assert.equal((await get('admin', query)).status, 400);
  }
  for (const range of ['2026-11-12/2026-11-10', '2026-02-30/2026-11-10', 'abc/2026-11-10']) {
    const url = `http://127.0.0.1:${server.address().port}/api/vendas/clientes/periodo/${range}`;
    assert.equal((await get('admin', '', url)).status, 400);
  }
  assert.equal(chamadas.length, count);
});
