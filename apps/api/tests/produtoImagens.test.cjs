const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarConsultaProdutoImagens } = require('../dist/services/produtoImagens.service.js');

const jpeg = Buffer.from([255, 216, 255, 224, 0, 16]).toString('base64');
const image = code => ({ imageCode: code, imageName: `foto-${code}.jpg`, imageFile: jpeg });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function mock(responder) {
  const calls = [];
  const fetcher = async (url, options) => {
    const auth = url.endsWith('/authorization/v2/token');
    const payload = auth ? Object.fromEntries(options.body) : JSON.parse(options.body);
    calls.push({ url, options, payload, auth });
    if (auth) return json({ access_token: `token-${calls.filter(c => c.auth).length}`, expires_in: 3600 });
    return responder(payload, options);
  };
  return { calls, fetcher };
}

test('consulta somente o produto escolhido, segue hasNext e remove imagens repetidas', async () => {
  const upstream = mock(body => json({ hasNext: body.page === 1, items: [{ productCode: 30888,
    images: body.page === 1 ? [image(1845)] : [image(1845), { ...image(1846), typeImageCode: 2 }],
  }] }));
  const get = criarConsultaProdutoImagens(upstream);
  const result = await get(30888);
  assert.deepEqual(result.images.map(i => i.imageCode), [1845, 1846]);
  assert.equal(result.images[1].typeImageCode, '2');
  assert.equal(result.images[0].mimeType, 'image/jpeg');
  assert.equal(result.images[0].base64, jpeg);
  assert.deepEqual(upstream.calls.filter(c => !c.auth).map(c => c.payload), [1, 2].map(page => ({
    filter: { productCodeList: [30888] }, page, pageSize: 100,
  })));
  assert.ok(upstream.calls.every(c => c.options.method === 'POST' && c.options.signal));
  assert.equal(upstream.calls[1].options.headers.Authorization, 'Bearer token-1');
});

test('cliques simultâneos compartilham consulta e cache; outro SKU não recebe as mesmas fotos', async () => {
  const upstream = mock(async body => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return json({ hasNext: false, items: [{ productCode: body.filter.productCodeList[0], images: [image(1)] }] });
  });
  const get = criarConsultaProdutoImagens(upstream);
  const results = await Promise.all([get(1), get(1), get(2)]);
  assert.equal(results[0], results[1]);
  assert.equal(results[2].productCode, 2);
  assert.equal(upstream.calls.filter(c => c.auth).length, 1);
  assert.equal(upstream.calls.filter(c => !c.auth).length, 2);
  await get(1);
  assert.equal(upstream.calls.length, 3);
});

test('ausência de imagem é cacheada por cinco minutos e fotos por 24 horas', async () => {
  let clock = 1000;
  const upstream = mock(body => json({ hasNext: false, items: [{ productCode: body.filter.productCodeList[0],
    images: body.filter.productCodeList[0] === 1 ? [] : [image(1)],
  }] }));
  const get = criarConsultaProdutoImagens({ ...upstream, now: () => clock });
  assert.deepEqual((await get(1)).images, []);
  await get(2);
  clock += 4 * 60_000;
  await get(1); await get(2);
  assert.equal(upstream.calls.filter(c => !c.auth).length, 2);
  clock += 2 * 60_000;
  await get(1); await get(2);
  assert.equal(upstream.calls.filter(c => !c.auth).length, 3);
  clock += 24 * 60 * 60_000;
  await get(2);
  assert.equal(upstream.calls.filter(c => !c.auth).length, 4);
});

test('token rejeitado é renovado uma vez; resposta de erro não entra em cache', async () => {
  let status = 401;
  const upstream = mock(() => status === 200
    ? json({ hasNext: false, items: [] }) : json({ error: 'detalhe privado' }, status));
  const get = criarConsultaProdutoImagens(upstream);
  await assert.rejects(get(1), e => e.statusCode === 502 && !e.message.includes('privado'));
  assert.equal(upstream.calls.filter(c => c.auth).length, 2);
  status = 200;
  assert.deepEqual((await get(1)).images, []);
});

test('renovação bem-sucedida após 401 permite concluir a consulta', async () => {
  const upstream = mock((body, options) => options.headers.Authorization === 'Bearer token-1'
    ? json({}, 401) : json({ hasNext: false, items: [{ productCode: 1, images: [image(1)] }] }));
  assert.equal((await criarConsultaProdutoImagens(upstream)(1)).images.length, 1);
  assert.equal(upstream.calls.filter(c => c.auth).length, 2);
});

test('código inválido não gera requisição ao TOTVS', async () => {
  const upstream = mock(() => { throw new Error('Não deve consultar'); });
  const get = criarConsultaProdutoImagens(upstream);
  for (const code of [0, -1, 1.5, NaN, Infinity, 2147483648, '30888']) {
    await assert.rejects(get(code), e => e.statusCode === 400);
  }
  assert.equal(upstream.calls.length, 0);
});

test('rejeita imagens de outro produto e conteúdo que não seja imagem base64 suportada', async () => {
  for (const item of [
    { productCode: 2, images: [image(1)] },
    { productCode: 1, images: [{ ...image(1), imageFile: 'https://externo.example/foto.jpg' }] },
    { productCode: 1, images: [{ ...image(1), imageFile: Buffer.from('<svg/>').toString('base64') }] },
  ]) {
    const upstream = mock(() => json({ hasNext: false, items: [item] }));
    await assert.rejects(criarConsultaProdutoImagens(upstream)(1), e => e.statusCode === 502);
  }
});

test('aceita prefixo data URL e verifica a assinatura real da imagem', async () => {
  const upstream = mock(() => json({ hasNext: false, items: [{ productCode: 1,
    images: [{ ...image(1), imageFile: `data:image/png;base64,${jpeg}` }],
  }] }));
  const result = await criarConsultaProdutoImagens(upstream)(1);
  assert.equal(result.images[0].mimeType, 'image/jpeg');
});

test('falha de rede é recuperável e não expõe detalhes privados', async () => {
  let falhar = true;
  const upstream = mock(() => {
    if (falhar) throw new Error('private-token-do-upstream');
    return json({ hasNext: false, items: [] });
  });
  const get = criarConsultaProdutoImagens(upstream);
  await assert.rejects(get(1), e => !e.message.includes('private-token') && e.statusCode === 502);
  falhar = false;
  assert.deepEqual((await get(1)).images, []);
});

test('paginação sem fim é interrompida sem devolver resultado parcial', async () => {
  const upstream = mock(() => json({ hasNext: true, items: [] }));
  await assert.rejects(criarConsultaProdutoImagens(upstream)(1), /concluir/);
  assert.equal(upstream.calls.filter(c => !c.auth).length, 20);
});

test('resposta acima do limite é interrompida', async () => {
  const upstream = mock(() => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(7 * 1024 * 1024));
      controller.enqueue(new Uint8Array(7 * 1024 * 1024));
      controller.close();
    },
  })));
  await assert.rejects(criarConsultaProdutoImagens(upstream)(1), /limite/);
});
