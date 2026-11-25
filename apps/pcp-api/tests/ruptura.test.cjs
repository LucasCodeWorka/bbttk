const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acumularRuptura, montarRupturaLinhaKpi, getRelatorioBase } = require('../dist/services/relatorioBase.service.js');
const { skuElegivelRuptura, ColetorItensRuptura } = require('../dist/services/relatorioBaseRuptura.service.js');
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

test('regra de 24/11: só entra quem já teve entrada e vendeu em 12 meses; registro técnico do ETL nunca entra', () => {
  const vida = new Map([[10, { ultimaVenda: '2026-11-01', venda12m: 4, ultimaEntrada: '2026-01-10' }]]);
  assert.equal(skuElegivelRuptura('7800000000010', 10, vida), true);
  assert.equal(skuElegivelRuptura('7800000000011', 11, vida), false);
  assert.equal(skuElegivelRuptura('7800000000012', null, vida), false);
  assert.equal(skuElegivelRuptura('PRODUCT_CODE:10', 10, vida), false);
  const basico = { skus: 0, totalSkus: 0 };
  const renovavel = { skus: 0, totalSkus: 0 };
  assert.equal(acumularRuptura(basico, renovavel, 'BÁSICO', 'ATIVO', 0, false), false);
  assert.equal(acumularRuptura(basico, renovavel, 'BÁSICO', 'ATIVO', 0, true), true);
  assert.deepEqual(montarRupturaLinhaKpi(basico), { skus: 1, totalSkus: 1, percent: 100 });
});

test('a relação agrupa por referência, só lista referência com ruptura e põe os SKUs em ruptura primeiro', () => {
  const vida = new Map([[1, { ultimaVenda: '2026-10-01', venda12m: 3, ultimaEntrada: '2026-01-01' }],
    [2, { ultimaVenda: '2026-11-01', venda12m: 5, ultimaEntrada: '2026-01-01' }]]);
  const coletor = new ColetorItensRuptura(vida);
  const base = { referencia: 'REF A', nome: 'Camisa', linha: 'Básico', cor: 'AZUL' };
  coletor.adicionar({ ...base, productSku: 'A-M', productCode: 1, tamanho: 'M', estoque: 4 });
  coletor.adicionar({ ...base, productSku: 'A-P', productCode: 2, tamanho: 'P', estoque: 0 });
  coletor.adicionar({ ...base, referencia: 'REF B', productSku: 'B-P', productCode: 1, tamanho: 'P', estoque: 2 });
  const r = coletor.montar('2026-11-22');
  assert.equal(r.totalSkusBase, 3);
  assert.equal(r.totalSkusRuptura, 1);
  assert.equal(r.referencias.length, 1);
  const [a] = r.referencias;
  assert.deepEqual([a.referencia, a.skusRuptura, a.skusBase, a.percent, a.venda12m, a.ultimaVenda, a.productCode],
    ['REF A', 1, 2, 50, 8, '2026-11-01', 1]);
  assert.deepEqual(a.skus.map(s => [s.productSku, s.emRuptura]), [['A-P', true], ['A-M', false]]);
});

test('a posição histórica inclui ativos ausentes do snapshot sem duplicar filiais nem alterar os demais KPIs', async (t) => {
  const catalogo = [
    { product_sku: 'B-COM-SALDO', linha: 'BÁSICO', status: 'ATIVO' },
    { product_sku: 'B-SEM-MOVIMENTO', product_code: 124, linha: 'BÁSICO', status: 'ATIVO' },
    { product_sku: 'R-ZERO', linha: 'BÁSICO RENOVÁVEL', status: 'ATIVO' },
    // Sem venda em 12 meses (fora da vida abaixo): sai da base da ruptura.
    { product_sku: 'R-SEM-MOVIMENTO', product_code: 125, linha: 'BÁSICO RENOVÁVEL', status: 'ATIVO' },
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
    if (text.includes('WITH venda AS')) return [123, 124].map(product_code => ({
      product_code, ultima_venda: new Date('2026-11-01'), qtd: 1, ultima_entrada: new Date('2026-01-01'),
    }));
    if (text.includes('produto_precos_promocionais')) return [{ existe: false }];
    if (text.includes('AS possui_diario')) return [{ possui_diario: false, hoje: '2026-11-15' }];
    if (text.includes('information_schema.columns')) return [{ possui_marcador: true }];
    if (text.includes('to_char(data_posicao') && text.includes('LIMIT 1')) return [{ data_posicao: '2026-11-12' }];
    if (text.includes('rb.giro_30d')) return snapshot;
    if (text.includes('FROM produto_analitico a')) return catalogo;
    if (text.includes('FROM branches')) return [];
    throw new Error(`Consulta não prevista no teste: ${text}`);
  } };
  const result = await getRelatorioBase({ dataPosicao: '2026-11-12', incluirComparativoAnoAnterior: false, pageSize: 1 });
  assert.deepEqual(result.kpisExtra.ruptura.basico, { skus: 1, totalSkus: 2, percent: 50 });
  assert.deepEqual(result.kpisExtra.ruptura.renovavel, { skus: 1, totalSkus: 1, percent: 100 });
  // Cards de referencias/SKUs: so INATIVO fica fora, entao STYLE e FORA entram na base
  // (6), ao contrario da ruptura acima, que segue restrita a Basico/Renovavel ATIVO.
  assert.deepEqual(result.kpisExtra.estoqueAtivos.referencias, { comEstoque: 1, totalAtivos: 6, percent: 16.67 });
  assert.deepEqual(result.kpisExtra.estoqueAtivos.skus, { comEstoque: 1, totalAtivos: 6, percent: 16.67 });
  assert.equal(result.kpisExtra.referenciasComEstoque, 1);
  assert.equal(result.kpis.estTt, 8);
  assert.equal(result.kpis.skuCount, 4);
  assert.equal(result.kpisExtra.valorEstoqueTotal, 80);
  assert.equal(result.pagination.totalReferencias, 4);
  assert.equal(result.rows.length, 1);
});
