import 'dotenv/config';
import { prisma } from '../config/database.js';

function hasFlag(...names: string[]): boolean {
  return process.argv.slice(2).some((arg) => names.includes(arg));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function main() {
  const startedAt = Date.now();
  const dryRun = !hasFlag('--apply');
  const latestOnly = hasFlag('--latest');

  console.log(`[estoque-aa-saldos] inicio ${new Date().toISOString()} (${dryRun ? 'dry-run' : 'gravando'}${latestOnly ? ', ultima data' : ', todas as datas'})`);

  const antes = await prisma.$queryRawUnsafe<Array<{
    datas: string;
    linhas: string;
    estoque_aa: string | null;
    valor_aa: string | null;
  }>>(`
    SELECT
      COUNT(DISTINCT data_posicao)::text AS datas,
      COUNT(*)::text AS linhas,
      SUM(estoque_ano_anterior)::text AS estoque_aa,
      SUM(estoque_ano_anterior * COALESCE(custo_producao, 0))::text AS valor_aa
    FROM pcp_relatorio_base_analitico_diario
  `);

  console.log('[estoque-aa-saldos] antes:', JSON.stringify(antes[0], null, 2));

  if (!dryRun) {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS pcp_tmp_estoque_aa_saldos');

    await prisma.$executeRawUnsafe(`
      CREATE UNLOGGED TABLE pcp_tmp_estoque_aa_saldos AS
      WITH datas AS (
        ${latestOnly
          ? 'SELECT MAX(data_posicao) AS data_posicao FROM pcp_relatorio_base_analitico_diario'
          : 'SELECT DISTINCT data_posicao FROM pcp_relatorio_base_analitico_diario'}
      ),
      produto_unico AS (
        SELECT DISTINCT ON (a.product_code)
          a.product_code,
          a.product_sku,
          a.is_finished_product,
          a.class_tipo,
          a.class_categoria
        FROM produto_analitico a
        WHERE a.product_code IS NOT NULL
        ORDER BY a.product_code, CASE WHEN a.product_sku LIKE 'PRODUCT_CODE:%' THEN 1 ELSE 0 END, a.product_sku
      ),
      ultimo_saldo AS (
        SELECT DISTINCT ON (d.data_posicao, s.product_code, s.branch_code, s.stock_code)
          d.data_posicao,
          s.product_code,
          CASE
            WHEN s.branch_code = 2 AND s.stock_code IN (1, 5) THEN -1
            WHEN s.branch_code = 2 AND s.stock_code = 8 THEN -2
            ELSE s.branch_code
          END::int AS branch_code,
          s.stock
        FROM datas d
        JOIN stg_saldo_virtual_csv s
          ON s.saldo_date < (d.data_posicao - INTERVAL '1 year') + INTERVAL '1 day'
        JOIN produto_unico a ON a.product_code = s.product_code
        WHERE s.rejection_reason IS NULL
          AND (
            s.stock_code = 1
            OR (s.branch_code = 2 AND s.stock_code IN (1, 5, 8))
          )
          AND (a.is_finished_product = true OR a.is_finished_product IS NULL)
          AND TRIM(UPPER(COALESCE(a.class_tipo, ''))) <> 'USO E CONSUMO'
          AND (
            a.product_code < 1000000
            OR (
              a.product_code >= 1000000
              AND TRIM(UPPER(COALESCE(a.class_categoria, ''))) = 'EMBALAGEM'
            )
          )
        ORDER BY d.data_posicao, s.product_code, s.branch_code, s.stock_code, s.saldo_date DESC
      ),
      saldos AS (
        SELECT data_posicao, product_code, branch_code, SUM(stock) AS stock
        FROM ultimo_saldo
        GROUP BY 1, 2, 3
      )
      SELECT data_posicao, product_code, branch_code, stock
      FROM saldos
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX pcp_tmp_estoque_aa_saldos_idx
      ON pcp_tmp_estoque_aa_saldos (data_posicao, product_code, branch_code)
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE pcp_relatorio_base_analitico_diario
      SET estoque_ano_anterior = 0
      ${latestOnly ? 'WHERE data_posicao = (SELECT MAX(data_posicao) FROM pcp_relatorio_base_analitico_diario)' : ''}
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE pcp_relatorio_base_analitico_diario rb
      SET estoque_ano_anterior = COALESCE(s.stock, 0)
      FROM pcp_tmp_estoque_aa_saldos s
      WHERE s.data_posicao = rb.data_posicao
        AND s.product_code = rb.product_code
        AND s.branch_code = rb.branch_code
    `);

    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS pcp_tmp_estoque_aa_saldos');
  }

  const depois = await prisma.$queryRawUnsafe<Array<{
    datas: string;
    linhas: string;
    estoque_aa: string | null;
    valor_aa: string | null;
  }>>(`
    SELECT
      COUNT(DISTINCT data_posicao)::text AS datas,
      COUNT(*)::text AS linhas,
      SUM(estoque_ano_anterior)::text AS estoque_aa,
      SUM(estoque_ano_anterior * COALESCE(custo_producao, 0))::text AS valor_aa
    FROM pcp_relatorio_base_analitico_diario
  `);

  const ultimasDatas = await prisma.$queryRawUnsafe<Array<{
    data_posicao: string;
    estoque_aa: string | null;
    valor_aa: string | null;
  }>>(`
    SELECT
      data_posicao::text,
      SUM(estoque_ano_anterior)::text AS estoque_aa,
      SUM(estoque_ano_anterior * COALESCE(custo_producao, 0))::text AS valor_aa
    FROM pcp_relatorio_base_analitico_diario
    GROUP BY data_posicao
    ORDER BY data_posicao DESC
    LIMIT 10
  `);

  console.log('[estoque-aa-saldos] depois:', JSON.stringify(depois[0], null, 2));
  console.log('[estoque-aa-saldos] ultimas datas:', JSON.stringify(ultimasDatas, null, 2));
  console.log(`[estoque-aa-saldos] concluido em ${formatDuration(Date.now() - startedAt)}`);
}

main()
  .catch((error) => {
    console.error('[estoque-aa-saldos] erro:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
