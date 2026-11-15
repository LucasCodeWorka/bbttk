const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acumularRuptura, montarRupturaLinhaKpi, getRelatorioBase } = require('../dist/services/relatorioBase.service.js');
const database = require('../dist/config/database.js');

function calcular(skus) {
  const basico = { skus: 0, totalSkus: 0 };
  const renovavel = { skus: 0, totalSkus: 0 };
  for (const sku of skus) {
    acumularRuptura(basico, renovavel, sku.linha, sku.status, sku.estoque);
  }
  return {
    basico: montarRupturaLinhaKpi(basico),
    renovavel: montarRupturaLinhaKpi(renovavel),
  };
}

test('a base inclui os ativos de Básico e Renovável mesmo sem registro de entrada', () => {
  const result = calcular([
    { linha: 'BÁSICO', status: 'ATIVO', estoque: 0, ultimaEntrada: null, productCode: null },
    { linha: 'BÁSICO', status: 'ATIVO', estoque: 5, ultimaEntrada: '2026-11-01' },
    { linha: 'BÁSICO RENOVÁVEL', status: 'ATIVO', estoque: 0, ultimaEntrada: null },
    { linha: 'BÁSICO RENOVÁVEL', status: 'ATIVO', estoque: 3, ultimaEntrada: '2026-11-01' },
  ]);
  assert.deepEqual(result.basico, { skus: 1, totalSkus: 2, percent: 50 });
  assert.deepEqual(result.renovavel, { skus: 1, totalSkus: 2, percent: 50 });
});

test('Fora de Linha, seus complementos e outros status não entram na ruptura nem na base', () => {
  const skus = [];
  for (const linha of ['BÁSICO', 'BÁSICO RENOVÁVEL']) {
    for (const status of ['FORA DE LINHA', 'FORA DE LINHA XXXX', 'FORA DE LINHA BLACK FRIDAY 2025', 'INATIVO', 'ATIVO PROMOÇÃO', null]) {
      skus.push({ linha, status, estoque: 0 });
    }
  }
  const result = calcular(skus);
  assert.deepEqual(result.basico, { skus: 0, totalSkus: 0, percent: 0 });
  assert.deepEqual(result.renovavel, { skus: 0, totalSkus: 0, percent: 0 });
});

test('Style e as demais linhas ficam fora da base mesmo com status ATIVO', () => {
  const result = calcular(['STYLE', 'COLEÇÃO', 'CASUAL', 'BRINDE', null].map(linha => ({
    linha, status: 'ATIVO', estoque: 0,
  })));
  assert.equal(result.basico.totalSkus + result.renovavel.totalSkus, 0);
  assert.equal(result.basico.skus + result.renovavel.skus, 0);
});

test('saldo zero ou negativo conta como ruptura; saldo positivo compõe somente a base', () => {
  const result = calcular([0, -2, 5].map(estoque => ({ linha: 'BÁSICO', status: 'ATIVO', estoque })));
  assert.deepEqual(result.basico, { skus: 2, totalSkus: 3, percent: 66.7 });
});

test('a elegibilidade normaliza acentos, espaços e caixa dos nomes cadastrados', () => {
  const result = calcular([
    { linha: '  básica  ', status: ' ativo ', estoque: 0 },
    { linha: '  básica   renovável ', status: 'ativo', estoque: 1 },
  ]);
  assert.deepEqual(result.basico, { skus: 1, totalSkus: 1, percent: 100 });
  assert.deepEqual(result.renovavel, { skus: 0, totalSkus: 1, percent: 0 });
});

test('a posição histórica inclui ativos ausentes do snapshot sem duplicar filiais nem alterar os demais KPIs', async (t) => {
  const catalogo = [
    { product_sku: 'B-COM-SALDO', linha: 'BÁSICO', status: 'ATIVO' },
    { product_sku: 'B-SEM-MOVIMENTO', linha: 'BÁSICO', status: 'ATIVO' },
    { product_sku: 'R-ZERO', linha: 'BÁSICO RENOVÁVEL', status: 'ATIVO' },
    { product_sku: 'R-SEM-MOVIMENTO', linha: 'BÁSICO RENOVÁVEL', status: 'ATIVO' },
    { product_sku: 'STYLE', linha: 'STYLE', status: 'ATIVO' },
    { product_sku: 'FORA', linha: 'BÁSICO', status: 'FORA DE LINHA XXXX' },
  ];
  function posicao(produto, estoque, branch_code = 1) {
    return {
      ...produto, product_code: 123, reference_code: produto.product_sku,
      reference_name: produto.product_sku, product_name: produto.product_sku,
      branch_code, estoque, custo_producao: 10, valor_estoque_custo_producao: estoque * 10,
      pdv_varejo: null, pdv_atacado: null, ultima_entrada: null,
      giro_30d: 0, giro_60d: 0, giro_90d: 0, giro_1m: 0, giro_3m: 0, giro_6m: 0,
      venda_cobertura_periodo: 0, em_producao: 0,
    };
  }
  const snapshot = [posicao(catalogo[0], 5), posicao(catalogo[0], 3, 3),
    posicao(catalogo[2], 0), posicao(catalogo[4], 0), posicao(catalogo[5], 0)];
  const prisma = database.prisma;
  t.after(() => { database.prisma = prisma; });
  database.prisma = { pcpRelatorioConfig: { upsert: async () => ({
    giroDias: 30, coberturaMeses: 1, atacadoCoberturaBase: 'atacado_only',
    coberturaLimiteVerde: 3, coberturaLimiteVermelho: 6,
  }) }, $queryRaw: async (sql) => {
    const text = Array.isArray(sql) ? sql.join('?') : sql.text;
    if (text.includes('information_schema.columns')) return [{ possui_marcador: true }];
    if (text.includes('to_char(data_posicao') && text.includes('LIMIT 1')) return [{ data_posicao: '2026-11-12' }];
    if (text.includes('rb.giro_30d')) return snapshot;
    if (text.includes('FROM produto_analitico a')) return catalogo;
    if (text.includes('FROM branches')) return [];
    throw new Error(`Consulta não prevista no teste: ${text}`);
  } };
  const result = await getRelatorioBase({ dataPosicao: '2026-11-12', incluirComparativoAnoAnterior: false, pageSize: 1 });
  assert.deepEqual(result.kpisExtra.ruptura.basico, { skus: 1, totalSkus: 2, percent: 50 });
  assert.deepEqual(result.kpisExtra.ruptura.renovavel, { skus: 2, totalSkus: 2, percent: 100 });
  assert.deepEqual(result.kpisExtra.estoqueAtivos.referencias, { comEstoque: 1, totalAtivos: 4, percent: 25 });
  assert.deepEqual(result.kpisExtra.estoqueAtivos.skus, { comEstoque: 1, totalAtivos: 4, percent: 25 });
  assert.equal(result.kpisExtra.referenciasComEstoque, 1);
  assert.equal(result.kpis.estTt, 8);
  assert.equal(result.kpis.skuCount, 4);
  assert.equal(result.kpisExtra.valorEstoqueTotal, 80);
  assert.equal(result.pagination.totalReferencias, 4);
  assert.equal(result.rows.length, 1);
});
