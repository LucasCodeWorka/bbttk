/**
 * Auditoria SOMENTE LEITURA: saídas da Fábrica desde 2026-07-01, sem FIFO.
 * Compara a foto atual com os documentos consultados diretamente no TOTVS.
 * Raiz: npx tsx apps/api/src/scripts/conferir-transito-vinculos.ts
 * Flags: --desde=YYYY-MM-DD --ate=YYYY-MM-DD --output=.cache/conferencia-transito.json
 * Mantém as operações 1510/556 do relatório para comparar o mesmo universo.
 * Não escreve no banco, não atualiza o relatório e não executa backfill.
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type Ref = { branch: number; transaction: number };
type Doc = {
  branchCode: number; transactionCode: number; transactionDate: string;
  items?: { productCode: number; quantity: number }[];
  originDestination?: {
    branchCodeOrigin?: number | null; transactionCodeOrigin?: number | null;
    destination?: { branchCodeDestination: number; transactionCodeDestination: number }[] | null;
  } | null;
};
type Foto = { documento: number; produto: number; saida: unknown; recebida: unknown; aberto: unknown };
const docKey = (b: number, t: number) => `${b}/${t}`;
const rowKey = (t: number, p: number) => `${t}/${p}`;
const round = (n: number) => Math.round(n * 10000) / 10000;
function itens(doc: Doc): Map<number, number> {
  const result = new Map<number, number>();
  for (const item of doc.items || []) {
    if (!Number.isFinite(Number(item.quantity)) || !Number.isInteger(item.productCode)) throw new Error('Item inválido na API');
    if (Number(item.quantity) > 0) result.set(item.productCode, (result.get(item.productCode) || 0) + Number(item.quantity));
  }
  return result;
}
function destinos(doc: Doc): Ref[] {
  const refs = new Map<string, Ref>();
  for (const d of doc.originDestination?.destination || []) {
    if (!Number.isInteger(d.branchCodeDestination) || d.branchCodeDestination <= 0 ||
        !Number.isInteger(d.transactionCodeDestination) || d.transactionCodeDestination <= 0) throw new Error('Vínculo inválido na API');
    refs.set(docKey(d.branchCodeDestination, d.transactionCodeDestination), { branch: d.branchCodeDestination, transaction: d.transactionCodeDestination });
  }
  return [...refs.values()];
}

export function conferir(saidas: Doc[], entradas: Doc[], foto: Foto[]) {
  const recebimentos = new Map(entradas.map(d => [docKey(d.branchCode, d.transactionCode), d]));
  const fotoMap = new Map(foto.map(r => [rowKey(r.documento, r.produto), r]));
  // Entrada compartilhada não pode ser contada duas vezes nem rateada por FIFO.
  const demandas = new Map<string, Set<number>>();
  for (const saida of saidas) for (const ref of destinos(saida)) for (const produto of itens(saida).keys()) {
    const k = `${docKey(ref.branch, ref.transaction)}/${produto}`;
    const docs = demandas.get(k) || new Set<number>();
    docs.add(saida.transactionCode); demandas.set(k, docs);
  }
  const rows = [];
  for (const saida of saidas) for (const [produto, quantidade] of itens(saida)) {
    const refs = destinos(saida);
    let recebida = 0;
    const problemas = new Set<string>();
    if (!refs.length) problemas.add(Array.isArray(saida.originDestination?.destination) ? 'sem_destino_na_api' : 'vinculo_nao_retornado');
    for (const ref of refs) {
      const k = docKey(ref.branch, ref.transaction);
      const entrada = recebimentos.get(k);
      if (!entrada) { problemas.add('entrada_nao_retornada_com_status_atendida'); continue; }
      const origem = entrada.originDestination;
      if (origem?.transactionCodeOrigin != null &&
          (origem.transactionCodeOrigin !== saida.transactionCode || origem.branchCodeOrigin !== saida.branchCode)) {
        problemas.add('origem_divergente'); continue;
      }
      if ((demandas.get(`${k}/${produto}`)?.size || 0) > 1) { problemas.add('entrada_compartilhada'); continue; }
      if (!entrada.items?.length) { problemas.add('entrada_sem_itens'); continue; }
      recebida += itens(entrada).get(produto) || 0;
    }
    const excessoEntrada = Math.max(0, recebida - quantidade);
    recebida = Math.min(quantidade, recebida);
    const anterior = fotoMap.get(rowKey(saida.transactionCode, produto));
    fotoMap.delete(rowKey(saida.transactionCode, produto));
    const aberto = round(quantidade - recebida);
    rows.push({ documento: saida.transactionCode, data: saida.transactionDate.slice(0, 10), produto,
      entradas: refs.map(r => docKey(r.branch, r.transaction)).join(', '),
      quantidadeSaida: round(quantidade), quantidadeRecebida: round(recebida), semRecebimentoDocumental: aberto,
      excessoEntrada: round(excessoEntrada), situacao: [...problemas].join('; ') || 'vinculo_conferido',
      presenteNaFoto: !!anterior, saidaNaFoto: Number(anterior?.saida || 0),
      recebidaNaFoto: Number(anterior?.recebida || 0), abertoNaFoto: Number(anterior?.aberto || 0),
      diferenca: round(aberto - Number(anterior?.aberto || 0)),
    });
  }
  const sum = (key: 'quantidadeSaida' | 'quantidadeRecebida' | 'semRecebimentoDocumental' | 'abertoNaFoto') => round(rows.reduce((s, r) => s + r[key], 0));
  const porSituacao: Record<string, { linhas: number; pecasSemRecebimento: number }> = {};
  for (const r of rows) {
    const grupo = porSituacao[r.situacao] ||= { linhas: 0, pecasSemRecebimento: 0 };
    grupo.linhas++; grupo.pecasSemRecebimento = round(grupo.pecasSemRecebimento + r.semRecebimentoDocumental);
  }
  return { resumo: { documentosApi: saidas.length, documentosEntradaApi: entradas.length,
    saidasApiSemItens: saidas.filter(d => !d.items?.length).map(d => d.transactionCode),
    pecasSaida: sum('quantidadeSaida'), pecasRecebidasPorVinculo: sum('quantidadeRecebida'),
    pecasSemRecebimentoDocumental: sum('semRecebimentoDocumental'),
    saldoFotoMesmoRecorte: round(foto.reduce((s, r) => s + Number(r.aberto), 0)),
    diferencaTotal: round(sum('semRecebimentoDocumental') - foto.reduce((s, r) => s + Number(r.aberto), 0)),
    pecasSaidaAusentesNaFoto: round(rows.filter(r => !r.presenteNaFoto).reduce((s, r) => s + r.quantidadeSaida, 0)),
    saldoApiItensPresentesNaFoto: round(rows.filter(r => r.presenteNaFoto).reduce((s, r) => s + r.semRecebimentoDocumental, 0)),
    saldoFotoItensPresentesNaApi: sum('abertoNaFoto'),
    linhasDivergentes: rows.filter(r => r.diferenca !== 0 || r.quantidadeSaida !== r.saidaNaFoto).length,
    porSituacao }, rows, fotoSemCorrespondenciaApi: [...fotoMap.values()] };
}

async function main() {
  config({ path: resolve('apps/api/.env') });
  const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
  const desde = arg('desde', '2026-07-01');
  const ate = arg('ate', new Date().toISOString().slice(0, 10));
  for (const date of [desde, ate]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Data inválida');
  if (desde > ate) throw new Error('Data inicial posterior à final');
  const prisma = new PrismaClient();
  try {
    const [foto, metadata] = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return Promise.all([
        tx.$queryRaw<Foto[]>`SELECT saida_transaction_code documento, product_code produto,
          SUM(quantidade_saida) saida, SUM(quantidade_recebida) recebida, SUM(quantidade_em_transito) aberto
          FROM pcp_estoque_transito WHERE saida_branch_code=2 AND saida_operation_code IN (1510,556)
          AND saida_transaction_date >= ${desde}::date AND saida_transaction_date < ${ate}::date + interval '1 day'
          GROUP BY saida_transaction_code, product_code`,
        tx.$queryRaw`SELECT MAX(snapshot_at) atualizado_em, MIN(janela_inicio) inicio, MAX(janela_fim) fim,
          SUM(quantidade_em_transito) saldo_total FROM pcp_estoque_transito`,
      ]);
    }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
    const base = process.env.TOTVS_API_URL?.replace(/\/$/, '');
    if (!base) throw new Error('TOTVS_API_URL ausente');
    async function request(path: string, options: RequestInit) {
      const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`TOTVS HTTP ${response.status}: ${path}`);
      return response.json();
    }
    const token = await request('/authorization/v2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: process.env.TOTVS_CLIENT_ID || '',
        client_secret: process.env.TOTVS_CLIENT_SECRET || '', username: process.env.TOTVS_USERNAME || '', password: process.env.TOTVS_PASSWORD || '' }),
    }) as { access_token: string };
    if (!token.access_token) throw new Error('Token não retornado');
    async function search(filter: Record<string, unknown>, page: number, pageSize = 100) {
      return request('/general/v2/transactions/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` },
        body: JSON.stringify({ ...filter, expand: 'originDestination', page, pageSize }),
      }) as Promise<{ items: Doc[]; hasNext: boolean; totalPages: number }>;
    }
    const saidas = new Map<string, Doc>();
    let ultimaData = '9999-12-31';
    for (let page = 1; ; page++) {
      const data = await search({ branchCodeList: [2], operationCodeList: [1510, 556], statusCodeList: [4], order: '-transactionDate,-transactionCode' }, page);
      let anteriores = false;
      for (const doc of data.items || []) {
        const date = doc.transactionDate.slice(0, 10);
        if (date > ultimaData) throw new Error('API não respeitou ordenação por data; consulta interrompida');
        ultimaData = date;
        if (date < desde) { anteriores = true; continue; }
        if (date <= ate) saidas.set(docKey(doc.branchCode, doc.transactionCode), doc);
      }
      console.log(`[consulta] página ${page}: ${saidas.size} saídas no período`);
      if (anteriores || (!data.hasNext && page >= (data.totalPages || 1))) break;
      if (!data.items?.length) throw new Error('Página vazia antes do fim da consulta');
    }
    const refsPorFilial = new Map<number, Set<number>>();
    for (const doc of saidas.values()) for (const ref of destinos(doc)) {
      const codes = refsPorFilial.get(ref.branch) || new Set<number>();
      codes.add(ref.transaction); refsPorFilial.set(ref.branch, codes);
    }
    const entradas = new Map<string, Doc>();
    for (const [branch, codes] of refsPorFilial) {
      const lista = [...codes];
      for (let i = 0; i < lista.length; i += 40) {
        const lote = lista.slice(i, i + 40);
        for (let page = 1; ; page++) {
          const data = await search({ branchCodeList: [branch], transactionCodeList: lote, statusCodeList: [4], transactionTypeList: ['E'] }, page, 40);
          for (const doc of data.items || []) {
            if (doc.branchCode !== branch || !lote.includes(doc.transactionCode)) throw new Error('API retornou documento fora do lote');
            // A janela é das saídas; entrada posterior à data final não pode baixar o recorte.
            if (doc.transactionDate.slice(0, 10) <= ate) entradas.set(docKey(doc.branchCode, doc.transactionCode), doc);
          }
          if (!data.hasNext && page >= (data.totalPages || 1)) break;
          if (!data.items?.length) throw new Error('Página de entradas incompleta');
        }
      }
      console.log(`[consulta] filial ${branch}: ${lista.length} documentos de entrada consultados`);
    }
    const result = { consultadoEm: new Date().toISOString(), desde, ate, snapshot: metadata,
      escopo: 'Fábrica 2, saídas 1510/556 atendidas. Vínculo documental, sem FIFO. Saldo sem vínculo não comprova trânsito físico.',
      ...conferir([...saidas.values()], [...entradas.values()], foto) };
    const output = resolve(arg('output', '.cache/conferencia-transito.json'));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(result, null, 2));
    const columns = Object.keys(result.rows[0] || {});
    const csv = [columns.join(';'), ...result.rows.map(r => columns.map(c => `"${String(r[c as keyof typeof r]).replace(/"/g, '""')}"`).join(';'))].join('\n');
    writeFileSync(output.replace(/\.json$/, '') + '.csv', '\uFEFF' + csv);
    console.log(JSON.stringify({ desde, ate, snapshot: metadata, ...result.resumo,
      fotoSemCorrespondenciaApi: result.fotoSemCorrespondenciaApi.length, arquivo: output }, null, 2));
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch(e => { console.error('[consulta]', e instanceof Error ? e.message.split('\n')[0] : 'Falha'); process.exitCode = 1; });
