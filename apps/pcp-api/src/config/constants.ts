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

export const FILIAIS_ABREVIADAS: Record<number, string> = {
  1: 'IGU',
  2: 'FAB',
  3: 'BEN',
  4: 'DEL',
  5: 'L05',
  6: 'SOB',
  7: 'PAR',
  8: 'RIO',
  9: 'EXP',
  10: 'MOS',
  11: 'RPK',
  12: 'MES',
  13: 'EUS',
  16: 'VIA',
  17: 'NOR',
  18: 'TER',
  19: 'MAR',
};

export function nomeFilial(branchCode: number, branchName?: string | null): string {
  const clean = branchName?.trim();
  if (clean && !/^\d+$/.test(clean)) return clean;
  return FILIAIS[branchCode] || `Filial ${branchCode}`;
}

export function abreviacaoFilial(branchCode: number): string {
  return FILIAIS_ABREVIADAS[branchCode] || `L${String(branchCode).padStart(2, '0')}`;
}

export const EXCLUDED_OPERATIONS = new Set([
  140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236,
]);

export const DEVOLUTION_OPERATIONS = new Set([1, 46, 192, 604, 802, 900, 905, 9041]);