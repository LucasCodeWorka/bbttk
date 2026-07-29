// Espelha apps/pcp-api/src/config/constants.ts (RELATORIO_BASE_BRANCH_ORDER) - mesma
// ordem das 13 colunas do Relatorio Base, usada tanto no configurador (cobertura ideal
// por loja) quanto na tela do relatorio.
export const ATACADO_BRANCH_CODE = -2;

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
