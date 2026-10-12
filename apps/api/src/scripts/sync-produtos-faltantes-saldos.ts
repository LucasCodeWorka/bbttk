import 'dotenv/config';
import https from 'https';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const API_BASE_URL = process.env.TOTVS_API_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const PRODUCT_CODE_CHUNK = 500;
const PAGE_SIZE = 500;
const MAX_TENTATIVAS = 4;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

type ClassificationColumn =
  | 'class_tipo'
  | 'class_categoria'
  | 'class_grupo'
  | 'class_linha'
  | 'class_colecao'
  | 'class_genero'
  | 'class_modelo'
  | 'class_tecido'
  | 'class_lancamento'
  | 'class_status'
  | 'class_tipo_de_materia_prima'
  | 'class_categoria_mp'
  | 'class_grupo_mc'
  | 'class_tecido_02'
  | 'class_motor_promocional'
  | 'class_campanha';

const CLASSIFICATION_COLUMNS: Record<number, ClassificationColumn> = {
  101: 'class_tipo',
  102: 'class_categoria',
  103: 'class_grupo',
  104: 'class_linha',
  105: 'class_colecao',
  106: 'class_genero',
  107: 'class_modelo',
  108: 'class_tecido',
  109: 'class_lancamento',
  110: 'class_status',
  111: 'class_tipo_de_materia_prima',
  112: 'class_categoria_mp',
  113: 'class_grupo_mc',
  115: 'class_tecido_02',
  117: 'class_motor_promocional',
  118: 'class_campanha',
};

interface TotvsClassification {
  typeCode?: number | null;
  typeName?: string | null;
  typeNameAux?: string | null;
  code?: string | null;
  name?: string | null;
  nameAux?: string | null;
}

interface TotvsProduct {
  productCode?: number | null;
  productSku?: string | null;
  productName?: string | null;
  colorCode?: string | null;
  colorName?: string | null;
  size?: string | null;
  ncm?: string | null;
  cst?: string | null;
  cest?: string | null;
  isActive?: boolean | null;
  isFinishedProduct?: boolean | null;
  isRawMaterial?: boolean | null;
  isBulkMaterial?: boolean | null;
  isOwnProduction?: boolean | null;
  measuredUnit?: string | null;
  minimumStockAmount?: number | null;
  maximumStockAmount?: number | null;
  idealStockAmount?: number | null;
  ReferenceCode?: string | null;
  referenceCode?: string | null;
  referenceId?: number | null;
  referenceName?: string | null;
  lastReferenceCode?: string | null;
  gridCode?: number | null;
  description?: string | null;
  descriptive?: string | null;
  isBlocked?: boolean | null;
  insertDate?: string | null;
  maxChangeFilterDate?: string | null;
  classifications?: TotvsClassification[] | null;
}

interface NormalizedProduct {
  productSku: string;
  productCode: number;
  productName: string | null;
  colorCode: string | null;
  colorName: string | null;
  size: string | null;
  ncm: string | null;
  cst: string | null;
  cest: string | null;
  isActive: boolean | null;
  isFinishedProduct: boolean | null;
  isRawMaterial: boolean | null;
  isBulkMaterial: boolean | null;
  isOwnProduction: boolean | null;
  measuredUnit: string | null;
  minimumStockAmount: number | null;
  maximumStockAmount: number | null;
  idealStockAmount: number | null;
  referenceCode: string | null;
  referenceId: number | null;
  referenceName: string | null;
  lastReferenceCode: string | null;
  gridCode: number | null;
  description: string | null;
  isBlocked: boolean | null;
  classValues: Record<ClassificationColumn, string | null>;
  classifications: TotvsClassification[];
}

function hasFlag(...names: string[]): boolean {
  return process.argv.slice(2).some((arg) => names.includes(arg));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function normalizeText(value: unknown, maxLength?: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return maxLength ? text.slice(0, maxLength) : text;
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function classificationSourceKey(classification: TotvsClassification): string {
  const typeCode = classification.typeCode ?? 'sem_tipo';
  const code = normalizeText(classification.code, 100) ?? 'sem_codigo';
  return `${typeCode}:${code}`.slice(0, 150);
}

function normalizeProduct(item: TotvsProduct): NormalizedProduct | null {
  const productCode = normalizeNumber(item.productCode);
  if (!productCode || !Number.isInteger(productCode)) return null;

  const productSku = normalizeText(item.productSku, 50) || `PRODUCT_CODE:${productCode}`;
  const classifications = item.classifications || [];
  const classValues = Object.fromEntries(
    Object.values(CLASSIFICATION_COLUMNS).map((column) => [column, null])
  ) as Record<ClassificationColumn, string | null>;

  for (const classification of classifications) {
    const typeCode = normalizeNumber(classification.typeCode);
    if (!typeCode) continue;
    const column = CLASSIFICATION_COLUMNS[typeCode];
    if (!column || classValues[column]) continue;
    classValues[column] = normalizeText(classification.name, 255);
  }

  return {
    productSku,
    productCode,
    productName: normalizeText(item.productName, 255),
    colorCode: normalizeText(item.colorCode, 10),
    colorName: normalizeText(item.colorName, 100),
    size: normalizeText(item.size, 20),
    ncm: normalizeText(item.ncm, 20),
    cst: normalizeText(item.cst, 10),
    cest: normalizeText(item.cest, 20),
    isActive: item.isActive ?? null,
    isFinishedProduct: item.isFinishedProduct ?? null,
    isRawMaterial: item.isRawMaterial ?? null,
    isBulkMaterial: item.isBulkMaterial ?? null,
    isOwnProduction: item.isOwnProduction ?? null,
    measuredUnit: normalizeText(item.measuredUnit, 10),
    minimumStockAmount: normalizeNumber(item.minimumStockAmount),
    maximumStockAmount: normalizeNumber(item.maximumStockAmount),
    idealStockAmount: normalizeNumber(item.idealStockAmount),
    referenceCode: normalizeText(item.ReferenceCode ?? item.referenceCode, 100),
    referenceId: normalizeNumber(item.referenceId),
    referenceName: normalizeText(item.referenceName, 255),
    lastReferenceCode: normalizeText(item.lastReferenceCode, 50),
    gridCode: normalizeNumber(item.gridCode),
    description: normalizeText(item.description ?? item.descriptive),
    isBlocked: item.isBlocked ?? null,
    classValues,
    classifications,
  };
}

async function getApiToken(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/authorization/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.TOTVS_CLIENT_ID || '',
      client_secret: process.env.TOTVS_CLIENT_SECRET || '',
      username: process.env.TOTVS_USERNAME || '',
      password: process.env.TOTVS_PASSWORD || '',
    }),
    // @ts-ignore - Node.js fetch suporta agent
    agent: httpsAgent,
  });

  if (!response.ok) {
    throw new Error(`Falha ao autenticar na TOTVS: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Falha ao autenticar na TOTVS: access_token ausente.');
  return data.access_token;
}

async function getProductCodesFaltantes(limit?: number): Promise<number[]> {
  const limitSql = limit && limit > 0 ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ product_code: number }>>`
    SELECT s.product_code
    FROM stg_saldo_virtual_csv s
    LEFT JOIN produtos p ON p.product_code = s.product_code
    WHERE s.product_code IS NOT NULL
      AND p.product_code IS NULL
      AND s.rejection_reason LIKE '%produto_nao_encontrado%'
    GROUP BY s.product_code
    ORDER BY COUNT(*) DESC
    ${limitSql}
  `;
  return rows.map((row) => row.product_code);
}

async function fetchProducts(productCodes: number[]): Promise<NormalizedProduct[]> {
  const products: NormalizedProduct[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    let lastError = '';
    let data: { hasNext?: boolean; items?: TotvsProduct[] } | null = null;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        const token = await getApiToken();
        const response = await fetch(`${API_BASE_URL}/product/v2/products/search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filter: { productCodeList: productCodes },
            option: { branchInfoCode: 1 },
            page,
            pageSize: PAGE_SIZE,
            expand: 'classifications',
            order: 'productCode',
          }),
          // @ts-ignore - Node.js fetch suporta agent
          agent: httpsAgent,
        });

        if (!response.ok) {
          lastError = `HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 300)}`;
        } else {
          data = (await response.json()) as { hasNext?: boolean; items?: TotvsProduct[] };
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (tentativa < MAX_TENTATIVAS) await new Promise((resolve) => setTimeout(resolve, tentativa * 3000));
    }

    if (!data) throw new Error(`Erro ao buscar produtos na TOTVS, pagina ${page}: ${lastError}`);

    for (const item of data.items || []) {
      const normalized = normalizeProduct(item);
      if (normalized) products.push(normalized);
    }

    hasNext = !!data.hasNext;
    page++;
  }

  return products;
}

async function upsertProducts(products: NormalizedProduct[], dryRun: boolean): Promise<void> {
  if (dryRun || products.length === 0) return;

  for (let i = 0; i < products.length; i += 500) {
    const batch = products.slice(i, i + 500);
    const values = batch.map((p) => Prisma.sql`(
      ${p.productSku}, ${p.productName}, ${p.colorCode}, ${p.colorName}, ${p.size},
      ${p.ncm}, ${p.cst}, ${p.cest}, ${p.isActive}, ${p.isFinishedProduct},
      ${p.isRawMaterial}, ${p.isBulkMaterial}, ${p.isOwnProduction}, ${p.measuredUnit},
      ${p.minimumStockAmount}, ${p.maximumStockAmount}, ${p.idealStockAmount},
      ${p.referenceCode}, ${p.referenceId}, ${p.referenceName}, ${p.lastReferenceCode},
      ${p.gridCode}, ${p.description}, ${p.isBlocked}, now(), now(), ${p.productCode}
    )`);

    await prisma.$executeRaw`
      INSERT INTO produtos (
        product_sku, product_name, color_code, color_name, size,
        ncm, cst, cest, is_active, is_finished_product,
        is_raw_material, is_bulk_material, is_own_production, measured_unit,
        minimum_stock_amount, maximum_stock_amount, ideal_stock_amount,
        reference_code, reference_id, reference_name, last_reference_code,
        grid_code, description, is_blocked, created_at, updated_at, product_code
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (product_sku)
      DO UPDATE SET
        product_name = EXCLUDED.product_name,
        color_code = EXCLUDED.color_code,
        color_name = EXCLUDED.color_name,
        size = EXCLUDED.size,
        ncm = EXCLUDED.ncm,
        cst = EXCLUDED.cst,
        cest = EXCLUDED.cest,
        is_active = EXCLUDED.is_active,
        is_finished_product = EXCLUDED.is_finished_product,
        is_raw_material = EXCLUDED.is_raw_material,
        is_bulk_material = EXCLUDED.is_bulk_material,
        is_own_production = EXCLUDED.is_own_production,
        measured_unit = EXCLUDED.measured_unit,
        minimum_stock_amount = EXCLUDED.minimum_stock_amount,
        maximum_stock_amount = EXCLUDED.maximum_stock_amount,
        ideal_stock_amount = EXCLUDED.ideal_stock_amount,
        reference_code = EXCLUDED.reference_code,
        reference_id = EXCLUDED.reference_id,
        reference_name = EXCLUDED.reference_name,
        last_reference_code = EXCLUDED.last_reference_code,
        grid_code = EXCLUDED.grid_code,
        description = EXCLUDED.description,
        is_blocked = EXCLUDED.is_blocked,
        product_code = EXCLUDED.product_code,
        updated_at = now()
    `;

    await prisma.$executeRaw`
      INSERT INTO produto_analitico (
        product_sku, product_name, color_code, color_name, size,
        ncm, cst, cest, is_active, is_finished_product,
        is_raw_material, is_bulk_material, is_own_production, measured_unit,
        minimum_stock_amount, maximum_stock_amount, ideal_stock_amount,
        reference_code, reference_id, reference_name, last_reference_code,
        grid_code, description, is_blocked, created_at, updated_at, product_code,
        refreshed_at, class_tipo, class_categoria, class_grupo, class_linha,
        class_colecao, class_genero, class_modelo, class_tecido, class_lancamento,
        class_status, class_tipo_de_materia_prima, class_categoria_mp, class_grupo_mc,
        class_tecido_02, class_motor_promocional, class_campanha
      )
      VALUES ${Prisma.join(batch.map((p) => Prisma.sql`(
        ${p.productSku}, ${p.productName}, ${p.colorCode}, ${p.colorName}, ${p.size},
        ${p.ncm}, ${p.cst}, ${p.cest}, ${p.isActive}, ${p.isFinishedProduct},
        ${p.isRawMaterial}, ${p.isBulkMaterial}, ${p.isOwnProduction}, ${p.measuredUnit},
        ${p.minimumStockAmount}, ${p.maximumStockAmount}, ${p.idealStockAmount},
        ${p.referenceCode}, ${p.referenceId}, ${p.referenceName}, ${p.lastReferenceCode},
        ${p.gridCode}, ${p.description}, ${p.isBlocked}, now(), now(), ${p.productCode},
        now(), ${p.classValues.class_tipo}, ${p.classValues.class_categoria}, ${p.classValues.class_grupo}, ${p.classValues.class_linha},
        ${p.classValues.class_colecao}, ${p.classValues.class_genero}, ${p.classValues.class_modelo}, ${p.classValues.class_tecido}, ${p.classValues.class_lancamento},
        ${p.classValues.class_status}, ${p.classValues.class_tipo_de_materia_prima}, ${p.classValues.class_categoria_mp}, ${p.classValues.class_grupo_mc},
        ${p.classValues.class_tecido_02}, ${p.classValues.class_motor_promocional}, ${p.classValues.class_campanha}
      )`))}
      ON CONFLICT (product_sku)
      DO UPDATE SET
        product_name = EXCLUDED.product_name,
        color_code = EXCLUDED.color_code,
        color_name = EXCLUDED.color_name,
        size = EXCLUDED.size,
        ncm = EXCLUDED.ncm,
        cst = EXCLUDED.cst,
        cest = EXCLUDED.cest,
        is_active = EXCLUDED.is_active,
        is_finished_product = EXCLUDED.is_finished_product,
        is_raw_material = EXCLUDED.is_raw_material,
        is_bulk_material = EXCLUDED.is_bulk_material,
        is_own_production = EXCLUDED.is_own_production,
        measured_unit = EXCLUDED.measured_unit,
        minimum_stock_amount = EXCLUDED.minimum_stock_amount,
        maximum_stock_amount = EXCLUDED.maximum_stock_amount,
        ideal_stock_amount = EXCLUDED.ideal_stock_amount,
        reference_code = EXCLUDED.reference_code,
        reference_id = EXCLUDED.reference_id,
        reference_name = EXCLUDED.reference_name,
        last_reference_code = EXCLUDED.last_reference_code,
        grid_code = EXCLUDED.grid_code,
        description = EXCLUDED.description,
        is_blocked = EXCLUDED.is_blocked,
        product_code = EXCLUDED.product_code,
        updated_at = now(),
        refreshed_at = now(),
        class_tipo = EXCLUDED.class_tipo,
        class_categoria = EXCLUDED.class_categoria,
        class_grupo = EXCLUDED.class_grupo,
        class_linha = EXCLUDED.class_linha,
        class_colecao = EXCLUDED.class_colecao,
        class_genero = EXCLUDED.class_genero,
        class_modelo = EXCLUDED.class_modelo,
        class_tecido = EXCLUDED.class_tecido,
        class_lancamento = EXCLUDED.class_lancamento,
        class_status = EXCLUDED.class_status,
        class_tipo_de_materia_prima = EXCLUDED.class_tipo_de_materia_prima,
        class_categoria_mp = EXCLUDED.class_categoria_mp,
        class_grupo_mc = EXCLUDED.class_grupo_mc,
        class_tecido_02 = EXCLUDED.class_tecido_02,
        class_motor_promocional = EXCLUDED.class_motor_promocional,
        class_campanha = EXCLUDED.class_campanha
    `;
  }
}

async function upsertClassifications(products: NormalizedProduct[], dryRun: boolean): Promise<number> {
  const rows = products.flatMap((product) =>
    product.classifications.map((classification) => ({
      product,
      classification,
      sourceKey: classificationSourceKey(classification),
    }))
  );

  if (dryRun || rows.length === 0) return rows.length;

  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    await prisma.$executeRaw`
      INSERT INTO produto_classificacao (
        product_sku, product_code, classification_source_key, classification_type_code,
        classification_type_name, classification_type_name_aux, classification_code,
        classification_name, classification_name_aux, raw_data, created_at, updated_at
      )
      VALUES ${Prisma.join(batch.map(({ product, classification, sourceKey }) => Prisma.sql`(
        ${product.productSku},
        ${product.productCode},
        ${sourceKey},
        ${normalizeNumber(classification.typeCode)},
        ${normalizeText(classification.typeName, 255)},
        ${normalizeText(classification.typeNameAux, 255)},
        ${normalizeText(classification.code, 100)},
        ${normalizeText(classification.name, 255)},
        ${normalizeText(classification.nameAux, 255)},
        ${JSON.stringify(classification)}::jsonb,
        now(),
        now()
      )`))}
      ON CONFLICT (product_sku, classification_source_key)
      DO UPDATE SET
        product_code = EXCLUDED.product_code,
        classification_type_code = EXCLUDED.classification_type_code,
        classification_type_name = EXCLUDED.classification_type_name,
        classification_type_name_aux = EXCLUDED.classification_type_name_aux,
        classification_code = EXCLUDED.classification_code,
        classification_name = EXCLUDED.classification_name,
        classification_name_aux = EXCLUDED.classification_name_aux,
        raw_data = EXCLUDED.raw_data,
        updated_at = now()
    `;
  }

  return rows.length;
}

async function atualizarStaging(dryRun: boolean): Promise<number> {
  if (dryRun) return 0;

  const result = await prisma.$executeRaw`
    UPDATE stg_saldo_virtual_csv s
    SET
      is_product_found = true,
      rejection_reason = NULLIF(
        TRIM(BOTH '; ' FROM REPLACE(REPLACE(COALESCE(s.rejection_reason, ''), 'produto_nao_encontrado', ''), ';;', ';')),
        ''
      )
    FROM produtos p
    WHERE p.product_code = s.product_code
      AND s.rejection_reason LIKE '%produto_nao_encontrado%'
  `;

  return Number(result);
}

async function main() {
  const startedAt = Date.now();
  const dryRun = !hasFlag('--apply');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  console.log(`[produtos-faltantes-saldos] inicio ${new Date().toISOString()} (${dryRun ? 'dry-run' : 'gravando'})`);

  const productCodes = await getProductCodesFaltantes(Number.isFinite(limit) ? limit : undefined);
  console.log(`[produtos-faltantes-saldos] codigos faltantes: ${productCodes.length}`);

  let encontrados = 0;
  let classificacoes = 0;
  const vistos = new Set<number>();

  for (let i = 0; i < productCodes.length; i += PRODUCT_CODE_CHUNK) {
    const chunk = productCodes.slice(i, i + PRODUCT_CODE_CHUNK);
    const chunkIndex = Math.floor(i / PRODUCT_CODE_CHUNK) + 1;
    const totalChunks = Math.ceil(productCodes.length / PRODUCT_CODE_CHUNK);
    console.log(`[produtos-faltantes-saldos] lote ${chunkIndex}/${totalChunks}: buscando ${chunk.length} codigos...`);

    const products = await fetchProducts(chunk);
    for (const product of products) vistos.add(product.productCode);

    await upsertProducts(products, dryRun);
    classificacoes += await upsertClassifications(products, dryRun);
    encontrados += products.length;

    console.log(
      `[produtos-faltantes-saldos] lote ${chunkIndex}/${totalChunks}: ${products.length} produtos retornados, total ${encontrados}`
    );
  }

  const linhasStagingAtualizadas = await atualizarStaging(dryRun);
  const naoEncontrados = productCodes.filter((code) => !vistos.has(code));

  console.log('[produtos-faltantes-saldos] resumo:');
  console.log(JSON.stringify({
    dryRun,
    codigosFaltantesAntes: productCodes.length,
    produtosRetornadosTotvs: encontrados,
    codigosNaoRetornadosTotvs: naoEncontrados.length,
    classificacoes,
    linhasStagingAtualizadas,
    amostraNaoRetornados: naoEncontrados.slice(0, 20),
    duration: formatDuration(Date.now() - startedAt),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[produtos-faltantes-saldos] erro:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
