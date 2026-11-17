const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Prisma, PrismaClient } = require('@prisma/client');
const database = require('../dist/config/database.js');
const { buildClientesPeriodoSql, getVendasPeriodo, calcularTotais, getClientesPeriodo } = require('../dist/services/vendas.service.js');
const prisma = new PrismaClient({ log: [] });
after(() => prisma.$disconnect());

// Dados inteiramente ficticios. Todas as tabelas sao CTEs numa transacao READ ONLY.
const fixture = Prisma.sql`WITH
  classificacao_operacoes(operation_code,operations_type,operation_mode,description) AS (
    VALUES(10,'S','4','VENDA'),(11,'E','3','DEVOLUCAO'),(12,'S','2','TRANSFERENCIA'),(14,'S','4','VENDA ATACADO')
  ),
  transacoes(branch_code,branch_name,transaction_code,customer_code,transaction_date,dt_fatura,status,operation_code) AS (
    VALUES
      (1,'LOJA A',1,100,'2026-11-10'::timestamp,NULL::timestamp,4,10),
      (1,'LOJA A',2,100,'2026-11-11',NULL,4,10),
      (3,'LOJA B',3,100,'2026-11-10',NULL,4,10),
      (1,'LOJA A',4,200,'2026-11-10',NULL,4,11),
      (1,'LOJA A',5,300,'2026-11-10',NULL,4,10),
      (1,'LOJA A',6,400,'2026-11-10',NULL,4,10),
      (2,'FABRICA',7,500,'2026-11-10',NULL,4,10),
      (2,'FABRICA',8,500,'2026-11-10',NULL,4,14),
      (2,'FABRICA',9,600,'2026-11-10',NULL,4,14),
      (1,'LOJA A',10,100,'2026-11-10',NULL,4,11),
      (1,'LOJA A',11,100,'2026-11-10',NULL,4,11),
      (1,'LOJA A',12,700,'2026-11-10',NULL,4,12),
      (1,'LOJA A',13,800,'2026-11-10',NULL,3,10),
      (1,'LOJA A',14,900,'2026-11-09','2026-11-11',4,10),
      (1,'LOJA A',15,950,'2026-11-10','2026-11-12',4,10),
      (1,'LOJA A',16,NULL,'2026-11-10',NULL,4,10)
  ),
  transacao_itens(branch_code,transaction_code,product_code,quantity,net_value,seller_code) AS (
    VALUES(1,1,1,2,100,2),(1,2,2,1,50,2),(3,3,1,1,30,2),
      (1,4,1,1,20,2),(1,5,1,1,20,1),
      (2,7,1,1,10,2),(2,8,1,1,20,2),(2,9,1,1,30,2),
      (1,10,1,-1,-5,2),(1,11,1,1,3,2),(1,12,1,100,10000,2),
      (1,13,1,1,50,2),(1,14,1,1,40,2),(1,15,1,1,50,2),
      (1,16,1,1,10,2)
  ),
  produto_analitico(product_code,class_categoria,class_genero,class_linha,class_status,class_colecao,class_tecido) AS (
    VALUES(1,'BLUSA','FEM','BASICO','ATIVO','VERAO','ALGODAO'),
      (1,'BLUSA','FEM','BASICO','ATIVO','VERAO','ALGODAO'),
      (2,'CALCA','FEM','STYLE','ATIVO','VERAO','JEANS')
  ),
  dim_cliente(idcliente,nome,nome_fantasia,telefone_principal,email_principal,cidade,uf) AS (
    VALUES(100,'Cliente Teste',NULL::text,'001199999999','teste@example.com','Fortaleza','CE'),
      (500,NULL,'Empresa Teste',NULL,NULL,NULL,NULL),
      (900,'','   ',NULL,NULL,NULL,NULL)
  )
`;

async function rowsFor(branches, filtro, dias) {
  const inicio = new Date('2026-11-10');
  const fim = new Date('2026-11-11');
  let card;
  const original = database.prisma;
  database.prisma = { $queryRaw: async (sql, ...values) => {
    card = Array.isArray(sql) ? Prisma.sql(sql, ...values) : sql;
    return [];
  } };
  try { await getVendasPeriodo(inicio, fim, branches, filtro, dias); }
  finally { database.prisma = original; }
  const lista = buildClientesPeriodoSql(inicio, fim, branches, filtro, dias);
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
    const clientes = await tx.$queryRaw`${fixture} SELECT * FROM (${lista}) consulta`;
    const porLoja = await tx.$queryRaw`${fixture} ${card}`;
    return { clientes, totalCard: porLoja.reduce((s, r) => s + Number(r.clientes), 0) };
  }, { timeout: 15000 });
}

const casos = [
  ['todas as lojas', undefined], ['uma loja', [1]], ['varias lojas', [1,3]],
  ['DPA', [2]], ['Atacado', [2.3]], ['DPA e Atacado juntos', [2,2.3]],
  ['classificacao sem multiplicar aliases', undefined, { categoria: ['BLUSA'] }],
  ['classificacoes combinadas', [1], { categoria: ['BLUSA'], genero: ['FEM'], linha: ['BASICO'], status: ['ATIVO'], colecao: ['VERAO'], tecido: ['ALGODAO'] }],
  ['dia excluido', undefined, undefined, ['2026-11-10']],
  ['sem resultados', undefined, { categoria: ['INEXISTENTE'] }],
];
for (const [nome, branches, filtro, dias] of casos) test(`Abas preservam compradores do card e segregam devolucoes: ${nome}`, async () => {
  const r = await rowsFor(branches, filtro, dias);
  assert.equal(r.clientes.filter(c => c.tipo === 'compra').length, r.totalCard);
  const devolucoes = r.clientes.filter(c => c.tipo === 'devolucao');
  const deveIncluir = !filtro?.categoria?.includes('INEXISTENTE')
    && (!branches || branches.includes(1)) && !dias?.includes('2026-11-10');
  assert.deepEqual(devolucoes.map(c => c.customer_code).sort((a,b) => a-b), deveIncluir ? [100,200] : []);
});

test('cliente com compra e devolucao aparece nas duas abas com valores independentes', async () => {
  const { clientes } = await rowsFor();
  assert.equal(clientes.length, 9);
  assert.equal(clientes.filter(c => c.customer_code === 100).length, 3);
  const c = clientes.find(c => c.customer_code === 100 && c.branch_code === 1 && c.tipo === 'compra');
  assert.equal(Number(c.movimentos), 2);
  assert.equal(Number(c.valor), 150);
  assert.equal(Number(c.pecas), 3);
  assert.equal(c.telefone, '001199999999');
  assert.equal(c.primeiro_movimento, '2026-11-10');
  assert.equal(c.ultimo_movimento, '2026-11-11');
  const d = clientes.find(c => c.customer_code === 100 && c.branch_code === 1 && c.tipo === 'devolucao');
  assert.equal(Number(d.movimentos), 2);
  assert.equal(Number(d.valor), -8);
  assert.equal(Number(d.pecas), -2);
  assert.equal(Number(c.valor) + Number(d.valor), 142);
  assert.equal(clientes.find(c => c.customer_code === 600).nome, 'Cliente 600');
  assert.equal(clientes.find(c => c.customer_code === 500).nome, 'Empresa Teste');
  assert.equal(clientes.find(c => c.customer_code === 900).nome, 'Cliente 900');
  for (const code of [300,400]) assert.equal(Number(clientes.find(c => c.customer_code === code).valor), 0);
  for (const code of [700,800,950]) assert.equal(clientes.some(c => c.customer_code === code), false);
  const devolucao = clientes.find(c => c.customer_code === 200);
  assert.equal(devolucao.tipo, 'devolucao');
  assert.equal(Number(devolucao.movimentos), 1);
  assert.equal(clientes.some(c => c.customer_code === 200 && c.tipo === 'compra'), false);
  assert.equal(Number(devolucao.valor), -20);
  assert.equal(Number(devolucao.pecas), -1);
  assert.equal(devolucao.primeiro_movimento, '2026-11-10');
  assert.equal(devolucao.ultimo_movimento, '2026-11-10');
  assert.equal(clientes.find(c => c.customer_code === 900).primeiro_movimento, '2026-11-11');
});

test('mapeamento usa nomes conhecidos, preserva contatos e delimita a transacao de leitura', async t => {
  const original = database.prisma;
  t.after(() => { database.prisma = original; });
  const comandos = [];
  database.prisma = { $transaction: async (fn, options) => {
    assert.equal(options.timeout, 35000);
    return fn({
      $executeRawUnsafe: async q => { comandos.push(q); },
      $queryRaw: async () => [{ branch_code: 2, branch_name: 'FABRICA', customer_code: 100,
        nome: 'Teste', telefone: '0011', email: null, cidade: null, uf: null,
        tipo: 'compra', movimentos: 2n, pecas: 3, valor: 150.123, primeiro_movimento: '2026-11-10', ultimo_movimento: '2026-11-11' },
        { branch_code: 2, branch_name: 'FABRICA', customer_code: 200,
          nome: 'Devolucao', telefone: null, email: null, cidade: null, uf: null,
          tipo: 'devolucao', movimentos: 1n, pecas: -1, valor: -20, primeiro_movimento: '2026-11-10', ultimo_movimento: '2026-11-10' }],
    });
  } };
  for (const [filtro, nome] of [[[2], 'DPA'], [[2.3], 'ATACADO'], [[2,2.3], 'DPA / ATACADO']]) {
    const [r, devolucao] = await getClientesPeriodo(new Date('2026-11-10'), new Date('2026-11-11'), filtro);
    assert.equal(r.loja, nome);
    assert.equal(r.tipo, 'compra');
    assert.equal(r.valor, 150.12);
    assert.equal(r.movimentos, 2);
    assert.equal(r.ticketMedio, 75.06);
    assert.equal(r.telefone, '0011');
    assert.equal(devolucao.tipo, 'devolucao');
    assert.equal(devolucao.movimentos, 1);
    assert.equal(devolucao.valor, -20);
    assert.equal(devolucao.ticketMedio, -20);
    assert.equal(devolucao.primeiroMovimento, '2026-11-10');
    assert.equal(devolucao.ultimoMovimento, '2026-11-10');
  }
  assert.match(comandos[0], /READ ONLY/);
  assert.match(comandos[1], /lock_timeout/);
});
