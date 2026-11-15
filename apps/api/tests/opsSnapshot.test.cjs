const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepararSnapshotOps, gravarSnapshotOps } = require('../dist/services/opsSnapshot.service.js');

test('sincronizacao manual rejeita captura anterior a ultima para nao regredir a posicao', async () => {
  const tx = {
    $executeRaw: async () => 0,
    $executeRawUnsafe: async () => 0,
    $queryRaw: async () => [{ captured_at: new Date('2026-11-15T21:00:00Z') }],
  };
  await assert.rejects(prepararSnapshotOps(tx, new Date('2026-11-15T20:00:00Z')), /mais antiga/);
});

test('sincronizacao manual grava cabecalho mesmo vazia e delimita a fotografia por dia em Sao Paulo', async () => {
  const queries = [];
  const tx = {
    $executeRaw: async (strings, ...values) => { queries.push({ sql: strings.join('?'), values }); return 0; },
  };
  const captura = new Date('2026-11-16T01:00:00Z'); // Ainda 15/11 em Sao Paulo.
  await gravarSnapshotOps(tx, captura);
  assert.equal(queries.length, 3);
  assert.match(queries[0].sql, /INSERT INTO ops_em_producao_capturas/);
  assert.match(queries[1].sql, /DELETE FROM ops_em_producao_diario/);
  assert.match(queries[2].sql, /SUM\(quantidade_pendente\)/);
  for (const query of queries) assert.match(query.sql, /America\/Sao_Paulo/);
  assert.match(queries[2].sql, /COALESCE\(insert_date, dt_inicio\)::date/);
});
