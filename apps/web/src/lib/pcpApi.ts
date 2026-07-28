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
  chave: 'categoria' | 'linha' | 'genero';
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
  referencia_count: number;
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
    referencia_count: number;
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
