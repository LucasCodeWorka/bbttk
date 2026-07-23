import * as vendasService from './vendas.service.js';
import * as metasService from './metas.service.js';
import { FILIAIS } from '../config/constants.js';

const ATACADO_BRANCH_CODES = [2];

function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Descobre o maior nivel (1-5) cujo alvo foi atingido pelo faturamento.
// Niveis sem alvo definido (0/nao configurado) sao ignorados, nao "zeram" um nivel ja atingido.
function nivelAtingido(faturamento: number, alvos: { nivel_1: number; nivel_2: number; nivel_3: number; nivel_4: number; nivel_5: number }): number {
  let atingido = 0;
  for (let n = 1; n <= 5; n++) {
    const alvo = alvos[`nivel_${n}` as keyof typeof alvos];
    if (alvo > 0 && faturamento >= alvo) atingido = n;
  }
  return atingido;
}

export interface ComissaoCelula {
  branch_code: number;
  branch_name: string;
  faturamento: number;
  nivel_1: number;
  nivel_2: number;
  nivel_3: number;
  nivel_4: number;
  nivel_5: number;
  nivel_atingido: number;
  resultado_pct: number;
  comissao_pct: number;
  comissao_valor: number;
}

export interface VendedorComissao {
  seller_code: number;
  seller_name?: string;
  filiais: number[];
  faturamento: number;
  nivel_1: number;
  nivel_2: number;
  nivel_3: number;
  nivel_4: number;
  nivel_5: number;
  nivel_atingido: number;
  resultado_pct: number;
  comissao_pct: number;
  comissao_valor: number;
  celulas: ComissaoCelula[];
}

export async function getRelatorioComissao(ano: number, mes: number, branchCodes?: number[]) {
  const startDate = new Date(ano, mes - 1, 1);
  const endDate = new Date(ano, mes, 0);

  const todasFiliais = Object.keys(FILIAIS).map(Number);
  const filiaisEscopo = branchCodes && branchCodes.length > 0 ? branchCodes : todasFiliais;
  const filiaisVarejo = filiaisEscopo.filter((c) => !ATACADO_BRANCH_CODES.includes(c));
  const filiaisAtacado = filiaisEscopo.filter((c) => ATACADO_BRANCH_CODES.includes(c));

  const [vendasPorFilial, metasDoMes, niveis, metasPorFilial] = await Promise.all([
    vendasService.getVendasVendedorPorFilial(startDate, endDate, branchCodes),
    metasService.getMetas(ano, mes),
    metasService.getMetaNiveis(),
    vendasService.getMetasPorFilial(ano, mes),
  ]);

  // Meta de cada vendedor, por filial (um vendedor pode ter meta - e comissao - diferente
  // em cada filial onde vende no mesmo mes, por isso a chave e composta).
  const metaPorVendedorFilial = new Map<string, {
    nivel_1: number; nivel_2: number; nivel_3: number; nivel_4: number; nivel_5: number;
    comissao_nivel_1: number | null; comissao_nivel_2: number | null; comissao_nivel_3: number | null;
    comissao_nivel_4: number | null; comissao_nivel_5: number | null;
  }>();
  for (const m of metasDoMes) {
    if (m.seller_code === null) continue;
    if (!filiaisEscopo.includes(m.branch_code)) continue;
    metaPorVendedorFilial.set(`${m.seller_code}-${m.branch_code}`, {
      nivel_1: m.nivel_1, nivel_2: m.nivel_2, nivel_3: m.nivel_3, nivel_4: m.nivel_4, nivel_5: m.nivel_5,
      comissao_nivel_1: m.comissao_nivel_1, comissao_nivel_2: m.comissao_nivel_2, comissao_nivel_3: m.comissao_nivel_3,
      comissao_nivel_4: m.comissao_nivel_4, comissao_nivel_5: m.comissao_nivel_5,
    });
  }

  const comissaoPorNivelGlobal = new Map(niveis.map((n) => [n.nivel_ordem, n.comissao_percentual]));

  function comissaoDoNivel(atingido: number, meta: ReturnType<typeof metaPorVendedorFilial.get>): number {
    if (atingido === 0) return 0;
    const especifica = meta ? (meta[`comissao_nivel_${atingido}` as keyof typeof meta] as number | null) : null;
    if (especifica !== null && especifica !== undefined) return especifica;
    return comissaoPorNivelGlobal.get(atingido) ?? 0;
  }

  // Agrupa as celulas (seller_code, branch_code) por vendedor pra formar a matriz.
  const porVendedor = new Map<number, ComissaoCelula[]>();
  for (const v of vendasPorFilial) {
    const alvos = metaPorVendedorFilial.get(`${v.seller_code}-${v.branch_code}`) || {
      nivel_1: 0, nivel_2: 0, nivel_3: 0, nivel_4: 0, nivel_5: 0,
      comissao_nivel_1: null, comissao_nivel_2: null, comissao_nivel_3: null, comissao_nivel_4: null, comissao_nivel_5: null,
    };
    const atingido = nivelAtingido(v.faturamento, alvos);
    const comissaoPct = comissaoDoNivel(atingido, alvos);

    const celula: ComissaoCelula = {
      branch_code: v.branch_code,
      branch_name: FILIAIS[v.branch_code] || `Filial ${v.branch_code}`,
      faturamento: v.faturamento,
      nivel_1: alvos.nivel_1,
      nivel_2: alvos.nivel_2,
      nivel_3: alvos.nivel_3,
      nivel_4: alvos.nivel_4,
      nivel_5: alvos.nivel_5,
      nivel_atingido: atingido,
      resultado_pct: alvos.nivel_3 > 0 ? round((v.faturamento / alvos.nivel_3) * 100, 1) : 0,
      comissao_pct: comissaoPct,
      comissao_valor: round((v.faturamento * comissaoPct) / 100),
    };

    const atual = porVendedor.get(v.seller_code) || [];
    atual.push(celula);
    porVendedor.set(v.seller_code, atual);
  }

  const vendedores: VendedorComissao[] = Array.from(porVendedor.entries()).map(([seller_code, celulas]) => {
    const faturamento = round(celulas.reduce((sum, c) => sum + c.faturamento, 0));
    const comissao_valor = round(celulas.reduce((sum, c) => sum + c.comissao_valor, 0));
    const nivel_1 = celulas.reduce((sum, c) => sum + c.nivel_1, 0);
    const nivel_2 = celulas.reduce((sum, c) => sum + c.nivel_2, 0);
    const nivel_3 = celulas.reduce((sum, c) => sum + c.nivel_3, 0);
    const nivel_4 = celulas.reduce((sum, c) => sum + c.nivel_4, 0);
    const nivel_5 = celulas.reduce((sum, c) => sum + c.nivel_5, 0);
    const nivel_atingido = celulas.reduce((max, c) => Math.max(max, c.nivel_atingido), 0);

    return {
      seller_code,
      filiais: celulas.map((c) => c.branch_code),
      faturamento,
      nivel_1,
      nivel_2,
      nivel_3,
      nivel_4,
      nivel_5,
      nivel_atingido,
      resultado_pct: nivel_3 > 0 ? round((faturamento / nivel_3) * 100, 1) : 0,
      comissao_pct: faturamento > 0 ? round((comissao_valor / faturamento) * 100, 1) : 0,
      comissao_valor,
      celulas: celulas.sort((a, b) => b.faturamento - a.faturamento),
    };
  });

  // Resumo geral (Realizado vs Meta): meta = soma das metas de loja (seller_code nulo) do escopo
  const metaTotal = filiaisEscopo.reduce((sum, code) => sum + (metasPorFilial.get(code) || 0), 0);
  const realizadoTotal = vendedores.reduce((sum, v) => sum + v.faturamento, 0);

  // Canal: Varejo (todas as filiais exceto Fabrica) vs Atacado (Fabrica)
  const [vendasVarejo, vendasAtacado] = await Promise.all([
    filiaisVarejo.length > 0 ? vendasService.getVendasPeriodo(startDate, endDate, filiaisVarejo) : Promise.resolve([]),
    filiaisAtacado.length > 0 ? vendasService.getVendasPeriodo(startDate, endDate, filiaisAtacado) : Promise.resolve([]),
  ]);

  function resumoCanal(nome: string, codigo: string, vendasCanal: { faturamento: number }[], filiaisCanal: number[]) {
    const faturamento = round(vendasCanal.reduce((sum, f) => sum + f.faturamento, 0));
    const meta = round(filiaisCanal.reduce((sum, code) => sum + (metasPorFilial.get(code) || 0), 0));
    return {
      canal: codigo,
      nome,
      faturamento,
      meta,
      pct_meta: meta > 0 ? round((faturamento / meta) * 100, 1) : 0,
    };
  }

  const canal = [
    resumoCanal('Varejo', 'VAR', vendasVarejo, filiaisVarejo),
    resumoCanal('Atacado', 'ATA', vendasAtacado, filiaisAtacado),
  ];

  vendedores.sort((a, b) => b.faturamento - a.faturamento);

  return {
    periodo: { ano, mes },
    resumo: {
      realizado: round(realizadoTotal),
      meta: round(metaTotal),
      resultado_pct: metaTotal > 0 ? round((realizadoTotal / metaTotal) * 100, 1) : 0,
    },
    canal,
    niveis,
    vendedores,
    top3: vendedores.slice(0, 3),
  };
}
