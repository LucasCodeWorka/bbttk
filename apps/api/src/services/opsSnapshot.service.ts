import { Prisma } from '@prisma/client';

// Mesmo contrato de projetobb/src/common/ops_snapshot.py. Nao retroage capturas.
export async function prepararSnapshotOps(tx: Prisma.TransactionClient, capturedAt: Date): Promise<void> {
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ops_em_producao_snapshot'))`;
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ops_em_producao_capturas (
    data_posicao DATE PRIMARY KEY, captured_at TIMESTAMPTZ NOT NULL, fonte TEXT NOT NULL
  )`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ops_em_producao_diario (
    data_posicao DATE NOT NULL REFERENCES ops_em_producao_capturas(data_posicao),
    product_code INTEGER NOT NULL, quantidade_pendente NUMERIC(15,4) NOT NULL,
    PRIMARY KEY (data_posicao, product_code)
  )`);
  const [ultima] = await tx.$queryRaw<Array<{ captured_at: Date | null }>>`
    SELECT MAX(captured_at) AS captured_at FROM ops_em_producao_capturas
  `;
  if (ultima?.captured_at && ultima.captured_at > capturedAt) {
    throw new Error('Captura de OPs mais antiga que a ultima carga; repita a busca.');
  }
}

export async function gravarSnapshotOps(tx: Prisma.TransactionClient, capturedAt: Date): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO ops_em_producao_capturas(data_posicao, captured_at, fonte)
    VALUES ((${capturedAt}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, ${capturedAt}, 'api')
    ON CONFLICT (data_posicao) DO UPDATE
    SET captured_at = EXCLUDED.captured_at, fonte = EXCLUDED.fonte
  `;
  await tx.$executeRaw`
    DELETE FROM ops_em_producao_diario
    WHERE data_posicao = (${capturedAt}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
  `;
  await tx.$executeRaw`
    INSERT INTO ops_em_producao_diario(data_posicao, product_code, quantidade_pendente)
    SELECT (${capturedAt}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
      product_code, SUM(quantidade_pendente)
    FROM ops_em_producao
    WHERE quantidade_pendente > 0
      AND (COALESCE(insert_date, dt_inicio) IS NULL OR COALESCE(insert_date, dt_inicio)::date
        <= (${capturedAt}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date)
    GROUP BY product_code
  `;
}
