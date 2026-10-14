/**
 * Backfill dos itens que o ETL parou de gravar em 25/06/2026.
 *
 * O ETL continua gravando o cabecalho em `transacoes` mas nao grava nada em
 * `transacao_itens` pra operacao que nao e venda/devolucao de venda - transferencia,
 * compra, industrializacao, consignacao. Medido em 13/10/2026: 45 operacoes com
 * 6.542 documentos e ZERO itens desde julho.
 *
 * A API do TOTVS devolve os itens normalmente (conferido documento a documento), entao
 * o buraco e recuperavel sem depender da correcao do script Python. Este backfill
 * busca os documentos que estao sem item e grava o que a API responde.
 *
 * Tambem preenche `transacoes.origin_destination`, que esta NULL em 100% das linhas
 * porque o ETL nunca pediu `expand=originDestination`. Esse campo traz o vinculo
 * documento-a-documento da transferencia (qual entrada corresponde a qual saida) - e a
 * informacao que hoje o relatorio de Estoque em Transito tem que adivinhar por FIFO.
 * Saida com `destination` vazio = ainda nao recebida, ou seja, em transito de verdade.
 *
 *   npm run backfill:itens:dryrun -w apps/api      # so relata, nao escreve
 *   npm run backfill:itens -w apps/api             # grava
 *
 * Flags: --desde=YYYY-MM-DD (default 2026-06-25), --limite=N (corta o lote, pra teste),
 *        --todas (inclui toda operacao sem item, nao so transferencia).
 */
import 'dotenv/config';
import https from 'https';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const API_BASE_URL = process.env.TOTVS_API_URL || '';
const agent = new https.Agent({ rejectUnauthorized: false });

// A API aceita uma lista de transacoes por chamada; o lote e por filial, porque
// branchCodeList + transactionCodeList sao filtros independentes (misturar filiais
// num lote so traria o produto cartesiano).
const LOTE = 40;
const PAUSA_MS = 250;

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(nome: string, padrao: string): string {
  const arg = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return arg ? arg.split('=')[1] : padrao;
}

interface DocPendente {
  branch_code: number;
  transaction_code: number;
  transaction_date: Date;
  operation_code: number;
}

interface ItemApi {
  productCode: number;
  measuredUnit?: string | null;
  quantity?: number | null;
  value?: number | null;
  unitDiscountValue?: number | null;
  netValue?: number | null;
  sellerCode?: number | null;
}

interface TransacaoApi {
  branchCode: number;
  transactionCode: number;
  items?: ItemApi[] | null;
  originDestination?: unknown;
}

async function getToken(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/authorization/v2/token`, {
    method: 'POST',
    // @ts-expect-error - o agent e aceito pelo undici no Node, mas nao esta no tipo
    agent,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.TOTVS_CLIENT_ID || '',
      client_secret: process.env.TOTVS_CLIENT_SECRET || '',
      username: process.env.TOTVS_USERNAME || '',
      password: process.env.TOTVS_PASSWORD || '',
    }),
  });
  if (!res.ok) throw new Error(`Falha na autenticacao TOTVS: HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('TOTVS nao devolveu access_token');
  return data.access_token;
}

// Documentos que existem em `transacoes` mas nao tem nenhuma linha em `transacao_itens`.
async function getDocumentosSemItem(desde: string, soTransferencia: boolean): Promise<DocPendente[]> {
  const filtroOperacao = soTransferencia
    ? Prisma.sql`AND co.operation_mode = '2'`
    : Prisma.empty;
  return prisma.$queryRaw<DocPendente[]>`
    SELECT t.branch_code, t.transaction_code, t.transaction_date, t.operation_code
    FROM transacoes t
    JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
    LEFT JOIN transacao_itens ti
      ON ti.branch_code = t.branch_code AND ti.transaction_code = t.transaction_code
    WHERE t.transaction_date >= ${desde}::date
      AND t.status = 4
      AND ti.id IS NULL
      ${filtroOperacao}
    ORDER BY t.transaction_date, t.branch_code, t.transaction_code
  `;
}

async function buscarNaApi(token: string, branchCode: number, codigos: number[]): Promise<TransacaoApi[]> {
  const res = await fetch(`${API_BASE_URL}/general/v2/transactions/search`, {
    method: 'POST',
    // @ts-expect-error - ver comentario em getToken
    agent,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      branchCodeList: [branchCode],
      transactionCodeList: codigos,
      expand: 'originDestination',
      page: 1,
      pageSize: codigos.length,
    }),
  });
  if (!res.ok) throw new Error(`search HTTP ${res.status} (filial ${branchCode})`);
  const data = (await res.json()) as { items?: TransacaoApi[] };
  return data.items || [];
}

// Regrava os itens de UM documento. O DELETE antes do insert e obrigatorio (bug ja
// conhecido no projeto): upsert por item_index sozinho deixa linha orfa quando o
// documento passa a ter menos itens do que numa carga anterior.
async function gravarItens(doc: TransacaoApi): Promise<number> {
  const itens = doc.items || [];
  if (itens.length === 0) return 0;
  // timeout acima do padrao (5s): o round-trip ate o Neon e lento e documento com
  // muitos itens estourava o limite no meio do createMany (aconteceu com a transacao
  // 900703, de 85 itens). O DELETE + INSERT precisa caber na MESMA transacao, senao
  // uma falha no meio deixaria o documento sem item nenhum.
  await prisma.$transaction(async (tx) => {
    await tx.transacao_itens.deleteMany({
      where: { branch_code: doc.branchCode, transaction_code: doc.transactionCode },
    });
    await tx.transacao_itens.createMany({
      data: itens.map((item, indice) => ({
        branch_code: doc.branchCode,
        transaction_code: doc.transactionCode,
        item_index: indice,
        product_code: item.productCode,
        measured_unit: item.measuredUnit ?? null,
        quantity: item.quantity ?? null,
        value: item.value ?? null,
        unit_discount_value: item.unitDiscountValue ?? null,
        net_value: item.netValue ?? null,
        seller_code: item.sellerCode ?? null,
      })),
    });
  }, { timeout: 30000 });
  return itens.length;
}

// `transacoes.origin_destination` e VARCHAR(255) e o JSON cru do TOTVS estoura esse
// limite assim que o documento tem mais de um destino (foi o que derrubou a primeira
// execucao). Guardamos so os pares [filial, transacao] do destino, que e a unica parte
// que o relatorio de transito precisa: compacto (~12 chars por destino) e parseavel.
// Lista vazia = saida ainda nao recebida, ou seja, em transito.
const LIMITE_ORIGIN_DESTINATION = 255;

function compactarDestino(originDestination: unknown): string | null {
  const od = originDestination as { destination?: Array<{ branchCodeDestination?: number; transactionCodeDestination?: number }> } | null;
  if (!od || !Array.isArray(od.destination)) return null;
  const pares = od.destination
    .filter((d) => d.branchCodeDestination != null && d.transactionCodeDestination != null)
    .map((d) => [d.branchCodeDestination, d.transactionCodeDestination]);
  const texto = JSON.stringify(pares);
  // Nao truncamos: meio JSON seria pior que nada (pareceria valido e nao e).
  return texto.length <= LIMITE_ORIGIN_DESTINATION ? texto : null;
}

async function gravarOrigemDestino(doc: TransacaoApi): Promise<boolean> {
  const compacto = compactarDestino(doc.originDestination);
  if (compacto === null) return false;
  await prisma.$executeRaw`
    UPDATE transacoes SET origin_destination = ${compacto}
    WHERE branch_code = ${doc.branchCode} AND transaction_code = ${doc.transactionCode}
  `;
  return true;
}

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const desde = getArg('desde', '2026-06-25');
  const limite = Number(getArg('limite', '0'));
  const soTransferencia = !hasFlag('--todas');

  if (!API_BASE_URL) throw new Error('TOTVS_API_URL nao configurada no .env');

  let docs = await getDocumentosSemItem(desde, soTransferencia);
  if (limite > 0) docs = docs.slice(0, limite);

  const porFilial = new Map<number, number[]>();
  for (const doc of docs) {
    const lista = porFilial.get(doc.branch_code) || [];
    lista.push(doc.transaction_code);
    porFilial.set(doc.branch_code, lista);
  }

  console.log(JSON.stringify({
    modo: apply ? 'apply' : 'dry-run',
    escopo: soTransferencia ? 'so transferencia (operation_mode=2)' : 'todas as operacoes sem item',
    desde,
    documentosSemItem: docs.length,
    filiais: porFilial.size,
    chamadasApiPrevistas: [...porFilial.values()].reduce((t, l) => t + Math.ceil(l.length / LOTE), 0),
  }, null, 2));

  if (docs.length === 0) return;

  const token = await getToken();
  let lidos = 0;
  let semItemNaApi = 0;
  let itensGravados = 0;
  let origemDestinoGravados = 0;
  let comDestinoVazio = 0;
  const falhas: Array<{ branchCode: number; transactionCode: number; erro: string }> = [];

  for (const [branchCode, codigos] of porFilial) {
    for (let i = 0; i < codigos.length; i += LOTE) {
      const lote = codigos.slice(i, i + LOTE);
      const encontrados = await buscarNaApi(token, branchCode, lote);
      lidos += encontrados.length;

      for (const doc of encontrados) {
        const qtd = (doc.items || []).length;
        if (qtd === 0) semItemNaApi += 1;
        const od = doc.originDestination as { destination?: unknown[] } | null;
        if (od && Array.isArray(od.destination) && od.destination.length === 0) comDestinoVazio += 1;

        if (apply) {
          // Um documento problematico nao pode derrubar o lote inteiro: na primeira
          // execucao um JSON grande demais abortou tudo depois de 23 documentos.
          try {
            itensGravados += await gravarItens(doc);
            if (await gravarOrigemDestino(doc)) origemDestinoGravados += 1;
          } catch (error) {
            falhas.push({
              branchCode: doc.branchCode,
              transactionCode: doc.transactionCode,
              erro: error instanceof Error ? error.message.split('\n')[0].slice(0, 120) : String(error),
            });
          }
        } else {
          itensGravados += qtd;
          if (compactarDestino(doc.originDestination) !== null) origemDestinoGravados += 1;
        }
      }
      await new Promise((r) => setTimeout(r, PAUSA_MS));
      process.stdout.write(`\r  processados ${Math.min(i + LOTE, codigos.length)}/${codigos.length} da filial ${branchCode}   `);
    }
    process.stdout.write('\n');
  }

  console.log(JSON.stringify({
    documentosRetornadosPelaApi: lidos,
    documentosSemItemTambemNaApi: semItemNaApi,
    itens: apply ? `${itensGravados} gravados` : `${itensGravados} seriam gravados`,
    origemDestino: apply ? `${origemDestinoGravados} gravados` : `${origemDestinoGravados} seriam gravados`,
    saidasAindaNaoRecebidas: comDestinoVazio,
    documentosComFalha: falhas.length,
  }, null, 2));

  if (falhas.length > 0) {
    console.log('\n[backfill-itens] documentos que falharam (os demais foram gravados):');
    falhas.slice(0, 10).forEach((f) => console.log(`  filial ${f.branchCode} transacao ${f.transactionCode}: ${f.erro}`));
    if (falhas.length > 10) console.log(`  ... e mais ${falhas.length - 10}`);
  }

  if (!apply) console.log('\n[dry-run] nada foi escrito. Rode com --apply para gravar.');
}

main()
  .catch((error) => {
    console.error('[backfill-itens] ERRO:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
