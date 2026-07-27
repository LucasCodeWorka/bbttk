// Mapeia prefixos de rota para o modulo que os protege.
// Usado tanto pela Sidebar (o que mostrar) quanto pelo layout (o que bloquear).
export const ROUTE_MODULES: { prefix: string; module: string }[] = [
  { prefix: '/dashboard', module: 'comercial' },
  { prefix: '/metas', module: 'comercial' },
  { prefix: '/comissoes', module: 'comercial' },
  { prefix: '/pcp-novo', module: 'pcp_servico' },
  { prefix: '/pcp-relatorio-base', module: 'pcp_servico' },
  { prefix: '/pcp-visao-geral', module: 'pcp_servico' },
  { prefix: '/pcp-analise-grade', module: 'pcp_servico' },
  { prefix: '/pcp-curva-abc', module: 'pcp_servico' },
  { prefix: '/pcp', module: 'pcp' },
];

export function getModuleForPath(pathname: string): string | null {
  const match = ROUTE_MODULES.find((r) => pathname.startsWith(r.prefix));
  return match ? match.module : null;
}

// Rotas que exigem admin, independente de modulo
export const ADMIN_ONLY_PREFIXES = ['/usuarios', '/pcp/relatorio-base-config'];

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

