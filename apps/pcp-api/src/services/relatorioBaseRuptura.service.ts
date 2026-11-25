import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

// Regra da RUPTURA pedida pela Renata em 24/11/2026: alem de Basico/Renovavel com
// STATUS ATIVO, o SKU so entra na base se (1) ja teve alguma entrada na vida e
// (2) teve venda nos ultimos 12 meses. Antes a base era o cadastro ativo inteiro
// e 62% dava ruptura porque muito item "ATIVO" no TOTVS nunca entrou ou nao vende.
//
// Avaliado na REDE inteira (qualquer filial, varejo e atacado), ate a data da
// posicao: e uma condicao do item, nao da loja. O filtro de loja da tela continua
// decidindo SO o estoque que conta pra saber se esta em ruptura.
//
// Sem import do relatorioBase.service (ele importa este arquivo): os filtros de
// operacao abaixo repetem IS_VENDA (S/4) e a entrada (operations_type E) de la.

export interface VidaRupturaProduto {
  ultimaVenda: string;
  venda12m: number;
  ultimaEntrada: string;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { em: number; valor: Promise<Map<number, VidaRupturaProduto>> }>();

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function consultarVida(dataPosicao: string): Promise<Map<number, VidaRupturaProduto>> {
  const rows = await prisma.$queryRaw<Array<{ product_code: number; ultima_venda: Date; qtd: Prisma.Decimal | number; ultima_entrada: Date }>>`
    WITH venda AS (
      SELECT ti.product_code, MAX(t.transaction_date) AS ultima_venda, SUM(ti.quantity) AS qtd
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
      LEFT JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
      WHERE t.status = 4 AND co.operations_type = 'S' AND co.operation_mode = '4'
        AND t.transaction_date > ${dataPosicao}::date - INTERVAL '12 months'
        AND t.transaction_date < ${dataPosicao}::date + INTERVAL '1 day'
      GROUP BY ti.product_code
    ),
    entrada AS (
      SELECT ti.product_code, MAX(t.transaction_date) AS ultima_entrada
      FROM transacoes t
      JOIN transacao_itens ti ON t.branch_code = ti.branch_code AND t.transaction_code = ti.transaction_code
      LEFT JOIN classificacao_operacoes co ON co.operation_code = t.operation_code
      WHERE t.status = 4 AND co.operations_type = 'E'
        AND t.transaction_date < ${dataPosicao}::date + INTERVAL '1 day'
        AND ti.product_code IN (SELECT product_code FROM venda)
      GROUP BY ti.product_code
    )
    SELECT v.product_code, v.ultima_venda, v.qtd, e.ultima_entrada
    FROM venda v
    JOIN entrada e ON e.product_code = v.product_code
  `;
  const mapa = new Map<number, VidaRupturaProduto>();
  for (const r of rows) {
    mapa.set(Number(r.product_code), {
      ultimaVenda: isoDate(r.ultima_venda),
      venda12m: Number(r.qtd),
      ultimaEntrada: isoDate(r.ultima_entrada),
    });
  }
  return mapa;
}

// So depende da data (nao dos filtros), entao um cache por data atende todas as
// combinacoes de filtro da tela. Falha nao fica em cache.
export function getVidaRuptura(dataPosicao: string): Promise<Map<number, VidaRupturaProduto>> {
  const atual = cache.get(dataPosicao);
  if (atual && Date.now() - atual.em < CACHE_MS) return atual.valor;
  const valor = consultarVida(dataPosicao);
  cache.set(dataPosicao, { em: Date.now(), valor });
  valor.catch(() => cache.delete(dataPosicao));
  return valor;
}

// Registro tecnico do ETL (SKU ainda desconhecido na carga): divide o product_code
// com o SKU definitivo e nao e um item de verdade - 520 deles entravam como ruptura.
export function skuTecnicoEtl(productSku: string): boolean {
  return productSku.startsWith('PRODUCT_CODE:');
}

export function skuElegivelRuptura(
  productSku: string, productCode: number | null, vida: Map<number, VidaRupturaProduto> | null
): boolean {
  if (skuTecnicoEtl(productSku)) return false;
  if (!vida) return true;
  return productCode !== null && vida.has(productCode);
}

// ---- Relacao dos itens (botao do card): por referencia, abrindo por SKU ----

export interface RupturaItemSku {
  productSku: string;
  cor: string;
  tamanho: string;
  estoque: number;
  emRuptura: boolean;
  ultimaVenda: string | null;
  venda12m: number;
  ultimaEntrada: string | null;
}

export interface RupturaItemReferencia {
  referencia: string;
  nome: string;
  linha: string;
  // Um product_code da referencia, pra abrir as fotos (rota /produtos/:code/imagens).
  productCode: number | null;
  skusBase: number;
  skusRuptura: number;
  percent: number;
  venda12m: number;
  ultimaVenda: string | null;
  // Todos os SKUs da referencia que estao na base (em ruptura primeiro), pra ver
  // na mesma tela o que falta e o que ainda tem.
  skus: RupturaItemSku[];
}

export interface RupturaItensResponse {
  dataPosicao: string;
  referencias: RupturaItemReferencia[];
  totalSkusBase: number;
  totalSkusRuptura: number;
}

export class ColetorItensRuptura {
  private refs = new Map<string, Omit<RupturaItemReferencia, 'percent' | 'skusBase' | 'skusRuptura' | 'venda12m' | 'ultimaVenda'>>();

  constructor(private vida: Map<number, VidaRupturaProduto> | null) {}

  adicionar(item: {
    productSku: string; productCode: number | null; referencia: string; nome: string;
    linha: string | null; cor: string; tamanho: string; estoque: number;
  }) {
    const ref = this.refs.get(item.referencia) || {
      referencia: item.referencia, nome: item.nome, linha: item.linha || '-', productCode: null, skus: [],
    };
    if (ref.productCode === null && item.productCode !== null && item.productCode > 0) ref.productCode = item.productCode;
    const vida = item.productCode !== null ? this.vida?.get(item.productCode) : undefined;
    ref.skus.push({
      productSku: item.productSku, cor: item.cor, tamanho: item.tamanho,
      estoque: Math.round(item.estoque), emRuptura: item.estoque <= 0,
      ultimaVenda: vida?.ultimaVenda ?? null, venda12m: vida?.venda12m ?? 0,
      ultimaEntrada: vida?.ultimaEntrada ?? null,
    });
    this.refs.set(item.referencia, ref);
  }

  montar(dataPosicao: string): RupturaItensResponse {
    const referencias: RupturaItemReferencia[] = [];
    let totalSkusBase = 0;
    let totalSkusRuptura = 0;
    for (const ref of this.refs.values()) {
      const skusRuptura = ref.skus.filter((s) => s.emRuptura).length;
      totalSkusBase += ref.skus.length;
      totalSkusRuptura += skusRuptura;
      if (skusRuptura === 0) continue;
      ref.skus.sort((a, b) => Number(b.emRuptura) - Number(a.emRuptura)
        || a.cor.localeCompare(b.cor) || a.tamanho.localeCompare(b.tamanho, 'pt-BR', { numeric: true }));
      const datas = ref.skus.map((s) => s.ultimaVenda).filter((d): d is string => !!d).sort();
      referencias.push({
        ...ref,
        skusBase: ref.skus.length,
        skusRuptura,
        percent: Math.round((skusRuptura / ref.skus.length) * 1000) / 10,
        venda12m: ref.skus.reduce((soma, s) => soma + s.venda12m, 0),
        ultimaVenda: datas.length ? datas[datas.length - 1] : null,
      });
    }
    referencias.sort((a, b) => b.skusRuptura - a.skusRuptura || b.venda12m - a.venda12m);
    return { dataPosicao, referencias, totalSkusBase, totalSkusRuptura };
  }
}
