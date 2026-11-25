const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ordenarColunasRelatorioBase, selecionarColunasRelatorioBase } = require('../dist/services/relatorioBaseLojas.service.js');
const { getRelatorioBase } = require('../dist/services/relatorioBase.service.js');
const database = require('../dist/config/database.js');

const ordemAtual = [-1, -2, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 17];
const fechadas = [
  { branchCode: 10, label: 'MOSSORO' }, { branchCode: 16, label: 'VIA SUL' },
  { branchCode: 18, label: 'TERRAZO SHOPPING' }, { branchCode: 19, label: 'MART MODA' },
];
const colunas = [...fechadas, ...ordemAtual.map(branchCode => ({ branchCode, label: 'ANTIGO' }))].reverse();

test('ordena e identifica as lojas exatamente conforme a lista solicitada', () => {
  const result = ordenarColunasRelatorioBase(colunas);
  assert.deepEqual(result.slice(0, 14).map(c => c.branchCode), ordemAtual);
  assert.deepEqual(result.slice(0, 14).map(c => c.label), [
    '02 DPA', '02 ATACADO', '01 IGUATEMI', '03 BENFICA', '04 DEL PASEO', '05 PÁTIO',
    '06 SOBRAL', '07 PARANGABA', '08 RIOMAR', '09 EXPANSÃO', '11 PK',
    '12 MESSEJANA', '13 EUSÉBIO', '17 NORTH SHOPPING',
  ]);
  assert.deepEqual(result.slice(14).map(c => c.branchCode), [10, 16, 18, 19]);
  assert.deepEqual(ordenarColunasRelatorioBase(result), result);
});

test('mantém atuais zeradas e esconde fechadas sem valores', () => {
  assert.deepEqual(selecionarColunasRelatorioBase(colunas, new Set()).map(c => c.branchCode), ordemAtual);
});

test('fechadas com valores ficam após as atuais e filtros explícitos são respeitados', () => {
  const selecionadas = colunas.filter(c => [-2, 4, 17, 10, 16].includes(c.branchCode));
  const original = selecionadas.map(c => ({ ...c }));
  const result = selecionarColunasRelatorioBase(selecionadas, new Set([16]));
  assert.deepEqual(result.map(c => c.branchCode), [-2, 4, 17, 16]);
  assert.deepEqual(selecionadas, original);
});

function fixtures() {
  function linha(sku, branch_code, estoque, venda, extra = {}) {
    return {
      product_sku: sku, product_code: sku.length * 100 + branch_code,
      reference_code: sku, reference_name: sku, product_name: sku,
      linha: 'BÁSICO', status: 'ATIVO', branch_code, estoque,
      custo_producao: 10, valor_estoque_custo_producao: estoque * 10,
      pdv_varejo: null, pdv_atacado: null, ultima_entrada: null,
      giro_30d: venda, giro_60d: venda, giro_90d: venda,
      giro_1m: venda, giro_3m: venda, giro_6m: venda,
      venda_cobertura_periodo: venda, em_producao: 0, ...extra,
    };
  }
  return [
    linha('ATUAL', 1, 10, 1),
    linha('FECHADA-ZERADA', 10, 0, 0, { giro_6m: 11 }),
    linha('SALDO-NEGATIVO', 16, -2, 0),
    linha('VENDA', 18, 0, 3),
    linha('COMPENSA-P', 19, 5, 0),
    linha('COMPENSA-M', 19, -5, 0),
  ];
}

function instalarBancoFake(t, consultar) {
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
      if (text.includes('AS possui_diario')) return [{ possui_diario: false, hoje: '2026-11-16' }];
      return consultar(text);
    },
  };
}

test('visibilidade histórica considera todos os SKUs, negativos e páginas, sem alterar totais', async (t) => {
  const snapshot = fixtures();
  let data = '2026-11-12';
  instalarBancoFake(t, text => {
    if (text.includes('information_schema.columns')) return [{ possui_marcador: true }];
    if (text.includes('to_char(data_posicao') && text.includes('LIMIT 1')) return [{ data_posicao: data }];
    if (text.includes('rb.giro_30d')) return data === '2026-11-12' ? snapshot : snapshot.map(row => ({
      ...row, estoque: row.branch_code === 1 ? 10 : 0,
      giro_30d: 0, giro_60d: 0, giro_90d: 0, giro_1m: 0, giro_3m: 0,
    }));
    if (text.includes('FROM produto_analitico a')) return snapshot;
    if (text.includes('FROM branches')) return fechadas.map(c => ({ branch_code: c.branchCode, branch_name: c.label }));
    if (text.includes('WITH venda AS')) return [];
    throw new Error(`Consulta não prevista: ${text}`);
  });
  const filtro = { dataPosicao: data, incluirComparativoAnoAnterior: false, pageSize: 1 };
  const result = await getRelatorioBase(filtro);
  assert.deepEqual(result.colunas.map(c => c.branchCode), [...ordemAtual, 16, 18, 19]);
  assert.equal(result.rows[0].branches[16].est, 0); // A venda da primeira página é de outra loja.
  assert.equal(result.kpis.estTt, 8);
  assert.equal(result.kpis.giroTt30, 4);
  assert.equal(result.kpis.giroTt6, 15); // O histórico de seis meses da loja oculta é preservado.
  const pagina2 = await getRelatorioBase({ ...filtro, page: 2 });
  assert.deepEqual(pagina2.colunas, result.colunas);
  data = '2026-11-10';
  const zeradas = await getRelatorioBase({ ...filtro, dataPosicao: data });
  assert.deepEqual(zeradas.colunas.map(c => c.branchCode), ordemAtual);
});

test('consulta ao vivo aplica a mesma ordem e mantém fechadas com saldo negativo ou venda', async (t) => {
  const snapshot = fixtures();
  const vendas = snapshot.filter(r => r.giro_30d !== 0).map(r => ({
    product_code: r.product_code, branch_code: r.branch_code, quantidade: r.giro_30d,
  }));
  instalarBancoFake(t, text => {
    if (text.includes('to_char(data_posicao') && text.includes('LIMIT 1')) return [];
    if (text.includes('FROM produto_analitico a') && text.includes('as descricao_completa')) return snapshot;
    if (text.includes('AS quantidade_estoque')) return snapshot.map(r => ({
      product_sku: r.product_sku, product_code: r.product_code,
      branch_code: r.branch_code, quantidade_estoque: r.estoque,
    }));
    if (text.includes('FROM branches')) return fechadas.map(c => ({ branch_code: c.branchCode, branch_name: c.label }));
    if (text.includes('FROM transacoes')) {
      if (text.includes('SUM(venda.quantidade)')) return [{ quantidade: 4 }];
      if (text.includes('AND t.branch_code =')) return [];
      if (text.includes('GROUP BY') && text.includes('SUM(')) return vendas;
      return [];
    }
    if (/FROM (produto_custos|produto_precos|ops_em_producao)/.test(text)) return [];
    if (text.includes('WITH venda AS')) return [];
    throw new Error(`Consulta não prevista: ${text}`);
  });
  const result = await getRelatorioBase({ dataPosicao: '2026-11-15', incluirComparativoAnoAnterior: false, pageSize: 1 });
  assert.deepEqual(result.colunas.map(c => c.branchCode), [...ordemAtual, 16, 18, 19]);
  assert.equal(result.kpis.estTt, 8);
  assert.equal(result.kpis.giroTt30, 4);
});
