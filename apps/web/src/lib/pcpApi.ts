const PCP_API_URL = process.env.NEXT_PUBLIC_PCP_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

interface FetchOptions extends RequestInit {
  token?: string;
}

async function fetchPcpApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${PCP_API_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export interface PcpClassificacaoOpcao {
  valor: string;
  qtd_skus: number;
}

export interface PcpClassificacaoDimensao {
  chave: 'categoria' | 'linha' | 'genero' | 'status' | 'statusProduto';
  label: string;
  opcoes: PcpClassificacaoOpcao[];
}

export interface PcpLojaFiltro {
  branch_code: number;
  branch_name: string;
}

export interface EstoqueSemGiroFiltro {
  dias?: number;
  branches?: number[];
  cobertura?: '6-12' | '12-24' | '24+';
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  limit?: number | 'all';
}

export interface EstoqueSemGiroResumoItem {
  dias: number;
  label: string;
  sku_count: number;
  ref_count: number;
  quantidade: number;
  valor: number;
  pct_total: number;
}

export interface EstoqueSemGiroResumoLoja {
  branch_code: number;
  branch_name: string;
  sku_count: number;
  quantidade: number;
  valor: number;
  pct_quantidade: number;
}

export interface EstoqueSemGiroSku {
  sku: string;
  referencia: string;
  descricao: string;
  colecao: string | null;
  grade: string | null;
  cor_de_para: string | null;
  dias_sem_giro: number;
  ultima_venda: string | null;
  lojas_total: number;
  lojas_sem_venda: number;
  quantidade: number;
  valor: number;
  cobertura_meses: number | null;
  lojas: {
    branch_code: number;
    branch_name: string;
    quantidade: number;
  }[];
}

export interface EstoqueSemGiroResponse {
  atualizado_em: string | null;
  dias_selecionado: number;
  resumo: EstoqueSemGiroResumoItem[];
  total: {
    sku_count: number;
    quantidade: number;
    valor: number;
  };
  lojas: PcpLojaFiltro[];
  resumo_lojas: EstoqueSemGiroResumoLoja[];
  top_skus: EstoqueSemGiroSku[];
}

export interface EstoqueSemGiroFiltrosResponse {
  classificacoes: PcpClassificacaoDimensao[];
  lojas: PcpLojaFiltro[];
}

function appendList(params: URLSearchParams, key: string, values?: Array<string | number>) {
  if (values && values.length > 0) {
    params.set(key, values.join(','));
  }
}

export const pcpApi = {
  getEstoqueSemGiro: (token: string, filtro: EstoqueSemGiroFiltro = {}) => {
    const params = new URLSearchParams();
    if (filtro.dias) params.set('dias', String(filtro.dias));
    if (filtro.cobertura) params.set('cobertura', filtro.cobertura);
    if (filtro.limit) params.set('limit', String(filtro.limit));
    appendList(params, 'branches', filtro.branches);
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);

    const query = params.toString();
    return fetchPcpApi<EstoqueSemGiroResponse>(`/api/pcp/estoque-sem-giro${query ? `?${query}` : ''}`, { token });
  },

  getFiltrosEstoqueSemGiro: (token: string) =>
    fetchPcpApi<EstoqueSemGiroFiltrosResponse>('/api/pcp/estoque-sem-giro/filtros', { token }),
};

// Relatorio Base
export interface RelatorioBaseFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  branches?: number[];
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface RelatorioBaseColunaFilial {
  giro: number;
  est: number;
  cob: number | null;
}

export interface RelatorioBaseRow {
  sku: string;
  codigo: number | null;
  referenceCode: string;
  cor: string;
  tamanho: string;
  refCorTam: string;
  descricao: string;
  descricaoCompleta: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  modelo: string | null;
  status: string | null;
  lancamento: string | null;
  ultimaEntrada: string | null;
  custo: number | null;
  pdvAtual: number | null;
  pdvRealVar: number | null;
  markupVar: number | null;
  pdvRealAta: number | null;
  markupAta: number | null;
  estDisponivel: null;
  emProducao: number;
  estPrevisto: null;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
}

export interface RelatorioBaseReferenciaRow {
  referenceCode: string;
  referenceName: string;
  totalSkus: number;
  descricao: string;
  descricaoCompleta: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  modelo: string | null;
  status: string | null;
  lancamento: string | null;
  ultimaEntrada: string | null;
  custo: number | null;
  pdvAtual: number | null;
  pdvRealVar: number | null;
  markupVar: number | null;
  pdvRealAta: number | null;
  markupAta: number | null;
  emProducao: number;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
  skus: RelatorioBaseRow[];
}

export interface RelatorioBaseResponse {
  config: {
    giroDias: number;
    coberturaMeses: number;
    atacadoCoberturaBase: string;
    coberturaLimiteVerde: number;
    coberturaLimiteVermelho: number;
  };
  kpis: { giroTt1: number; giroTt3: number; giroTt6: number; estTt: number; skuCount: number };
  kpisExtra: RelatorioBaseKpisExtra;
  matriz: {
    linha: RelatorioBaseMatrizLinha[];
    categoria: RelatorioBaseMatrizLinha[];
    genero: RelatorioBaseMatrizLinha[];
  };
  pagination: { page: number; pageSize: number; totalReferencias: number; totalPages: number };
  colunas: { branchCode: number; label: string }[];
  rows: RelatorioBaseReferenciaRow[];
}

export interface RelatorioBaseKpisExtra {
  coberturaGeral: number | null;
  coberturaVarejo: number | null;
  coberturaAtacado: number | null;
  giroAnualizado: number;
  valorEstoqueTotal: number;
  estoqueMortoQtd: number;
  estoqueMortoValor: number;
  estoqueMortoPercent: number;
  coberturaBasico: number | null;
  coberturaBasicoRenovavel: number | null;
  coberturaColecao: number | null;
  referenciasComEstoque: number;
  statusBreakdown: { status: string; estTt: number; percent: number }[];
}

export interface RelatorioBaseMatrizLinha {
  label: string;
  estoqueVarejo: number;
  estoqueAtacado: number;
  estoqueTotal: number;
  valorEstoque: number;
  coberturaVarejo: number | null;
  coberturaAtacado: number | null;
  coberturaGeral: number | null;
}

export interface RelatorioBaseFiltrosResponse {
  classificacoes: PcpClassificacaoDimensao[];
  colunas: { branchCode: number; label: string }[];
}

export const relatorioBaseApi = {
  getRelatorioBase: (token: string, filtro: RelatorioBaseFiltro = {}) => {
    const params = new URLSearchParams();
    if (filtro.search) params.set('search', filtro.search);
    if (filtro.page) params.set('page', String(filtro.page));
    if (filtro.pageSize) params.set('pageSize', String(filtro.pageSize));
    appendList(params, 'branches', filtro.branches);
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);
    appendList(params, 'status', filtro.status);

    const query = params.toString();
    return fetchPcpApi<RelatorioBaseResponse>(`/api/pcp/relatorio-base${query ? `?${query}` : ''}`, { token });
  },

  getFiltrosRelatorioBase: (token: string) =>
    fetchPcpApi<RelatorioBaseFiltrosResponse>('/api/pcp/relatorio-base/filtros', { token }),
};

// ---- Visao Geral (indicadores extra, reusados de Analise de Grade/Estoque Sem
// Giro/Curva ABC - ver apps/pcp-api/src/services/visaoGeral.service.ts) ----

export interface VisaoGeralExtrasResponse {
  meta: {
    metaCoberturaGeralMeses: number;
    metaGiroAnualizado: number;
    metaEstoqueMortoPercent: number;
    metaCoberturaBasicoMeses: number;
    metaCoberturaColecaoMeses: number;
  };
  skusEmRisco: {
    percent: number;
    referenciasCriticas: number;
    skusEmRiscoTotal: number;
    totalSkus: number;
  };
  estoqueSemGiro: { dias: number; label: string; sku_count: number; quantidade: number; valor: number; pct_total: number }[];
  curvaAbc: { curva: 'A' | 'B' | 'C'; percentDoTotal: number }[];
}

export interface VisaoGeralExtrasFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  branches?: number[];
}

// ---- Analise de Grade ----

export type AnaliseGradeStatusReferencia = 'saudavel' | 'atencao' | 'critica';
export type AnaliseGradeStatusSku = 'ok' | 'risco';

export interface PcpGradeDetalheSku {
  sku: string;
  refCorTam: string;
  cor: string;
  tamanho: string;
  estoque: number;
  emProducao: number;
  vendaMes1: number;
  vendaMes2: number;
  vendaMes3: number;
  mediaMensal: number;
  cobertura: number | null;
  status: AnaliseGradeStatusSku;
}

export interface PcpGradeSaldoFilial {
  branchCode: number;
  branchName: string;
  estoque: number;
}

export interface PcpGradeReferencia {
  referenceCode: string;
  referenceName: string;
  curva: CurvaLetra;
  estoqueTotal: number;
  emProducao: number;
  vendaMes1: number;
  vendaMes2: number;
  vendaMes3: number;
  mediaMensal: number;
  coberturaGeral: number | null;
  totalSkus: number;
  skusEmRisco: number;
  percentGradeEmRisco: number;
  status: AnaliseGradeStatusReferencia;
  prioridade: number;
  detalhes: PcpGradeDetalheSku[];
  saldoPorFilial: PcpGradeSaldoFilial[];
}

export interface AnaliseGradeResponse {
  config: {
    mesesFechados: number;
    riscoCoberturaMeses: number;
    statusAtencaoLimitePercent: number;
    meses: string[];
  };
  referencias: PcpGradeReferencia[];
  indicadores: {
    referenciasTotal: number;
    referenciasCriticas: number;
    skusEmRiscoTotal: number;
    totalSkus: number;
    percentSkusEmRisco: number;
  };
}

export interface CurvaAbcTamanhoResponse {
  meses: number;
  linhas: Array<{ size: string; giro: number; percentVendas: number; percentAcumulado: number; classe: 'A' | 'B' | 'C' }>;
}

export interface AnaliseGradeFiltro {
  referencia?: string;
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  cor?: string[];
  branches?: number[];
}

// ---- Curva ABC (produto) ----

export type CurvaLetra = 'A' | 'B' | 'C';
export type CurvaGrupo = CurvaLetra | 'SEM_VENDA';

export interface CurvaLinhaBucket {
  bucket: string;
  quantidade: number;
  valorReais: number;
  percentDoValorCurva: number;
}

export interface ReferenciaAbc {
  referenceCode: string;
  referenceName: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status: string | null;
  lancamento: string | null;
  ultimaEntrada: string | null;
  curva: CurvaGrupo;
  rankQtd: number;
  rankCurva: number;
  qtdVendida: number;
  mediaMensal: number;
  giro90dPercent: number | null;
  giro30dPercent: number | null;
  totalSkus: number;
  mediaPorSku: number;
  mediaPorSkuAnterior: number;
  tendenciaMediaSku: 'up' | 'down' | 'flat';
  rankValor: number;
  valorReais: number;
  valorMedioMensal: number;
  representatividadeValor: number;
  representatividadeAcumulada: number;
  estoqueAtacado: number;
  estoqueVarejo: number;
  estoqueTotal: number;
  valorEstoqueCusto: number;
}

export interface CurvaResumo {
  curva: CurvaLetra;
  totalReferencias: number;
  quantidade: number;
  valorReais: number;
  totalSkus: number;
  mediaMensal: number;
  percentDoTotal: number;
  porLinha: CurvaLinhaBucket[];
}

export interface VendaEstoqueResumoLinha {
  grupo: CurvaGrupo | 'TOTAL';
  totalReferencias: number;
  percentReferencias: number;
  qtdVendida: number;
  valorVenda: number;
  percentValorVenda: number;
  estoquePecas: number;
  valorEstoqueCusto: number;
  percentValorEstoque: number;
}

export interface CurvaAbcResumoResponse {
  config: { giroDias: number; mesesFechados: number; curvaALimitePercent: number; curvaBLimitePercent: number; curvaCLimitePercent: number };
  totalAnalisadas: number;
  totalSemVenda: number;
  curvas: CurvaResumo[];
  resumoVendaEstoque: VendaEstoqueResumoLinha[];
  referencias: ReferenciaAbc[];
}

export interface SkuAbc {
  sku: string;
  refCorTam: string;
  referenceCode: string;
  referenceName: string;
  cor: string;
  tamanho: string;
  curva: CurvaLetra;
  rankQtd: number;
  qtdVendida: number;
  mediaMensal: number;
  giro90dPercent: number | null;
  giro30dPercent: number | null;
  rankValor: number;
  valorReais: number;
  valorMedioMensal: number;
  representatividadeValor: number;
  representatividadeAcumulada: number;
  estoqueAtacado: number;
  estoqueVarejo: number;
  estoqueTotal: number;
}

export interface SkuCurvaResumo {
  curva: CurvaLetra;
  totalItens: number;
  quantidade: number;
  valorReais: number;
  mediaMensal: number;
  percentDoTotal: number;
  porLinha: CurvaLinhaBucket[];
}

export interface CurvaAbcResumoSkuResponse {
  config: { mesesFechados: number; curvaALimitePercent: number; curvaBLimitePercent: number; curvaCLimitePercent: number };
  totalAnalisadas: number;
  curvas: SkuCurvaResumo[];
  itens: SkuAbc[];
}

export interface CurvaAbcSkuLinha {
  sku: string;
  refCorTam: string;
  referenceCode: string | null;
  referenceName: string | null;
  qtdVendida: number;
  valorReais: number;
  estoqueVarejo: number;
  estoqueAtacado: number;
}

export interface CurvaAbcSkusResponse {
  total: number;
  page: number;
  pageSize: number;
  linhas: CurvaAbcSkuLinha[];
}

export interface CurvaAbcFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  familia?: string[];
}

export const visaoGeralApi = {
  getVisaoGeralExtras: (token: string, filtro: VisaoGeralExtrasFiltro = {}) => {
    const params = new URLSearchParams();
    appendList(params, 'branches', filtro.branches);
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);
    appendList(params, 'status', filtro.status);
    const query = params.toString();
    return fetchPcpApi<VisaoGeralExtrasResponse>(`/api/pcp/visao-geral${query ? `?${query}` : ''}`, { token });
  },
};

export const analiseGradeApi = {
  getGrade: (token: string, filtro: AnaliseGradeFiltro = {}) => {
    const params = new URLSearchParams();
    if (filtro.referencia) params.set('referencia', filtro.referencia);
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);
    appendList(params, 'status', filtro.status);
    appendList(params, 'cor', filtro.cor);
    appendList(params, 'branches', filtro.branches);
    const query = params.toString();
    return fetchPcpApi<AnaliseGradeResponse>(`/api/pcp/analise-grade${query ? `?${query}` : ''}`, { token });
  },

  getCurvaAbcTamanho: (token: string, filtro: AnaliseGradeFiltro = {}) => {
    const params = new URLSearchParams();
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);
    appendList(params, 'cor', filtro.cor);
    appendList(params, 'branches', filtro.branches);
    const query = params.toString();
    return fetchPcpApi<CurvaAbcTamanhoResponse>(`/api/pcp/analise-grade/curva-abc-tamanho${query ? `?${query}` : ''}`, { token });
  },
};

function appendCurvaAbcFiltro(params: URLSearchParams, filtro: CurvaAbcFiltro) {
  appendList(params, 'categoria', filtro.categoria);
  appendList(params, 'linha', filtro.linha);
  appendList(params, 'genero', filtro.genero);
  appendList(params, 'status', filtro.status);
  appendList(params, 'familia', filtro.familia);
}

export const curvaAbcApi = {
  getResumo: (token: string, filtro: CurvaAbcFiltro = {}) => {
    const params = new URLSearchParams();
    appendCurvaAbcFiltro(params, filtro);
    const query = params.toString();
    return fetchPcpApi<CurvaAbcResumoResponse>(`/api/pcp/curva-abc${query ? `?${query}` : ''}`, { token });
  },

  getResumoPorSku: (token: string, filtro: CurvaAbcFiltro = {}) => {
    const params = new URLSearchParams();
    appendCurvaAbcFiltro(params, filtro);
    const query = params.toString();
    return fetchPcpApi<CurvaAbcResumoSkuResponse>(`/api/pcp/curva-abc/resumo-sku${query ? `?${query}` : ''}`, { token });
  },

  getSkus: (token: string, filtro: CurvaAbcFiltro & { referencia?: string; page: number; pageSize: number }) => {
    const params = new URLSearchParams();
    appendCurvaAbcFiltro(params, filtro);
    if (filtro.referencia) params.set('referencia', filtro.referencia);
    params.set('page', String(filtro.page));
    params.set('pageSize', String(filtro.pageSize));
    const query = params.toString();
    return fetchPcpApi<CurvaAbcSkusResponse>(`/api/pcp/curva-abc/skus${query ? `?${query}` : ''}`, { token });
  },
};

// ---- Em Producao ----

export interface EmProducaoFiltro {
  status?: number[];
  colecao?: string[];
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  statusProduto?: string[];
  search?: string;
  dataInicio?: string;
  considerarSemReferencia?: boolean;
}

export interface EmProducaoRow {
  id: number;
  branchCode: number;
  branchName: string;
  orderCode: number;
  status: number;
  statusLabel: string;
  dtInicio: string | null;
  dtPrevisao: string | null;
  insertDate: string | null;
  lastChangeDate: string | null;
  productCode: number;
  referenceCode: string | null;
  descricao: string;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  statusProduto: string | null;
  quantidadeOp: number;
  quantidadeFinalizada: number;
  quantidadePendente: number;
  percentFinalizado: number;
  diasEmProcesso: number | null;
  diasAtraso: number;
  syncedAt: string | null;
}

export interface EmProducaoResponse {
  atualizadoEm: string | null;
  kpis: {
    ordens: number;
    linhas: number;
    referencias: number;
    produtos: number;
    quantidadeOp: number;
    quantidadeFinalizada: number;
    quantidadePendente: number;
    percentFinalizado: number;
    ordensAtrasadas: number;
    quantidadeAtrasada: number;
  };
  statusResumo: Array<{ status: number; statusLabel: string; ordens: number; quantidadePendente: number }>;
  rows: EmProducaoRow[];
}

export interface EmProducaoFiltrosResponse {
  status: Array<{ valor: number; label: string; qtd: number }>;
  colecoes: PcpClassificacaoOpcao[];
  classificacoes: PcpClassificacaoDimensao[];
  lojas: Array<{ branchCode: number; label: string; qtd: number }>;
}

export const emProducaoApi = {
  getEmProducao: (token: string, filtro: EmProducaoFiltro = {}) => {
    const params = new URLSearchParams();
    if (filtro.search) params.set('search', filtro.search);
    if (filtro.dataInicio) params.set('dataInicio', filtro.dataInicio);
    if (filtro.considerarSemReferencia !== undefined) params.set('considerarSemReferencia', String(filtro.considerarSemReferencia));
    appendList(params, 'status', filtro.status);
    appendList(params, 'colecao', filtro.colecao);
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);
    appendList(params, 'statusProduto', filtro.statusProduto);
    const query = params.toString();
    return fetchPcpApi<EmProducaoResponse>(`/api/pcp/em-producao${query ? `?${query}` : ''}`, { token });
  },

  getFiltros: (token: string) =>
    fetchPcpApi<EmProducaoFiltrosResponse>('/api/pcp/em-producao/filtros', { token }),
};
// ---- Performance Colecao ----

export interface PerformanceColecaoFiltro {
  dataInicio: string;
  dataFim: string;
  colecao?: string[];
  branches?: number[];
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  status?: string[];
  search?: string;
}

export interface PerformanceColecaoRow {
  grupo: string | null;
  referenceCode: string;
  descricao: string;
  categoria: string | null;
  linha: string | null;
  custo: number | null;
  pdvVarejo: number | null;
  markupVarejo: number | null;
  pdvAtacado: number | null;
  markupAtacado: number | null;
  entrouDpa: string | null;
  qtdeProduzida: number;
  vendaMes1: number;
  vendaMes2: number;
  vendaMes3: number;
  valorMes1: number;
  valorMes2: number;
  valorMes3: number;
  estoqueFinal: number;
  giro: number | null;
  totalVendaValor: number;
  totalVendaCusto: number;
  totalEstoqueCusto: number;
  totalEstoqueVenda: number;
}

export interface PerformanceColecaoResponse {
  config: {
    precoCustoBranchCode: number;
    custoCode: number;
    pdvVarejoCode: number;
    pdvAtacadoCode: number;
  };
  periodo: { dataInicio: string; dataFim: string; meses: string[] };
  kpis: {
    referencias: number;
    qtdeProduzida: number;
    qtdeVendida: number;
    estoqueFinal: number;
    totalVendaValor: number;
    totalVendaCusto: number;
    totalEstoqueCusto: number;
    totalEstoqueVenda: number;
    participacaoColecaoPercent: number;
    giroMedioPercent: number | null;
  };
  rows: PerformanceColecaoRow[];
}

export interface PerformanceColecaoFiltrosResponse {
  colecoes: PcpClassificacaoOpcao[];
  classificacoes: PcpClassificacaoDimensao[];
  lojas: { branchCode: number; label: string }[];
}

export const performanceColecaoApi = {
  getPerformance: (token: string, filtro: PerformanceColecaoFiltro) => {
    const params = new URLSearchParams();
    params.set('dataInicio', filtro.dataInicio);
    params.set('dataFim', filtro.dataFim);
    if (filtro.search) params.set('search', filtro.search);
    appendList(params, 'colecao', filtro.colecao);
    appendList(params, 'branches', filtro.branches);
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);
    appendList(params, 'status', filtro.status);
    return fetchPcpApi<PerformanceColecaoResponse>(`/api/pcp/performance-colecao?${params.toString()}`, { token });
  },

  getFiltros: (token: string) =>
    fetchPcpApi<PerformanceColecaoFiltrosResponse>('/api/pcp/performance-colecao/filtros', { token }),
};
// ---- Raio X ----

export interface RaioXFiltro {
  dataInicio: string;
  dataFim: string;
  referencias?: string[];
  categorias?: string[];
  lojas?: number[];
  canal?: 'varejo' | 'atacado' | 'todos';
  visao?: 'sintetico' | 'analitico';
  agruparPorCor?: boolean;
}

export interface RaioXGrade {
  tamanho: string;
  estoqueInicial: number;
  transferencias: number;
  vendasVarejo: number;
  vendasAtacado: number;
  estoqueFinal: number;
  cobertura: number;
}

export interface RaioXLoja {
  branchCode: number;
  branchName: string;
  grades: RaioXGrade[];
  totais: {
    estoqueInicial: number;
    transferencias: number;
    vendasVarejo: number;
    vendasAtacado: number;
    estoqueFinal: number;
    cobertura: number;
  };
}

export interface RaioXProduto {
  productSku?: string;
  referenceCode: string;
  referenceName: string;
  productCode?: number;
  cor?: string;
  fotoUrl?: string | null;
  emPromocao?: boolean;
  lojas: RaioXLoja[];
  totalGeral: {
    estoqueInicial: number;
    transferencias: number;
    vendasVarejo: number;
    vendasAtacado: number;
    estoqueFinal: number;
    cobertura: number;
  };
}

export interface RaioXResponse {
  produtos: RaioXProduto[];
  config: {
    coberturaLimiteVerde: number;
    coberturaLimiteVermelho: number;
  };
}

export interface RaioXProdutoSearch {
  reference_code: string;
  reference_name: string;
}

export const raioXApi = {
  buscarProdutos: (token: string, search: string = '', limit: number = 20) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('limit', String(limit));
    const query = params.toString();
    return fetchPcpApi<RaioXProdutoSearch[]>(`/api/pcp/raio-x/produtos${query ? `?${query}` : ''}`, { token });
  },

  getRaioX: (token: string, filtro: RaioXFiltro) => {
    const params = new URLSearchParams();
    params.set('dataInicio', filtro.dataInicio);
    params.set('dataFim', filtro.dataFim);
    if (filtro.referencias) params.set('referencias', filtro.referencias.join(','));
    if (filtro.categorias) params.set('categorias', filtro.categorias.join(','));
    if (filtro.lojas) params.set('lojas', filtro.lojas.join(','));
    if (filtro.canal) params.set('canal', filtro.canal);
    if (filtro.visao) params.set('visao', filtro.visao);
    if (filtro.agruparPorCor !== undefined) params.set('agruparPorCor', String(filtro.agruparPorCor));
    const query = params.toString();
    return fetchPcpApi<RaioXResponse>(`/api/pcp/raio-x${query ? `?${query}` : ''}`, { token });
  },
};

// Gestão de Transferência
export interface TransferenciaLoja {
  branchCode: number;
  branchName: string;
  estoquePorTamanho: Record<string, number>;
  estoqueTotal: number;
  vendasPorTamanho: Record<string, number>;
  coberturaPorTamanho: Record<string, number>;
}

export interface TransferenciaGrupo {
  referencia: string;
  descricao: string;
  cor: string | null;
  tamanhos: string[];
  lojas: TransferenciaLoja[];
}

export interface TransferenciaResponse {
  grupos: TransferenciaGrupo[];
}

export interface ReferenciaSearchResult {
  referencia: string;
  descricao: string;
  cor?: string;
}

export const transferenciaApi = {
  getTransferencia: (token: string, referencia: string, agruparPorCor: boolean) => {
    const params = new URLSearchParams();
    params.set('referencia', referencia);
    params.set('agruparPorCor', String(agruparPorCor));
    return fetchPcpApi<TransferenciaResponse>(`/api/pcp/transferencia?${params.toString()}`, { token });
  },

  buscarReferencias: (token: string, search: string, limit: number = 20) => {
    const params = new URLSearchParams();
    params.set('search', search);
    params.set('limit', String(limit));
    return fetchPcpApi<ReferenciaSearchResult[]>(`/api/pcp/transferencia/referencias?${params.toString()}`, { token });
  },
};

// ---- Venda do Dia por Classificação ----

export type VendaDiaTipoClassificacao = 'categoria' | 'linha' | 'colecao' | 'status';

export interface VendaDiaFiltro {
  tipoClassificacao: VendaDiaTipoClassificacao;
  classificacaoValores?: string[];
  branches?: number[];
  agruparLojas?: boolean;
}

export interface VendaDiaLinha {
  branchCode: number | null;
  branchName: string;
  branchAbrev: string;
  estoqueDiaAnterior: number;
  vendaDiaAnterior: number;
  vendaUltimaSemana: number;
  vendaMes: number;
  giroMes: number | null;
}

export interface VendaDiaKpis {
  estoqueTotal: number;
  vendaDiaAnteriorTotal: number;
  vendaUltimaSemanaTotal: number;
  vendaMesTotal: number;
  giroMesTotal: number | null;
  ticketMedioDia: number | null;
  ticketMedioSemana: number | null;
  ticketMedioMes: number | null;
}

export interface VendaDiaResponse {
  dataReferencia: string;
  periodoSemana: { inicio: string; fim: string };
  periodoMes: { inicio: string; fim: string };
  tipoClassificacao: VendaDiaTipoClassificacao;
  classificacaoSelecionada: string[];
  agrupadoPorLoja: boolean;
  kpis: VendaDiaKpis;
  linhas: VendaDiaLinha[];
}

export interface VendaDiaClassificacaoOpcao {
  tipo: VendaDiaTipoClassificacao;
  label: string;
  opcoes: { valor: string; qtd_skus: number }[];
}

export interface VendaDiaFiltrosResponse {
  classificacoes: VendaDiaClassificacaoOpcao[];
  lojas: { branchCode: number; label: string; abrev: string }[];
}

export const vendaDiaApi = {
  getVendaDia: (token: string, filtro: VendaDiaFiltro) => {
    const params = new URLSearchParams();
    params.set('tipoClassificacao', filtro.tipoClassificacao);
    if (filtro.classificacaoValores && filtro.classificacaoValores.length > 0) {
      params.set('classificacaoValores', filtro.classificacaoValores.join(','));
    }
    if (filtro.branches && filtro.branches.length > 0) {
      params.set('branches', filtro.branches.join(','));
    }
    if (filtro.agruparLojas !== undefined) {
      params.set('agruparLojas', String(filtro.agruparLojas));
    }
    return fetchPcpApi<VendaDiaResponse>(`/api/pcp/venda-dia?${params.toString()}`, { token });
  },

  getFiltros: (token: string) =>
    fetchPcpApi<VendaDiaFiltrosResponse>('/api/pcp/venda-dia/filtros', { token }),
};