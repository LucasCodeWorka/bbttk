import 'dotenv/config';
import { prisma } from '../config/database.js';
import { syncCustosEPrecos } from '../services/totvs.service.js';

function hasFlag(...names: string[]): boolean {
  return process.argv.slice(2).some((arg) => names.includes(arg));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

async function ensureTabelaAnalitica() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS produto_custo_preco_sku_filial (
      id BIGSERIAL PRIMARY KEY,
      product_sku VARCHAR(50) NOT NULL,
      product_code INTEGER NOT NULL,
      branch_code INTEGER NOT NULL,
      cost_code INTEGER NOT NULL,
      cost_name VARCHAR(100),
      custo NUMERIC(15,4) NOT NULL,
      price_code INTEGER NOT NULL,
      price_name VARCHAR(100),
      preco NUMERIC(15,4) NOT NULL,
      markup NUMERIC(15,4),
      margem_percent NUMERIC(15,4),
      synced_at TIMESTAMP(6) NOT NULL DEFAULT now()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS produto_custo_preco_sku_filial_uk
      ON produto_custo_preco_sku_filial (product_sku, branch_code, cost_code, price_code)
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS produto_custo_preco_sku_filial_product_code_idx ON produto_custo_preco_sku_filial (product_code)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS produto_custo_preco_sku_filial_branch_code_idx ON produto_custo_preco_sku_filial (branch_code)`);
}

async function reconstruirTabelaAnalitica(): Promise<{ linhas: number; duracaoMs: number }> {
  const startedAt = Date.now();

  await prisma.$executeRawUnsafe('TRUNCATE TABLE produto_custo_preco_sku_filial');
  await prisma.$executeRaw`
    INSERT INTO produto_custo_preco_sku_filial (
      product_sku,
      product_code,
      branch_code,
      cost_code,
      cost_name,
      custo,
      price_code,
      price_name,
      preco,
      markup,
      margem_percent,
      synced_at
    )
    SELECT DISTINCT
      a.product_sku,
      a.product_code,
      c.branch_code,
      c.cost_code,
      c.cost_name,
      c.valor AS custo,
      p.price_code,
      p.price_name,
      p.valor AS preco,
      CASE WHEN c.valor > 0 THEN ROUND((p.valor / c.valor)::numeric, 4) ELSE NULL END AS markup,
      CASE WHEN p.valor > 0 THEN ROUND((((p.valor - c.valor) / p.valor) * 100)::numeric, 4) ELSE NULL END AS margem_percent,
      now() AS synced_at
    FROM produto_analitico a
    JOIN produto_custos c ON c.product_code = a.product_code
    JOIN produto_precos p ON p.product_code = c.product_code AND p.branch_code = c.branch_code
    WHERE a.product_code IS NOT NULL
  `;

  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM produto_custo_preco_sku_filial`;
  return { linhas: Number(rows[0]?.count ?? 0n), duracaoMs: Date.now() - startedAt };
}

async function main() {
  const dryRun = hasFlag('--dry-run', '--dryrun', '-n');
  const startedAt = Date.now();

  console.log(`[custo-preco-sku-filial] inicio ${new Date().toISOString()}${dryRun ? ' (dry-run)' : ''}`);

  if (!dryRun) {
    console.log('[custo-preco-sku-filial] garantindo tabela produto_custo_preco_sku_filial...');
    await ensureTabelaAnalitica();
  } else {
    console.log('[custo-preco-sku-filial] dry-run: nao cria tabela e nao grava dados.');
  }

  const sync = await syncCustosEPrecos({
    dryRun,
    sequential: true,
    onProgress: (event) => {
      const label = event.tipo === 'custo' ? 'custos' : 'precos';
      const prefix = `[custo-preco-sku-filial] ${label} lote ${event.chunkIndex}/${event.totalChunks} pagina ${event.page}`;

      if (event.stage === 'request') {
        console.log(`${prefix}: buscando ${event.productCodesInChunk} produtos... total ate agora ${event.linhasTotal} linhas em ${formatDuration(event.duracaoMs)}`);
        return;
      }

      if (event.stage === 'retry') {
        console.log(`${prefix}: tentativa ${event.tentativa} falhou (${event.erro || 'erro sem detalhe'}), tentando novamente...`);
        return;
      }

      console.log(`${prefix}: pagina concluida, ${event.linhasPagina} linhas (${event.linhasTotal} acumuladas), ${event.produtosTotal} produtos, pagina ${formatDuration(event.pageDurationMs)}, total ${formatDuration(event.duracaoMs)}${event.hasNext ? ', proxima pagina...' : ', lote finalizado'}`);
    },
  });
  console.log(`[custo-preco-sku-filial] product_codes relevantes: ${sync.productCodes}`);
  console.log(`[custo-preco-sku-filial] custos: ${sync.custos.linhas} linhas, ${sync.custos.produtos} produtos, ${formatDuration(sync.custos.duracaoMs)}`);
  console.log(`[custo-preco-sku-filial] precos: ${sync.precos.linhas} linhas, ${sync.precos.produtos} produtos, ${formatDuration(sync.precos.duracaoMs)}`);

  if (!dryRun) {
    console.log('[custo-preco-sku-filial] reconstruindo tabela analitica...');
    const tabela = await reconstruirTabelaAnalitica();
    console.log(`[custo-preco-sku-filial] tabela analitica: ${tabela.linhas} linhas, ${formatDuration(tabela.duracaoMs)}`);
  }

  console.log(`[custo-preco-sku-filial] fim ${new Date().toISOString()} - total ${formatDuration(Date.now() - startedAt)}`);
}

main()
  .catch((error) => {
    console.error('[custo-preco-sku-filial] erro:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

