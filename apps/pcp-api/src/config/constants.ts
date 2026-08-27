export const FILIAIS: Record<number, string> = {
  1: 'IGUATEMI',
  // A filial 02 do TOTVS e dois locais de estoque distintos. Os codigos negativos
  // sao sentinelas da aplicacao, para que os filtros nunca misturem os dois.
  [-1]: 'DPA',
  [-2]: 'ATACADO',
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

// A filial 02 contem dois locais: DPA (fisico + segunda qualidade) e ATACADO.
// Os codigos negativos sao propositais, para nunca colidirem com uma filial real.
export const DPA_BRANCH_CODE = -1;
export const ATACADO_BRANCH_CODE = -2;
export const DPA_STOCK_CODES = [1, 5];
export const ATACADO_STOCK_CODE = 8;

// A filial 02 nunca aparece como coluna propria: DPA e ATACADO sao locais separados.
export const RELATORIO_BASE_BRANCH_ORDER: { branchCode: number; label: string }[] = [
  { branchCode: DPA_BRANCH_CODE, label: 'DPA' },
  { branchCode: ATACADO_BRANCH_CODE, label: 'ATACADO' },
  { branchCode: 1, label: 'IGUATEMI' },
  { branchCode: 13, label: 'EUSÉBIO' },
  { branchCode: 6, label: 'SOBRAL' },
  { branchCode: 4, label: 'DEL PASEO' },
  { branchCode: 9, label: 'EXPANSÃO' },
  { branchCode: 12, label: 'MESSEJANA' },
  { branchCode: 7, label: 'PARANGABA' },
  { branchCode: 11, label: 'RIOMAR PK' },
  { branchCode: 8, label: 'RIO MAR' },
  { branchCode: 17, label: 'NORTH SHOPPING' },
  { branchCode: 3, label: 'BENFICA' },
  { branchCode: 5, label: 'PÁTIO DOM LUÍS' },
];

export const EXCLUDED_OPERATIONS = new Set([
  140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236,
]);

export const DEVOLUTION_OPERATIONS = new Set([1, 46, 192, 604, 802, 900, 905, 9041]);
