// Filiais da Bebetenkite (nomes sincronizados com a tabela `branches` do ETL)
export const FILIAIS: Record<number, string> = {
  1: 'IGUATEMI',
  2: 'FABRICA',
  3: 'BENFICA',
  4: 'DEL PASEO',
  5: 'PATIO DOM LUIS',
  6: 'SOBRAL SHOPPING',
  7: 'PARANGABA',
  8: 'RIOMAR',
  9: 'IGUATEMI EXP.',
  10: 'MOSSORO',
  11: 'RIOMAR PK',
  12: 'MESSEJANA',
  13: 'EUSEBIO',
  16: 'VIA SUL',
  17: 'NORTH SHOPPING',
  18: 'TERRAZO SHOPPING',
  19: 'MART MODA',
};

// branch_code sintetico usado so na tabela `metas` pra vendedoras VOLANTE (sem loja
// fixa) - de proposito nao entra em FILIAIS, nunca deve aparecer como opcao de loja em
// filtro nenhum, so nos pontos que tratam meta/comissao explicitamente.
export const VOLANTE_BRANCH_CODE = 0;

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

// Distribui um valor total entre itens proporcionalmente aos pesos passados, garantindo
// que a soma dos valores retornados feche EXATO com o total (sem sobra/falta de
// centavo por erro de arredondamento) - a diferenca de centavos residual vai pros itens
// de maior peso primeiro. Usado no cadastro de metas pra distribuir entre lojas e entre
// vendedores sem exigir que o usuario calcule percentual manualmente.
export function distribuirValor(total: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];

  const somaPesos = pesos.reduce((s, p) => s + Math.max(p, 0), 0);
  // Sem peso valido em nenhum item (ex: nenhum historico de venda) - cai pra igual.
  if (somaPesos <= 0) return distribuirValor(total, pesos.map(() => 1));

  const totalCentavos = Math.round(total * 100);
  const brutos = pesos.map((p) => (totalCentavos * Math.max(p, 0)) / somaPesos);
  const base = brutos.map((b) => Math.floor(b));
  const somaBase = base.reduce((s, v) => s + v, 0);
  const restante = totalCentavos - somaBase;

  // Sobra de centavos (sempre < pesos.length) vai pros itens com maior parte
  // fracionaria perdida no floor - desempate pelo maior peso.
  const ordem = pesos
    .map((_, i) => i)
    .sort((a, b) => (brutos[b] - base[b]) - (brutos[a] - base[a]) || pesos[b] - pesos[a]);

  for (let k = 0; k < restante; k++) {
    base[ordem[k % ordem.length]] += 1;
  }

  return base.map((centavos) => Math.round(centavos) / 100);
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

// Formatar mes curto (mes/ano) - usado quando o grafico agrega por mes
export function formatMonthShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
}

// Verifica se duas datas (yyyy-mm-dd) estao dentro do mesmo mes/ano
export function isMesUnico(dataInicio: string, dataFim: string): boolean {
  return dataInicio.slice(0, 7) === dataFim.slice(0, 7);
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
