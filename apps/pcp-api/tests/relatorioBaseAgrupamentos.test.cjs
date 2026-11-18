const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getRelatorioBase } = require('../dist/services/relatorioBase.service.js');
const { agruparStatus } = require('../dist/services/relatorioBaseAgrupamentos.service.js');
const database = require('../dist/config/database.js');

test('agrupa complementos, preserva demais status e respeita o limite da expressão', () => {
  for (const status of ['FORA DE LINHA', 'FORA DE LINHA 2025', ' fora  de linha BLACK FRIDAY ']) {
    assert.equal(agruparStatus(status), 'FORA DE LINHA');
  }
  for (const status of ['ATIVO', 'INATIVO', 'FORA DE LINHAGEM', null]) {
    assert.equal(agruparStatus(status), status);
  }
});

function fixture(sku, ref, estoque, status, venda = 0) {
  return {
    product_sku: sku, product_code: Number(sku), reference_code: ref,
    reference_name: `Descrição ${ref}`, product_name: ref,
    linha: 'BÁSICO', categoria: null, genero: 'INFANTIL', status,
    branch_code: 1, estoque, custo_producao: 10, valor_estoque_custo_producao: estoque * 10,
    pdv_varejo: null, pdv_atacado: null, ultima_entrada: null,
    giro_30d: venda, giro_60d: venda, giro_90d: venda,
    giro_1m: venda, giro_3m: venda, giro_6m: venda,
    venda_cobertura_periodo: venda, em_producao: 0,
  };
}

for (const historico of [true, false]) {
  test(`${historico ? 'histórico' : 'atual'}: consolida status, detalha todas as referências e ordena antes de paginar`, async t => {
    const rows = [
      fixture('101', 'FDL1', 10, 'FORA DE LINHA', 50),
      fixture('102', 'FDL1', -2, 'FORA DE LINHA 2026'),
      fixture('103', 'FDL2', 4, 'FORA DE LINHA 2025'),
      fixture('104', 'MAIOR', 20, 'ATIVO'),
      fixture('105', 'ZERADA', 0, 'INATIVO', 100),
      fixture('106', 'NEGATIVA', -3, null),
    ];
    const vendas = rows.filter(r => r.giro_30d).map(r => ({
      product_code: r.product_code, branch_code: 1, quantidade: r.giro_30d,
    }));
    const original = database.prisma;
    t.after(() => { database.prisma = original; });
    database.prisma = {
      pcpRelatorioConfig: { upsert: async () => ({
        giroDias: 30, coberturaMeses: 1, atacadoCoberturaBase: 'atacado_only',
        coberturaLimiteVerde: 3, coberturaLimiteVermelho: 6,
      }) },
      $queryRaw: async sql => {
        const text = Array.isArray(sql) ? sql.join('?') : sql.text;
        if (text.includes('AS possui_diario')) return [{ possui_diario: false, hoje: '2026-11-17' }];
        if (text.includes('information_schema.columns')) return [{ possui_marcador: true }];
        if (text.includes('to_char(data_posicao') && text.includes('LIMIT 1')) {
          return historico ? [{ data_posicao: '2026-11-10' }] : [];
        }
        if (text.includes('rb.giro_30d') || text.includes('FROM produto_analitico a')) return rows;
        if (text.includes('AS quantidade_estoque')) return rows.map(r => ({
          ...r, quantidade_estoque: r.estoque,
        }));
        if (text.includes('FROM branches')) return [];
        if (text.includes('FROM transacoes')) {
          if (text.includes('SUM(venda.quantidade)')) return [{ quantidade: 150 }];
          if (text.includes('AND t.branch_code =')) return [];
          if (text.includes('GROUP BY') && text.includes('SUM(')) return vendas;
          return [];
        }
        if (/FROM (produto_custos|produto_precos|ops_em_producao)/.test(text)) return [];
        throw new Error(`Consulta não prevista: ${text}`);
      },
    };
    const filtro = { dataPosicao: '2026-11-10', incluirComparativoAnoAnterior: false, pageSize: 1 };
    const result = await getRelatorioBase(filtro);
    assert.equal(result.rows[0].referenceCode, 'MAIOR');
    const p2 = await getRelatorioBase({ ...filtro, page: 2 });
    assert.equal(p2.rows[0].referenceCode, 'FDL1');
    const grupo = result.matriz.status.find(r => r.label === 'FORA DE LINHA');
    assert.equal(grupo.estoqueTotal, 12);
    assert.deepEqual(grupo.referencias, [
      { referenceCode: 'FDL1', descricao: 'Descrição FDL1', statusOriginais: ['FORA DE LINHA', 'FORA DE LINHA 2026'], estTt: 8 },
      { referenceCode: 'FDL2', descricao: 'Descrição FDL2', statusOriginais: ['FORA DE LINHA 2025'], estTt: 4 },
    ]);
    assert.equal(result.matriz.status.filter(r => r.label.startsWith('FORA DE LINHA')).length, 1);
    assert.equal(p2.rows[0].status, 'FORA DE LINHA');
    // O KPI de promoção mantém a regra anterior dos complementos: -2 + 4 = 2.
    assert.equal(result.kpisExtra.estoquePromocaoQtd, 2);
    assert.equal(result.kpisExtra.statusBreakdown.find(r => r.status === 'FORA DE LINHA').estTt, 12);
    assert.equal(result.matriz.status[0].label, 'ATIVO');
    for (const linhas of Object.values(result.matriz)) {
      for (const linha of linhas.filter(r => r.label !== 'Total')) {
        assert.equal(linha.referencias.reduce((n, ref) => n + ref.estTt, 0), linha.estoqueTotal, linha.label);
      }
    }
    assert.equal(result.matriz.categoria[0].referencias.length, 5);
    assert.equal(result.matriz.status.find(r => r.label === 'Nao classificado').referencias[0].estTt, -3);
  });
}
