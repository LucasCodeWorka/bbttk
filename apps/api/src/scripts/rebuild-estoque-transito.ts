import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const SAIDA_OPS = [1510, 556];
const ENTRADA_OPS = [1003, 3];
const DPA_BRANCH_CODE = 2;
const DPA_PERSON_CODE = 110000002;
const DEFAULT_MESES = 12;

// Como a baixa de cada linha foi determinada:
// - 'vinculo': o proprio TOTVS diz qual documento de entrada recebeu esta saida
//   (`transacoes.origin_destination`). E fato, nao estimativa.
// - 'fifo': nao ha vinculo (o campo so passou a ser preenchido em 25/06/2026), entao a
//   baixa e aproximada por fila FIFO em (loja destino, product_code).
type MetodoBaixa = 'vinculo' | 'fifo';

type RawSaida = {
  transaction_date: Date;
  transaction_code: number;
  operation_code: number;
  operation_description: string | null;
  destino_branch_code: number | null;
  destino_branch_name: string | null;
  origin_destination: string | null;
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

type RawEntrada = {
  transaction_date: Date;
  transaction_code: number;
  branch_code: number;
  branch_name: string | null;
  operation_code: number;
  customer_code: bigint | number | null;
  item_index: number;
  product_code: number;
  quantity: Prisma.Decimal;
};

type EntradaItem = RawEntrada & { restante: number; elegivelFifo: boolean };

type SaidaItem = RawSaida & {
  destinoBranchCode: number;
  destinoBranchName: string | null;
  destinos: Array<{ branch: number; transaction: number }>;
  temVinculo: boolean;
  quantidadeOriginal: number;
  quantidadeAberta: number;
  metodos: Set<MetodoBaixa>;
  entradasCasadas: Array<{ entrada: EntradaItem; quantidade: number; metodo: MetodoBaixa }>;
};

type LinhaTransito = {
  janelaInicio: string;
  janelaFim: string;
  statusTransito: string;
  metodoBaixa: string | null;
  temVinculo: boolean;
  entradaDocs: string | null;
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
  metodo: MetodoBaixa;
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

// `origin_destination` vem do TOTVS em dois formatos. O comum e a lista achatada
// `[[branch, transaction]]`, que para um documento de SAIDA e o `destination` -
// o(s) documento(s) de entrada que receberam a mercadoria. O outro e o objeto
// completo `{branchCodeOrigin, transactionCodeOrigin, destination:[{...}]}`, onde
// `origin` e quem mandou (preenchido no lado da entrada) e `destination` quem
// recebeu. Os dois sao tratados; para saida interessa sempre o destino.
function parseDestinos(raw: string | null): Array<{ branch: number; transaction: number }> {
  if (!raw) return [];
  const texto = raw.trim();
  if (!texto || texto === '[]') return [];

  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return [];
  }

  const normalizar = (branch: unknown, transaction: unknown) => {
    const b = Number(branch);
    const c = Number(transaction);
    return Number.isFinite(b) && Number.isFinite(c) ? { branch: b, transaction: c } : null;
  };

  if (Array.isArray(json)) {
    return json
      .map((par) => (Array.isArray(par) ? normalizar(par[0], par[1]) : null))
      .filter((par): par is { branch: number; transaction: number } => par !== null);
  }

  if (json && typeof json === 'object') {
    const destino = (json as { destination?: unknown }).destination;
    if (Array.isArray(destino)) {
      return destino
        .map((item) => {
          const d = item as { branchCodeDestination?: unknown; transactionCodeDestination?: unknown };
          return normalizar(d.branchCodeDestination, d.transactionCodeDestination);
        })
        .filter((par): par is { branch: number; transaction: number } => par !== null);
    }
  }

  return [];
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

  // Colunas da reestruturacao de 13/10/2026 (casamento por vinculo do TOTVS). Usa
  // ADD COLUMN IF NOT EXISTS pra tabela que ja existe em banco nao precisar ser dropada.
  await prisma.$executeRawUnsafe(`ALTER TABLE pcp_estoque_transito ADD COLUMN IF NOT EXISTS metodo_baixa VARCHAR(10)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE pcp_estoque_transito ADD COLUMN IF NOT EXISTS tem_vinculo BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE pcp_estoque_transito ADD COLUMN IF NOT EXISTS entrada_docs VARCHAR(255)`);

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
  await prisma.$executeRawUnsafe(`ALTER TABLE pcp_estoque_transito_movimentos ADD COLUMN IF NOT EXISTS metodo VARCHAR(10)`);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_status ON pcp_estoque_transito (status_transito)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_destino ON pcp_estoque_transito (destino_branch_code)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_saida_data ON pcp_estoque_transito (saida_transaction_date)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_product ON pcp_estoque_transito (product_code)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_ref ON pcp_estoque_transito (reference_code)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_metodo ON pcp_estoque_transito (metodo_baixa)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pcp_estoque_transito_mov_saida ON pcp_estoque_transito_movimentos (saida_branch_code, saida_transaction_code, saida_item_index)`);
}

// A filial de destino continua vindo de `branches.person_code = customer_code` como
// fallback: o vinculo so existe de 25/06/2026 em diante. Onde os dois existem eles
// concordam em 100% dos casos (medido), entao o fallback e seguro pro periodo antigo.
async function getSaidas(meses: number): Promise<RawSaida[]> {
  return prisma.$queryRaw<RawSaida[]>`
    SELECT
      t.transaction_date,
      t.transaction_code,
      t.operation_code,
      co.description AS operation_description,
      b.branch_code AS destino_branch_code,
      b.branch_name AS destino_branch_name,
      t.origin_destination,
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
    LEFT JOIN branches b ON b.person_code = t.customer_code AND b.branch_code <> ${DPA_BRANCH_CODE}
    JOIN transacao_itens ti ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
    LEFT JOIN produtos p ON p.product_code = ti.product_code
    LEFT JOIN produto_analitico pa ON pa.product_sku = p.product_sku
    WHERE t.branch_code = ${DPA_BRANCH_CODE}
      AND t.status = 4
      AND t.operation_code IN (${Prisma.join(SAIDA_OPS)})
      AND t.transaction_date >= current_date - (${meses}::text || ' months')::interval
      AND COALESCE(ti.quantity, 0) > 0
    ORDER BY t.transaction_date, t.transaction_code, ti.item_index
  `;
}

// Carrega dois universos de entrada de uma vez, como OS MESMOS objetos, pra que o
// consumo de saldo seja compartilhado entre as duas fases do casamento:
//  - conjunto FIFO (estreito: ops de entrada de transferencia vindas da Fabrica);
//  - documentos explicitamente referenciados por algum vinculo de saida, sem filtro de
//    operacao - o vinculo e a autoridade, nao precisa de heuristica por codigo.
async function getEntradas(meses: number): Promise<RawEntrada[]> {
  return prisma.$queryRaw<RawEntrada[]>`
    WITH vinculadas AS (
      SELECT DISTINCT (par->>0)::int AS branch_code, (par->>1)::int AS transaction_code
      FROM transacoes t
      CROSS JOIN LATERAL jsonb_array_elements(t.origin_destination::jsonb) AS par
      WHERE t.branch_code = ${DPA_BRANCH_CODE}
        AND t.status = 4
        AND t.operation_code IN (${Prisma.join(SAIDA_OPS)})
        AND t.transaction_date >= current_date - (${meses}::text || ' months')::interval
        AND t.origin_destination ~ '^\\[\\['
        AND jsonb_typeof(par) = 'array'
    )
    SELECT
      t.transaction_date,
      t.transaction_code,
      t.branch_code,
      t.branch_name,
      t.operation_code,
      t.customer_code,
      ti.item_index,
      ti.product_code,
      ti.quantity
    FROM transacoes t
    JOIN transacao_itens ti ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
    WHERE t.status = 4
      AND t.branch_code <> ${DPA_BRANCH_CODE}
      AND t.transaction_date >= current_date - (${meses}::text || ' months')::interval
      AND COALESCE(ti.quantity, 0) > 0
      AND (
        (t.customer_code = ${DPA_PERSON_CODE} AND t.operation_code IN (${Prisma.join(ENTRADA_OPS)}))
        OR EXISTS (SELECT 1 FROM vinculadas v WHERE v.branch_code = t.branch_code AND v.transaction_code = t.transaction_code)
      )
    ORDER BY t.transaction_date, t.branch_code, t.transaction_code, ti.item_index
  `;
}

function calcular(
  saidasRaw: RawSaida[],
  entradasRaw: RawEntrada[],
  janelaInicio: string,
  janelaFim: string
): { linhas: LinhaTransito[]; movimentos: MovimentoBaixa[]; descartadas: number } {
  const hoje = new Date(`${janelaFim}T00:00:00.000Z`);

  const entradas: EntradaItem[] = entradasRaw.map((item) => ({
    ...item,
    restante: toNumber(item.quantity),
    elegivelFifo:
      ENTRADA_OPS.includes(item.operation_code) && Number(item.customer_code ?? 0) === DPA_PERSON_CODE,
  }));

  // Indice por documento (usado pelo vinculo) e por par loja+produto (usado pelo FIFO).
  const porDocumento = new Map<string, EntradaItem[]>();
  const porParFifo = new Map<string, EntradaItem[]>();
  for (const entrada of entradas) {
    const chaveDoc = `${entrada.branch_code}|${entrada.transaction_code}`;
    const doc = porDocumento.get(chaveDoc);
    if (doc) doc.push(entrada);
    else porDocumento.set(chaveDoc, [entrada]);

    if (entrada.elegivelFifo) {
      const chavePar = `${entrada.branch_code}|${entrada.product_code}`;
      const par = porParFifo.get(chavePar);
      if (par) par.push(entrada);
      else porParFifo.set(chavePar, [entrada]);
    }
  }

  const saidas: SaidaItem[] = [];
  let descartadas = 0;

  for (const raw of saidasRaw) {
    const destinos = parseDestinos(raw.origin_destination);
    const branchesVinculo = Array.from(new Set(destinos.map((d) => d.branch)));

    // O vinculo e preferido pra definir o destino; `customer_code` entra quando nao ha
    // vinculo (periodo antigo) ou quando o vinculo aponta pra mais de uma filial.
    const destinoBranchCode =
      branchesVinculo.length === 1 ? branchesVinculo[0] : raw.destino_branch_code ?? null;

    if (destinoBranchCode === null || destinoBranchCode === DPA_BRANCH_CODE) {
      descartadas += 1;
      continue;
    }

    const quantidade = toNumber(raw.quantity);
    saidas.push({
      ...raw,
      destinoBranchCode,
      destinoBranchName: raw.destino_branch_name,
      destinos,
      temVinculo: destinos.length > 0,
      quantidadeOriginal: quantidade,
      quantidadeAberta: quantidade,
      metodos: new Set<MetodoBaixa>(),
      entradasCasadas: [],
    });
  }

  function abater(saida: SaidaItem, entrada: EntradaItem, metodo: MetodoBaixa): void {
    const baixa = Math.min(saida.quantidadeAberta, entrada.restante);
    if (baixa <= 0.0001) return;
    saida.quantidadeAberta -= baixa;
    entrada.restante -= baixa;
    saida.metodos.add(metodo);
    saida.entradasCasadas.push({ entrada, quantidade: baixa, metodo });
  }

  // FASE 1 - vinculo. O TOTVS diz qual documento recebeu; dentro do par de documentos
  // basta casar pelo product_code. Roda ANTES do FIFO pra que uma entrada explicitamente
  // vinculada nunca seja "roubada" por uma aproximacao de outro documento.
  for (const saida of saidas) {
    if (!saida.temVinculo) continue;
    for (const destino of saida.destinos) {
      if (saida.quantidadeAberta <= 0.0001) break;
      const itens = porDocumento.get(`${destino.branch}|${destino.transaction}`);
      if (!itens) continue;
      for (const entrada of itens) {
        if (saida.quantidadeAberta <= 0.0001) break;
        if (entrada.product_code !== saida.product_code || entrada.restante <= 0.0001) continue;
        abater(saida, entrada, 'vinculo');
      }
    }
  }

  // FASE 2 - FIFO, so pras saidas SEM vinculo. Saida que tem vinculo e nao foi baixada
  // por ele fica aberta de proposito: o TOTVS ja afirmou o que foi recebido, completar
  // com aproximacao seria apagar a evidencia.
  for (const saida of saidas) {
    if (saida.temVinculo || saida.quantidadeAberta <= 0.0001) continue;
    const fila = porParFifo.get(`${saida.destinoBranchCode}|${saida.product_code}`);
    if (!fila) continue;
    for (const entrada of fila) {
      if (saida.quantidadeAberta <= 0.0001) break;
      if (entrada.restante <= 0.0001) continue;
      if (entrada.transaction_date < saida.transaction_date) continue;
      abater(saida, entrada, 'fifo');
    }
  }

  const linhas: LinhaTransito[] = [];
  const movimentos: MovimentoBaixa[] = [];

  for (const saida of saidas) {
    const quantidadeRecebida = saida.quantidadeOriginal - saida.quantidadeAberta;
    const datas = saida.entradasCasadas
      .map((item) => item.entrada.transaction_date)
      .sort((a, b) => a.getTime() - b.getTime());

    const metodoBaixa = saida.metodos.size === 0 ? null : saida.metodos.size > 1 ? 'misto' : Array.from(saida.metodos)[0];

    // Documentos de entrada que o TOTVS aponta - e o atalho do auditor pra abrir a nota
    // no ERP. So faz sentido quando ha vinculo; no FIFO o documento e inferido.
    const entradaDocs = saida.temVinculo
      ? Array.from(new Set(saida.destinos.map((d) => `${d.branch}/${d.transaction}`))).join(', ').slice(0, 255)
      : null;

    // O nome da filial pode nao ter vindo do fallback de customer_code; nesse caso cai
    // pro nome que veio do proprio documento de entrada vinculado.
    const nomeDestino =
      saida.destinoBranchName ||
      saida.entradasCasadas.find((item) => item.entrada.branch_code === saida.destinoBranchCode)?.entrada.branch_name ||
      null;

    linhas.push({
      janelaInicio,
      janelaFim,
      statusTransito: statusTransito(saida.quantidadeAberta, quantidadeRecebida),
      metodoBaixa,
      temVinculo: saida.temVinculo,
      entradaDocs,
      destinoBranchCode: saida.destinoBranchCode,
      destinoBranchName: nomeDestino,
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
      primeiraEntradaDate: datas[0] || null,
      ultimaEntradaDate: datas[datas.length - 1] || null,
      diasEmTransito: diffDias(saida.transaction_date, hoje),
    });

    for (const baixa of saida.entradasCasadas) {
      movimentos.push({
        saidaBranchCode: DPA_BRANCH_CODE,
        saidaTransactionCode: saida.transaction_code,
        saidaItemIndex: saida.item_index,
        entradaBranchCode: baixa.entrada.branch_code,
        entradaTransactionCode: baixa.entrada.transaction_code,
        entradaItemIndex: baixa.entrada.item_index,
        entradaTransactionDate: baixa.entrada.transaction_date,
        entradaOperationCode: baixa.entrada.operation_code,
        quantidadeBaixada: baixa.quantidade,
        metodo: baixa.metodo,
      });
    }
  }

  return { linhas, movimentos, descartadas };
}

async function insertLinhas(linhas: LinhaTransito[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    await prisma.$executeRaw`
      INSERT INTO pcp_estoque_transito (
        snapshot_at, janela_inicio, janela_fim, status_transito,
        metodo_baixa, tem_vinculo, entrada_docs,
        destino_branch_code, destino_branch_name, saida_branch_code, saida_branch_name,
        saida_transaction_code, saida_transaction_date, saida_operation_code, saida_operation_description, saida_item_index,
        product_code, product_sku, reference_code, product_name, color_name, size,
        colecao, categoria, linha, genero, status_produto,
        quantidade_saida, quantidade_recebida, quantidade_em_transito,
        primeira_entrada_date, ultima_entrada_date, dias_em_transito, updated_at
      )
      VALUES ${Prisma.join(lote.map((l) => Prisma.sql`(
        now(), ${l.janelaInicio}::date, ${l.janelaFim}::date, ${l.statusTransito},
        ${l.metodoBaixa}, ${l.temVinculo}, ${l.entradaDocs},
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
        entrada_transaction_date, entrada_operation_code, quantidade_baixada, metodo
      )
      VALUES ${Prisma.join(lote.map((m) => Prisma.sql`(
        now(), ${m.saidaBranchCode}, ${m.saidaTransactionCode}, ${m.saidaItemIndex},
        ${m.entradaBranchCode}, ${m.entradaTransactionCode}, ${m.entradaItemIndex},
        ${toDateOnly(m.entradaTransactionDate)}::date, ${m.entradaOperationCode}, ${m.quantidadeBaixada}, ${m.metodo}
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
  const { linhas, movimentos, descartadas } = calcular(saidas, entradas, janelaInicio, janelaFim);
  const abertas = linhas.filter((linha) => linha.quantidadeEmTransito > 0.0001);
  const comVinculo = linhas.filter((linha) => linha.temVinculo);

  const somaPecas = (lista: LinhaTransito[], campo: 'quantidadeSaida' | 'quantidadeRecebida' | 'quantidadeEmTransito') =>
    lista.reduce((total, linha) => total + linha[campo], 0);

  const resumo = {
    modo: apply ? 'apply' : 'dry-run',
    janelaInicio,
    janelaFim,
    meses,
    saidasLinhas: saidas.length,
    entradasLinhas: entradas.length,
    linhasMaterializadas: linhas.length,
    linhasSemDestinoResolvido: descartadas,
    movimentosBaixa: movimentos.length,
    pecasSaida: somaPecas(linhas, 'quantidadeSaida'),
    pecasRecebidas: somaPecas(linhas, 'quantidadeRecebida'),
    pecasEmTransito: somaPecas(abertas, 'quantidadeEmTransito'),
    documentosPendentes: new Set(abertas.map((linha) => linha.saidaTransactionCode)).size,
    lojasPendentes: new Set(abertas.map((linha) => linha.destinoBranchCode)).size,
    // O que o vinculo do TOTVS cobre hoje contra o que ainda depende de aproximacao
    vinculo: {
      linhasComVinculo: comVinculo.length,
      pecasComVinculo: somaPecas(comVinculo, 'quantidadeSaida'),
      pecasAbertasComVinculo: somaPecas(comVinculo.filter((l) => l.quantidadeEmTransito > 0.0001), 'quantidadeEmTransito'),
      baixasPorVinculo: movimentos.filter((m) => m.metodo === 'vinculo').length,
      baixasPorFifo: movimentos.filter((m) => m.metodo === 'fifo').length,
    },
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
