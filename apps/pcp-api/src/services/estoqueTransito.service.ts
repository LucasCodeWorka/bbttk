import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import { LOJAS_VAREJO_FECHADAS } from '../config/constants.js';

const LOJAS_FECHADAS = new Set<number>(LOJAS_VAREJO_FECHADAS);

// Defasagem tolerada entre a saida mais recente materializada e o fim da janela. Acima
// disso o relatorio avisa sozinho que a foto esta velha - seja porque a materializacao
// nao roda ha dias, seja porque o ETL parou de trazer item de transferencia (ja
// aconteceu entre 25/06 e 13/10/2026). Sem isso o auditor leria a ausencia de saida
// recente como "a rede parou de transferir mercadoria", que e a conclusao errada.
const DIAS_TOLERANCIA_COBERTURA = 15;

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function toDateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export type EstoqueTransitoStatus = 'em_transito' | 'parcial' | 'recebido';

// Desde 14/10/2026 a baixa e sempre por vinculo do TOTVS - o FIFO foi removido do
// calculo. `null` significa que nada foi baixado nessa linha. Os valores 'fifo'/'misto'
// so apareceriam numa foto materializada por uma versao antiga do script.
export type EstoqueTransitoMetodo = 'vinculo' | 'fifo' | 'misto';

export interface EstoqueTransitoFiltro {
  status?: EstoqueTransitoStatus[];
  branches?: number[];
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  statusProduto?: string[];
  search?: string;
  idadeMin?: number;
  idadeMax?: number;
  apenasPendentes?: boolean;
  /** 'vinculo' = saidas que o ERP relaciona a um documento de entrada; 'sem_vinculo' = as que nao. */
  confiabilidade?: 'vinculo' | 'sem_vinculo';
  /** Coluna da ordenacao - precisa ser do servidor, senao paginar embaralha o resultado. */
  ordenarPor?: string;
  direcao?: 'asc' | 'desc';
  offset?: number;
  limite?: number;
  /** Janela do prazo medio por loja (30/90/180 dias). Nao afeta o resto do relatorio. */
  prazoDias?: number;
}

export interface EstoqueTransitoPrazoLoja {
  branchCode: number;
  branchName: string;
  lojaFechada: boolean;
  /** Media de dias entre a saida e a ultima baixa, so de linhas ja encerradas. */
  diasMedio: number;
  diasMediana: number;
  diasMaximo: number;
  linhas: number;
  pecas: number;
}

const PRAZO_DIAS_PERMITIDOS = [30, 90, 180];
const PRAZO_DIAS_PADRAO = 90;

// Ordenacao e feita no banco, nao no navegador. Antes a tela ordenava as 2.000 linhas
// que ja tinham chegado, mas essas 2.000 eram escolhidas por outro criterio (quantidade
// aberta, depois idade) - o resultado era uma amostra enviesada que parecia buraco no
// historico: a tabela pulava de out/2026 pra nov/2025 porque os 11 meses do meio
// (45.360 linhas) nunca entravam no corte.
const COLUNAS_ORDENAVEIS: Record<string, string> = {
  statusTransito: 'status_transito',
  metodoBaixa: 'metodo_baixa',
  entradaDocs: 'entrada_docs',
  destinoBranchName: 'destino_branch_name',
  saidaTransactionCode: 'saida_transaction_code',
  saidaTransactionDate: 'saida_transaction_date',
  diasEmTransito: 'dias_em_transito',
  saidaOperationCode: 'saida_operation_code',
  saidaOperationDescription: 'saida_operation_description',
  productSku: 'product_sku',
  referenceCode: 'reference_code',
  productName: 'product_name',
  colorName: 'color_name',
  size: 'size',
  categoria: 'categoria',
  linha: 'linha',
  genero: 'genero',
  colecao: 'colecao',
  quantidadeSaida: 'quantidade_saida',
  quantidadeRecebida: 'quantidade_recebida',
  quantidadeEmTransito: 'quantidade_em_transito',
  primeiraEntradaDate: 'primeira_entrada_date',
  ultimaEntradaDate: 'ultima_entrada_date',
};

const LIMITE_PADRAO = 2000;
const LIMITE_MAXIMO = 5000;

export interface EstoqueTransitoRow {
  id: number;
  statusTransito: EstoqueTransitoStatus;
  metodoBaixa: EstoqueTransitoMetodo | null;
  temVinculo: boolean;
  entradaDocs: string | null;
  destinoBranchCode: number;
  destinoBranchName: string;
  saidaTransactionCode: number;
  saidaTransactionDate: string;
  saidaOperationCode: number;
  saidaOperationDescription: string | null;
  productCode: number;
  productSku: string | null;
  referenceCode: string | null;
  productName: string | null;
  colorName: string | null;
  size: string | null;
  colecao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  statusProduto: string | null;
  quantidadeSaida: number;
  quantidadeRecebida: number;
  quantidadeEmTransito: number;
  primeiraEntradaDate: string | null;
  ultimaEntradaDate: string | null;
  diasEmTransito: number;
}

export interface EstoqueTransitoResponse {
  atualizadoEm: string | null;
  janela: { inicio: string | null; fim: string | null };
  // Ate onde o dado de origem realmente alcanca, independente da janela pedida: a saida
  // de transferencia mais recente que tem item gravado. Se ficar muito atras do fim da
  // janela, `coberturaDefasagemDias`/`coberturaIncompleta` denunciam a lacuna do ETL.
  cobertura: {
    ultimaSaida: string | null;
    defasagemDias: number | null;
    incompleta: boolean;
  };
  // Paginacao: `rows` e a fatia pedida, `kpis.linhas` e o total do recorte e `temMais`
  // diz se vale buscar a proxima pagina (a tela carrega conforme a rolagem).
  temMais: boolean;
  offset: number;
  limite: number;
  kpis: {
    documentos: number;
    lojas: number;
    linhas: number;
    pecasSaida: number;
    pecasRecebidas: number;
    pecasEmTransito: number;
    pendencias: number;
    parciais: number;
    recebidas: number;
    pendenciasAntigas90d: number;
    pecasLojasFechadas: number;
    /** Pendencia que o ERP confirma documento a documento - e a que vale cobrar. */
    pecasAbertasComVinculo: number;
    /** Pendencia apurada por aproximacao FIFO, sem vinculo no ERP. */
    pecasAbertasSemVinculo: number;
  };
  // Quanto do recorte e fato (vinculo do TOTVS) e quanto e aproximacao (FIFO).
  confiabilidade: {
    linhasComVinculo: number;
    linhasSemVinculo: number;
    pecasComVinculo: number;
    pecasSemVinculo: number;
    primeiraSaidaComVinculo: string | null;
  };
  idadeBuckets: Array<{ label: string; min: number; max: number | null; pecas: number; linhas: number }>;
  porLoja: Array<{ branchCode: number; branchName: string; lojaFechada: boolean; documentos: number; linhas: number; pecasEmTransito: number; maisAntiga: string | null; maisRecente: string | null }>;
  porStatus: Array<{ status: EstoqueTransitoStatus; label: string; linhas: number; pecas: number }>;
  // Prazo medio de entrega por loja. Diferente do resto da resposta, NAO respeita os
  // filtros de recorte (status/idade/busca): ele descreve o desempenho historico da
  // operacao, e filtrar por "so pendentes" deixaria a amostra so com o que nao chegou.
  // O filtro de loja e respeitado, porque ai o usuario quer comparar um subconjunto.
  prazoEntrega: {
    dias: number;
    porLoja: EstoqueTransitoPrazoLoja[];
    mediaGeral: number | null;
    linhasConsideradas: number;
  };
  rows: EstoqueTransitoRow[];
}

export interface EstoqueTransitoFiltrosResponse {
  lojas: Array<{ branch_code: number; branch_name: string }>;
  classificacoes: Array<{ chave: string; label: string; opcoes: Array<{ valor: string; qtd_skus: number }> }>;
}

type RawRow = {
  id: bigint;
  status_transito: EstoqueTransitoStatus;
  metodo_baixa: EstoqueTransitoMetodo | null;
  tem_vinculo: boolean;
  entrada_docs: string | null;
  destino_branch_code: number;
  destino_branch_name: string | null;
  saida_transaction_code: number;
  saida_transaction_date: Date;
  saida_operation_code: number;
  saida_operation_description: string | null;
  product_code: number;
  product_sku: string | null;
  reference_code: string | null;
  product_name: string | null;
  color_name: string | null;
  size: string | null;
  colecao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status_produto: string | null;
  quantidade_saida: Decimal;
  quantidade_recebida: Decimal;
  quantidade_em_transito: Decimal;
  primeira_entrada_date: Date | null;
  ultima_entrada_date: Date | null;
  dias_em_transito: number;
  snapshot_at: Date;
  janela_inicio: Date;
  janela_fim: Date;
};

function buildFiltro(filtro: EstoqueTransitoFiltro): Prisma.Sql {
  const condicoes: Prisma.Sql[] = [];

  if (filtro.apenasPendentes !== false) condicoes.push(Prisma.sql`t.quantidade_em_transito > 0`);
  if (filtro.status?.length) condicoes.push(Prisma.sql`t.status_transito IN (${Prisma.join(filtro.status)})`);
  if (filtro.branches?.length) condicoes.push(Prisma.sql`t.destino_branch_code IN (${Prisma.join(filtro.branches)})`);
  if (filtro.categoria?.length) condicoes.push(Prisma.sql`TRIM(t.categoria) IN (${Prisma.join(filtro.categoria)})`);
  if (filtro.linha?.length) condicoes.push(Prisma.sql`TRIM(t.linha) IN (${Prisma.join(filtro.linha)})`);
  if (filtro.genero?.length) condicoes.push(Prisma.sql`TRIM(t.genero) IN (${Prisma.join(filtro.genero)})`);
  if (filtro.statusProduto?.length) condicoes.push(Prisma.sql`TRIM(t.status_produto) IN (${Prisma.join(filtro.statusProduto)})`);
  if (Number.isFinite(filtro.idadeMin)) condicoes.push(Prisma.sql`t.dias_em_transito >= ${filtro.idadeMin}`);
  if (Number.isFinite(filtro.idadeMax)) condicoes.push(Prisma.sql`t.dias_em_transito <= ${filtro.idadeMax}`);
  if (filtro.confiabilidade === 'vinculo') condicoes.push(Prisma.sql`t.tem_vinculo = true`);
  if (filtro.confiabilidade === 'sem_vinculo') condicoes.push(Prisma.sql`t.tem_vinculo = false`);
  if (filtro.search?.trim()) {
    const termo = `%${filtro.search.trim()}%`;
    condicoes.push(Prisma.sql`(
      t.saida_transaction_code::text ILIKE ${termo}
      OR t.entrada_docs ILIKE ${termo}
      OR t.product_code::text ILIKE ${termo}
      OR t.product_sku ILIKE ${termo}
      OR t.reference_code ILIKE ${termo}
      OR t.product_name ILIKE ${termo}
      OR t.destino_branch_name ILIKE ${termo}
    )`);
  }

  return condicoes.length ? Prisma.sql`WHERE ${Prisma.join(condicoes, ' AND ')}` : Prisma.empty;
}

function statusLabel(status: EstoqueTransitoStatus): string {
  if (status === 'em_transito') return 'Em transito';
  if (status === 'parcial') return 'Parcial';
  return 'Recebido';
}

function mapRow(row: RawRow): EstoqueTransitoRow {
  return {
    id: Number(row.id),
    statusTransito: row.status_transito,
    metodoBaixa: row.metodo_baixa,
    temVinculo: row.tem_vinculo,
    entradaDocs: row.entrada_docs,
    destinoBranchCode: row.destino_branch_code,
    destinoBranchName: row.destino_branch_name || `Filial ${row.destino_branch_code}`,
    saidaTransactionCode: row.saida_transaction_code,
    saidaTransactionDate: toDateString(row.saida_transaction_date) || '',
    saidaOperationCode: row.saida_operation_code,
    saidaOperationDescription: row.saida_operation_description,
    productCode: row.product_code,
    productSku: row.product_sku,
    referenceCode: row.reference_code,
    productName: row.product_name,
    colorName: row.color_name,
    size: row.size,
    colecao: row.colecao,
    categoria: row.categoria,
    linha: row.linha,
    genero: row.genero,
    statusProduto: row.status_produto,
    quantidadeSaida: round(decimalToNumber(row.quantidade_saida), 0),
    quantidadeRecebida: round(decimalToNumber(row.quantidade_recebida), 0),
    quantidadeEmTransito: round(decimalToNumber(row.quantidade_em_transito), 0),
    primeiraEntradaDate: toDateString(row.primeira_entrada_date),
    ultimaEntradaDate: toDateString(row.ultima_entrada_date),
    diasEmTransito: row.dias_em_transito,
  };
}

// Faixas de idade da pendencia. Ficam aqui (nao no SQL) pra o rotulo e o corte
// morarem no mesmo lugar; o CASE da query e gerado a partir desta lista.
const FAIXAS_IDADE: Array<{ label: string; min: number; max: number | null }> = [
  { label: 'Ate 7 dias', min: 0, max: 7 },
  { label: '8 a 15 dias', min: 8, max: 15 },
  { label: '16 a 30 dias', min: 16, max: 30 },
  { label: '31 a 60 dias', min: 31, max: 60 },
  { label: '61 a 90 dias', min: 61, max: 90 },
  { label: '91+ dias', min: 91, max: null },
];

function faixaIdadeSql(): Prisma.Sql {
  const ramos = FAIXAS_IDADE.map((faixa, indice) =>
    faixa.max === null
      ? Prisma.sql`ELSE ${indice}`
      : Prisma.sql`WHEN t.dias_em_transito <= ${faixa.max} THEN ${indice}`
  );
  return Prisma.sql`CASE ${Prisma.join(ramos, ' ')} END`;
}

// Prazo de entrega por loja: media de dias entre a saida da Fabrica e a ultima baixa.
//
// So entra linha JA ENCERRADA (`quantidade_em_transito = 0` com data de baixa), porque
// so nela `dias_em_transito` significa "quanto tempo levou" - na linha aberta o contador
// ainda corre e inflaria a media com mercadoria que nem chegou.
//
// A janela e pela DATA DE SAIDA: "das remessas que sairam nos ultimos N dias, quanto
// tempo levaram". Cortar pela data de baixa misturaria remessas antigas que so foram
// baixadas agora.
async function getPrazoEntregaPorLoja(dias: number, branches?: number[]): Promise<EstoqueTransitoPrazoLoja[]> {
  const filtroLoja = branches?.length
    ? Prisma.sql`AND t.destino_branch_code IN (${Prisma.join(branches)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{
    branch_code: number;
    branch_name: string | null;
    dias_medio: Decimal | null;
    dias_mediana: number | null;
    dias_maximo: number | null;
    linhas: number;
    pecas: Decimal | null;
  }>>`
    SELECT
      t.destino_branch_code AS branch_code,
      MAX(t.destino_branch_name) AS branch_name,
      AVG(t.dias_em_transito) AS dias_medio,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY t.dias_em_transito)::int AS dias_mediana,
      MAX(t.dias_em_transito)::int AS dias_maximo,
      COUNT(*)::int AS linhas,
      SUM(t.quantidade_saida) AS pecas
    FROM pcp_estoque_transito t
    WHERE t.quantidade_em_transito = 0
      AND t.ultima_entrada_date IS NOT NULL
      AND t.saida_transaction_date >= current_date - ${dias}::int
      ${filtroLoja}
    GROUP BY t.destino_branch_code
    ORDER BY AVG(t.dias_em_transito) DESC
  `;

  return rows.map((item) => ({
    branchCode: item.branch_code,
    branchName: item.branch_name || `Filial ${item.branch_code}`,
    lojaFechada: LOJAS_FECHADAS.has(item.branch_code),
    diasMedio: round(decimalToNumber(item.dias_medio), 1),
    diasMediana: item.dias_mediana ?? 0,
    diasMaximo: item.dias_maximo ?? 0,
    linhas: item.linhas,
    pecas: round(decimalToNumber(item.pecas), 0),
  }));
}

export async function getEstoqueTransito(filtro: EstoqueTransitoFiltro = {}): Promise<EstoqueTransitoResponse> {
  const filtroSql = buildFiltro(filtro);
  const lojasFechadasSql = LOJAS_FECHADAS.size > 0 ? Prisma.join(Array.from(LOJAS_FECHADAS)) : Prisma.sql`NULL`;

  const offset = Math.max(0, Math.floor(filtro.offset ?? 0));
  const limite = Math.min(Math.max(1, Math.floor(filtro.limite ?? LIMITE_PADRAO)), LIMITE_MAXIMO);

  // `t.id` no fim e o desempate: sem ordem total, paginar por OFFSET pode repetir ou
  // pular linha quando ha empate na coluna escolhida.
  const coluna = COLUNAS_ORDENAVEIS[filtro.ordenarPor ?? ''];
  const direcao = filtro.direcao === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const ordenacaoSql = coluna
    ? Prisma.sql`${Prisma.raw(`t.${coluna}`)} ${direcao} NULLS LAST, t.id ASC`
    : Prisma.sql`t.quantidade_em_transito DESC, t.dias_em_transito DESC, t.saida_transaction_date DESC, t.id ASC`;

  // As linhas vem com LIMIT (a tabela de auditoria nao precisa de 40 mil linhas no
  // navegador), mas TODA agregacao e feita em SQL sobre o conjunto filtrado inteiro.
  // Somar em memoria sobre as linhas limitadas dava total errado sem avisar - era o
  // caso de `apenasPendentes=false`, onde o recorte estourava o limite e os KPIs
  // passavam a descrever so as 2000 primeiras linhas.
  const prazoDias = PRAZO_DIAS_PERMITIDOS.includes(filtro.prazoDias ?? 0)
    ? (filtro.prazoDias as number)
    : PRAZO_DIAS_PADRAO;

  const [rowsRaw, meta, kpisRaw, faixasRaw, porLojaRaw, porStatusRaw, prazoRaw] = await Promise.all([
    prisma.$queryRaw<RawRow[]>`
      SELECT *
      FROM pcp_estoque_transito t
      ${filtroSql}
      ORDER BY ${ordenacaoSql}
      LIMIT ${limite} OFFSET ${offset}
    `,

    // Sem filtro de proposito: descreve a FOTO inteira, nao o recorte. `primeira_saida_com_vinculo`
    // e a data a partir da qual o TOTVS passou a gravar a amarracao - afirmar isso a partir
    // do recorte filtrado daria uma data que muda conforme o filtro do usuario.
    prisma.$queryRaw<Array<{ atualizado_em: Date | null; janela_inicio: Date | null; janela_fim: Date | null; ultima_saida: Date | null; defasagem_dias: number | null; primeira_saida_com_vinculo: Date | null }>>`
      SELECT
        MAX(snapshot_at) AS atualizado_em,
        MIN(janela_inicio) AS janela_inicio,
        MAX(janela_fim) AS janela_fim,
        MAX(saida_transaction_date) AS ultima_saida,
        (MAX(janela_fim) - MAX(saida_transaction_date))::int AS defasagem_dias,
        MIN(saida_transaction_date) FILTER (WHERE tem_vinculo) AS primeira_saida_com_vinculo
      FROM pcp_estoque_transito
    `,

    prisma.$queryRaw<Array<{
      documentos: number;
      lojas: number;
      linhas: number;
      pecas_saida: Decimal | null;
      pecas_recebidas: Decimal | null;
      pecas_em_transito: Decimal | null;
      pendencias: number;
      parciais: number;
      recebidas: number;
      pendencias_antigas_90d: Decimal | null;
      pecas_lojas_fechadas: Decimal | null;
      pecas_abertas_com_vinculo: Decimal | null;
      pecas_abertas_sem_vinculo: Decimal | null;
      linhas_com_vinculo: number;
      linhas_sem_vinculo: number;
      pecas_com_vinculo: Decimal | null;
      pecas_sem_vinculo: Decimal | null;
    }>>`
      SELECT
        COUNT(DISTINCT t.saida_transaction_code)::int AS documentos,
        COUNT(DISTINCT t.destino_branch_code)::int AS lojas,
        COUNT(*)::int AS linhas,
        SUM(t.quantidade_saida) AS pecas_saida,
        SUM(t.quantidade_recebida) AS pecas_recebidas,
        SUM(t.quantidade_em_transito) AS pecas_em_transito,
        COUNT(*) FILTER (WHERE t.status_transito = 'em_transito')::int AS pendencias,
        COUNT(*) FILTER (WHERE t.status_transito = 'parcial')::int AS parciais,
        COUNT(*) FILTER (WHERE t.status_transito = 'recebido')::int AS recebidas,
        COALESCE(SUM(t.quantidade_em_transito) FILTER (WHERE t.quantidade_em_transito > 0 AND t.dias_em_transito > 90), 0) AS pendencias_antigas_90d,
        COALESCE(SUM(t.quantidade_em_transito) FILTER (WHERE t.destino_branch_code IN (${lojasFechadasSql})), 0) AS pecas_lojas_fechadas,
        COALESCE(SUM(t.quantidade_em_transito) FILTER (WHERE t.tem_vinculo), 0) AS pecas_abertas_com_vinculo,
        COALESCE(SUM(t.quantidade_em_transito) FILTER (WHERE NOT t.tem_vinculo), 0) AS pecas_abertas_sem_vinculo,
        COUNT(*) FILTER (WHERE t.tem_vinculo)::int AS linhas_com_vinculo,
        COUNT(*) FILTER (WHERE NOT t.tem_vinculo)::int AS linhas_sem_vinculo,
        COALESCE(SUM(t.quantidade_saida) FILTER (WHERE t.tem_vinculo), 0) AS pecas_com_vinculo,
        COALESCE(SUM(t.quantidade_saida) FILTER (WHERE NOT t.tem_vinculo), 0) AS pecas_sem_vinculo
      FROM pcp_estoque_transito t
      ${filtroSql}
    `,

    prisma.$queryRaw<Array<{ faixa: number; linhas: number; pecas: Decimal | null }>>`
      SELECT ${faixaIdadeSql()} AS faixa, COUNT(*)::int AS linhas, SUM(t.quantidade_em_transito) AS pecas
      FROM pcp_estoque_transito t
      ${filtroSql}
      GROUP BY 1
    `,

    prisma.$queryRaw<Array<{ branch_code: number; branch_name: string | null; documentos: number; linhas: number; pecas: Decimal | null; mais_antiga: Date | null; mais_recente: Date | null }>>`
      SELECT
        t.destino_branch_code AS branch_code,
        MAX(t.destino_branch_name) AS branch_name,
        COUNT(DISTINCT t.saida_transaction_code)::int AS documentos,
        COUNT(*)::int AS linhas,
        SUM(t.quantidade_em_transito) AS pecas,
        MIN(t.saida_transaction_date) AS mais_antiga,
        MAX(t.saida_transaction_date) AS mais_recente
      FROM pcp_estoque_transito t
      ${filtroSql}
      GROUP BY t.destino_branch_code
      ORDER BY SUM(t.quantidade_em_transito) DESC
    `,

    prisma.$queryRaw<Array<{ status: EstoqueTransitoStatus; linhas: number; pecas: Decimal | null }>>`
      SELECT t.status_transito AS status, COUNT(*)::int AS linhas, SUM(t.quantidade_em_transito) AS pecas
      FROM pcp_estoque_transito t
      ${filtroSql}
      GROUP BY t.status_transito
      ORDER BY SUM(t.quantidade_em_transito) DESC
    `,

    getPrazoEntregaPorLoja(prazoDias, filtro.branches),
  ]);

  const rows = rowsRaw.map(mapRow);
  const kpisRow = kpisRaw[0];
  const defasagemDias = meta[0]?.defasagem_dias ?? null;
  const linhasTotais = kpisRow?.linhas ?? 0;

  const faixasPorIndice = new Map(faixasRaw.map((item) => [Number(item.faixa), item]));

  return {
    atualizadoEm: meta[0]?.atualizado_em?.toISOString() || null,
    janela: {
      inicio: toDateString(meta[0]?.janela_inicio),
      fim: toDateString(meta[0]?.janela_fim),
    },
    cobertura: {
      ultimaSaida: toDateString(meta[0]?.ultima_saida),
      defasagemDias,
      incompleta: defasagemDias !== null && defasagemDias > DIAS_TOLERANCIA_COBERTURA,
    },
    temMais: offset + rows.length < linhasTotais,
    offset,
    limite,
    kpis: {
      documentos: kpisRow?.documentos ?? 0,
      lojas: kpisRow?.lojas ?? 0,
      linhas: linhasTotais,
      pecasSaida: round(decimalToNumber(kpisRow?.pecas_saida), 0),
      pecasRecebidas: round(decimalToNumber(kpisRow?.pecas_recebidas), 0),
      pecasEmTransito: round(decimalToNumber(kpisRow?.pecas_em_transito), 0),
      pendencias: kpisRow?.pendencias ?? 0,
      parciais: kpisRow?.parciais ?? 0,
      recebidas: kpisRow?.recebidas ?? 0,
      pendenciasAntigas90d: round(decimalToNumber(kpisRow?.pendencias_antigas_90d), 0),
      pecasLojasFechadas: round(decimalToNumber(kpisRow?.pecas_lojas_fechadas), 0),
      pecasAbertasComVinculo: round(decimalToNumber(kpisRow?.pecas_abertas_com_vinculo), 0),
      pecasAbertasSemVinculo: round(decimalToNumber(kpisRow?.pecas_abertas_sem_vinculo), 0),
    },
    confiabilidade: {
      linhasComVinculo: kpisRow?.linhas_com_vinculo ?? 0,
      linhasSemVinculo: kpisRow?.linhas_sem_vinculo ?? 0,
      pecasComVinculo: round(decimalToNumber(kpisRow?.pecas_com_vinculo), 0),
      pecasSemVinculo: round(decimalToNumber(kpisRow?.pecas_sem_vinculo), 0),
      primeiraSaidaComVinculo: toDateString(meta[0]?.primeira_saida_com_vinculo),
    },
    idadeBuckets: FAIXAS_IDADE.map((faixa, indice) => {
      const encontrada = faixasPorIndice.get(indice);
      return {
        label: faixa.label,
        min: faixa.min,
        max: faixa.max,
        pecas: round(decimalToNumber(encontrada?.pecas), 0),
        linhas: encontrada?.linhas ?? 0,
      };
    }),
    porLoja: porLojaRaw.map((item) => ({
      branchCode: item.branch_code,
      branchName: item.branch_name || `Filial ${item.branch_code}`,
      lojaFechada: LOJAS_FECHADAS.has(item.branch_code),
      documentos: item.documentos,
      linhas: item.linhas,
      pecasEmTransito: round(decimalToNumber(item.pecas), 0),
      maisAntiga: toDateString(item.mais_antiga),
      maisRecente: toDateString(item.mais_recente),
    })),
    porStatus: porStatusRaw.map((item) => ({
      status: item.status,
      label: statusLabel(item.status),
      linhas: item.linhas,
      pecas: round(decimalToNumber(item.pecas), 0),
    })),
    prazoEntrega: {
      dias: prazoDias,
      porLoja: prazoRaw,
      // Media ponderada por LINHA, nao media das medias: loja com 1.000 remessas pesa
      // mais que uma com 50, que e o que descreve a operacao de verdade.
      mediaGeral: prazoRaw.length
        ? round(
            prazoRaw.reduce((total, l) => total + l.diasMedio * l.linhas, 0) /
              prazoRaw.reduce((total, l) => total + l.linhas, 0),
            1
          )
        : null,
      linhasConsideradas: prazoRaw.reduce((total, l) => total + l.linhas, 0),
    },
    rows,
  };
}

export async function getFiltrosEstoqueTransito(): Promise<EstoqueTransitoFiltrosResponse> {
  const lojas = await prisma.$queryRaw<Array<{ branch_code: number; branch_name: string }>>`
    SELECT DISTINCT destino_branch_code AS branch_code, destino_branch_name AS branch_name
    FROM pcp_estoque_transito
    ORDER BY destino_branch_name
  `;

  const dimensoes = [
    { chave: 'categoria', label: 'Categoria', coluna: 'categoria' },
    { chave: 'linha', label: 'Linha', coluna: 'linha' },
    { chave: 'genero', label: 'Genero', coluna: 'genero' },
    { chave: 'statusProduto', label: 'Status', coluna: 'status_produto' },
  ];

  const classificacoes = [];
  for (const dimensao of dimensoes) {
    const rows = await prisma.$queryRawUnsafe<Array<{ valor: string; qtd_skus: number }>>(`
      SELECT TRIM(${dimensao.coluna}) AS valor, COUNT(DISTINCT product_sku)::int AS qtd_skus
      FROM pcp_estoque_transito
      WHERE ${dimensao.coluna} IS NOT NULL AND TRIM(${dimensao.coluna}) <> ''
      GROUP BY TRIM(${dimensao.coluna})
      ORDER BY valor
    `);
    classificacoes.push({ chave: dimensao.chave, label: dimensao.label, opcoes: rows });
  }

  return { lojas, classificacoes };
}
