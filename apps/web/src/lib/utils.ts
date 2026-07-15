// Filiais da Bebetenkite
export const FILIAIS: Record<number, string> = {
  1: 'IGUATEMI',
  3: 'BENFICA',
  4: 'DEL PASEO',
  5: 'PATIO DOM LUIS',
  6: 'SOBRAL SHOPPING',
  7: 'RIOMAR FORTALEZA',
  8: 'NORTH SHOPPING JOQUEI',
  9: 'RIOMAR KENNEDY',
  11: 'VIA SUL',
  12: 'MESSEJANA',
  13: 'EUSEBIO',
  17: 'NORTH SHOPPING',
};

export const MESES = [
  '',
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

// Formatar dinheiro
export function formatMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

// Formatar número
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

// Formatar percentual
export function formatPercent(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

// Formatar data
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR');
}

// Formatar data curta (dia/mes)
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Obter cor de variação
export function getVariationColor(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-600';
}

// Obter cor de fundo de variação
export function getVariationBgColor(value: number): string {
  if (value > 0) return 'bg-green-100 text-green-700';
  if (value < 0) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-700';
}

// Calcular data início do mês
export function getMonthStart(): string {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
}

// Calcular data de hoje
export function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

// Classe helper para juntar classes condicionais
export function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
