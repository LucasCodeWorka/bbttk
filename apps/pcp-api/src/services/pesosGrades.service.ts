import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { SALE_OPERATION_FILTER, QUANTIDADE_COM_SINAL, OPERACAO_JOIN, joinProdutoAnaliticoUnico } from './relatorioBase.service.js';

// Relatorio de Pesos e Grades para Producao ("Rel. 3"): a partir da venda GERAL
// (atacado + varejo somados, sem separar canal - diferente do resto do PCP) de um
// periodo, calcula a frequencia de corte por tamanho de cada referencia:
// frequencia = CEIL(quantidade_vendida_do_tamanho / fator_divisor).

export type TipoAnalisePesosGrades = 'item' | 'categoria';

export interface PesosGradesFiltro {
  tipoAnalise: TipoAnalisePesosGrades;
  referencias?: string[];
  categorias?: string[];
  linhas?: string[];
  generos?: string[];
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
  totalVendido: number;
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

// Ordem fixa pedida pelo cliente: UN P M G GG 2 4 6 8 10. Tamanho fora dessa lista
// (PP, 12, 14, 36-44, numeracao de calcado...) vai pro fim, desempatado por ordem
// numerica/alfabetica - sao 46 tamanhos distintos no cadastro, a lista cobre so os
// principais de proposito.
const ORDEM_GRADES = ['UN', 'P', 'M', 'G', 'GG', '2', '4', '6', '8', '10'];

function ordemGrade(tamanho: string): number {
  const normalizado = normalizarTamanho(tamanho);
  const indice = ORDEM_GRADES.indexOf(normalizado);
  return indice < 0 ? ORDEM_GRADES.length : indice;
}

// O cadastro do TOTVS grava tamanho unico como "U" (1.344 SKUs), nunca "UN"/"UNICO" -
// sem normalizar, 'UN' da lista acima nao casava com nada e todo produto de tamanho
// unico era ordenado por ULTIMO em vez de primeiro.
function normalizarTamanho(tamanho: string): string {
  const t = tamanho.trim().toUpperCase();
  if (t === 'U' || t === 'UNICO' || t === 'ÚNICO' || t === 'UN') return 'UN';
  return t;
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
    SELECT TRIM(a.class_categoria) AS reference_code, CONCAT('Categoria: ', TRIM(a.class_categoria)) AS reference_name
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE a.reference_code IS NOT NULL
      AND TRIM(a.class_categoria) IN (${Prisma.join(categorias)})
      ${filtro.linhas?.length ? Prisma.sql`AND TRIM(a.class_linha) IN (${Prisma.join(filtro.linhas)})` : Prisma.empty}
      ${filtro.generos?.length ? Prisma.sql`AND TRIM(a.class_genero) IN (${Prisma.join(filtro.generos)})` : Prisma.empty}
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
    GROUP BY TRIM(a.class_categoria)
  `;
}

interface GradeRow {
  reference_code: string;
  size: string;
}

// Grade CADASTRADA de cada referencia/categoria (todos os tamanhos que existem no
// cadastro, tenham vendido ou nao). E o que permite mostrar "zero onde nao houve venda
// naquele tamanho": sem isso, tamanho sem venda simplesmente nao aparece, porque a
// query de venda so devolve o que foi vendido.
// Nao usamos a lista fixa ORDEM_GRADES como universo de proposito - a maioria das
// referencias tem 3 a 6 tamanhos, e um produto de tamanho unico ficaria com 9 colunas
// de zero sem sentido. Alem disso existem tamanhos reais fora da lista (PP, 12, 14,
// numeracao de calcado) que precisam aparecer.
async function getGradeCadastrada(filtro: PesosGradesFiltro, grupos: string[]): Promise<GradeRow[]> {
  if (grupos.length === 0) return [];
  if (filtro.tipoAnalise === 'categoria') {
    return prisma.$queryRaw<GradeRow[]>`
      SELECT TRIM(a.class_categoria) AS reference_code, TRIM(a.size) AS size
      FROM produto_analitico a
      LEFT JOIN produtos p ON p.product_sku = a.product_sku
      WHERE TRIM(a.class_categoria) IN (${Prisma.join(grupos)})
        ${filtro.linhas?.length ? Prisma.sql`AND TRIM(a.class_linha) IN (${Prisma.join(filtro.linhas)})` : Prisma.empty}
        ${filtro.generos?.length ? Prisma.sql`AND TRIM(a.class_genero) IN (${Prisma.join(filtro.generos)})` : Prisma.empty}
        AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
        AND a.size IS NOT NULL AND TRIM(a.size) NOT IN ('', '.')
      GROUP BY TRIM(a.class_categoria), TRIM(a.size)
    `;
  }
  return prisma.$queryRaw<GradeRow[]>`
    SELECT a.reference_code, TRIM(a.size) AS size
    FROM produto_analitico a
    LEFT JOIN produtos p ON p.product_sku = a.product_sku
    WHERE a.reference_code IN (${Prisma.join(grupos)})
      AND (p.is_finished_product = true OR p.is_finished_product IS NULL)
      AND a.size IS NOT NULL AND TRIM(a.size) NOT IN ('', '.')
    GROUP BY a.reference_code, TRIM(a.size)
  `;
}

interface VendaRow {
  reference_code: string;
  size: string;
  quantidade: Decimal;
}

// Venda GERAL (atacado + varejo somados - sem filtro de canal/loja de proposito,
// pedido explicito do spec) por referencia + tamanho, liquida de devolucao.
async function getVendaPorReferenciaTamanho(filtro: PesosGradesFiltro, grupos: string[]): Promise<VendaRow[]> {
  const { dataInicio, dataFim } = filtro;
  if (grupos.length === 0) return [];
  if (filtro.tipoAnalise === 'categoria') {
    return prisma.$queryRaw<VendaRow[]>`
      SELECT TRIM(a.class_categoria) AS reference_code, TRIM(a.size) AS size, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
      ${joinProdutoAnaliticoUnico('ti.product_code', 'INNER')}
      ${OPERACAO_JOIN}
      WHERE t.transaction_date >= ${dataInicio}::date AND t.transaction_date <= ${dataFim}::date
        AND t.status = 4 AND ${SALE_OPERATION_FILTER}
        AND TRIM(a.class_categoria) IN (${Prisma.join(grupos)})
        ${filtro.linhas?.length ? Prisma.sql`AND TRIM(a.class_linha) IN (${Prisma.join(filtro.linhas)})` : Prisma.empty}
        ${filtro.generos?.length ? Prisma.sql`AND TRIM(a.class_genero) IN (${Prisma.join(filtro.generos)})` : Prisma.empty}
        AND a.size IS NOT NULL AND TRIM(a.size) NOT IN ('', '.')
      GROUP BY TRIM(a.class_categoria), TRIM(a.size)
    `;
  }
  return prisma.$queryRaw<VendaRow[]>`
    SELECT a.reference_code, TRIM(a.size) AS size, SUM(${QUANTIDADE_COM_SINAL}) AS quantidade
    FROM transacoes t
    JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code AND ti.seller_code != 1
    ${joinProdutoAnaliticoUnico('ti.product_code', 'INNER')}
    ${OPERACAO_JOIN}
    WHERE t.transaction_date >= ${dataInicio}::date
      AND t.transaction_date <= ${dataFim}::date
      AND t.status = 4
      AND ${SALE_OPERATION_FILTER}
      AND a.reference_code IN (${Prisma.join(grupos)})
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
  const [vendaRows, gradeRows] = await Promise.all([
    getVendaPorReferenciaTamanho(filtro, referenceCodes),
    getGradeCadastrada(filtro, referenceCodes),
  ]);

  const vendaPorRef = new Map<string, Map<string, number>>();
  for (const row of vendaRows) {
    const mapa = vendaPorRef.get(row.reference_code) || new Map<string, number>();
    mapa.set(row.size, decimalToNumber(row.quantidade));
    vendaPorRef.set(row.reference_code, mapa);
  }

  const gradePorRef = new Map<string, Set<string>>();
  for (const row of gradeRows) {
    const set = gradePorRef.get(row.reference_code) || new Set<string>();
    set.add(row.size);
    gradePorRef.set(row.reference_code, set);
  }

  const referencias: PesosGradesReferencia[] = identidade
    .map((r) => {
      const vendas = vendaPorRef.get(r.reference_code) || new Map<string, number>();
      // Universo de tamanhos = grade cadastrada + qualquer tamanho que apareceu na
      // venda mas nao esta mais no cadastro (produto descontinuado, por exemplo) -
      // esconder uma venda real seria pior do que mostrar um tamanho a mais.
      const universo = new Set<string>([...(gradePorRef.get(r.reference_code) || []), ...vendas.keys()]);

      const tamanhos: PesosGradesTamanho[] = [...universo]
        .map((tamanho) => {
          // Venda liquida de devolucao pode dar negativo; pro corte de producao isso
          // equivale a nao ter venda, entao vira 0 em vez de quantidade negativa.
          const quantidade = Math.max(vendas.get(tamanho) || 0, 0);
          return {
            tamanho,
            quantidadeVendida: quantidade,
            frequencia: Math.ceil(quantidade / filtro.fatorDivisor),
          };
        })
        .sort((a, b) => ordemGrade(a.tamanho) - ordemGrade(b.tamanho) || a.tamanho.localeCompare(b.tamanho, undefined, { numeric: true }));

      const totalVendido = tamanhos.reduce((total, tamanho) => total + tamanho.quantidadeVendida, 0);
      return {
        referenceCode: r.reference_code,
        descricao: r.reference_name || r.reference_code,
        // Referencia que nao vendeu NADA no periodo continua fora da tela (a tela filtra
        // por tamanhos.length). O zero-fill e pros tamanhos DENTRO de um produto que
        // vendeu, que e o que foi pedido: "zero onde nao houver venda naquele tamanho".
        tamanhos: totalVendido > 0 ? tamanhos : [],
        totalVendido,
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
