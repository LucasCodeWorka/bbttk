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
  chave: 'categoria' | 'linha' | 'genero' | 'status';
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
  limit?: number | 'all';
}

export interface RelatorioBaseColunaFilial {
  giro: number;
  est: number;
  cob: number | null;
}

export interface RelatorioBaseRow {
  sku: string;
  codigo: number | null;
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
  pdvAtual: null;
  pdvRealVar: number | null;
  markupVar: number | null;
  pdvRealAta: number | null;
  markupAta: number | null;
  estDisponivel: null;
  transito: null;
  emProducao: null;
  estPrevisto: null;
  estTt: number;
  giroTt1: number;
  giroTt3: number;
  giroTt6: number;
  branches: Record<number, RelatorioBaseColunaFilial>;
}

export interface RelatorioBaseResponse {
  config: { giroDias: number; coberturaMeses: number; atacadoCoberturaBase: string };
  kpis: { giroTt1: number; giroTt3: number; giroTt6: number; estTt: number; skuCount: number };
  colunas: { branchCode: number; label: string }[];
  rows: RelatorioBaseRow[];
}

export interface RelatorioBaseFiltrosResponse {
  classificacoes: PcpClassificacaoDimensao[];
  colunas: { branchCode: number; label: string }[];
}

export const relatorioBaseApi = {
  getRelatorioBase: (token: string, filtro: RelatorioBaseFiltro = {}) => {
    const params = new URLSearchParams();
    if (filtro.search) params.set('search', filtro.search);
    if (filtro.limit) params.set('limit', String(filtro.limit));
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

// ---- Visao Geral ----

export interface PcpMetaGap {
  valor: number;
  meta: number;
  gap: number;
}

export interface PcpMatrizCelula {
  estoque: number;
  vendaPeriodo: number;
  cobertura: number | null;
}

export interface PcpMatrizCanal {
  linhas: string[];
  matriz: Record<string, Record<'varejo' | 'atacado' | 'total', PcpMatrizCelula>>;
}

export interface VisaoGeralResponse {
  config: { coberturaMeses: number };
  kpis: {
    coberturaGeral: PcpMetaGap;
    giroAnualizado: PcpMetaGap;
    estoqueMortoPercent: PcpMetaGap;
    coberturaBasico: PcpMetaGap;
    coberturaColecao: PcpMetaGap;
    valorEstoque: number;
    estoqueMortoValor: number;
    skusAtivos: number;
  };
  coberturaPorLinhaCanal: PcpMatrizCanal;
  coberturaPorCategoriaCanal: PcpMatrizCanal;
  coberturaPorGeneroCanal: PcpMatrizCanal;
}

export interface VisaoGeralFiltro {
  branches?: number[];
  genero?: string[];
}

// ---- Analise de Grade ----

export interface PcpGradeCelula {
  size: string;
  estoque: number;
  giro: number;
  cobertura: number | null;
  ruptura: boolean;
}

export interface PcpGradeReferencia {
  referenceCode: string;
  referenceName: string;
  celulas: PcpGradeCelula[];
  completudePercent: number;
}

export interface AnaliseGradeResponse {
  config: { coberturaMeses: number };
  referencias: PcpGradeReferencia[];
  indicadores: {
    skusEmRupturaTotal: number;
    totalCelulas: number;
    celulasComCoberturaBaixa: number;
    completudeMediaPercent: number;
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
  cor?: string[];
  branches?: number[];
}

// ---- Curva ABC (produto) ----

export type CurvaLetra = 'A' | 'B' | 'C' | 'D';

export interface ReferenciaAbc {
  referenceCode: string;
  referenceName: string;
  curva: CurvaLetra;
  rankQtd: number;
  qtdVendida: number;
  mediaMensal: number;
  totalSkus: number;
  mediaPorSku: number;
  mediaPorSkuAnterior: number;
  tendenciaMediaSku: 'up' | 'down' | 'flat';
  rankValor: number;
  valorReais: number;
}

export interface CurvaResumo {
  curva: CurvaLetra;
  totalReferencias: number;
  quantidade: number;
  valorReais: number;
  totalSkus: number;
  mediaMensal: number;
  percentDoTotal: number;
  ultimaReferencia: ReferenciaAbc | null;
}

export interface CurvaAbcResumoResponse {
  config: { giroDias: number; metaCurvaAUnidades: number; curvaDPercent: number; curvaCPercent: number };
  totalAnalisadas: number;
  curvas: CurvaResumo[];
  referencias: ReferenciaAbc[];
}

export interface CurvaAbcSkuLinha {
  sku: string;
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
  getVisaoGeral: (token: string, filtro: VisaoGeralFiltro = {}) => {
    const params = new URLSearchParams();
    appendList(params, 'branches', filtro.branches);
    appendList(params, 'genero', filtro.genero);
    const query = params.toString();
    return fetchPcpApi<VisaoGeralResponse>(`/api/pcp/visao-geral${query ? `?${query}` : ''}`, { token });
  },
};

export const analiseGradeApi = {
  getGrade: (token: string, filtro: AnaliseGradeFiltro = {}) => {
    const params = new URLSearchParams();
    if (filtro.referencia) params.set('referencia', filtro.referencia);
    appendList(params, 'categoria', filtro.categoria);
    appendList(params, 'linha', filtro.linha);
    appendList(params, 'genero', filtro.genero);
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
