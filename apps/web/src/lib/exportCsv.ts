// Exportacao simples de tabela para CSV (abre direto no Excel).
// Sem dependencia externa - o pacote xlsx do npm tem vulnerabilidades
// nao corrigidas (prototype pollution / ReDoS), entao evitamos ele aqui.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const header = columns.map((c) => escapeCsvField(c.header)).join(';');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(c.value(row))).join(';')
  );
  const csv = [header, ...lines].join('\r\n');

  // BOM UTF-8 para acentos aparecerem certo no Excel
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
