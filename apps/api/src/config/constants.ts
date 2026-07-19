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
  11: 'RIOMAR PK',
  12: 'MESSEJANA',
  13: 'EUSEBIO',
  17: 'NORTH SHOPPING',
};

// Operações excluídas (não são vendas)
export const EXCLUDED_OPERATIONS = new Set([
  140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236
]);

// Filiais que não são lojas de venda - hoje nenhuma (Fabrica/2 passou a vender como Atacado)
export const EXCLUDED_BRANCH_CODES = new Set<number>([]);

// Operações de devolução (TOTVS: invoiceData.operationsType = 'E' e operationMode = '3')
// Contam como faturamento negativo/devolução, não como venda.
export const DEVOLUTION_OPERATIONS = new Set([
  1, 46, 192, 604, 802, 900, 905, 9041
]);

// Níveis de meta (percentuais)
export const NIVEL_PERCENTUAIS = {
  1: 0.80,  // Bronze: 80%
  2: 0.90,  // Prata: 90%
  3: 1.00,  // Ouro: 100%
  4: 1.10,  // Diamante: 110%
  5: 1.20,  // Super: 120%
};
