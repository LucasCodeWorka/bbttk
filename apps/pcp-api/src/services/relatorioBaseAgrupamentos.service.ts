export interface ReferenciaAgrupamento {
  referenceCode: string;
  descricao: string;
  statusOriginais: string[];
  estTt: number;
  estoqueVarejo: number;
  estoqueAtacado: number;
  estoqueTotal: number;
  valorEstoque: number;
  vendaVarejo: number;
  vendaAtacado: number;
  vendaTotal: number;
  coberturaVarejo: number | null;
  coberturaAtacado: number | null;
  coberturaGeral: number | null;
}

interface ValoresAgrupamento {
  estVarejo: number;
  estAtacado: number;
  valorEstoque: number;
  vendaVarejo: number;
  vendaAtacado: number;
}

type ReferenciaAcumulada = Pick<ReferenciaAgrupamento, 'referenceCode' | 'descricao' | 'statusOriginais'> & ValoresAgrupamento;

// Consolida apenas a apresentação; a classificação original continua nos detalhes
// e nas regras de elegibilidade dos indicadores.
export function agruparStatus(status: string | null): string | null {
  const original = status?.trim() || null;
  const normalizado = original?.replace(/\s+/g, ' ').toUpperCase();
  // "FORA DE LINHA" puro (preco cheio) fica separado dos "FORA DE LINHA <campanha>"
  // (Black, Promo, Liqui...), que sao os itens com desconto e viram um grupo so.
  if (normalizado === 'FORA DE LINHA') return 'FORA DE LINHA';
  return normalizado?.startsWith('FORA DE LINHA ') ? 'FORA DE LINHA PROMO' : original;
}

export function ordenarPorEstoque<T extends { estTt: number; referenceCode: string }>(a: T, b: T): number {
  return b.estTt - a.estTt || a.referenceCode.localeCompare(b.referenceCode, 'pt-BR');
}

export class ReferenciasMatriz {
  private grupos = new Map<string, Map<string, ReferenciaAcumulada>>();

  acumular(dimensao: string, label: string | null, referenceCode: string, descricao: string,
    status: string | null, valores: ValoresAgrupamento): void {
    const chave = JSON.stringify([dimensao, label?.trim() || 'Nao classificado']);
    const grupo = this.grupos.get(chave) || new Map<string, ReferenciaAcumulada>();
    const ref = grupo.get(referenceCode) || {
      referenceCode, descricao, statusOriginais: [], estVarejo: 0, estAtacado: 0,
      valorEstoque: 0, vendaVarejo: 0, vendaAtacado: 0,
    };
    const original = status?.trim() || 'Sem classificação';
    if (!ref.statusOriginais.includes(original)) ref.statusOriginais.push(original);
    ref.estVarejo += valores.estVarejo;
    ref.estAtacado += valores.estAtacado;
    ref.valorEstoque += valores.valorEstoque;
    ref.vendaVarejo += valores.vendaVarejo;
    ref.vendaAtacado += valores.vendaAtacado;
    grupo.set(referenceCode, ref);
    this.grupos.set(chave, grupo);
  }

  consultar(dimensao: string, label: string): ReferenciaAgrupamento[] {
    const grupo = this.grupos.get(JSON.stringify([dimensao, label]));
    const round = (valor: number) => Math.round(valor * 100) / 100;
    const cobertura = (estoque: number, venda: number) => venda > 0 ? round(estoque / venda) : null;
    return [...(grupo?.values() || [])].map(ref => ({
      referenceCode: ref.referenceCode, descricao: ref.descricao,
      statusOriginais: [...ref.statusOriginais].sort(),
      estTt: Math.round(ref.estVarejo + ref.estAtacado),
      estoqueVarejo: Math.round(ref.estVarejo), estoqueAtacado: Math.round(ref.estAtacado),
      estoqueTotal: Math.round(ref.estVarejo + ref.estAtacado), valorEstoque: round(ref.valorEstoque),
      vendaVarejo: Math.round(ref.vendaVarejo), vendaAtacado: Math.round(ref.vendaAtacado),
      vendaTotal: Math.round(ref.vendaVarejo + ref.vendaAtacado),
      coberturaVarejo: cobertura(ref.estVarejo, ref.vendaVarejo),
      coberturaAtacado: cobertura(ref.estAtacado, ref.vendaAtacado),
      coberturaGeral: cobertura(ref.estVarejo + ref.estAtacado, ref.vendaVarejo + ref.vendaAtacado),
    })).sort(ordenarPorEstoque);
  }
}
