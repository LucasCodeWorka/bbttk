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

// Sentinel nao-real de branch_code pra representar a coluna sintetica "Atacado" (canal
// de venda dentro da Fabrica/branch_code=2, nunca uma filial de verdade). Negativo de
// proposito, pra nunca colidir com um branch_code real que o TOTVS venha a criar.
export const ATACADO_BRANCH_CODE = -2;

// Ordem exata das 13 colunas de filial do Relatorio Base, igual ao cabecalho da
// planilha de referencia. branch_code=2 (FABRICA) nunca aparece como coluna propria -
// e inteiramente consumido pela sintese da coluna Atacado.
export const RELATORIO_BASE_BRANCH_ORDER: { branchCode: number; label: string }[] = [
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
