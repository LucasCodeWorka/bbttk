import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL, OPERACAO_JOIN } from './relatorioBase.service.js';

// Relatorio de Pesos e Grades para Producao ("Rel. 3"): a partir da venda GERAL
// (atacado + varejo somados, sem separar canal - diferente do resto do PCP) de um
// periodo, calcula a frequencia de corte por tamanho de cada referencia:
// frequencia = CEIL(quantidade_vendida_do_tamanho / fator_divisor).

export type TipoAnalisePesosGrades = 'item' | 'categoria';

export interface PesosGradesFiltro {
  tipoAnalise: TipoAnalisePesosGrades;
  referencias?: string[];
  categorias?: string[];
  dataInicio: string;
  dataFim: string;
  fatorDivisor: number;
}

export interface PesosGradesTamanho {
  tamanho: string;
  quantidadeVendida: number;
  frequencia: number;
}

export interface PesosGradesReferencia {
  referenceCode: string;
  descricao: string;
  tamanhos: PesosGradesTamanho[];
}

export interface PesosGradesResponse {
  fatorDivisor: number;
  periodo: { inicio: string; fim: string };
  referencias: PesosGradesReferencia[];
}

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

interface IdentidadeRow {
  reference_code: string;
  reference_name: string | null;
}

// Universo de referencias selecionado - por item (lista explicita) ou por categoria
// (todas as referencias daquela categoria, sem limite - o usuario escolheu a
// categoria de proposito, cortar resultado seria surpreendente).
async function getReferenciasSelecionadas(filtro: PesosGradesFiltro): Promise<IdentidadeRow[]> {
  if (filtro.tipoAnalise === 'item') {
    const refs = filtro.referencias || [];
    if (refs.length === 0) return [];
    return prisma.$queryRaw<IdentidadeRow[]>`
      SELECT a.reference_code, MIN(a.reference_name) AS reference_name
      FROM produto_analitico a
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      WHERE a.reference_code IN (${Prisma.join(refs)})
        AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      GROUP BY a.reference_code
    `;
  }

  const categorias = filtro.categorias || [];
  if (categorias.length === 0) return [];
  return prisma.$queryRaw<IdentidadeRow[]>`
    SELECT a.reference_code, MIN(a.reference_name) AS reference_name
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE a.reference_code IS NOT NULL
      AND TRIM(a.class_categoria) IN (${Prisma.join(categorias)})
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
    GROUP BY a.reference_code
  `;
}

interface VendaRow {
  reference_code: string;
  size: string;
  quantidade: Decimal;
}

// Venda GERAL (atacado + varejo somados - sem filtro de canal/loja de proposito,
// pedido explicito do spec) por referencia + tamanho, liquida de devolucao.
async function getVendaPorReferenciaTamanho(referenceCodes: string[], dataInicio: string, dataFim: string): Promise<VendaRow[]> {
  if (referenceCodes.length === 0) return [];
  return prisma.$queryRaw<VendaRow[]>`
    SELECT a.reference_code, TRIM(a.size) AS size, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    JOIN produto_analitico a ON a.product_code = ti.product_code
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= ${dataInicio}::date
      AND t.transaction_date <= ${dataFim}::date
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND a.reference_code IN (${Prisma.join(referenceCodes)})
      AND a.size IS NOT NULL AND TRIM(a.size) NOT IN ('', '.')
    GROUP BY a.reference_code, TRIM(a.size)
  `;
}

export async function getPesosGrades(filtro: PesosGradesFiltro): Promise<PesosGradesResponse> {
  if (!(filtro.fatorDivisor > 0)) {
    throw new Error('Fator divisor precisa ser um numero positivo');
  }

  const identidade = await getReferenciasSelecionadas(filtro);
  const referenceCodes = identidade.map((r) => r.reference_code);
  const vendaRows = await getVendaPorReferenciaTamanho(referenceCodes, filtro.dataInicio, filtro.dataFim);

  const vendaPorRef = new Map<string, { tamanho: string; quantidade: number }[]>();
  for (const row of vendaRows) {
    const lista = vendaPorRef.get(row.reference_code) || [];
    lista.push({ tamanho: row.size, quantidade: decimalToNumber(row.quantidade) });
    vendaPorRef.set(row.reference_code, lista);
  }

  const referencias: PesosGradesReferencia[] = identidade
    .map((r) => {
      const vendas = vendaPorRef.get(r.reference_code) || [];
      const tamanhos: PesosGradesTamanho[] = vendas
        .filter((v) => v.quantidade > 0)
        .map((v) => ({
          tamanho: v.tamanho,
          quantidadeVendida: v.quantidade,
          frequencia: Math.ceil(v.quantidade / filtro.fatorDivisor),
        }))
        .sort((a, b) => a.tamanho.localeCompare(b.tamanho, undefined, { numeric: true }));
      return {
        referenceCode: r.reference_code,
        descricao: r.reference_name || r.reference_code,
        tamanhos,
      };
    })
    .sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));

  return {
    fatorDivisor: filtro.fatorDivisor,
    periodo: { inicio: filtro.dataInicio, fim: filtro.dataFim },
    referencias,
  };
}

export interface PesosGradesReferenciaOpcao {
  referenceCode: string;
  referenceName: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
}

export interface BuscarReferenciasFiltro {
  search?: string;
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  limit?: number;
}

// Busca de referencia pro modo "Por Item" - texto livre OPCIONALMENTE combinado com os
// mesmos filtros de classificacao do resto do PCP (categoria/linha/genero/status),
// pra nao obrigar o usuario a digitar referencia por referencia: filtra por
// categoria/genero e a rota ja devolve a lista inteira pra selecionar de uma vez (ou
// "selecionar todas"), em vez de um autocomplete de 1 resultado por vez.
export async function buscarReferenciasPesosGrades(filtro: BuscarReferenciasFiltro): Promise<PesosGradesReferenciaOpcao[]> {
  const condicoes: Prisma.Sql[] = [Prisma.sql`reference_code IS NOT NULL`];

  const termo = filtro.search?.trim();
  if (termo) {
    const like = `%${termo}%`;
    condicoes.push(Prisma.sql`(reference_code ILIKE ${like} OR reference_name ILIKE ${like})`);
  }
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(class_categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(class_linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(class_genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`TRIM(class_status) IN (${Prisma.join(filtro.status)})`);

  const limit = Math.min(500, Math.max(1, filtro.limit || 300));

  const rows = await prisma.$queryRaw<
    Array<{ reference_code: string; reference_name: string | null; categoria: string | null; linha: string | null; genero: string | null }>
  >`
    SELECT
      reference_code,
      MIN(reference_name) AS reference_name,
      MIN(NULLIF(TRIM(class_categoria), '')) AS categoria,
      MIN(NULLIF(TRIM(class_linha), '')) AS linha,
      MIN(NULLIF(TRIM(class_genero), '')) AS genero
    FROM produto_analitico
    WHERE ${Prisma.join(condicoes, ' AND ')}
    GROUP BY reference_code
    ORDER BY reference_code
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    referenceCode: r.reference_code,
    referenceName: r.reference_name || r.reference_code,
    categoria: r.categoria,
    linha: r.linha,
    genero: r.genero,
  }));
}
