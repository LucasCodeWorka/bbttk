const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../dist/config/database.js');
const { getMetasPorVendedorPeriodo } = require('../dist/services/vendas.service.js');

// Substitui somente a leitura de metas. Nenhuma conexao ou escrita no banco.
const queryRawOriginal = prisma.$queryRaw;
prisma.$queryRaw = async () => [
  { branch_code: 2, seller_code: null, nivel_3: 280000 },
  { branch_code: 2, seller_code: 232, nivel_3: 80000 },
  { branch_code: 2, seller_code: 1304, nivel_3: 100000 },
  { branch_code: 2, seller_code: 1901, nivel_3: 100000 },
  { branch_code: 3, seller_code: 300, nivel_3: 60000 },
];

const inicio = new Date('2026-11-01');
const fim = new Date('2026-11-09');
const metasAtacado = [[232, 24000], [1304, 30000], [1901, 30000]];

test('Atacado busca as metas da filial real 2 com rateio pelos dias do periodo', async () => {
  const metas = await getMetasPorVendedorPeriodo(inicio, fim, [2.3]);
  assert.deepEqual([...metas], metasAtacado);
  // Corrigir a empresa nao deve remapear vendedores de mesmo nome.
  assert.equal(metas.has(1303), false);
});

test('DPA nao recebe a meta exclusiva do Atacado', async () => {
  assert.deepEqual([...await getMetasPorVendedorPeriodo(inicio, fim, [2])], []);
});

test('selecionar DPA e Atacado juntos nao duplica as metas', async () => {
  assert.deepEqual([...await getMetasPorVendedorPeriodo(inicio, fim, [2, 2.3])], metasAtacado);
});

test('outras lojas mantem suas metas e podem ser combinadas com Atacado', async () => {
  assert.deepEqual([...await getMetasPorVendedorPeriodo(inicio, fim, [3])], [[300, 18000]]);
  assert.deepEqual([...await getMetasPorVendedorPeriodo(inicio, fim, [2.3, 3])], [
    ...metasAtacado, [300, 18000],
  ]);
});

test('sem filtro ou com lista vazia considera todas as empresas uma vez', async () => {
  for (const filtro of [undefined, []]) {
    assert.deepEqual([...await getMetasPorVendedorPeriodo(inicio, fim, filtro)], [
      ...metasAtacado, [300, 18000],
    ]);
  }
});

test('mes completo preserva as metas mensais e exclui a meta geral da loja', async () => {
  const metas = await getMetasPorVendedorPeriodo(inicio, new Date('2026-11-30'), [2.3]);
  assert.deepEqual([...metas], [[232, 80000], [1304, 100000], [1901, 100000]]);
  assert.equal([...metas.values()].reduce((total, valor) => total + valor, 0), 280000);
});

after(async () => {
  prisma.$queryRaw = queryRawOriginal;
  await prisma.$disconnect();
});
