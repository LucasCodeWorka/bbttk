/**
 * Utilitário para exportação de dados para Excel (XLSX)
 *
 * Mantém números como números para permitir uso de fórmulas no Excel
 * Suporta formatação de moeda (R$) e percentual (%)
 */
import * as XLSX from 'xlsx';

export interface ExcelColumn {
  /** Chave do campo no objeto de dados */
  key: string;
  /** Título do cabeçalho */
  header: string;
  /** Largura da coluna em caracteres (default: 12) */
  width?: number;
  /** Tipo do dado: 'number' | 'text' | 'currency' | 'percent' (default: detecta automaticamente) */
  type?: 'number' | 'text' | 'currency' | 'percent';
  /** Função para extrair o valor (se key for aninhado ou precisar de transformação) */
  getValue?: (row: Record<string, unknown>) => unknown;
}

export interface ExcelExportOptions {
  /** Nome do arquivo (sem extensão) */
  filename: string;
  /** Nome da aba (default: 'Dados') */
  sheetName?: string;
  /** Título do relatório (opcional, aparece na primeira linha) */
  title?: string;
  /** Definição das colunas */
  columns: ExcelColumn[];
  /** Dados a exportar */
  data: Record<string, unknown>[];
  /** Adicionar linha de totais (opcional) */
  totals?: Record<string, number | string>;
}

// Formatos de número customizados
const CURRENCY_FORMAT = 'R$ #,##0.00';
const PERCENT_FORMAT = '0.0"%"';

/**
 * Aplica formatação nas células baseado no tipo da coluna
 */
function applyColumnFormats(
  ws: XLSX.WorkSheet,
  columns: ExcelColumn[],
  startRow: number,
  dataRowCount: number
): void {
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const col = columns[colIdx];
    if (col.type !== 'currency' && col.type !== 'percent') continue;

    const format = col.type === 'currency' ? CURRENCY_FORMAT : PERCENT_FORMAT;

    // Aplicar formato em todas as linhas de dados (incluindo totais)
    for (let rowIdx = startRow; rowIdx < startRow + dataRowCount; rowIdx++) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
      const cell = ws[cellRef];
      if (cell && typeof cell.v === 'number') {
        cell.z = format;
      }
    }
  }
}

/**
 * Exporta dados para arquivo Excel XLSX
 */
export function exportToExcel(options: ExcelExportOptions): void {
  const { filename, sheetName = 'Dados', title, columns, data, totals } = options;

  // Criar workbook
  const wb = XLSX.utils.book_new();

  // Preparar dados da planilha
  const wsData: unknown[][] = [];
  let startRow = 0;

  // Adicionar título se fornecido
  if (title) {
    wsData.push([title]);
    wsData.push([]); // Linha em branco
    startRow = 2;
  }

  // Adicionar cabeçalhos
  const headers = columns.map(col => col.header);
  wsData.push(headers);
  const headerRow = startRow;
  startRow++; // Dados começam após o cabeçalho

  // Adicionar dados
  for (const row of data) {
    const rowData: unknown[] = [];
    for (const col of columns) {
      let value: unknown;

      if (col.getValue) {
        value = col.getValue(row);
      } else {
        value = getNestedValue(row, col.key);
      }

      // Converter para tipo correto
      if (value === null || value === undefined || value === '' || value === '-') {
        rowData.push('');
      } else if (col.type === 'text') {
        rowData.push(String(value));
      } else if (col.type === 'number' || col.type === 'currency' || col.type === 'percent') {
        const num = parseNumber(value);
        rowData.push(isNaN(num) ? '' : num);
      } else {
        // Auto-detect
        const num = parseNumber(value);
        if (!isNaN(num) && typeof value !== 'string') {
          rowData.push(num);
        } else if (typeof value === 'string' && /^[\d.,\-]+$/.test(value.replace(/\s/g, ''))) {
          const parsed = parseNumber(value);
          rowData.push(isNaN(parsed) ? value : parsed);
        } else {
          rowData.push(value);
        }
      }
    }
    wsData.push(rowData);
  }

  // Contar linhas de dados (sem totais ainda)
  let dataRowCount = data.length;

  // Adicionar linha de totais se fornecido
  if (totals) {
    const totalsRow: unknown[] = [];
    for (const col of columns) {
      const value = totals[col.key];
      if (value !== undefined) {
        if (typeof value === 'number') {
          totalsRow.push(value);
        } else {
          totalsRow.push(value);
        }
      } else {
        totalsRow.push('');
      }
    }
    wsData.push(totalsRow);
    dataRowCount++; // Incluir totais na formatação
  }

  // Criar worksheet
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Aplicar formatação de moeda/percentual
  applyColumnFormats(ws, columns, startRow, dataRowCount);

  // Configurar larguras das colunas
  const colWidths: XLSX.ColInfo[] = columns.map(col => ({
    wch: col.width || 12
  }));
  ws['!cols'] = colWidths;

  // Mesclar células do título se existir
  if (title) {
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }
    ];
  }

  // Adicionar worksheet ao workbook
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Gerar e baixar arquivo
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Exporta múltiplas abas para um único arquivo Excel
 */
export function exportMultiSheetExcel(
  filename: string,
  sheets: Array<{
    sheetName: string;
    columns: ExcelColumn[];
    data: Record<string, unknown>[];
    title?: string;
    totals?: Record<string, number | string>;
  }>
): void {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const { sheetName, columns, data, title, totals } = sheet;
    const wsData: unknown[][] = [];
    let startRow = 0;

    if (title) {
      wsData.push([title]);
      wsData.push([]);
      startRow = 2;
    }

    const headers = columns.map(col => col.header);
    wsData.push(headers);
    startRow++; // Dados começam após o cabeçalho

    for (const row of data) {
      const rowData: unknown[] = [];
      for (const col of columns) {
        let value: unknown;

        if (col.getValue) {
          value = col.getValue(row);
        } else {
          value = getNestedValue(row, col.key);
        }

        if (value === null || value === undefined || value === '' || value === '-') {
          rowData.push('');
        } else if (col.type === 'text') {
          rowData.push(String(value));
        } else if (col.type === 'number' || col.type === 'currency' || col.type === 'percent') {
          const num = parseNumber(value);
          rowData.push(isNaN(num) ? '' : num);
        } else {
          const num = parseNumber(value);
          if (!isNaN(num) && typeof value !== 'string') {
            rowData.push(num);
          } else if (typeof value === 'string' && /^[\d.,\-]+$/.test(value.replace(/\s/g, ''))) {
            const parsed = parseNumber(value);
            rowData.push(isNaN(parsed) ? value : parsed);
          } else {
            rowData.push(value);
          }
        }
      }
      wsData.push(rowData);
    }

    let dataRowCount = data.length;

    if (totals) {
      const totalsRow: unknown[] = [];
      for (const col of columns) {
        const value = totals[col.key];
        if (value !== undefined) {
          totalsRow.push(typeof value === 'number' ? value : value);
        } else {
          totalsRow.push('');
        }
      }
      wsData.push(totalsRow);
      dataRowCount++;
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Aplicar formatação de moeda/percentual
    applyColumnFormats(ws, columns, startRow, dataRowCount);

    const colWidths: XLSX.ColInfo[] = columns.map(col => ({
      wch: col.width || 12
    }));
    ws['!cols'] = colWidths;

    if (title) {
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }
      ];
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Helpers

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, part: string) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Remove R$, %, espaços e troca vírgula por ponto
    const cleaned = value
      .replace(/R\$\s*/g, '')
      .replace(/%/g, '')
      .replace(/\s/g, '')
      .replace(/\./g, '') // Remove separadores de milhar
      .replace(',', '.'); // Troca vírgula decimal por ponto
    return parseFloat(cleaned);
  }
  return NaN;
}
