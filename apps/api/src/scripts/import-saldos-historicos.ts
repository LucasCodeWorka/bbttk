import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const DEFAULT_FOLDER = 'C:\\Users\\Marcelo\\OneDrive\\Documentos\\PROJETOS\\SALDOS';
const DEFAULT_CUTOFF_DATE = '2026-10-08';
const DEFAULT_MAX_ABS_STOCK = 1_000_000;
const BATCH_SIZE = 2000;
const EXPECTED_HEADER = 'Cod. Empresa;Cod. Saldo;Cod. Produto;Dt. Saldo;Qt. Saldo';

interface Args {
  folder: string;
  apply: boolean;
  truncate: boolean;
  maxRows: number | null;
  cutoffDate: string;
  maxAbsStock: number;
}

interface ParsedRow {
  sourceFile: string;
  rowNumber: number;
  branchCode: number | null;
  stockCode: number | null;
  productCode: number | null;
  stock: number | null;
  saldoDate: string | null;
  rejectionReason: string | null;
}

interface ImportStats {
  files: number;
  rows: number;
  inserted: number;
  skippedEmpty: number;
  invalidHeader: number;
  invalidRows: number;
  productNotFound: number;
  branchNotFound: number;
  outliers: number;
  minDate: string | null;
  maxDate: string | null;
  products: Set<number>;
  branches: Set<number>;
  stockCodes: Set<number>;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const maxRowsRaw = getValue('--max-rows');
  const maxAbsStockRaw = getValue('--max-abs-stock');

  return {
    folder: getValue('--folder') || DEFAULT_FOLDER,
    apply: args.includes('--apply'),
    truncate: args.includes('--truncate'),
    maxRows: maxRowsRaw ? Number(maxRowsRaw) : null,
    cutoffDate: getValue('--cutoff-date') || DEFAULT_CUTOFF_DATE,
    maxAbsStock: maxAbsStockRaw ? Number(maxAbsStockRaw) : DEFAULT_MAX_ABS_STOCK,
  };
}

function formatDuration(ms: number): string {
  const secondsTotal = Math.round(ms / 1000);
  const minutes = Math.floor(secondsTotal / 60);
  const seconds = secondsTotal % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function parseDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function addReason(current: string | null, reason: string): string {
  return current ? `${current}; ${reason}` : reason;
}

async function loadExistingSets() {
  const [products, branches] = await Promise.all([
    prisma.$queryRaw<Array<{ product_code: number }>>`
      SELECT DISTINCT product_code
      FROM produtos
      WHERE product_code IS NOT NULL
    `,
    prisma.$queryRaw<Array<{ branch_code: number }>>`
      SELECT branch_code
      FROM branches
    `,
  ]);

  return {
    productCodes: new Set(products.map((row) => row.product_code)),
    branchCodes: new Set(branches.map((row) => row.branch_code)),
  };
}

async function insertBatch(rows: ParsedRow[], cutoffDate: string) {
  if (rows.length === 0) return;

  await prisma.$executeRaw`
    INSERT INTO stg_saldo_virtual_csv (
      source_file,
      row_number,
      branch_code,
      stock_code,
      product_code,
      seqgrupo,
      stock,
      product_description,
      saldo_date,
      cutoff_date,
      is_before_cutoff,
      is_product_found,
      is_branch_found,
      rejection_reason,
      imported_to_prd_saldo,
      loaded_at
    )
    VALUES ${Prisma.join(
      rows.map((row) => Prisma.sql`(
        ${row.sourceFile},
        ${row.rowNumber},
        ${row.branchCode},
        ${row.stockCode},
        ${row.productCode},
        ${null},
        ${row.stock},
        ${null},
        ${row.saldoDate ? new Date(`${row.saldoDate}T00:00:00`) : null},
        ${new Date(`${cutoffDate}T00:00:00`)},
        ${row.saldoDate ? row.saldoDate < cutoffDate : false},
        ${row.productCode !== null && !row.rejectionReason?.includes('produto_nao_encontrado')},
        ${row.branchCode !== null && !row.rejectionReason?.includes('filial_nao_encontrada')},
        ${row.rejectionReason},
        ${false},
        now()
      )`)
    )}
    ON CONFLICT (source_file, row_number) DO UPDATE SET
      branch_code = EXCLUDED.branch_code,
      stock_code = EXCLUDED.stock_code,
      product_code = EXCLUDED.product_code,
      stock = EXCLUDED.stock,
      saldo_date = EXCLUDED.saldo_date,
      cutoff_date = EXCLUDED.cutoff_date,
      is_before_cutoff = EXCLUDED.is_before_cutoff,
      is_product_found = EXCLUDED.is_product_found,
      is_branch_found = EXCLUDED.is_branch_found,
      rejection_reason = EXCLUDED.rejection_reason,
      imported_to_prd_saldo = false,
      loaded_at = now()
  `;
}

async function processFile(
  filePath: string,
  args: Args,
  productCodes: Set<number>,
  branchCodes: Set<number>,
  stats: ImportStats
) {
  const sourceFile = path.basename(filePath);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let rowNumber = 0;
  let batch: ParsedRow[] = [];

  for await (const line of rl) {
    rowNumber += 1;

    if (rowNumber === 1) {
      if (line.trim() !== EXPECTED_HEADER) {
        stats.invalidHeader += 1;
        console.warn(`[saldos-historicos] cabecalho inesperado em ${sourceFile}: ${line}`);
      }
      continue;
    }

    if (args.maxRows !== null && stats.rows >= args.maxRows) break;

    if (!line.trim() || line.trim() === ';;;;') {
      stats.skippedEmpty += 1;
      continue;
    }

    const columns = line.split(';');
    let rejectionReason: string | null = null;
    if (columns.length !== 5) rejectionReason = addReason(rejectionReason, 'colunas_invalidas');

    const branchCode = parseNumber(columns[0] || '');
    const stockCode = parseNumber(columns[1] || '');
    const productCode = parseNumber(columns[2] || '');
    const saldoDate = parseDate(columns[3] || '');
    const stock = parseNumber(columns[4] || '');

    if (branchCode === null || !Number.isInteger(branchCode)) rejectionReason = addReason(rejectionReason, 'filial_invalida');
    if (stockCode === null || !Number.isInteger(stockCode)) rejectionReason = addReason(rejectionReason, 'saldo_invalido');
    if (productCode === null || !Number.isInteger(productCode)) rejectionReason = addReason(rejectionReason, 'produto_invalido');
    if (!saldoDate) rejectionReason = addReason(rejectionReason, 'data_invalida');
    if (stock === null) rejectionReason = addReason(rejectionReason, 'quantidade_invalida');

    if (productCode !== null && Number.isInteger(productCode)) {
      stats.products.add(productCode);
      if (!productCodes.has(productCode)) {
        stats.productNotFound += 1;
        rejectionReason = addReason(rejectionReason, 'produto_nao_encontrado');
      }
    }

    if (branchCode !== null && Number.isInteger(branchCode)) {
      stats.branches.add(branchCode);
      if (!branchCodes.has(branchCode)) {
        stats.branchNotFound += 1;
        rejectionReason = addReason(rejectionReason, 'filial_nao_encontrada');
      }
    }

    if (stockCode !== null && Number.isInteger(stockCode)) stats.stockCodes.add(stockCode);

    if (stock !== null && Math.abs(stock) > args.maxAbsStock) {
      stats.outliers += 1;
      rejectionReason = addReason(rejectionReason, 'quantidade_outlier');
    }

    if (saldoDate) {
      stats.minDate = !stats.minDate || saldoDate < stats.minDate ? saldoDate : stats.minDate;
      stats.maxDate = !stats.maxDate || saldoDate > stats.maxDate ? saldoDate : stats.maxDate;
    }

    if (rejectionReason) stats.invalidRows += 1;
    stats.rows += 1;

    const parsed: ParsedRow = {
      sourceFile,
      rowNumber,
      branchCode: branchCode !== null && Number.isInteger(branchCode) ? branchCode : null,
      stockCode: stockCode !== null && Number.isInteger(stockCode) ? stockCode : null,
      productCode: productCode !== null && Number.isInteger(productCode) ? productCode : null,
      saldoDate,
      stock,
      rejectionReason,
    };

    if (args.apply) {
      batch.push(parsed);
      if (batch.length >= BATCH_SIZE) {
        await insertBatch(batch, args.cutoffDate);
        stats.inserted += batch.length;
        batch = [];
      }
    }
  }

  if (args.apply && batch.length) {
    await insertBatch(batch, args.cutoffDate);
    stats.inserted += batch.length;
  }
}

async function main() {
  const args = parseArgs();
  const startedAt = Date.now();

  if (!fs.existsSync(args.folder)) {
    throw new Error(`Pasta nao encontrada: ${args.folder}`);
  }

  const files = fs.readdirSync(args.folder)
    .filter((file) => file.toUpperCase().endsWith('.CSV'))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  if (files.length === 0) throw new Error(`Nenhum CSV encontrado em ${args.folder}`);

  console.log(`[saldos-historicos] inicio ${new Date().toISOString()}${args.apply ? ' (gravando staging)' : ' (dry-run)'}`);
  console.log(`[saldos-historicos] pasta: ${args.folder}`);
  console.log(`[saldos-historicos] arquivos: ${files.length}`);

  const { productCodes, branchCodes } = await loadExistingSets();
  console.log(`[saldos-historicos] cadastro atual: ${productCodes.size} product_codes, ${branchCodes.size} filiais`);

  if (args.apply && args.truncate) {
    console.log('[saldos-historicos] limpando stg_saldo_virtual_csv...');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE stg_saldo_virtual_csv');
  } else if (!args.apply) {
    console.log('[saldos-historicos] dry-run: nada sera gravado. Use --apply para carregar a staging.');
  }

  const stats: ImportStats = {
    files: files.length,
    rows: 0,
    inserted: 0,
    skippedEmpty: 0,
    invalidHeader: 0,
    invalidRows: 0,
    productNotFound: 0,
    branchNotFound: 0,
    outliers: 0,
    minDate: null,
    maxDate: null,
    products: new Set<number>(),
    branches: new Set<number>(),
    stockCodes: new Set<number>(),
  };

  for (const file of files) {
    if (args.maxRows !== null && stats.rows >= args.maxRows) break;
    const before = stats.rows;
    await processFile(path.join(args.folder, file), args, productCodes, branchCodes, stats);
    console.log(`[saldos-historicos] ${file}: ${stats.rows - before} linhas lidas, total ${stats.rows}${args.apply ? `, inseridas ${stats.inserted}` : ''}`);
  }

  console.log('[saldos-historicos] resumo:');
  console.log(JSON.stringify({
    dryRun: !args.apply,
    files: stats.files,
    rows: stats.rows,
    inserted: stats.inserted,
    skippedEmpty: stats.skippedEmpty,
    invalidHeader: stats.invalidHeader,
    invalidRows: stats.invalidRows,
    productNotFound: stats.productNotFound,
    branchNotFound: stats.branchNotFound,
    outliers: stats.outliers,
    minDate: stats.minDate,
    maxDate: stats.maxDate,
    products: stats.products.size,
    branches: [...stats.branches].sort((a, b) => a - b),
    stockCodes: [...stats.stockCodes].sort((a, b) => a - b),
    duration: formatDuration(Date.now() - startedAt),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[saldos-historicos] erro:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
