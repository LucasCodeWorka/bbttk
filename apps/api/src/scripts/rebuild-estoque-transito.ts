import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const SAIDA_OPS = [1510, 556];
const ENTRADA_OPS = [1003, 3];
const DPA_BRANCH_CODE = 2;
const DPA_PERSON_CODE = 110000002;
const DEFAULT_MESES = 12;

type RawMovimento = {
  transaction_date: Date;
  transaction_code: number;
  operation_code: number;
  operation_description: string | null;
  branch_code?: number;
  branch_name?: string | null;
  destino_branch_code: number;
  destino_branch_name: string | null;
  customer_code?: bigint | number | null;
  item_index: number;
  product_code: number;
  product_sku: string | null;
  reference_code: string | null;
  product_name: string | null;
  color_name: string | null;
  size: string | null;
  colecao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status_produto: string | null;
  quantity: Prisma.Decimal;
};

type SaidaAberta = RawMovimento & {
  quantidadeOriginal: number;
  quantidadeAberta: number;
  entradas: Array<{
    entrada: RawMovimento;
    quantidade: number;
  }>;
};

type LinhaTransito = {
  janelaInicio: string;
  janelaFim: string;
  statusTransito: string;
  destinoBranchCode: number;
  destinoBranchName: string | null;
  saidaBranchCode: number;
  saidaBranchName: string;
  saidaTransactionCode: number;
  saidaTransactionDate: Date;
  saidaOperationCode: number;
  saidaOperationDescription: string | null;
  saidaItemIndex: number;
  productCode: number;
  productSku: string | null;
  referenceCode: string | null;
  productName: string | null;
  colorName: string | null;
  size: string | null;
  colecao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  statusProduto: string | null;
  quantidadeSaida: number;
  quantidadeRecebida: number;
  quantidadeEmTransito: number;
  primeiraEntradaDate: Date | null;
  ultimaEntradaDate: Date | null;
  diasEmTransito: number;
};

type MovimentoBaixa = {
  saidaTransactionCode: number;
  saidaBranchCode: number;
  saidaItemIndex: number;
  entradaTransactionCode: number;
  entradaBranchCode: number;
  entradaItemIndex: number;
  entradaTransactionDate: Date;
  entradaOperationCode: number;
  quantidadeBaixada: number;
};

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getMeses(): number {
  const arg = process.argv.find((item) => item.startsWith('--meses='));
  if (!arg) return DEFAULT_MESES;
  const value = Number(arg.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MESES;
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function diffDias(inicio: Date, fim: Date): number {
  const inicioUtc = Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate());
  const fimUtc = Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate());
  return Math.max(0, Math.floor((fimUtc - inicioUtc) / 86_400_000));
}

function statusTransito(quantidadeEmTransito: number, quantidadeRecebida: number): string {
  if (quantidadeEmTransito <= 0.0001) return 'recebido';
  if (quantidadeRecebida > 0.0001) return 'parcial';
  return 'em_transito';
}

async function ensureTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pcp_estoque_transito (
      id BIGSERIAL PRIMARY KEY,
      snapshot_at TIMESTAMP NOT NULL DEFAULT now(),
      janela_inicio DATE NOT NULL,
      janela_fim DATE NOT NULL,
      status_transito VARCHAR(20) NOT NULL,
      destino_branch_code INTEGER NOT NULL,
      destino_branch_name VARCHAR(100),
      saida_branch_code INTEGER NOT NULL,
      saida_branch_name VARCHAR(100) NOT NULL,
      saida_transaction_code INTEGER NOT NULL,
      saida_transaction_date DATE NOT NULL,
      saida_operation_code INTEGER NOT NULL,
      saida_operation_description VARCHAR(255),
      saida_item_index INTEGER NOT NULL,
      product_code INTEGER NOT NULL,
      product_sku VARCHAR(50),
      reference_code VARCHAR(100),
      product_name VARCHAR(255),
      color_name VARCHAR(100),
      size VARCHAR(20),
      colecao VARCHAR(255),
      categoria VARCHAR(255),
      linha VARCHAR(255),
      genero VARCHAR(255),
      status_produto VARCHAR(255),
      quantidade_saida NUMERIC(15,4) NOT NULL,
      quantidade_recebida NUMERIC(15,4) NOT NULL,
      quantidade_em_transito NUMERIC(15,4) NOT NULL,
      primeira_entrada_date DATE,
      ultima_entrada_date DATE,
      dias_em_transito INTEGER NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pcp_estoque_transito_movimentos (
      id BIGSERIAL PRIMARY KEY,
      snapshot_at TIMESTAMP NOT NULL DEFAULT now(),
      saida_branch_code INTEGER NOT NULL,
      saida_transaction_code INTEGER NOT NULL,
      saida_item_index INTEGER NOT NULL,
      entrada_branch_code INTEGER NOT NULL,
      entrada_transaction_code INTEGER NOT NULL,
      entrada_item_index INTEGER NOT NULL,
      entrada_transaction_date DATE NOT NULL,
      entrada_operation_code INTEGER NOT NULL,
      quantidade_baixada NUMERIC(15,4) NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_status ON pcp_estoque_transito (status_transito)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_destino ON pcp_estoque_transito (destino_branch_code)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_saida_data ON pcp_estoque_transito (saida_transaction_date)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_product ON pcp_estoque_transito (product_code)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_ref ON pcp_estoque_transito (reference_code)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_mov_saida ON pcp_estoque_transito_movimentos (saida_branch_code, saida_transaction_code, saida_item_index)`);
}

async function getSaidas(meses: number): Promise<RawMovimento[]> {
  return prisma.$queryRaw<RawMovimento[]>`
    SELECT
      t.transaction_date,
      t.transaction_code,
      t.operation_code,
      co.description AS operation_description,
      t.branch_code,
      t.branch_name,
      b.branch_code AS destino_branch_code,
      b.branch_name AS destino_branch_name,
      t.customer_code,
      ti.item_index,
      ti.product_code,
      p.product_sku,
      p.reference_code,
      p.product_name,
      p.color_name,
      p.size,
      pa.class_colecao AS colecao,
      pa.class_categoria AS categoria,
      pa.class_linha AS linha,
      pa.class_genero AS genero,
      pa.class_status AS status_produto,
      ti.quantity
    FROM transacoes t
    JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
    JOIN branches b ON b.person_code = t.customer_code AND b.branch_code <> ${DPA_BRANCH_CODE}
    JOIN transacao_itens ti ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
    LEFT JOIN produtos p ON p.product_code = ti.product_code
    LEFT JOIN produto_analitico pa ON pa.product_sku = p.product_sku
    WHERE t.branch_code = ${DPA_BRANCH_CODE}
      AND t.status = 4
      AND t.operation_code IN (${Prisma.join(SAIDA_OPS)})
      AND t.transaction_date >= current_date - (${meses}::text || ' months')::interval
      AND COALESCE(ti.quantity, 0) > 0
    ORDER BY b.branch_code, ti.product_code, t.transaction_date, t.transaction_code, ti.item_index
  `;
}

async function getEntradas(meses: number): Promise<RawMovimento[]> {
  return prisma.$queryRaw<RawMovimento[]>`
    SELECT
      t.transaction_date,
      t.transaction_code,
      t.operation_code,
      co.description AS operation_description,
      t.branch_code,
      t.branch_name,
      t.branch_code AS destino_branch_code,
      t.branch_name AS destino_branch_name,
      t.customer_code,
      ti.item_index,
      ti.product_code,
      p.product_sku,
      p.reference_code,
      p.product_name,
      p.color_name,
      p.size,
      pa.class_colecao AS colecao,
      pa.class_categoria AS categoria,
      pa.class_linha AS linha,
      pa.class_genero AS genero,
      pa.class_status AS status_produto,
      ti.quantity
    FROM transacoes t
    JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
    JOIN transacao_itens ti ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
    LEFT JOIN produtos p ON p.product_code = ti.product_code
    LEFT JOIN produto_analitico pa ON pa.product_sku = p.product_sku
    WHERE t.branch_code <> ${DPA_BRANCH_CODE}
      AND t.customer_code = ${DPA_PERSON_CODE}
      AND t.status = 4
      AND t.operation_code IN (${Prisma.join(ENTRADA_OPS)})
      AND t.transaction_date >= current_date - (${meses}::text || ' months')::interval
      AND COALESCE(ti.quantity, 0) > 0
    ORDER BY t.branch_code, ti.product_code, t.transaction_date, t.transaction_code, ti.item_index
  `;
}

function calcular(saidas: RawMovimento[], entradas: RawMovimento[], janelaInicio: string, janelaFim: string): { linhas: LinhaTransito[]; movimentos: MovimentoBaixa[] } {
  const filas = new Map<string, SaidaAberta[]>();
  const hoje = new Date(`${janelaFim}T00:00:00.000Z`);

  const key = (destinoBranchCode: number, productCode: number) => `${destinoBranchCode}|${productCode}`;

  for (const saida of saidas) {
    const quantidade = toNumber(saida.quantity);
    const k = key(saida.destino_branch_code, saida.product_code);
    const fila = filas.get(k) || [];
    fila.push({ ...saida, quantidadeOriginal: quantidade, quantidadeAberta: quantidade, entradas: [] });
    filas.set(k, fila);
  }

  for (const entrada of entradas) {
    let restante = toNumber(entrada.quantity);
    const fila = filas.get(key(entrada.destino_branch_code, entrada.product_code));
    if (!fila || restante <= 0) continue;

    for (const saida of fila) {
      if (restante <= 0) break;
      if (entrada.transaction_date < saida.transaction_date) continue;
      if (saida.quantidadeAberta <= 0.0001) continue;

      const baixa = Math.min(saida.quantidadeAberta, restante);
      saida.quantidadeAberta -= baixa;
      restante -= baixa;
      saida.entradas.push({ entrada, quantidade: baixa });
    }
  }

  const linhas: LinhaTransito[] = [];
  const movimentos: MovimentoBaixa[] = [];

  for (const fila of filas.values()) {
    for (const saida of fila) {
      const quantidadeRecebida = saida.quantidadeOriginal - saida.quantidadeAberta;
      const entradaDates = saida.entradas.map((item) => item.entrada.transaction_date).sort((a, b) => a.getTime() - b.getTime());
      const primeiraEntrada = entradaDates[0] || null;
      const ultimaEntrada = entradaDates[entradaDates.length - 1] || null;

      linhas.push({
        janelaInicio,
        janelaFim,
        statusTransito: statusTransito(saida.quantidadeAberta, quantidadeRecebida),
        destinoBranchCode: saida.destino_branch_code,
        destinoBranchName: saida.destino_branch_name,
        saidaBranchCode: DPA_BRANCH_CODE,
        saidaBranchName: 'FABRICA',
        saidaTransactionCode: saida.transaction_code,
        saidaTransactionDate: saida.transaction_date,
        saidaOperationCode: saida.operation_code,
        saidaOperationDescription: saida.operation_description,
        saidaItemIndex: saida.item_index,
        productCode: saida.product_code,
        productSku: saida.product_sku,
        referenceCode: saida.reference_code,
        productName: saida.product_name,
        colorName: saida.color_name,
        size: saida.size,
        colecao: saida.colecao,
        categoria: saida.categoria,
        linha: saida.linha,
        genero: saida.genero,
        statusProduto: saida.status_produto,
        quantidadeSaida: saida.quantidadeOriginal,
        quantidadeRecebida,
        quantidadeEmTransito: Math.max(saida.quantidadeAberta, 0),
        primeiraEntradaDate: primeiraEntrada,
        ultimaEntradaDate: ultimaEntrada,
        diasEmTransito: diffDias(saida.transaction_date, hoje),
      });

      for (const baixa of saida.entradas) {
        movimentos.push({
          saidaBranchCode: DPA_BRANCH_CODE,
          saidaTransactionCode: saida.transaction_code,
          saidaItemIndex: saida.item_index,
          entradaBranchCode: baixa.entrada.destino_branch_code,
          entradaTransactionCode: baixa.entrada.transaction_code,
          entradaItemIndex: baixa.entrada.item_index,
          entradaTransactionDate: baixa.entrada.transaction_date,
          entradaOperationCode: baixa.entrada.operation_code,
          quantidadeBaixada: baixa.quantidade,
        });
      }
    }
  }

  return { linhas, movimentos };
}

async function insertLinhas(linhas: LinhaTransito[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    await prisma.$executeRaw`
      INSERT INTO pcp_estoque_transito (
        snapshot_at, janela_inicio, janela_fim, status_transito,
        destino_branch_code, destino_branch_name, saida_branch_code, saida_branch_name,
        saida_transaction_code, saida_transaction_date, saida_operation_code, saida_operation_description, saida_item_index,
        product_code, product_sku, reference_code, product_name, color_name, size,
        colecao, categoria, linha, genero, status_produto,
        quantidade_saida, quantidade_recebida, quantidade_em_transito,
        primeira_entrada_date, ultima_entrada_date, dias_em_transito, updated_at
      )
      VALUES ${Prisma.join(lote.map((l) => Prisma.sql`(
        now(), ${l.janelaInicio}::date, ${l.janelaFim}::date, ${l.statusTransito},
        ${l.destinoBranchCode}, ${l.destinoBranchName}, ${l.saidaBranchCode}, ${l.saidaBranchName},
        ${l.saidaTransactionCode}, ${toDateOnly(l.saidaTransactionDate)}::date, ${l.saidaOperationCode}, ${l.saidaOperationDescription}, ${l.saidaItemIndex},
        ${l.productCode}, ${l.productSku}, ${l.referenceCode}, ${l.productName}, ${l.colorName}, ${l.size},
        ${l.colecao}, ${l.categoria}, ${l.linha}, ${l.genero}, ${l.statusProduto},
        ${l.quantidadeSaida}, ${l.quantidadeRecebida}, ${l.quantidadeEmTransito},
        ${l.primeiraEntradaDate ? toDateOnly(l.primeiraEntradaDate) : null}::date,
        ${l.ultimaEntradaDate ? toDateOnly(l.ultimaEntradaDate) : null}::date,
        ${l.diasEmTransito}, now()
      )`))}
    `;
  }
}

async function insertMovimentos(movimentos: MovimentoBaixa[]): Promise<void> {
  for (let i = 0; i < movimentos.length; i += 500) {
    const lote = movimentos.slice(i, i + 500);
    await prisma.$executeRaw`
      INSERT INTO pcp_estoque_transito_movimentos (
        snapshot_at, saida_branch_code, saida_transaction_code, saida_item_index,
        entrada_branch_code, entrada_transaction_code, entrada_item_index,
        entrada_transaction_date, entrada_operation_code, quantidade_baixada
      )
      VALUES ${Prisma.join(lote.map((m) => Prisma.sql`(
        now(), ${m.saidaBranchCode}, ${m.saidaTransactionCode}, ${m.saidaItemIndex},
        ${m.entradaBranchCode}, ${m.entradaTransactionCode}, ${m.entradaItemIndex},
        ${toDateOnly(m.entradaTransactionDate)}::date, ${m.entradaOperationCode}, ${m.quantidadeBaixada}
      )`))}
    `;
  }
}

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const meses = getMeses();

  const [{ inicio, fim }] = await prisma.$queryRaw<Array<{ inicio: Date; fim: Date }>>`
    SELECT (current_date - (${meses}::text || ' months')::interval)::date AS inicio, current_date::date AS fim
  `;
  const janelaInicio = toDateOnly(inicio);
  const janelaFim = toDateOnly(fim);

  const [saidas, entradas] = await Promise.all([getSaidas(meses), getEntradas(meses)]);
  const { linhas, movimentos } = calcular(saidas, entradas, janelaInicio, janelaFim);
  const abertas = linhas.filter((linha) => linha.quantidadeEmTransito > 0.0001);

  const resumo = {
    modo: apply ? 'apply' : 'dry-run',
    janelaInicio,
    janelaFim,
    meses,
    saidasLinhas: saidas.length,
    entradasLinhas: entradas.length,
    linhasMaterializadas: linhas.length,
    movimentosBaixa: movimentos.length,
    pecasSaida: linhas.reduce((total, linha) => total + linha.quantidadeSaida, 0),
    pecasRecebidas: linhas.reduce((total, linha) => total + linha.quantidadeRecebida, 0),
    pecasEmTransito: abertas.reduce((total, linha) => total + linha.quantidadeEmTransito, 0),
    documentosPendentes: new Set(abertas.map((linha) => linha.saidaTransactionCode)).size,
    lojasPendentes: new Set(abertas.map((linha) => linha.destinoBranchCode)).size,
  };

  console.log(JSON.stringify(resumo, null, 2));

  if (!apply) return;

  await ensureTables();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('TRUNCATE TABLE pcp_estoque_transito_movimentos');
    await tx.$executeRawUnsafe('TRUNCATE TABLE pcp_estoque_transito RESTART IDENTITY');
  });

  await insertLinhas(linhas);
  await insertMovimentos(movimentos);
  console.log('[estoque-transito] materializacao concluida');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
