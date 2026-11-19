const { test } = require('node:test');
const assert = require('node:assert/strict');
const database = require('../dist/config/database.js');
const { getRelatorioBase } = require('../dist/services/relatorioBase.service.js');

const casos = [
  ['usa peças, mesmo quando a participação financeira é diferente', 2, 8, 180, 20, 20],
  ['calcula participação mesmo quando os produtos não têm custo', 2, 8, 0, 0, 20],
  ['calcula 73,35% quando a quantidade selecionada é 67.533 sobre 92.072', 67533, 24539, 1726398.76, 533479.48, 73.35],
  ['calcula 72,18% quando a quantidade selecionada é 66.453 sobre 92.072', 66453, 25619, 1694780.51, 565097.73, 72.18],
  ['o percentual acompanha uma quantidade conciliada de 65.054 peças', 65054, 27018, 1700000, 500000, 70.66],
  ['estoque total zero não gera divisão por zero', 0, 0, 0, 0, 0],
  ['cobertura exatamente igual a cinco meses fica fora do indicador', 25, 5, 250, 5, 0, 5, 0],
  ['cobertura superior a cinco meses entra no indicador', 26, 4, 260, 4, 86.67, 5],
  ['cobertura inferior a cinco meses fica fora do indicador', 24, 6, 240, 6, 0, 5, 0],
  ['estoque sem venda líquida positiva continua incluído', 2, 8, 180, 20, 20, -1],
];

for (const [nome, critico, restante, valorCritico, valorRestante, percentual, vendaCritico = 0, quantidadeEsperada = critico] of casos) {
  test(nome, async (t) => {
    function produto(sku, estoque, venda, valor) {
      return {
        product_sku: sku, product_code: sku === 'CRITICO' ? 1 : 2,
        reference_code: sku, reference_name: sku, product_name: sku,
        linha: 'BÁSICO', status: 'ATIVO', branch_code: 9, estoque,
        custo_producao: estoque ? valor / estoque : 0, valor_estoque_custo_producao: valor,
        pdv_varejo: null, pdv_atacado: null, ultima_entrada: null,
        giro_30d: venda, giro_60d: venda, giro_90d: venda,
        giro_1m: venda, giro_3m: venda, giro_6m: venda,
        venda_cobertura_periodo: venda, em_producao: 0,
      };
    }
    const snapshot = [produto('CRITICO', critico, vendaCritico, valorCritico), produto('NORMAL', restante, restante, valorRestante)];
    const original = database.prisma;
    t.after(() => { database.prisma = original; });
    database.prisma = {
      pcpRelatorioConfig: { upsert: async () => ({
        giroDias: 30, coberturaMeses: 1, atacadoCoberturaBase: 'atacado_only',
        coberturaLimiteVerde: 3, coberturaLimiteVermelho: 6,
      }) },
      $queryRaw: async (sql) => {
        const text = Array.isArray(sql) ? sql.join('?') : sql.text;
        if (text.includes('produto_precos_promocionais')) return [{ existe: false }];
        if (text.includes('AS possui_diario')) return [{ possui_diario: false, hoje: '2026-11-15' }];
        if (text.includes('information_schema.columns')) return [{ possui_marcador: true }];
        if (text.includes('to_char(data_posicao') && text.includes('LIMIT 1')) return [{ data_posicao: '2026-11-10' }];
        if (text.includes('rb.giro_30d')) return snapshot;
        if (text.includes('FROM produto_analitico a')) return snapshot;
        if (text.includes('FROM branches')) return [];
        throw new Error(`Consulta não prevista no teste: ${text}`);
      },
    };
    const result = await getRelatorioBase({ dataPosicao: '2026-11-10', incluirComparativoAnoAnterior: false, pageSize: 1 });
    assert.equal(result.kpisExtra.estoqueMortoQtd, quantidadeEsperada);
    assert.equal(result.kpisExtra.estoqueMortoPercent, percentual);
    assert.equal(result.kpisExtra.estoqueMortoValor, quantidadeEsperada > 0 ? valorCritico : 0);
    assert.equal(result.kpis.estTt, critico + restante);
  });
}
