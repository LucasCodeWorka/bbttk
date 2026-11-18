export interface ReferenciaAgrupamento {
  referenceCode: string;
  descricao: string;
  statusOriginais: string[];
  estTt: number;
}

// Consolida apenas a apresentação; a classificação original continua nos detalhes
// e nas regras de elegibilidade dos indicadores.
export function agruparStatus(status: string | null): string | null {
  const original = status?.trim() || null;
  const normalizado = original?.replace(/\s+/g, ' ').toUpperCase();
  return normalizado === 'FORA DE LINHA' || normalizado?.startsWith('FORA DE LINHA ')
    ? 'FORA DE LINHA' : original;
}

export function ordenarPorEstoque<T extends { estTt: number; referenceCode: string }>(a: T, b: T): number {
  return b.estTt - a.estTt || a.referenceCode.localeCompare(b.referenceCode, 'pt-BR');
}

export class ReferenciasMatriz {
  private grupos = new Map<string, Map<string, ReferenciaAgrupamento>>();

  acumular(dimensao: string, label: string | null, referenceCode: string, descricao: string,
    status: string | null, estTt: number): void {
    const chave = JSON.stringify([dimensao, label?.trim() || 'Nao classificado']);
    const grupo = this.grupos.get(chave) || new Map<string, ReferenciaAgrupamento>();
    const ref = grupo.get(referenceCode) || { referenceCode, descricao, statusOriginais: [], estTt: 0 };
    const original = status?.trim() || 'Sem classificação';
    if (!ref.statusOriginais.includes(original)) ref.statusOriginais.push(original);
    ref.estTt += estTt;
    grupo.set(referenceCode, ref);
    this.grupos.set(chave, grupo);
  }

  consultar(dimensao: string, label: string): ReferenciaAgrupamento[] {
    const grupo = this.grupos.get(JSON.stringify([dimensao, label]));
    return [...(grupo?.values() || [])].map(ref => ({
      ...ref, estTt: Math.round(ref.estTt), statusOriginais: [...ref.statusOriginais].sort(),
    })).sort(ordenarPorEstoque);
  }
}
