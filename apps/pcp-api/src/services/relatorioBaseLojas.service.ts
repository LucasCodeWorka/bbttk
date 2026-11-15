import { ATACADO_BRANCH_CODE, DPA_BRANCH_CODE } from '../config/constants.js';

export interface ColunaLoja {
  branchCode: number;
  label: string;
}

const LOJAS_ATUAIS: readonly ColunaLoja[] = [
  { branchCode: DPA_BRANCH_CODE, label: '02 DPA' },
  { branchCode: ATACADO_BRANCH_CODE, label: '02 ATACADO' },
  { branchCode: 1, label: '01 IGUATEMI' },
  { branchCode: 3, label: '03 BENFICA' },
  { branchCode: 4, label: '04 DEL PASEO' },
  { branchCode: 5, label: '05 PÁTIO' },
  { branchCode: 6, label: '06 SOBRAL' },
  { branchCode: 7, label: '07 PARANGABA' },
  { branchCode: 8, label: '08 RIOMAR' },
  { branchCode: 9, label: '09 EXPANSÃO' },
  { branchCode: 11, label: '11 PK' },
  { branchCode: 12, label: '12 MESSEJANA' },
  { branchCode: 13, label: '13 EUSÉBIO' },
  { branchCode: 17, label: '17 NORTH SHOPPING' },
];
const CODIGOS_ATUAIS = new Set(LOJAS_ATUAIS.map(loja => loja.branchCode));

export function ordenarColunasRelatorioBase(colunas: readonly ColunaLoja[]): ColunaLoja[] {
  const restantes = new Map(colunas.map(coluna => [coluna.branchCode, coluna]));
  const ordenadas: ColunaLoja[] = [];
  for (const loja of LOJAS_ATUAIS) {
    if (!restantes.has(loja.branchCode)) continue;
    ordenadas.push({ ...loja });
    restantes.delete(loja.branchCode);
  }
  return [
    ...ordenadas,
    ...Array.from(restantes.values()).sort((a, b) => a.branchCode - b.branchCode).map(coluna => ({
      ...coluna,
      label: `${String(coluna.branchCode).padStart(2, '0')} ${coluna.label.replace(/^\d+\s+/, '')}`,
    })),
  ];
}

export function selecionarColunasRelatorioBase(
  colunas: readonly ColunaLoja[], lojasComValores: ReadonlySet<number>
): ColunaLoja[] {
  return ordenarColunasRelatorioBase(colunas).filter(coluna =>
    CODIGOS_ATUAIS.has(coluna.branchCode) || lojasComValores.has(coluna.branchCode));
}
