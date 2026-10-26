import type { SugestaoProducaoRow } from './pcpApi';
import { ordemGrade, tamanhoNormalizado } from './gradeOrdem';

export type ModoCorSugestao = 'padrao' | 'agrupada';
export const METRICAS_SUGESTAO = [
  'estoqueAtual', 'emProducao', 'estoqueFuturo', 'vendaPeriodoAtual',
  'vendaPeriodoAnterior', 'vendaMediaMensal', 'estoqueMinimo', 'sugestaoProducao',
] as const;
export type SugestaoMatrizMetricas = Pick<SugestaoProducaoRow, (typeof METRICAS_SUGESTAO)[number]> & { corteMinimo: number | null };
export type SugestaoMatrizSortKey = keyof SugestaoMatrizMetricas | 'referenceCode' | 'descricao' | 'categoria' | 'linha';
export interface SugestaoMatrizNo extends SugestaoMatrizMetricas {
  key: string;
  nivel: 'referencia' | 'cor' | 'tamanho';
  label: string;
  referenceCode: string;
  descricao: string;
  categoria: string | null;
  linha: string | null;
  cor: string | null;
  tamanho: string | null;
  skus: string[];
  productCodes: number[];
  coresOriginais: string[];
  cortesMinimos: number[];
  children: SugestaoMatrizNo[];
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const round2 = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

export function somarMetricasSugestao(rows: SugestaoProducaoRow[]): SugestaoMatrizMetricas {
  const metricas = Object.fromEntries(METRICAS_SUGESTAO.map((key) => [key, round2(rows.reduce((sum, row) => sum + row[key], 0))])) as Omit<SugestaoMatrizMetricas, 'corteMinimo'>;
  const cortes = new Set(rows.map((row) => row.corteMinimo));
  return { ...metricas, corteMinimo: cortes.size === 1 ? rows[0].corteMinimo : null };
}

function agrupar<T>(rows: T[], chave: (row: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const row of rows) {
    const key = chave(row);
    const grupo = grupos.get(key);
    if (grupo) grupo.push(row);
    else grupos.set(key, [row]);
  }
  return grupos;
}

function montarNo(rows: SugestaoProducaoRow[], props: Pick<SugestaoMatrizNo, 'key' | 'nivel' | 'label' | 'cor' | 'tamanho' | 'children'>): SugestaoMatrizNo {
  const primeiro = rows[0];
  const coresOriginais = [...new Set(rows.map((row) => row.corCodigo ? `${row.cor} (${row.corCodigo})` : row.cor))];
  const comum = (key: 'categoria' | 'linha') => rows.every((row) => row[key] === primeiro[key]) ? primeiro[key] : null;
  return {
    ...props,
    ...somarMetricasSugestao(rows),
    referenceCode: primeiro.referenceCode,
    descricao: props.nivel === 'referencia'
      ? primeiro.referenceName || primeiro.referenceCode
      : props.nivel === 'tamanho' && rows.length === 1
        ? primeiro.descricao
        : `${rows.length} SKUs${coresOriginais.length > 1 ? ` · ${coresOriginais.length} cores originais` : ''}`,
    categoria: comum('categoria'),
    linha: comum('linha'),
    skus: [...new Set(rows.map((row) => row.sku))],
    productCodes: [...new Set(rows.map((row) => row.productCode).filter((code): code is number => code !== null && Number.isSafeInteger(code) && code > 0))],
    coresOriginais,
    cortesMinimos: [...new Set(rows.map((row) => row.corteMinimo))].sort((a, b) => a - b),
  };
}

// O agrupamento e de apresentacao: conserva a sugestao/corte calculados por SKU.
// Recalcular o deficit depois de juntar cores mudaria a quantidade a produzir.
export function montarMatrizSugestaoProducao(
  rows: SugestaoProducaoRow[], modo: ModoCorSugestao,
  sortKey: SugestaoMatrizSortKey = 'sugestaoProducao', sortDir: 'asc' | 'desc' = 'desc',
): SugestaoMatrizNo[] {
  const comparar = (a: SugestaoMatrizNo, b: SugestaoMatrizNo) => {
    const va = a[sortKey], vb = b[sortKey];
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va ?? ''), String(vb ?? ''));
    return (sortDir === 'asc' ? cmp : -cmp) || collator.compare(a.label, b.label);
  };
  return [...agrupar(rows, (row) => row.referenceCode)].map(([referenceCode, referencias]) => {
    const cores = [...agrupar(referencias, (row) => modo === 'agrupada' && row.corAgrupada?.trim()
      ? JSON.stringify(['grupo', row.corAgrupada.trim()])
      : JSON.stringify(['original', row.corCodigo?.trim() || row.cor]))].map(([corKey, itens]) => {
      const cor = modo === 'agrupada' && itens[0].corAgrupada?.trim() ? itens[0].corAgrupada.trim() : itens[0].cor;
      const key = JSON.stringify(['cor', referenceCode, modo, corKey]);
      const tamanhos = [...agrupar(itens, (row) => tamanhoNormalizado(row.tamanho))].map(([tamanho, skus]) => montarNo(skus, {
        key: JSON.stringify([key, tamanho]), nivel: 'tamanho', label: tamanho, cor, tamanho, children: [],
      })).sort((a, b) => ordemGrade(a.label) - ordemGrade(b.label) || collator.compare(a.label, b.label));
      return montarNo(itens, { key, nivel: 'cor', label: cor, cor, tamanho: null, children: tamanhos });
    }).sort(comparar);
    return montarNo(referencias, {
      key: JSON.stringify(['referencia', referenceCode]), nivel: 'referencia', label: referenceCode,
      cor: null, tamanho: null, children: cores,
    });
  }).sort(comparar);
}

export function folhasSugestaoProducao(matriz: SugestaoMatrizNo[]): SugestaoMatrizNo[] {
  return matriz.flatMap((ref) => ref.children.flatMap((cor) => cor.children));
}

export function linhasVisiveisSugestaoProducao(matriz: SugestaoMatrizNo[], expandidos: Set<string>): SugestaoMatrizNo[] {
  const resultado: SugestaoMatrizNo[] = [];
  function visitar(no: SugestaoMatrizNo) {
    resultado.push(no);
    if (expandidos.has(no.key)) no.children.forEach(visitar);
  }
  matriz.forEach(visitar);
  return resultado;
}
