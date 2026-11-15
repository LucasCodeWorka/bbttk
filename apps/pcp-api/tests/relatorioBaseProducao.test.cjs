const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Decimal } = require('@prisma/client/runtime/library');
const database = require('../dist/config/database.js');
const { getProducaoRelatorio, skusCanonicosProducao } = require('../dist/services/relatorioBaseProducao.service.js');
const { getRelatorioBase } = require('../dist/services/relatorioBase.service.js');

function banco(t, query) {
  const original = database.prisma;
  t.after(() => { database.prisma = original; });
  database.prisma = {
    pcpRelatorioConfig: { upsert: async () => ({
      giroDias: 30, coberturaMeses: 1, atacadoCoberturaBase: 'atacado_only',
      coberturaLimiteVerde: 3, coberturaLimiteVermelho: 6,
    }) },
    $queryRaw: async sql => query(Array.isArray(sql) ? sql.join('?') : sql.text),
  };
}

test('data passada sem captura nunca usa pendencia atual ou materializada', async t => {
  banco(t, sql => {
    assert.match(sql, /AS possui_diario/);
    return [{ possui_diario: false, hoje: '2026-11-15' }];
  });
  const r = await getProducaoRelatorio('2026-11-10');
  assert.deepEqual(r, { info: { disponivel: false, capturedAt: null, fonte: 'indisponivel' }, rows: [] });
});

test('cabecalho sem itens distingue zero real de falta de historico', async t => {
  banco(t, sql => {
    if (sql.includes('AS possui_diario')) return [{ possui_diario: true, hoje: '2026-11-15' }];
    assert.match(sql, /LEFT JOIN ops_em_producao_diario/);
    return [{ captured_at: new Date('2026-11-10T23:00:00Z'), product_code: null, quantidade: null }];
  });
  const r = await getProducaoRelatorio('2026-11-10');
  assert.equal(r.info.disponivel, true);
  assert.equal(r.info.fonte, 'diario');
  assert.deepEqual(r.rows, []);
});

test('sem captura do dia nao escolhe outro dia nem consulta atual para data passada', async t => {
  banco(t, sql => {
    if (sql.includes('AS possui_diario')) return [{ possui_diario: true, hoje: '2026-11-15' }];
    assert.match(sql, /WHERE c.data_posicao =/);
    assert.doesNotMatch(sql, /ORDER BY|LIMIT/);
    return [];
  });
  assert.equal((await getProducaoRelatorio('2026-11-10')).info.disponivel, false);
});

test('compatibilidade da carga atual exige dia da carga e corta criacao posterior', async t => {
  banco(t, sql => {
    if (sql.includes('AS possui_diario')) return [{ possui_diario: false, hoje: '2026-11-15' }];
    assert.match(sql, /COALESCE\(o.insert_date, o.dt_inicio\)::date <=/);
    assert.match(sql, /America\/Sao_Paulo/);
    return [{ captured_at: new Date('2026-11-15T21:30:00Z'), product_code: 123, quantidade: new Decimal(1852) }];
  });
  const r = await getProducaoRelatorio('2026-11-15');
  assert.equal(r.info.fonte, 'atual');
  assert.equal(Number(r.rows[0].quantidade), 1852);
});

test('produto com placeholder recebe pendencia uma unica vez no SKU real', () => {
  const r = skusCanonicosProducao([
    { product_code: 123, product_sku: 'PRODUCT_CODE:123' },
    { product_code: 123, product_sku: 'REAL' },
    { product_code: 123, product_sku: 'REAL' },
  ]);
  assert.equal(r.size, 1);
  assert.equal(r.get(123), 'REAL');
});

function linha(sku, code, estoque, branch = 1) {
  return {
    product_sku: sku, product_code: code, reference_code: 'CST413', reference_name: 'CST413',
    product_name: sku, descricao: sku, descricao_completa: sku, color_name: 'AZUL', color_code: 'AZ',
    cor_agrupada: null, size: 'P', categoria: 'CAMISETA', linha: 'BASICO', genero: null,
    modelo: null, status: 'ATIVO', lancamento: null, branch_code: branch, estoque,
    giro_30d: 0, giro_60d: 0, giro_90d: 0, giro_1m: 0, giro_3m: 0, giro_6m: 0,
    venda_cobertura_periodo: 0, custo_producao: null, pdv_varejo: null, pdv_atacado: null,
    ultima_entrada: null, em_producao: 2261, valor_estoque_custo_producao: 0,
  };
}

function relatorioFake(t, disponivel) {
  const existentes = [linha('REAL', 123, 10), linha('REAL', 123, 20, -1)];
  banco(t, sql => {
    if (sql.includes('AS possui_diario')) return [{ possui_diario: disponivel, hoje: '2026-11-15' }];
    if (sql.includes('FROM ops_em_producao_capturas')) return [
      { captured_at: new Date('2026-11-10T23:00:00Z'), product_code: 123, quantidade: new Decimal(1171) },
      { captured_at: new Date('2026-11-10T23:00:00Z'), product_code: 456, quantidade: new Decimal(720) },
    ];
    if (sql.includes('information_schema.columns')) return [{ possui_marcador: true }];
    if (sql.includes('to_char(data_posicao') && sql.includes('LIMIT 1')) return [{ data_posicao: '2026-11-10' }];
    if (sql.includes('rb.giro_30d')) return existentes;
    if (sql.includes('FROM produto_analitico a')) return [
      linha('PRODUCT_CODE:123', 123, 0), linha('REAL', 123, 0), linha('SO-PRODUCAO', 456, 0),
    ];
    if (sql.includes('FROM branches')) return [];
    throw new Error(`Consulta inesperada: ${sql}`);
  });
}

test('analitico recupera SKU apenas em producao e soma uma vez por SKU, sem alterar estoque', async t => {
  relatorioFake(t, true);
  const r = await getRelatorioBase({ dataPosicao: '2026-11-10', incluirComparativoAnoAnterior: false });
  assert.equal(r.rows[0].emProducao, 1891); // 1.171 existentes + 720 que faltavam; sem OP futura.
  assert.equal(r.rows[0].estTt, 30);
  assert.equal(r.rows[0].cores[0].emProducao, 1891);
  assert.equal(r.rows[0].totalSkus, 2);
  assert.equal(r.kpis.estTt, 30);
  assert.equal(r.producao.fonte, 'diario');
});

test('analitico legado contaminado devolve null em referencia, cor e SKU sem captura', async t => {
  relatorioFake(t, false);
  const r = await getRelatorioBase({ dataPosicao: '2026-11-10', incluirComparativoAnoAnterior: false });
  assert.equal(r.producao.disponivel, false);
  assert.equal(r.rows[0].emProducao, null);
  assert.equal(r.rows[0].cores[0].emProducao, null);
  for (const sku of r.rows[0].skus) assert.equal(sku.emProducao, null);
  assert.equal(r.kpis.estTt, 30);
});
