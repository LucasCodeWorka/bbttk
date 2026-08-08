import 'dotenv/config';
import https from 'https';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const API_BASE_URL = process.env.TOTVS_API_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const STATUS_EM_PRODUCAO = [5, 10, 20];
const FILIAIS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 17];
const PAGE_SIZE = 100;
const MAX_TENTATIVAS = 4;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

interface TotvsOrderItem {
  productCode?: number | null;
  productName?: string | null;
  colorCode?: string | null;
  colorName?: string | null;
  sizeCode?: number | null;
  sizeName?: string | null;
  referenceCode?: string | null;
  referenceName?: string | null;
  quantity?: number | null;
  finishedQuantity?: number | null;
  pendingQuantity?: number | null;
}

interface TotvsOrder {
  branchCode: number;
  orderCode: number;
  status: number;
  estimatedDeliveryDate?: string | null;
  insertDate?: string | null;
  lastChangeDate?: string | null;
  endDate?: string | null;
  startMovimentDate?: string | null;
  items?: TotvsOrderItem[] | null;
}

interface TotvsOrdersPage {
  hasNext?: boolean;
  items?: TotvsOrder[];
}

interface EmProducaoLinha {
  productCode: number;
  branchCode: number;
  quantidade: number;
}

interface EmProducaoDetalheLinha {
  branchCode: number;
  orderCode: number;
  status: number;
  dtInicio: string | null;
  dtPrevisao: string | null;
  insertDate: string | null;
  lastChangeDate: string | null;
  productCode: number;
  productName: string | null;
  referenceCode: string | null;
  referenceName: string | null;
  colorCode: string | null;
  colorName: string | null;
  sizeCode: number | null;
  sizeName: string | null;
  quantidadeOp: number | null;
  quantidadeFinalizada: number | null;
  quantidadePendente: number;
}

interface SyncResumo {
  ordens: number;
  linhasAgregadas: number;
  linhasDetalhadas: number;
  paginas: number;
  duracaoMs: number;
  dryRun: boolean;
  detalhado: boolean;
}

function hasFlag(...names: string[]): boolean {
  return process.argv.slice(2).some((arg) => names.includes(arg));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function autenticarTotvs(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/authorization/v2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.TOTVS_CLIENT_ID || '',
      client_secret: process.env.TOTVS_CLIENT_SECRET || '',
      username: process.env.TOTVS_USERNAME || '',
      password: process.env.TOTVS_PASSWORD || '',
    }),
    // @ts-ignore - Node fetch aceita agent neste ambiente.
    agent: httpsAgent,
  });

  if (!response.ok) {
    throw new Error(`Falha ao autenticar na TOTVS: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Falha ao autenticar na TOTVS: access_token ausente.');
  }

  return data.access_token;
}

async function buscarPaginaOrdens(page: number): Promise<TotvsOrdersPage> {
  let ultimoErro = '';

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const token = await autenticarTotvs();
      const startedAt = Date.now();

      const response = await fetch(`${API_BASE_URL}/production-order/v2/orders/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            statusList: STATUS_EM_PRODUCAO,
            branchCodeList: FILIAIS,
          },
          expand: 'items',
          page,
          pageSize: PAGE_SIZE,
        }),
        // @ts-ignore - Node fetch aceita agent neste ambiente.
        agent: httpsAgent,
      });

      if (!response.ok) {
        ultimoErro = `HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`;
      } else {
        const data = (await response.json()) as TotvsOrdersPage;
        console.log(`[em-producao] pagina ${page}: ${data.items?.length ?? 0} ordens em ${formatDuration(Date.now() - startedAt)}${data.hasNext ? ', tem proxima' : ', ultima pagina'}`);
        return data;
      }
    } catch (error) {
      ultimoErro = error instanceof Error ? error.message : String(error);
    }

    if (tentativa < MAX_TENTATIVAS) {
      const esperaMs = tentativa * 3000;
      console.log(`[em-producao] pagina ${page}: tentativa ${tentativa} falhou (${ultimoErro}), nova tentativa em ${formatDuration(esperaMs)}`);
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }

  throw new Error(`Erro ao buscar Ordens de Producao na TOTVS (pagina ${page}) apos ${MAX_TENTATIVAS} tentativas: ${ultimoErro}`);
}

function agregarItensPendentes(ordens: TotvsOrder[], agregado: Map<string, EmProducaoLinha>): void {
  for (const ordem of ordens) {
    for (const item of ordem.items || []) {
      const productCode = item.productCode;
      const quantidade = item.pendingQuantity ?? 0;

      if (productCode == null || !quantidade || quantidade <= 0) continue;

      const chave = `${productCode}-${ordem.branchCode}`;
      const linha = agregado.get(chave) || {
        productCode,
        branchCode: ordem.branchCode,
        quantidade: 0,
      };

      linha.quantidade += quantidade;
      agregado.set(chave, linha);
    }
  }
}

function montarItensPendentesDetalhados(ordens: TotvsOrder[]): EmProducaoDetalheLinha[] {
  const detalhes: EmProducaoDetalheLinha[] = [];

  for (const ordem of ordens) {
    for (const item of ordem.items || []) {
      const productCode = item.productCode;
      const quantidadePendente = item.pendingQuantity ?? 0;

      if (productCode == null || !quantidadePendente || quantidadePendente <= 0) continue;

      detalhes.push({
        branchCode: ordem.branchCode,
        orderCode: ordem.orderCode,
        status: ordem.status,
        dtInicio: ordem.startMovimentDate ?? ordem.insertDate ?? null,
        dtPrevisao: ordem.estimatedDeliveryDate ?? null,
        insertDate: ordem.insertDate ?? null,
        lastChangeDate: ordem.lastChangeDate ?? null,
        productCode,
        productName: item.productName ?? null,
        referenceCode: item.referenceCode ?? null,
        referenceName: item.referenceName ?? null,
        colorCode: item.colorCode ?? null,
        colorName: item.colorName ?? null,
        sizeCode: item.sizeCode ?? null,
        sizeName: item.sizeName ?? null,
        quantidadeOp: item.quantity ?? null,
        quantidadeFinalizada: item.finishedQuantity ?? null,
        quantidadePendente,
      });
    }
  }

  return detalhes;
}

async function garantirTabela(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ops_em_producao (
      id SERIAL PRIMARY KEY,
      product_code INTEGER NOT NULL,
      branch_code INTEGER NOT NULL,
      quantidade NUMERIC(15,4) NOT NULL,
      synced_at TIMESTAMP(6) NOT NULL DEFAULT now()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS ops_em_producao_product_branch_uk
      ON ops_em_producao (product_code, branch_code)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS ops_em_producao_product_code_idx
      ON ops_em_producao (product_code)
  `);
}

async function gravarSnapshot(linhas: EmProducaoLinha[]): Promise<number> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('DELETE FROM ops_em_producao');

    for (let i = 0; i < linhas.length; i += 2000) {
      const lote = linhas.slice(i, i + 2000);
      if (lote.length === 0) continue;

      await tx.$executeRaw`
        INSERT INTO ops_em_producao (product_code, branch_code, quantidade, synced_at)
        VALUES ${Prisma.join(
          lote.map((linha) => Prisma.sql`(${linha.productCode}, ${linha.branchCode}, ${linha.quantidade}, now())`)
        )}
      `;
    }
  });

  return linhas.length;
}

async function sincronizarEmProducao(dryRun: boolean, detalhado: boolean): Promise<SyncResumo> {
  const startedAt = Date.now();
  const agregado = new Map<string, EmProducaoLinha>();
  const detalhes: EmProducaoDetalheLinha[] = [];
  const ordensVistas = new Set<string>();
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    console.log(`[em-producao] buscando pagina ${page}...`);
    const data = await buscarPaginaOrdens(page);
    const ordens = data.items || [];

    for (const ordem of ordens) {
      ordensVistas.add(`${ordem.branchCode}-${ordem.orderCode}`);
    }

    agregarItensPendentes(ordens, agregado);
    if (detalhado) detalhes.push(...montarItensPendentesDetalhados(ordens));

    hasNext = !!data.hasNext;
    page++;
  }

  const linhas = [...agregado.values()];

  if (dryRun) {
    console.log('[em-producao] dry-run: nao cria tabela, nao limpa dados e nao grava snapshot.');
    console.log(`[em-producao] dry-run: ${linhas.length} linhas agregadas seriam geradas.`);
    if (detalhado) {
      console.log(`[em-producao] dry-run detalhado: ${detalhes.length} linhas por OP + produto seriam geradas.`);
      console.table(detalhes.slice(0, 10));
    }
  } else {
    console.log(`[em-producao] gravando snapshot: ${linhas.length} linhas agregadas...`);
    await gravarSnapshot(linhas);
  }

  return {
    ordens: ordensVistas.size,
    linhasAgregadas: linhas.length,
    linhasDetalhadas: detalhes.length,
    paginas: page - 1,
    duracaoMs: Date.now() - startedAt,
    dryRun,
    detalhado,
  };
}

async function main(): Promise<void> {
  const dryRun = hasFlag('--dry-run', '--dryrun', '-n');
  const detalhado = hasFlag('--detalhado', '--detalhe', '--detailed');

  console.log(`[em-producao] inicio ${new Date().toISOString()}`);
  console.log(`[em-producao] API ${API_BASE_URL}`);
  console.log(`[em-producao] status ${STATUS_EM_PRODUCAO.join(', ')} | filiais ${FILIAIS.join(', ')} | pageSize ${PAGE_SIZE}`);
  if (dryRun) console.log('[em-producao] modo dry-run ativo.');
  if (detalhado) console.log('[em-producao] modo detalhado ativo: simula linhas por OP + produto.');

  if (!dryRun) await garantirTabela();
  const resumo = await sincronizarEmProducao(dryRun, detalhado);

  console.log(`[em-producao] fim ${new Date().toISOString()}`);
  console.log(`[em-producao] resumo: ${resumo.ordens} ordens vistas, ${resumo.linhasAgregadas} linhas agregadas${resumo.detalhado ? `, ${resumo.linhasDetalhadas} linhas detalhadas` : ''}, ${resumo.paginas} paginas, total ${formatDuration(resumo.duracaoMs)}${resumo.dryRun ? ', sem gravar' : ''}`);
}

main()
  .catch((error) => {
    console.error('[em-producao] erro:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });