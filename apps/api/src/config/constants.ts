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

// Filiais que não são lojas de venda - hoje nenhuma (Fabrica/2 passou a vender como Atacado)
export const EXCLUDED_BRANCH_CODES = new Set<number>([]);

// A classificacao de venda/devolucao NAO usa mais lista de operation_code fixa aqui -
// isso ja causou faturamento inflado mais de uma vez porque o TOTVS cria operacao nova
// (compra, consignacao, remessa, brinde) sem avisar, e ela caia como "venda" por padrao
// ate alguem desconfiar de um numero errado. Agora vem de `classificacao_operacoes`
// (tabela propria, sincronizada da API do TOTVS via totvs.service.ts syncClassificacaoOperacoes),
// usando operationsType/operationMode direto - ver OPERACAO_JOIN/IS_VENDA/IS_DEVOLUCAO
// em vendas.service.ts.

// Níveis de meta (percentuais)
export const NIVEL_PERCENTUAIS = {
  1: 0.80,  // Bronze: 80%
  2: 0.90,  // Prata: 90%
  3: 1.00,  // Ouro: 100%
  4: 1.10,  // Diamante: 110%
  5: 1.20,  // Super: 120%
};
