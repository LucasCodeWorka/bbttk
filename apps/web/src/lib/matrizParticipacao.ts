// Participacao de um item da matriz de cobertura (Relatorio Base / Visao Geral) sobre o
// total da propria coluna, em %. null quando o total e zero ou o valor nao existe -
// a tela mostra "—". A linha TOTAL nao chama isso (devolutiva secao 7: nao exibir 100%).
export function participacaoMatriz(valor: number | null | undefined, total: number | null | undefined): number | null {
  if (valor == null || total == null || total === 0) return null;
  return (valor / total) * 100;
}
