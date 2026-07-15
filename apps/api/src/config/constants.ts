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

// Operações excluídas (não são vendas)
export const EXCLUDED_OPERATIONS = new Set([
  140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236
]);

// Níveis de meta (percentuais)
export const NIVEL_PERCENTUAIS = {
  1: 0.80,  // Bronze: 80%
  2: 0.90,  // Prata: 90%
  3: 1.00,  // Ouro: 100%
  4: 1.10,  // Diamante: 110%
  5: 1.20,  // Super: 120%
};
