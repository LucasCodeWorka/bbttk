import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ATACADO_BRANCH_CODE, DPA_BRANCH_CODE } from '../config/constants.js';
import {
  RelatorioBaseFiltro, OPERACAO_JOIN, SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL,
  buildProdutosValidosAnoAnteriorSql, buildEstoqueAnoAnteriorSql,
  buildEstoqueAnoAnteriorAnaliticoSql, dataLimiteSuperiorSql,
} from './relatorioBase.service.js';

export function buildVendasAnoAnteriorSql(filtro: RelatorioBaseFiltro): Prisma.Sql {
  const fim = dataLimiteSuperiorSql(filtro.dataPosicao, -1);
  const inicio = Prisma.sql`(${fim} - INTERVAL '30 days')`;
  const empresas = filtro.branches?.filter(c => c > 0) || [];
  const locais: Prisma.Sql[] = [];
  if (empresas.length) locais.push(Prisma.sql`t.branch_code IN (${Prisma.join(empresas)})`);
  if (filtro.branches?.includes(ATACADO_BRANCH_CODE)) locais.push(Prisma.sql`(t.branch_code = 2 AND co.description ILIKE '%ATACADO%')`);
  if (filtro.branches?.includes(DPA_BRANCH_CODE)) locais.push(Prisma.sql`(t.branch_code = 2 AND COALESCE(co.description, '') NOT ILIKE '%ATACADO%')`);
  const filtroLocal = filtro.branches?.length
    ? Prisma.sql`AND (${locais.length ? Prisma.join(locais, ' OR ') : Prisma.sql`FALSE`})` : Prisma.empty;
  return Prisma.sql`
    WITH ${buildProdutosValidosAnoAnteriorSql(filtro)}, transacoes_periodo AS MATERIALIZED (
      SELECT t.branch_code, t.transaction_code, co.operations_type, co.operation_mode
      FROM transacoes t ${OPERACAO_JOIN}
      WHERE t.status = 4 AND ${SALE_OPERATION_FILTER}
        -- Equivale ao COALESCE(dt_fatura, transaction_date), preservando os
        -- indices das duas datas. A janela e a mesma do giro atual (D-30 a D).
        AND ((t.dt_fatura >= ${inicio} AND t.dt_fatura < ${fim} + INTERVAL '1 day')
          OR (t.dt_fatura IS NULL AND t.transaction_date >= ${inicio}
              AND t.transaction_date < ${fim} + INTERVAL '1 day'))
        ${filtroLocal}
    )
    SELECT a.linha, COALESCE(SUM(${QUANTIDADE_COM_SINAL}), 0) AS quantidade
    FROM transacoes_periodo co
    JOIN transacao_itens ti USING (branch_code, transaction_code)
    JOIN produtos_validos a ON a.product_code = ti.product_code
    WHERE COALESCE(ti.seller_code, 0) <> 1
    GROUP BY a.linha
  `;
}

type EstoqueLinha = { linha: string | null; quantidade: Prisma.Decimal; valor: Prisma.Decimal };
type VendaLinha = { linha: string | null; quantidade: Prisma.Decimal };
type Bucket = { estoque: number; vendas: number };

function linhaPadrao(linha: string | null): string {
  return (linha || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, ' ').toUpperCase();
}

export function montarComparativoAnoAnterior(estoques: EstoqueLinha[], vendas: VendaLinha[]) {
  const buckets = new Map<string, Bucket>();
  let estoqueTotal = 0, vendasTotal = 0, valorEstoque = 0;
  function bucket(linha: string | null) {
    const key = linhaPadrao(linha);
    const acc = buckets.get(key) || { estoque: 0, vendas: 0 };
    buckets.set(key, acc);
    return acc;
  }
  for (const row of estoques) {
    const quantidade = Number(row.quantidade);
    estoqueTotal += quantidade;
    valorEstoque += Number(row.valor);
    bucket(row.linha).estoque += quantidade;
  }
  for (const row of vendas) {
    const quantidade = Number(row.quantidade);
    vendasTotal += quantidade;
    bucket(row.linha).vendas += quantidade;
  }
  const cobertura = (acc: Bucket) => acc.vendas > 0 ? Math.round(acc.estoque / acc.vendas * 100) / 100 : null;
  function coberturaLinhas(...linhas: string[]) {
    const acc = linhas.reduce((total, linha) => {
      const b = buckets.get(linha);
      return { estoque: total.estoque + (b?.estoque || 0), vendas: total.vendas + (b?.vendas || 0) };
    }, { estoque: 0, vendas: 0 });
    return cobertura(acc);
  }
  return {
    estoque: estoqueTotal, vendas30d: vendasTotal,
    valorEstoque: Math.round(valorEstoque * 100) / 100,
    coberturaGeral: cobertura({ estoque: estoqueTotal, vendas: vendasTotal }),
    coberturaBasico: coberturaLinhas('BASICA', 'BASICO'),
    coberturaBasicoRenovavel: coberturaLinhas('BASICA RENOVAVEL', 'BASICO RENOVAVEL'),
    coberturaColecao: coberturaLinhas('STYLE', 'COLECAO'),
  };
}

export async function getComparativoAnoAnterior(filtro: RelatorioBaseFiltro) {
  // O frontend envia a data efetiva devolvida pelo relatorio principal. Clientes
  // sem data usam o mesmo criterio: ultima posicao fechada, ou a data atual.
  if (!filtro.dataPosicao) {
    const [row] = await prisma.$queryRaw<Array<{ data: string }>>`
      SELECT to_char(COALESCE(MAX(data_posicao) FILTER (WHERE data_posicao < CURRENT_DATE), CURRENT_DATE), 'YYYY-MM-DD') AS data
      FROM pcp_relatorio_base_analitico_diario`;
    filtro = { ...filtro, dataPosicao: row.data };
  }
  const [schema] = await prisma.$queryRaw<Array<{ possui_marcador: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pcp_relatorio_base_analitico_diario'
        AND column_name = 'compoe_posicao_atual') AS possui_marcador`;
  let estoques: EstoqueLinha[] | undefined;
  if (schema.possui_marcador) {
    const [posicao] = await prisma.$queryRaw<Array<{ completo: boolean }>>`
      SELECT COUNT(*) > 0 AND COUNT(*) FILTER (WHERE compoe_posicao_atual IS NULL) = 0 AS completo
      FROM pcp_relatorio_base_analitico_diario WHERE data_posicao = ${filtro.dataPosicao}::date`;
    if (posicao.completo) {
      estoques = await prisma.$queryRaw<EstoqueLinha[]>(buildEstoqueAnoAnteriorAnaliticoSql(filtro, filtro.dataPosicao!, true));
    }
  }
  // A quantidade e a valorizacao compartilham uma unica leitura do historico.
  if (!estoques) estoques = await prisma.$queryRaw<EstoqueLinha[]>(buildEstoqueAnoAnteriorSql(filtro, filtro.dataPosicao, true));
  const vendas = await prisma.$queryRaw<VendaLinha[]>(buildVendasAnoAnteriorSql(filtro));
  const [datas] = await prisma.$queryRaw<Array<{ dataAnoAnterior: string; inicioVendas: string }>>`
    SELECT to_char(${dataLimiteSuperiorSql(filtro.dataPosicao, -1)}, 'YYYY-MM-DD') AS "dataAnoAnterior",
      to_char(${dataLimiteSuperiorSql(filtro.dataPosicao, -1)} - INTERVAL '30 days', 'YYYY-MM-DD') AS "inicioVendas"`;
  return { dataPosicao: filtro.dataPosicao!, ...datas, ...montarComparativoAnoAnterior(estoques, vendas) };
}
