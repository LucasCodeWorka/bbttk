const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const env = dotenv.parse(fs.readFileSync(envPath));
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
}
const { Prisma, PrismaClient } = require('@prisma/client');
const { filtroLocalEstoqueSql, localEstoqueSql, saldosAtuaisSql } = require('../dist/services/estoqueLocal.service.js');
const prisma = new PrismaClient({ log: [] });

// CTE isolada: nenhum dado real e alterado. Inclui saldo antigo, loja fechada,
// atacado fora da Fabrica, negativos e um tipo de saldo adicional (99).
const fixture = Prisma.sql`WITH prd_saldo(product_sku, product_code, branch_code, stock_code, stock, captured_at, id) AS (
  VALUES
    ('SKU', 1, 9, 1, 1, '2026-10-23 12:00'::timestamp, 1),
    ('SKU', 1, 9, 8, 5, '2026-10-22 12:00'::timestamp, 2),
    ('SKU', 1, 9, 8, -2, '2026-10-23 15:00'::timestamp, 3),
    ('SKU', 1, 9, 5, 0, '2026-10-23 12:00'::timestamp, 4),
    ('SKU', 1, 16, 8, 1, '2026-10-23 12:00'::timestamp, 5),
    ('SKU', 1, 2, 1, 3, '2026-10-23 12:00'::timestamp, 6),
    ('SKU', 1, 2, 5, -1, '2026-10-23 12:00'::timestamp, 7),
    ('SKU', 1, 2, 8, 4, '2026-10-23 12:00'::timestamp, 8),
    ('SKU', 1, 2, 99, 2, '2026-10-23 12:00'::timestamp, 9)
), ultimo AS (${saldosAtuaisSql()})`;

async function readOnly(fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return fn(tx);
  });
}

test('soma todos os saldos por empresa usando somente a ultima captura', { skip: !process.env.DATABASE_URL }, async () => {
  const rows = await readOnly((tx) => tx.$queryRaw`${fixture}
    SELECT ${localEstoqueSql('s')} AS local, SUM(s.stock)::int AS quantidade
    FROM ultimo s GROUP BY 1 ORDER BY 1`);
  assert.deepEqual(rows, [
    { local: -2, quantidade: 4 }, { local: -1, quantidade: 4 },
    { local: 9, quantidade: -1 }, { local: 16, quantidade: 1 },
  ]);
});

test('filtro de loja preserva atacado negativo e o valor com sinal', { skip: !process.env.DATABASE_URL }, async () => {
  const [row] = await readOnly((tx) => tx.$queryRaw`${fixture}
    SELECT SUM(s.stock)::int AS quantidade, SUM(s.stock * 10.50) AS valor
    FROM ultimo s WHERE TRUE ${filtroLocalEstoqueSql([9], 's')}`);
  assert.equal(row.quantidade, -1);
  assert.equal(Number(row.valor), -10.5);
});

test('DPA inclui saldos adicionais e nao se sobrepoe ao atacado da Fabrica', { skip: !process.env.DATABASE_URL }, async () => {
  for (const [branches, expected] of [[[-1], 4], [[-2], 4], [[2], 8], [[16], 1], [[-99], 0]]) {
    const [row] = await readOnly((tx) => tx.$queryRaw`${fixture}
      SELECT COALESCE(SUM(s.stock), 0)::int AS quantidade
      FROM ultimo s WHERE TRUE ${filtroLocalEstoqueSql(branches, 's')}`);
    assert.equal(row.quantidade, expected, JSON.stringify(branches));
  }
});

after(async () => prisma.$disconnect());
