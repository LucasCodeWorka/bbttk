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

export interface VendedorComissao {
  seller_code: number;
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

export async function getRelatorioComissao(ano: number, mes: number, branchCodes?: number[]) {
  const startDate = new Date(ano, mes - 1, 1);
  const endDate = new Date(ano, mes, 0);

  const todasFiliais = Object.keys(FILIAIS).map(Number);
  const filiaisEscopo = branchCodes && branchCodes.length > 0 ? branchCodes : todasFiliais;
  const filiaisVarejo = filiaisEscopo.filter((c) => !ATACADO_BRANCH_CODES.includes(c));
  const filiaisAtacado = filiaisEscopo.filter((c) => ATACADO_BRANCH_CODES.includes(c));

  const [vendas, metasDoMes, niveis, metasPorFilial] = await Promise.all([
    vendasService.getVendasVendedor(startDate, endDate, branchCodes),
    metasService.getMetas(ano, mes),
    metasService.getMetaNiveis(),
    vendasService.getMetasPorFilial(ano, mes),
  ]);

  // Soma as metas de vendedor (seller_code != null) dentro do escopo de filiais, por vendedor
  // (um vendedor pode ter meta em mais de uma filial no mesmo mes).
  const metaPorVendedor = new Map<number, { nivel_1: number; nivel_2: number; nivel_3: number; nivel_4: number; nivel_5: number }>();
  for (const m of metasDoMes) {
    if (m.seller_code === null) continue;
    if (!filiaisEscopo.includes(m.branch_code)) continue;

    const atual = metaPorVendedor.get(m.seller_code) || { nivel_1: 0, nivel_2: 0, nivel_3: 0, nivel_4: 0, nivel_5: 0 };
    atual.nivel_1 += m.nivel_1;
    atual.nivel_2 += m.nivel_2;
    atual.nivel_3 += m.nivel_3;
    atual.nivel_4 += m.nivel_4;
    atual.nivel_5 += m.nivel_5;
    metaPorVendedor.set(m.seller_code, atual);
  }

  const comissaoPorNivel = new Map(niveis.map((n) => [n.nivel_ordem, n.comissao_percentual]));

  const vendedores: VendedorComissao[] = vendas.map((v) => {
    const alvos = metaPorVendedor.get(v.seller_code) || { nivel_1: 0, nivel_2: 0, nivel_3: 0, nivel_4: 0, nivel_5: 0 };
    const atingido = nivelAtingido(v.faturamento, alvos);
    const comissaoPct = atingido > 0 ? (comissaoPorNivel.get(atingido) ?? 0) : 0;

    return {
      seller_code: v.seller_code,
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
