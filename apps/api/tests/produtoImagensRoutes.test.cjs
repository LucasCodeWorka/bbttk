const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const auth = require('../dist/services/auth.service.js');
const imagens = require('../dist/services/produtoImagens.service.js');
const router = require('../dist/routes/produtos.routes.js').default;

test('fotos exigem login e módulo PCP, validam código e retornam apenas a grade solicitada', async t => {
  const original = { verificar: auth.verifyToken, consultar: imagens.getProdutoImagens };
  const calls = [];
  auth.verifyToken = token => ({
    admin: { role: 'admin', moduleAccess: [] },
    pcp: { role: 'gerente', moduleAccess: ['pcp'] },
    comercial: { role: 'gerente', moduleAccess: ['comercial'] },
  })[token] || null;
  imagens.getProdutoImagens = imagens.criarConsultaProdutoImagens({ fetcher: async (url, options) => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'privado-totvs', expires_in: 3600 });
    const payload = JSON.parse(options.body);
    calls.push(payload);
    const productCode = payload.filter.productCodeList[0];
    if (productCode === 999) throw new Error('detalhe privado');
    return Response.json({ hasNext: false, items: [{ productCode, images: [] }] });
  } });
  const server = express().use('/api', router).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    auth.verifyToken = original.verificar;
    imagens.getProdutoImagens = original.consultar;
    await new Promise(resolve => server.close(resolve));
  });
  const get = (token, code = '30888') => fetch(`http://127.0.0.1:${server.address().port}/api/produtos/${code}/imagens`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  assert.equal((await get()).status, 401);
  assert.equal((await get('invalido')).status, 401);
  assert.equal((await get('comercial')).status, 403);
  for (const code of ['abc', '0', '-1', '1.2', '30888abc', '2147483648', '1e3']) {
    assert.equal((await get('pcp', code)).status, 400);
  }
  assert.equal(calls.length, 0);
  const result = await get('pcp');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await result.json(), { productCode: 30888, images: [] });
  assert.equal((await get('admin')).status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter.productCodeList, [30888]);
  const failure = await get('pcp', '999');
  assert.equal(failure.status, 502);
  assert.ok(!JSON.stringify(await failure.json()).includes('privado'));
});
