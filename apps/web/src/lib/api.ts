const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FetchOptions extends RequestInit {
  token?: string;
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    fetchApi<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) =>
    fetchApi<{ user: User }>('/api/auth/me', { token }),

  getUsers: (token: string) =>
    fetchApi<{ users: User[] }>('/api/auth/users', { token }),

  createUser: (token: string, data: CreateUserData) =>
    fetchApi<{ user: User }>('/api/auth/users', {
      token,
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (token: string, id: number, data: Partial<CreateUserData>) =>
    fetchApi<{ user: User }>(`/api/auth/users/${id}`, {
      token,
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteUser: (token: string, id: number) =>
    fetchApi<{ success: boolean }>(`/api/auth/users/${id}`, {
      token,
      method: 'DELETE',
    }),
};

// Vendas
// Monta a query string ?branches=1,3,4 a partir de uma lista de filiais (vazio/undefined = todas)
function branchesQuery(branchCodes?: number[]): string {
  return branchCodes && branchCodes.length > 0 ? `branches=${branchCodes.join(',')}` : '';
}

// Filtro de classificacao de produto (categoria, genero, status, linha, colecao, tecido)
export interface ProdutoFiltro {
  categoria?: string[];
  genero?: string[];
  status?: string[];
  linha?: string[];
  colecao?: string[];
  tecido?: string[];
}

function produtoFiltroQuery(filtro?: ProdutoFiltro): string {
  if (!filtro) return '';
  return Object.entries(filtro)
    .filter(([, valores]) => valores && valores.length > 0)
    .map(([chave, valores]) => `${chave}=${(valores as string[]).map(encodeURIComponent).join(',')}`)
    .join('&');
}

function joinQuery(...parts: string[]): string {
  const filtered = parts.filter(Boolean);
  return filtered.length > 0 ? `?${filtered.join('&')}` : '';
}

export const vendasApi = {
  getPeriodo: (inicio: string, fim: string, branchCodes?: number[], produtoFiltro?: ProdutoFiltro) =>
    fetchApi<VendasResponse>(
      `/api/vendas/periodo/${inicio}/${fim}${joinQuery(branchesQuery(branchCodes), produtoFiltroQuery(produtoFiltro))}`
    ),

  getDiarias: (inicio: string, fim: string, branchCodes?: number[], produtoFiltro?: ProdutoFiltro) =>
    fetchApi<VendasDiariasResponse>(
      `/api/vendas/diarias/periodo/${inicio}/${fim}${joinQuery(branchesQuery(branchCodes), produtoFiltroQuery(produtoFiltro))}`
    ),

  getMensais: (inicio: string, fim: string, branchCodes?: number[], produtoFiltro?: ProdutoFiltro) =>
    fetchApi<VendasDiariasResponse>(
      `/api/vendas/mensais/periodo/${inicio}/${fim}${joinQuery(branchesQuery(branchCodes), produtoFiltroQuery(produtoFiltro))}`
    ),

  getVendedores: (inicio: string, fim: string, branchCodes?: number[], produtoFiltro?: ProdutoFiltro) =>
    fetchApi<VendedoresResponse>(
      `/api/vendedores${joinQuery(`start=${inicio}`, `end=${fim}`, branchesQuery(branchCodes), produtoFiltroQuery(produtoFiltro))}`
    ),

  getVendedoresLista: () =>
    fetchApi<{ vendedores: { code: number; name: string }[] }>('/api/vendedores-lista'),

  getVendedoresPorFilial: (branchCode: number, ano: number, mes: number) =>
    fetchApi<VendedoresPorFilialResponse>(
      `/api/vendedores-por-filial/${branchCode}/${ano}/${mes}`
    ),

  getTopProdutos: (inicio: string, fim: string, branchCodes?: number[], produtoFiltro?: ProdutoFiltro) =>
    fetchApi<TopProdutosResponse>(
      `/api/top-produtos${joinQuery(`start=${inicio}`, `end=${fim}`, branchesQuery(branchCodes), produtoFiltroQuery(produtoFiltro))}`
    ),

  getComparativoAno: (inicio: string, fim: string, branchCodes?: number[], produtoFiltro?: ProdutoFiltro) =>
    fetchApi<ComparativoAnoResponse>(
      `/api/comparativo-ano/${inicio}/${fim}${joinQuery(branchesQuery(branchCodes), produtoFiltroQuery(produtoFiltro))}`
    ),

  getProjecaoMes: (branchCode?: number, produtoFiltro?: ProdutoFiltro) =>
    fetchApi<ProjecaoMesResponse>(
      `/api/projecao-mes${branchCode ? `/${branchCode}` : ''}${joinQuery(produtoFiltroQuery(produtoFiltro))}`
    ),

  getProjecaoFiliais: (produtoFiltro?: ProdutoFiltro) =>
    fetchApi<ProjecaoFiliaisResponse>(`/api/projecao-filiais${joinQuery(produtoFiltroQuery(produtoFiltro))}`),

  getClassificacoes: () =>
    fetchApi<{ dimensoes: ClassificacaoDimensao[] }>('/api/produtos/classificacoes'),
};

// Entregas
export const entregasApi = {
  getAll: () => fetchApi<{ entregas: Entrega[] }>('/api/entregas'),
};

// Upload de arquivo (nao usa fetchApi pois FormData nao pode ter Content-Type forcado)
async function uploadFile<T>(endpoint: string, token: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Produtos
export const produtosApi = {
  getCores: (token: string) =>
    fetchApi<{ cores: CorProduto[] }>('/api/produtos/cores', { token }),

  getImpactoAgrupamento: (token: string, tipo: string, cores: { color_code: string | null; color_name: string | null }[], excluirGrupoId?: number) =>
    fetchApi<{ impacto: ImpactoAgrupamentoItem[] }>('/api/produtos/impacto-agrupamento', {
      token,
      method: 'POST',
      body: JSON.stringify({ tipo, cores, excluirGrupoId }),
    }),
};

// Agrupamentos (configurador generico)
export const agrupamentosApi = {
  getGrupos: (token: string, tipo: string) =>
    fetchApi<{ grupos: AgrupamentoGrupo[] }>(`/api/agrupamentos?tipo=${tipo}`, { token }),

  createGrupo: (token: string, data: CreateGrupoData) =>
    fetchApi<{ grupo: AgrupamentoGrupo }>('/api/agrupamentos', {
      token,
      method: 'POST',
      body: JSON.stringify(data),
    }),

  renomearGrupo: (token: string, id: number, nome: string) =>
    fetchApi<{ grupo: AgrupamentoGrupo }>(`/api/agrupamentos/${id}`, {
      token,
      method: 'PATCH',
      body: JSON.stringify({ nome }),
    }),

  adicionarMembros: (token: string, id: number, membros: AgrupamentoMembroData[]) =>
    fetchApi<{ grupo: AgrupamentoGrupo }>(`/api/agrupamentos/${id}/membros`, {
      token,
      method: 'POST',
      body: JSON.stringify({ membros }),
    }),

  deleteGrupo: (token: string, id: number) =>
    fetchApi<{ success: boolean }>(`/api/agrupamentos/${id}`, { token, method: 'DELETE' }),

  deleteMembro: (token: string, id: number) =>
    fetchApi<{ success: boolean }>(`/api/agrupamentos/membros/${id}`, { token, method: 'DELETE' }),

  uploadCoresCsv: (token: string, file: File) =>
    uploadFile<{ cores: CorProduto[]; total_linhas: number }>('/api/agrupamentos/cores/csv', token, file),
};

// Metas
export const metasApi = {
  getNiveis: () =>
    fetchApi<{ niveis: MetaNivel[] }>('/api/meta-niveis'),

  updateNiveis: (token: string, niveis: MetaNivel[]) =>
    fetchApi<{ success: boolean }>('/api/meta-niveis', {
      token,
      method: 'POST',
      body: JSON.stringify({ niveis }),
    }),

  getMetas: (ano: number, mes: number, branchCode?: number) =>
    fetchApi<{ metas: Meta[]; ano: number; mes: number }>(
      `/api/metas?ano=${ano}&mes=${mes}${branchCode ? `&branch_code=${branchCode}` : ''}`
    ),

  saveMeta: (token: string, data: MetaData) =>
    fetchApi<{ success: boolean }>('/api/metas', {
      token,
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteMeta: (token: string, id: number) =>
    fetchApi<{ success: boolean }>(`/api/metas/${id}`, {
      token,
      method: 'DELETE',
    }),

  distribuir: (token: string, data: DistribuicaoData) =>
    fetchApi<{ success: boolean; distribution: MetaDistribution }>('/api/metas/distribuir', {
      token,
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getDistribuicoes: (ano: number, mes: number) =>
    fetchApi<{ distributions: MetaDistribution[] }>(
      `/api/metas/distribuicoes?ano=${ano}&mes=${mes}`
    ),

  getComissoes: (ano: number, mes: number, branchCodes?: number[]) =>
    fetchApi<ComissoesResponse>(
      `/api/metas/comissoes${joinQuery(`ano=${ano}`, `mes=${mes}`, branchesQuery(branchCodes))}`
    ),
};

// Types
export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  branchCodes: number[];
  sellerCode?: number;
  isActive?: boolean;
  moduleAccess?: string[];
}

export interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role: string;
  branchCodes?: number[];
  sellerCode?: number;
  isActive?: boolean;
  moduleAccess?: string[];
}

export interface Filial {
  branch_code: number;
  branch_name: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
  pa: number;
  tm: number;
}

export interface VendasResponse {
  periodo: { inicio: string; fim: string };
  filiais: Filial[];
  total: {
    faturamento: number;
    pecas: number;
    transacoes: number;
    pa: number;
    tm: number;
    clientes: number;
    pm: number;
  };
}

export interface VendasDiariasResponse {
  periodo: { inicio: string; fim: string };
  dados: {
    data: string;
    transacoes: number;
    pecas: number;
    faturamento: number;
  }[];
}

export interface Vendedor {
  seller_code: number;
  seller_name: string;
  transacoes: number;
  pecas: number;
  faturamento: number;
  pa: number;
  tm: number;
}

export interface VendedoresResponse {
  periodo: { inicio: string; fim: string };
  vendedores: Vendedor[];
}

export interface VendedorPorFilial {
  seller_code: number;
  seller_name: string;
  faturamento: number;
}

export interface VendedoresPorFilialResponse {
  periodo: { inicio: string; fim: string };
  vendedores: VendedorPorFilial[];
}

export interface Produto {
  referencia: string;
  nome: string;
  quantidade: number;
  valor: number;
}

export interface TopProdutosResponse {
  periodo: { inicio: string; fim: string };
  produtos: Produto[];
}

export interface FilialComparativo {
  branch_code: number;
  branch_name: string;
  atual: {
    faturamento: number;
    pecas: number;
    transacoes: number;
    pa: number;
    tm: number;
    clientes: number;
    pm: number;
    tm_cliente: number;
    pac: number;
    pct_tt_faturamento: number;
    pct_tt_pecas: number;
  };
  ano_anterior: {
    faturamento: number;
    pecas: number;
    transacoes: number;
    pa: number;
    tm: number;
    clientes: number;
    pm: number;
    tm_cliente: number;
    pac: number;
  };
  variacao: {
    faturamento: number;
    pecas: number;
    transacoes: number;
    clientes: number;
    pm: number;
    tm: number;
    tm_cliente: number;
    pa: number;
    pac: number;
  };
  devolucoes: {
    valor: number;
    qtde: number;
    pct: number;
  };
  clientes_novos: {
    qtde: number;
    faturamento: number;
    pct: number;
  };
  meta: {
    valor: number;
    pct: number;
    meta_dia: number;
  };
}

export interface ComparativoAnoResponse {
  periodo_atual: { inicio: string; fim: string };
  periodo_anterior: { inicio: string; fim: string };
  filiais: FilialComparativo[];
  total: {
    atual: { faturamento: number; pecas: number; transacoes: number; pa: number; tm: number; clientes: number; pm: number; tm_cliente: number; pac: number };
    ano_anterior: { faturamento: number; pecas: number; transacoes: number; pa: number; tm: number; clientes: number; pm: number; tm_cliente: number; pac: number };
    variacao: {
      faturamento: { atual: number; anterior: number; diferenca: number; percentual: number };
      pecas: { atual: number; anterior: number; diferenca: number; percentual: number };
      transacoes: { atual: number; anterior: number; diferenca: number; percentual: number };
      clientes: { atual: number; anterior: number; diferenca: number; percentual: number };
      tm: { atual: number; anterior: number; diferenca: number; percentual: number };
      pa: { atual: number; anterior: number; diferenca: number; percentual: number };
      pm: { atual: number; anterior: number; diferenca: number; percentual: number };
    };
  };
}

export interface ProjecaoMesResponse {
  periodo_atual: {
    inicio: string;
    fim: string;
    dias_decorridos: number;
    dias_restantes: number;
    dias_total: number;
  };
  realizado: {
    faturamento: number;
    pecas: number;
    transacoes: number;
    tm: number;
    pa: number;
  };
  caminhada: number;
  projecao: { faturamento: number };
  falta_vender: {
    faturamento: number;
    media_diaria_necessaria: number;
  };
  variacao_vs_ano_anterior: number;
}

export interface ProjecaoFilial {
  branch_code: number;
  branch_name: string;
  realizado: number;
  caminhada: number;
  projecao: number;
  falta: number;
  ano_anterior_completo: number;
  variacao_vs_ano_anterior: number;
}

export interface ProjecaoFiliaisResponse {
  periodo: {
    inicio: string;
    fim: string;
    dias_decorridos: number;
    dias_restantes: number;
  };
  filiais: ProjecaoFilial[];
  total: {
    realizado: number;
    projecao: number;
    falta: number;
    ano_anterior_completo: number;
    variacao_vs_ano_anterior: number;
  };
}

export interface Entrega {
  title: string;
  date: string;
  modulo: string;
  body: string;
}

export interface ClassificacaoOpcao {
  valor: string;
  qtd_skus: number;
}

export interface ClassificacaoDimensao {
  chave: string;
  label: string;
  opcoes: ClassificacaoOpcao[];
}

export interface CorProduto {
  color_code: string | null;
  color_name: string | null;
  qtd_referencias: number;
  qtd_skus: number;
}

export interface ImpactoAgrupamentoItem {
  reference_code: string;
  reference_name: string | null;
  color_code: string | null;
  color_name: string | null;
  qtd_skus: number;
  ja_agrupado_em: string | null;
}

export interface AgrupamentoMembroData {
  referenceCode: string;
  colorCode: string | null;
  colorName: string | null;
}

export interface AgrupamentoMembro extends AgrupamentoMembroData {
  id: number;
  grupoId: number;
  createdAt: string;
}

export interface AgrupamentoGrupo {
  id: number;
  tipo: string;
  nome: string;
  createdAt: string;
  membros: AgrupamentoMembro[];
}

export interface CreateGrupoData {
  tipo: string;
  nome: string;
  membros: AgrupamentoMembroData[];
}

export interface MetaNivel {
  nivel_ordem: number;
  nivel_nome: string;
  nivel_cor: string;
  comissao_percentual: number;
}

export interface ComissaoCelula {
  branch_code: number;
  branch_name: string;
  faturamento: number;
  nivel_1: number;
  nivel_2: number;
  nivel_3: number;
  nivel_4: number;
  nivel_5: number;
  nivel_atingido: number;
  resultado_pct: number;
  comissao_pct: number;
  comissao_valor: number;
}

export interface VendedorComissao {
  seller_code: number;
  seller_name: string;
  filiais: number[];
  faturamento: number;
  nivel_1: number;
  nivel_2: number;
  nivel_3: number;
  nivel_4: number;
  nivel_5: number;
  nivel_atingido: number;
  resultado_pct: number;
  comissao_pct: number;
  comissao_valor: number;
  celulas: ComissaoCelula[];
}

export interface CanalComissao {
  canal: string;
  nome: string;
  faturamento: number;
  meta: number;
  pct_meta: number;
}

export interface ComissoesResponse {
  periodo: { ano: number; mes: number };
  resumo: { realizado: number; meta: number; resultado_pct: number };
  canal: CanalComissao[];
  niveis: MetaNivel[];
  vendedores: VendedorComissao[];
  top3: VendedorComissao[];
}

export interface Meta {
  id: number;
  ano: number;
  mes: number;
  branch_code: number;
  seller_code: number | null;
  nivel_1: number;
  nivel_2: number;
  nivel_3: number;
  nivel_4: number;
  nivel_5: number;
  comissao_nivel_1: number | null;
  comissao_nivel_2: number | null;
  comissao_nivel_3: number | null;
  comissao_nivel_4: number | null;
  comissao_nivel_5: number | null;
}

export interface MetaData {
  ano: number;
  mes: number;
  branch_code: number;
  seller_code?: number | null;
  nivel_1: number;
  nivel_2: number;
  nivel_3: number;
  nivel_4: number;
  nivel_5: number;
  comissao_nivel_1?: number | null;
  comissao_nivel_2?: number | null;
  comissao_nivel_3?: number | null;
  comissao_nivel_4?: number | null;
  comissao_nivel_5?: number | null;
}

export interface DistribuicaoItem {
  branchCode: number;
  sellerCode?: number;
  percentage: number;
}

export interface DistribuicaoData {
  name?: string;
  ano: number;
  mes: number;
  totalValue: number;
  distributionType: 'manual' | 'igual' | 'proporcional';
  items: DistribuicaoItem[];
}

export interface MetaDistribution {
  id: number;
  name: string | null;
  ano: number;
  mes: number;
  totalValue: number;
  distributionType: string;
  createdAt: string;
  items: {
    id: number;
    branchCode: number;
    sellerCode: number | null;
    percentage: number;
    valorCalculado: number;
  }[];
}
