import assert from 'node:assert/strict';
import test from 'node:test';
import type { SugestaoProducaoRow } from '../src/lib/pcpApi';
import {
  METRICAS_SUGESTAO, folhasSugestaoProducao, linhasVisiveisSugestaoProducao,
  montarMatrizSugestaoProducao, somarMetricasSugestao,
} from '../src/lib/sugestaoProducaoMatriz';

function sku(overrides: Partial<SugestaoProducaoRow> = {}): SugestaoProducaoRow {
  return {
    sku: 'REF-A-AZUL-M', productCode: 1, referenceCode: 'REF-A', referenceName: 'Blusa A',
    descricao: 'Blusa A azul M', cor: 'Azul claro', corCodigo: '101', corAgrupada: 'AZUL',
    tamanho: 'M', categoria: 'BLUSA', linha: 'BÁSICO', genero: 'FEMININO', status: 'ATIVO',
    estoqueAtual: -1, emProducao: 2, estoqueFuturo: 1, vendaPeriodoAtual: 7,
    vendaPeriodoAnterior: 4, vendaMediaMensal: 2.33, estoqueMinimo: 7,
    corteMinimo: 10, sugestaoProducao: 10, ...overrides,
  };
}

const rows = [
  sku(),
  sku({ sku: 'REF-A-AZUL2-M', productCode: 2, cor: 'Azul escuro', corCodigo: '102',
    estoqueAtual: 20, emProducao: 3, estoqueFuturo: 23, vendaPeriodoAtual: 5,
    vendaPeriodoAnterior: 2, vendaMediaMensal: 1.67, estoqueMinimo: 5,
    corteMinimo: 6, sugestaoProducao: 0 }),
  sku({ sku: 'REF-A-VERDE-P', productCode: 3, cor: 'Verde', corCodigo: '201', corAgrupada: null, tamanho: 'P' }),
  sku({ sku: 'REF-B-AZUL-M', productCode: 4, referenceCode: 'REF-B', referenceName: 'Blusa B' }),
];

test('a matriz agrupa por referência, cor e tamanho sem recalcular a sugestão de cada SKU', () => {
  const padrao = montarMatrizSugestaoProducao(rows, 'padrao', 'referenceCode', 'asc');
  const agrupada = montarMatrizSugestaoProducao(rows, 'agrupada', 'referenceCode', 'asc');
  assert.equal(padrao.length, 2);
  assert.equal(padrao[0].children.length, 3);
  assert.equal(agrupada[0].children.length, 2);
  const azul = agrupada[0].children.find((cor) => cor.label === 'AZUL')!;
  assert.equal(azul.children.length, 1);
  assert.equal(azul.estoqueAtual, 19); // mantém o saldo negativo de um dos SKUs
  assert.equal(azul.estoqueFuturo, 24);
  assert.equal(azul.estoqueMinimo, 12);
  assert.equal(azul.sugestaoProducao, 10); // o excedente do outro SKU não cancela a necessidade
  assert.equal(azul.corteMinimo, null);
  assert.deepEqual(azul.cortesMinimos, [6, 10]);
  assert.deepEqual(azul.productCodes, [1, 2]);
  assert.equal(azul.children[0].skus.length, 2);
  assert.equal(agrupada[1].children[0].productCodes.length, 1); // não mistura referências
  assert.equal(agrupada[0].children.find((cor) => cor.label === 'Verde')?.children[0].tamanho, 'P');
});

test('os subtotais e as folhas para exportação conservam todas as métricas nos dois modos', () => {
  const totais = somarMetricasSugestao(rows);
  for (const modo of ['padrao', 'agrupada'] as const) {
    const matriz = montarMatrizSugestaoProducao(rows, modo);
    const folhas = folhasSugestaoProducao(matriz);
    assert.equal(new Set(folhas.flatMap((no) => no.skus)).size, rows.length);
    for (const metrica of METRICAS_SUGESTAO) {
      const sum = (nos: typeof folhas) => Math.round(nos.reduce((total, no) => total + no[metrica], 0) * 100) / 100;
      assert.equal(sum(matriz), totais[metrica], `${modo}: subtotal ${metrica}`);
      assert.equal(sum(folhas), totais[metrica], `${modo}: exportação ${metrica}`);
    }
  }
});

test('cor padrão distingue códigos diferentes e os tamanhos seguem a ordem da grade', () => {
  const matriz = montarMatrizSugestaoProducao([
    sku({ cor: 'Azul', tamanho: '10' }),
    sku({ sku: 's2', cor: 'Azul', tamanho: '2' }),
    sku({ sku: 's3', cor: 'Azul', tamanho: 'P' }),
    sku({ sku: 's4', cor: 'Azul', tamanho: 'M' }),
    sku({ sku: 's5', cor: 'Azul', corCodigo: '102', tamanho: 'M' }),
  ], 'padrao');
  assert.equal(matriz[0].children.length, 2);
  const cor = matriz[0].children.find((no) => no.skus.length === 4)!;
  assert.deepEqual(cor.children.map((no) => no.label), ['P', 'M', '2', '10']);
  assert.equal(cor.corteMinimo, 10);
});

test('expandir e recolher mantém a hierarquia e a referência aberta ao alternar cores', () => {
  const matriz = montarMatrizSugestaoProducao(rows, 'padrao');
  const ref = matriz[0];
  assert.deepEqual(linhasVisiveisSugestaoProducao(matriz, new Set()), matriz);
  const abertos = new Set([ref.key]);
  assert.equal(linhasVisiveisSugestaoProducao(matriz, abertos).length, matriz.length + ref.children.length);
  abertos.add(ref.children[0].key);
  assert.equal(linhasVisiveisSugestaoProducao(matriz, abertos).length, matriz.length + ref.children.length + ref.children[0].children.length);
  const agrupada = montarMatrizSugestaoProducao(rows, 'agrupada');
  assert.equal(agrupada[0].key, ref.key);
  assert.equal(linhasVisiveisSugestaoProducao(agrupada, abertos).length, agrupada.length + agrupada[0].children.length);
});

test('ordena referências pelos subtotais e aceita resultado vazio', () => {
  assert.deepEqual(montarMatrizSugestaoProducao([], 'padrao'), []);
  assert.equal(somarMetricasSugestao([]).sugestaoProducao, 0);
  assert.equal(somarMetricasSugestao([]).corteMinimo, null);
  assert.deepEqual(montarMatrizSugestaoProducao(rows, 'padrao', 'sugestaoProducao', 'desc').map((no) => no.label), ['REF-A', 'REF-B']);
  assert.deepEqual(montarMatrizSugestaoProducao(rows, 'agrupada', 'sugestaoProducao', 'asc').map((no) => no.label), ['REF-B', 'REF-A']);
});
