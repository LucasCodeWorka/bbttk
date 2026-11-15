import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

export interface ProducaoRelatorio {
  disponivel: boolean;
  capturedAt: string | null;
  fonte: 'diario' | 'atual' | 'indisponivel';
}

export interface ProducaoRelatorioDados {
  info: ProducaoRelatorio;
  rows: Array<{ product_code: number; quantidade: Prisma.Decimal }>;
}

// A data selecionada nunca consulta o ultimo dia anterior nem o saldo de hoje
// como se fosse historico. Captura vazia (cabecalho presente) e zero conhecido.
export async function getProducaoRelatorio(dataPosicao: string): Promise<ProducaoRelatorioDados> {
  const indisponivel: ProducaoRelatorioDados = {
    info: { disponivel: false, capturedAt: null, fonte: 'indisponivel' }, rows: [],
  };
  const [schema] = await prisma.$queryRaw<Array<{ possui_diario: boolean; hoje: string }>>`
    SELECT to_regclass('public.ops_em_producao_capturas') IS NOT NULL
       AND to_regclass('public.ops_em_producao_diario') IS NOT NULL AS possui_diario,
       to_char(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS hoje
  `;
  if (schema.possui_diario) {
    // Uma unica instrucao mantem cabecalho e itens consistentes durante o sync.
    const dados = await prisma.$queryRaw<Array<{
      captured_at: Date; product_code: number | null; quantidade: Prisma.Decimal | null;
    }>>`
      SELECT c.captured_at, d.product_code, d.quantidade_pendente AS quantidade
      FROM ops_em_producao_capturas c
      LEFT JOIN ops_em_producao_diario d USING(data_posicao)
      WHERE c.data_posicao = ${dataPosicao}::date
    `;
    if (dados.length) return {
      info: { disponivel: true, capturedAt: dados[0].captured_at.toISOString(), fonte: 'diario' },
      rows: dados.filter(d => d.product_code !== null).map(d => ({
        product_code: d.product_code!, quantidade: d.quantidade!,
      })),
    };
  }
  if (dataPosicao !== schema.hoje) return indisponivel;

  // Compatibilidade antes da primeira execucao do ETL atualizado. Apenas o dia
  // real da carga pode usar a tabela corrente; nao gera fotografias retroativas.
  const dados = await prisma.$queryRaw<Array<{
    captured_at: Date; product_code: number | null; quantidade: Prisma.Decimal | null;
  }>>`
    WITH captura AS (SELECT MAX(synced_at) AS captured_at FROM ops_em_producao)
    SELECT c.captured_at, o.product_code, SUM(o.quantidade_pendente) AS quantidade
    FROM captura c
    LEFT JOIN ops_em_producao o ON o.quantidade_pendente > 0
      AND (COALESCE(o.insert_date, o.dt_inicio) IS NULL
           OR COALESCE(o.insert_date, o.dt_inicio)::date <= ${dataPosicao}::date)
    WHERE ((c.captured_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date = ${dataPosicao}::date
    GROUP BY c.captured_at, o.product_code
  `;
  if (!dados.length) return indisponivel;
  return {
    info: { disponivel: true, capturedAt: dados[0].captured_at.toISOString(), fonte: 'atual' },
    rows: dados.filter(d => d.product_code !== null).map(d => ({
      product_code: d.product_code!, quantidade: d.quantidade!,
    })),
  };
}

// Atribui uma unica vez a pendencia por produto, preferindo o SKU real a um
// placeholder. A mesma producao nao pode se multiplicar por loja ou alias.
export function skusCanonicosProducao(rows: Array<{ product_sku: string; product_code: number | null }>): Map<number, string> {
  const canonicos = new Map<number, string>();
  for (const row of [...rows].sort((a, b) =>
    Number(a.product_sku.startsWith('PRODUCT_CODE:')) - Number(b.product_sku.startsWith('PRODUCT_CODE:'))
      || a.product_sku.localeCompare(b.product_sku))) {
    if (row.product_code !== null && !canonicos.has(row.product_code)) canonicos.set(row.product_code, row.product_sku);
  }
  return canonicos;
}
