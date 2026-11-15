const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Prisma, PrismaClient } = require('@prisma/client');
const { VINCULO_CICLO_OP_SQL } = require('../dist/services/performanceColecao.service.js');
const prisma = new PrismaClient({ log: [] });
after(() => prisma.$disconnect());

test('Performance Colecao nao cruza itens de ciclos diferentes da OP 1352', async () => {
  const rows = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRaw`
      WITH ops_producao(branch_code,order_code,cycle_code) AS (VALUES (2,1352,1),(2,1352,2)),
      ops_producao_itens(branch_code,order_code,cycle_code,quantidade) AS (VALUES (2,1352,1,307),(2,1352,2,3018))
      SELECT o.cycle_code,SUM(i.quantidade)::int AS quantidade
      FROM ops_producao o JOIN ops_producao_itens i
        ON i.branch_code=o.branch_code AND i.order_code=o.order_code ${VINCULO_CICLO_OP_SQL}
      GROUP BY o.cycle_code ORDER BY 1
    `;
  });
  assert.deepEqual(rows, [{ cycle_code: 1, quantidade: 307 }, { cycle_code: 2, quantidade: 3018 }]);
});

test('Performance Colecao continua lendo itens sem coluna de ciclo antes da migracao', async () => {
  const rows = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRaw`
      WITH ops_producao(branch_code,order_code,cycle_code) AS (VALUES (2,1352,1)),
      ops_producao_itens(branch_code,order_code,quantidade) AS (VALUES (2,1352,307))
      SELECT SUM(i.quantidade)::int AS quantidade
      FROM ops_producao o JOIN ops_producao_itens i
        ON i.branch_code=o.branch_code AND i.order_code=o.order_code ${VINCULO_CICLO_OP_SQL}
    `;
  });
  assert.deepEqual(rows, [{ quantidade: 307 }]);
});
