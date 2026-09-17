// Ordem de exibicao de grade (tamanho) usada nos relatorios de PCP que quebram por
// tamanho (Raio X, Performance Colecao). Compartilhado entre as duas telas porque e
// o mesmo padrao exato, ao contrario do resto do projeto onde cada tela mantem sua
// propria copia (ver AGENTS.md, convencao do ThSortPcp).
export const GRADES = ['UN', 'P', 'M', 'G', 'GG', '2', '4', '6', '8', '10'];

export function tamanhoNormalizado(tamanho: string): string {
  const valor = tamanho.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (valor === 'UNICO' || valor === 'U') return 'UN';
  return valor;
}

export function ordemGrade(tamanho: string): number {
  const indice = GRADES.indexOf(tamanhoNormalizado(tamanho));
  return indice === -1 ? GRADES.length : indice;
}
