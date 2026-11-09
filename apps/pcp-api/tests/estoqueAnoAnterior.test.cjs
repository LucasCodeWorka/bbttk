const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Prisma, PrismaClient } = require('@prisma/client');
const { buildEstoqueAnoAnteriorSql, buildEstoqueAnoAnteriorAnaliticoSql } = require('../dist/services/relatorioBase.service.js');
const prisma = new PrismaClient({ log: [] });

// CTEs substituem as tabelas reais. ANTIGA so existe no historico; nao ha lista
// de SKUs atuais. Nenhuma tabela e criada ou alterada por estes testes.
const fixture = Prisma.sql`WITH
  produto_analitico(product_code, product_sku, product_name, reference_code, reference_name,
                    class_categoria, class_linha, class_genero, class_status, class_tipo) AS (
    VALUES
      (1, 'ATUAL', 'Blusa atual', 'REF-ATUAL', 'Blusa atual', 'BLUSA', 'BASICO', 'FEM', 'ATIVO', 'PRODUTO PROPRIO'),
      (2, 'ANTIGA', 'Blusa antiga', 'REF-ANTIGA', 'Blusa antiga', 'BLUSA', 'RENOVAVEL', 'FEM', 'FORA DE LINHA', 'PRODUTO PROPRIO'),
      (2, 'PRODUCT_CODE:2', 'Placeholder', 'REF-ERRADA', 'Placeholder', 'CALCA', 'OUTRA', 'OUTRO', 'ATIVO', 'PRODUTO PROPRIO'),
      (3, 'SEM-CUSTO', 'Acessorio', 'REF-SEM-CUSTO', 'Acessorio', 'ACESSORIO', 'OUTRA', 'OUTRO', 'ATIVO', 'PRODUTO PROPRIO'),
      (4, 'USO', 'Uso e consumo', 'REF-USO', 'Uso e consumo', 'BLUSA', 'BASICO', 'FEM', 'ATIVO', 'USO E CONSUMO'),
      (5, 'NAO-ACABADO', 'Nao acabado', 'REF-MP', 'Nao acabado', 'BLUSA', 'BASICO', 'FEM', 'ATIVO', 'PRODUTO PROPRIO'),
      (6, 'API', 'Calca', 'REF-API', 'Calca', 'CALCA', 'OUTRA', 'OUTRO', 'ATIVO', 'PRODUTO PROPRIO'),
      (1000001, 'COMPONENTE', 'Tecido', 'REF-TECIDO', 'Tecido', 'TECIDO', 'OUTRA', 'OUTRO', 'ATIVO', 'MATERIA PRIMA'),
      (1000002, 'EMBALAGEM', 'Sacola', 'REF-SACOLA', 'Sacola', 'EMBALAGEM', 'OUTRA', 'OUTRO', 'ATIVO', 'PRODUTO PROPRIO')
  ), produtos(product_sku, is_finished_product) AS (
    VALUES ('ATUAL', true), ('ANTIGA', true), ('SEM-CUSTO', NULL::boolean),
           ('USO', true), ('NAO-ACABADO', false), ('API', true), ('COMPONENTE', true), ('EMBALAGEM', true)
  ), produto_custos(product_code, branch_code, cost_code, valor) AS (
    VALUES (1, 1, 1, 10), (2, 1, 1, 20), (6, 1, 1, 3), (1000002, 1, 1, 2), (1, 2, 1, 999)
  ), dados(product_code, branch_code, stock_code, stock, saldo_date, rejection_reason) AS (
    VALUES
      (1, 9, 1, 3, '2025-11-01'::date, NULL::text),
      (1, 9, 1, 5, '2025-11-08'::date, NULL::text),
      (1, 9, 1, 999, '2025-11-09'::date, NULL::text),
      (1, 9, 1, 999, '2025-11-08'::date, 'rejeitado'),
      (1, 9, 8, -1, '2025-11-08'::date, NULL::text),
      (1, 9, 99, 2, '2025-11-08'::date, NULL::text),
      (2, 2, 1, 4, '2025-11-08'::date, NULL::text),
      (2, 2, 5, -1, '2025-11-08'::date, NULL::text),
      (2, 2, 8, 2, '2025-11-08'::date, NULL::text),
      (2, 16, 1, 5, '2025-11-08'::date, NULL::text),
      (3, 9, 1, 7, '2025-11-08'::date, NULL::text),
      (6, 19, 99, 1, '2025-11-01'::date, NULL::text),
      (4, 9, 1, 999, '2025-11-08'::date, NULL::text),
      (5, 9, 1, 999, '2025-11-08'::date, NULL::text),
      (1000001, 2, 1, 999, '2025-11-08'::date, NULL::text),
      (1000002, 9, 1, 3, '2025-11-08'::date, NULL::text)
  ), stg_saldo_virtual_csv AS (
    SELECT *, 'teste.csv'::text AS source_file, ROW_NUMBER() OVER () AS row_number,
           '2026-10-12'::timestamp AS loaded_at FROM dados
  ), prd_saldo(product_code, branch_code, stock_code, stock, captured_at, id, stock_description) AS (
    VALUES
      (1, 9, 1, 4, '2025-11-07'::timestamp, 1::bigint, 'FISICO'),
      (2, 2, 1, 99, '2025-11-08'::timestamp, 2::bigint, 'FISICO'),
      (6, 19, 99, 2, '2025-11-08 15:00'::timestamp, 3::bigint, NULL::text),
      (1, 9, 8, 999, '2025-11-08 19:00'::timestamp, 4::bigint, 'CSV Virtual')
  )`;

async function consultar(filtro = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [row] = await tx.$queryRaw`${fixture}
      SELECT * FROM (${buildEstoqueAnoAnteriorSql(filtro, '2026-11-08')}) calculo`;
    return { quantidade: Number(row.quantidade), valor: Number(row.valor) };
  });
}

const casos = [
  ['sem filtros inclui historico geral, saldos com sinal, empresas fechadas e complemento API', {}, { quantidade: 28, valor: 272 }],
  ['classificacao inclui os produtos historicos fora da posicao atual', { categoria: ['BLUSA'] }, { quantidade: 16, valor: 260 }],
  ['referencia antiga recupera todas as suas cores/tamanhos e locais', { search: 'REF-ANTIGA' }, { quantidade: 10, valor: 200 }],
  ['filtro combinado de linha, genero e status', { linha: ['RENOVAVEL'], genero: ['FEM'], status: ['FORA DE LINHA'] }, { quantidade: 10, valor: 200 }],
  ['loja soma todos os tipos de saldo com sinal', { branches: [9] }, { quantidade: 16, valor: 66 }],
  ['DPA respeita todos os saldos da Fabrica exceto 8', { branches: [-1] }, { quantidade: 3, valor: 60 }],
  ['atacado considera somente saldo 8 da Fabrica', { branches: [-2] }, { quantidade: 2, valor: 40 }],
  ['empresa Fabrica inclui DPA e atacado', { branches: [2] }, { quantidade: 5, valor: 100 }],
  ['classificacao e empresa selecionadas conjuntamente', { categoria: ['BLUSA'], branches: [16] }, { quantidade: 5, valor: 100 }],
  ['referencia inexistente retorna zero', { search: 'SEM-REFERENCIA' }, { quantidade: 0, valor: 0 }],
  ['paginacao e agrupamento por cor nao limitam o comparativo', { page: 2, pageSize: 1, agruparPorCorSalva: true }, { quantidade: 28, valor: 272 }],
];
for (const [nome, filtro, esperado] of casos) {
  test(nome, { skip: !process.env.DATABASE_URL }, async () => {
    assert.deepEqual(await consultar(filtro), esperado);
  });
}

const fixtureAnalitico = Prisma.sql`WITH pcp_relatorio_base_analitico_diario(
  data_posicao, product_sku, reference_code, reference_name, product_name,
  categoria, linha, genero, status, branch_code, estoque, estoque_ano_anterior,
  custo_producao, compoe_posicao_atual
) AS (
  VALUES
    ('2026-11-08'::date, 'ATUAL', 'REF-ATUAL', 'Atual', 'Atual', 'BLUSA', 'BASICO', 'FEM', 'ATIVO', 9, 50, 1, 10, true),
    ('2026-11-08'::date, 'ANTIGA', 'REF-ANTIGA', 'Antiga', 'Antiga', 'BLUSA', 'RENOVAVEL', 'FEM', 'FORA DE LINHA', 16, 0, 5, 20, false),
    ('2026-11-08'::date, 'ANTIGA', 'REF-ANTIGA', 'Antiga', 'Antiga', 'BLUSA', 'RENOVAVEL', 'FEM', 'FORA DE LINHA', -1, 0, -2, 20, false),
    ('2026-11-07'::date, 'LEGADO', 'REF-ATUAL', 'Legado', 'Legado', 'BLUSA', 'BASICO', 'FEM', 'ATIVO', 9, 50, 999, 1, NULL::boolean)
)`;

const casosAnaliticos = [
  ['AA analitico inclui produtos exclusivos do historico e negativos', {}, '2026-11-08', 70, true],
  ['AA analitico respeita referencia antiga e ignora paginacao', { search: 'REF-ANTIGA', page: 5, pageSize: 1 }, '2026-11-08', 60, true],
  ['AA analitico respeita empresa fechada', { branches: [16] }, '2026-11-08', 100, true],
  ['AA analitico respeita DPA e classificacao', { branches: [-1], linha: ['RENOVAVEL'] }, '2026-11-08', -40, true],
  ['AA analitico com filtro sem produtos retorna zero completo', { categoria: ['CALCA'] }, '2026-11-08', 0, true],
  ['snapshot antigo nao e aceito como AA completo', {}, '2026-11-07', 999, false],
  ['data ausente nao e aceita como AA completo', {}, '2026-11-06', 0, false],
];
for (const [nome, filtro, data, valor, completo] of casosAnaliticos) {
  test(nome, { skip: !process.env.DATABASE_URL }, async () => {
    const [row] = await prisma.$queryRaw`${fixtureAnalitico}
      SELECT * FROM (${buildEstoqueAnoAnteriorAnaliticoSql(filtro, data)}) calculo`;
    assert.equal(Number(row.valor), valor);
    assert.equal(row.completo, completo);
  });
}

test('linhas exclusivas do AA nao compoem os indicadores atuais', { skip: !process.env.DATABASE_URL }, async () => {
  const [row] = await prisma.$queryRaw`${fixtureAnalitico}
    SELECT COUNT(*)::int AS skus, SUM(estoque)::int AS estoque
    FROM pcp_relatorio_base_analitico_diario
    WHERE data_posicao = '2026-11-08' AND compoe_posicao_atual IS DISTINCT FROM false`;
  assert.deepEqual(row, { skus: 1, estoque: 50 });
});
after(async () => prisma.$disconnect());
