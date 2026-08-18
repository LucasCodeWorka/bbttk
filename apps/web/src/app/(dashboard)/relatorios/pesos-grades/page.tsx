'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  pesosGradesApi,
  relatorioBaseApi,
  PesosGradesResponse,
  PesosGradesReferenciaOpcao,
  TipoAnalisePesosGrades,
  PcpClassificacaoDimensao,
} from '@/lib/pcpApi';
import { cn, formatNumber } from '@/lib/utils';
import { exportMultiSheetExcel, ExcelColumn } from '@/lib/exportExcel';

function inicioMesAtual(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

function hoje(): string {
  return new Date().toISOString().split('T')[0];
}

export default function PesosGradesPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [data, setData] = useState<PesosGradesResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [tipoAnalise, setTipoAnalise] = useState<TipoAnalisePesosGrades>('item');
  const [dataInicio, setDataInicio] = useState(inicioMesAtual);
  const [dataFim, setDataFim] = useState(hoje);
  const [fatorDivisorStr, setFatorDivisorStr] = useState('100');

  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState<string[]>([]);

  const [referenciasSelecionadas, setReferenciasSelecionadas] = useState<PesosGradesReferenciaOpcao[]>([]);
  const [mostrarModalReferencias, setMostrarModalReferencias] = useState(false);

  useEffect(() => {
    if (!token) return;
    relatorioBaseApi
      .getFiltrosRelatorioBase(token)
      .then((res) => setClassificacoes(res.classificacoes))
      .catch((error) => console.error('Erro ao carregar classificações:', error));
  }, [token]);

  const categoriasDisponiveis = useMemo(() => classificacoes.find((d) => d.chave === 'categoria')?.opcoes || [], [classificacoes]);

  function removerReferencia(referenceCode: string) {
    setReferenciasSelecionadas((prev) => prev.filter((r) => r.referenceCode !== referenceCode));
  }

  function adicionarReferencias(refs: PesosGradesReferenciaOpcao[]) {
    setReferenciasSelecionadas((prev) => {
      const existentes = new Set(prev.map((r) => r.referenceCode));
      return [...prev, ...refs.filter((r) => !existentes.has(r.referenceCode))];
    });
  }

  const carregarDados = useCallback(async () => {
    if (!token) return;

    const fatorDivisor = parseFloat(fatorDivisorStr.replace(',', '.'));
    if (!Number.isFinite(fatorDivisor) || fatorDivisor <= 0) {
      showToast('Informe um fator divisor válido (maior que zero)', 'error');
      return;
    }
    if (tipoAnalise === 'item' && referenciasSelecionadas.length === 0) {
      showToast('Selecione ao menos uma referência', 'error');
      return;
    }
    if (tipoAnalise === 'categoria' && categoriasSelecionadas.length === 0) {
      showToast('Selecione ao menos uma categoria', 'error');
      return;
    }

    setIsLoading(true);
    setErro(null);
    try {
      const response = await pesosGradesApi.getPesosGrades(token, {
        tipoAnalise,
        referencias: tipoAnalise === 'item' ? referenciasSelecionadas.map((r) => r.referenceCode) : undefined,
        categorias: tipoAnalise === 'categoria' ? categoriasSelecionadas : undefined,
        dataInicio,
        dataFim,
        fatorDivisor,
      });
      setData(response);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Erro desconhecido';
      setErro(mensagem);
      showToast(mensagem, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token, tipoAnalise, referenciasSelecionadas, categoriasSelecionadas, dataInicio, dataFim, fatorDivisorStr, showToast]);

  function handleExportExcel() {
    if (!data || data.referencias.length === 0) return;
    setExportando(true);
    try {
      const sheets = data.referencias.map((ref) => {
        const columns: ExcelColumn[] = [
          { key: 'linha', header: '', width: 18, type: 'text' },
          ...ref.tamanhos.map((t) => ({ key: t.tamanho, header: t.tamanho, width: 8, type: 'number' as const })),
        ];
        const linhaQtd: Record<string, unknown> = { linha: 'Qtde Vendida' };
        const linhaFreq: Record<string, unknown> = { linha: 'Frequência/Grade' };
        for (const t of ref.tamanhos) {
          linhaQtd[t.tamanho] = t.quantidadeVendida;
          linhaFreq[t.tamanho] = t.frequencia;
        }
        return {
          sheetName: ref.referenceCode.slice(0, 28),
          title: `${ref.referenceCode} - ${ref.descricao}`,
          columns,
          data: [linhaQtd, linhaFreq],
        };
      });
      exportMultiSheetExcel(`Pesos_Grades_${dataInicio}_${dataFim}`, sheets);
      showToast('Excel exportado com sucesso', 'success');
    } catch (error) {
      showToast('Erro ao exportar Excel', 'error');
      console.error(error);
    } finally {
      setExportando(false);
    }
  }

  const totalReferenciasComVenda = useMemo(() => data?.referencias.filter((r) => r.tamanhos.length > 0).length || 0, [data]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Pesos e Grades para Produção</h1>
        <p className="text-sm text-gray-500 mt-1">
          Calcula a frequência de corte por tamanho de cada referência a partir da venda real (atacado + varejo) do período
        </p>
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm text-gray-700">
          <strong>Como funciona:</strong> soma a venda geral (atacado + varejo) do período selecionado, por referência e
          tamanho, e divide pelo fator divisor informado, arredondando sempre para cima:{' '}
          <code className="bg-white px-1 rounded">frequência = CEIL(quantidade vendida do tamanho / fator divisor)</code>.
        </p>
      </Card>

      <Card>
        <div className="flex gap-2 mb-4 border border-gray-200 rounded-lg overflow-hidden w-fit">
          <button
            onClick={() => setTipoAnalise('item')}
            className={cn('px-4 py-2 text-sm font-medium transition-colors', tipoAnalise === 'item' ? 'bg-[var(--bbtk-purple)] text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
          >
            Por Item
          </button>
          <button
            onClick={() => setTipoAnalise('categoria')}
            className={cn('px-4 py-2 text-sm font-medium transition-colors border-l border-gray-200', tipoAnalise === 'categoria' ? 'bg-[var(--bbtk-purple)] text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}
          >
            Por Categoria
          </button>
        </div>

        {tipoAnalise === 'item' ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Referências selecionadas ({referenciasSelecionadas.length})</label>
              <Button variant="secondary" size="sm" onClick={() => setMostrarModalReferencias(true)}>
                Buscar Referências
              </Button>
            </div>

            {referenciasSelecionadas.length > 0 ? (
              <div className="border border-gray-200 rounded-lg bg-gray-50 max-h-52 overflow-y-auto">
                {referenciasSelecionadas.map((ref) => (
                  <div key={ref.referenceCode} className="flex items-center justify-between px-3 py-2 border-b border-gray-200 last:border-b-0 hover:bg-gray-100">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{ref.referenceCode}</div>
                      <div className="text-xs text-gray-600">{ref.referenceName}</div>
                    </div>
                    <button type="button" onClick={() => removerReferencia(ref.referenceCode)} className="ml-2 text-gray-400 hover:text-red-600">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">Nenhuma referência selecionada ainda - clique em &quot;Buscar Referências&quot; e filtre por categoria/linha/gênero em vez de digitar uma por uma.</p>
            )}
          </div>
        ) : (
          <div className="mb-4">
            <ClassificacaoMultiSelect
              label="Categorias"
              options={categoriasDisponiveis.map((c) => ({ value: c.valor, label: c.valor, meta: formatNumber(c.qtd_skus) }))}
              selected={categoriasSelecionadas}
              onChange={setCategoriasSelecionadas}
              className="w-72"
            />
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <Input label="Data início" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-40" />
          <Input label="Data fim" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-40" />
          <Input
            label="Fator divisor"
            type="number"
            step="1"
            min="1"
            value={fatorDivisorStr}
            onChange={(e) => setFatorDivisorStr(e.target.value)}
            className="w-36"
          />
          <Button onClick={carregarDados} isLoading={isLoading}>
            Gerar Relatório
          </Button>
          <Button variant="secondary" onClick={handleExportExcel} isLoading={exportando} disabled={!data || data.referencias.length === 0}>
            Exportar Excel
          </Button>
        </div>
      </Card>

      {erro && <div className="text-red-600 text-sm">Erro: {erro}</div>}

      {data && (
        <p className="text-xs text-gray-500">
          {totalReferenciasComVenda} de {data.referencias.length} referência(s) com venda no período · fator divisor {data.fatorDivisor}
        </p>
      )}

      <div className="space-y-4">
        {data?.referencias.filter((ref) => ref.tamanhos.length > 0).map((ref) => (
          <Card key={ref.referenceCode}>
            <CardHeader>
              <CardTitle>
                REF. <span className="text-[var(--bbtk-purple)]">{ref.referenceCode}</span> — {ref.descricao}
              </CardTitle>
            </CardHeader>

            <div className="overflow-x-auto">
                <table className="text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left px-3 py-1.5 text-gray-500 font-medium"></th>
                      {ref.tamanhos.map((t) => (
                        <th key={t.tamanho} className="text-center px-3 py-1.5 text-gray-500 font-medium min-w-[56px]">
                          {t.tamanho}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">Qtde Vendida</td>
                      {ref.tamanhos.map((t) => (
                        <td key={t.tamanho} className="text-center px-3 py-1.5 text-gray-500">
                          {formatNumber(t.quantidadeVendida)}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-purple-50">
                      <td className="px-3 py-1.5 font-semibold whitespace-nowrap">Frequência / Grade</td>
                      {ref.tamanhos.map((t) => (
                        <td key={t.tamanho} className="text-center px-3 py-1.5 font-semibold text-[var(--bbtk-purple)]">
                          {t.frequencia}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
          </Card>
        ))}

        {data && totalReferenciasComVenda === 0 && (
          <Card>
            <p className="text-sm text-gray-500 text-center py-6">Nenhuma referência com venda no período selecionado.</p>
          </Card>
        )}
      </div>

      <ModalBuscarReferencias
        isOpen={mostrarModalReferencias}
        onClose={() => setMostrarModalReferencias(false)}
        classificacoes={classificacoes}
        jaSelecionadas={referenciasSelecionadas}
        onAdicionar={adicionarReferencias}
      />
    </div>
  );
}

function ModalBuscarReferencias({
  isOpen,
  onClose,
  classificacoes,
  jaSelecionadas,
  onAdicionar,
}: {
  isOpen: boolean;
  onClose: () => void;
  classificacoes: PcpClassificacaoDimensao[];
  jaSelecionadas: PesosGradesReferenciaOpcao[];
  onAdicionar: (refs: PesosGradesReferenciaOpcao[]) => void;
}) {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [categoria, setCategoria] = useState<string[]>([]);
  const [linha, setLinha] = useState<string[]>([]);
  const [genero, setGenero] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);

  const [resultados, setResultados] = useState<PesosGradesReferenciaOpcao[]>([]);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [buscando, setBuscando] = useState(false);
  const [jaBuscou, setJaBuscou] = useState(false);

  const opcoesPor = (chave: string) => classificacoes.find((d) => d.chave === chave)?.opcoes || [];

  // Zera a busca toda vez que o modal reabre, pra nao ficar "em cache" de sessao anterior.
  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setCategoria([]);
    setLinha([]);
    setGenero([]);
    setStatus([]);
    setResultados([]);
    setMarcadas(new Set());
    setJaBuscou(false);
  }, [isOpen]);

  async function handleBuscar() {
    if (!token) return;
    setBuscando(true);
    try {
      const res = await pesosGradesApi.buscarReferencias(token, { search: search || undefined, categoria, linha, genero, status, limit: 300 });
      setResultados(res.referencias);
      setMarcadas(new Set());
      setJaBuscou(true);
      if (res.referencias.length === 300) {
        showToast('Mostrando as 300 primeiras referências - refine o filtro se precisar de mais', 'info');
      }
    } catch (error) {
      showToast('Erro ao buscar referências', 'error');
      console.error(error);
    } finally {
      setBuscando(false);
    }
  }

  function toggleMarcada(referenceCode: string) {
    setMarcadas((prev) => {
      const next = new Set(prev);
      if (next.has(referenceCode)) next.delete(referenceCode);
      else next.add(referenceCode);
      return next;
    });
  }

  function toggleSelecionarTodas() {
    setMarcadas((prev) => (prev.size === resultados.length ? new Set() : new Set(resultados.map((r) => r.referenceCode))));
  }

  function handleAdicionar() {
    const escolhidas = resultados.filter((r) => marcadas.has(r.referenceCode));
    onAdicionar(escolhidas);
    onClose();
  }

  const jaSelecionadasSet = useMemo(() => new Set(jaSelecionadas.map((r) => r.referenceCode)), [jaSelecionadas]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Buscar Referências" size="2xl">
      <div className="space-y-4">
        <div className="flex items-end gap-3">
          <Input label="Buscar (código ou nome)" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
          <Button onClick={handleBuscar} isLoading={buscando}>
            Buscar
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <ClassificacaoMultiSelect label="Categoria" options={opcoesPor('categoria').map((o) => ({ value: o.valor, label: o.valor, meta: String(o.qtd_skus) }))} selected={categoria} onChange={setCategoria} className="w-56" />
          <ClassificacaoMultiSelect label="Linha" options={opcoesPor('linha').map((o) => ({ value: o.valor, label: o.valor, meta: String(o.qtd_skus) }))} selected={linha} onChange={setLinha} className="w-56" />
          <ClassificacaoMultiSelect label="Gênero" options={opcoesPor('genero').map((o) => ({ value: o.valor, label: o.valor, meta: String(o.qtd_skus) }))} selected={genero} onChange={setGenero} className="w-48" />
          <ClassificacaoMultiSelect label="Status" options={opcoesPor('status').map((o) => ({ value: o.valor, label: o.valor, meta: String(o.qtd_skus) }))} selected={status} onChange={setStatus} className="w-48" />
        </div>

        {jaBuscou && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{resultados.length} referência(s) encontrada(s)</span>
              {resultados.length > 0 && (
                <button type="button" onClick={toggleSelecionarTodas} className="text-xs text-[var(--bbtk-purple)] hover:underline font-medium">
                  {marcadas.size === resultados.length ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
              {resultados.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">Nenhuma referência encontrada para esse filtro.</p>
              ) : (
                resultados.map((ref) => {
                  const jaEstava = jaSelecionadasSet.has(ref.referenceCode);
                  return (
                    <label
                      key={ref.referenceCode}
                      className={cn('flex items-center gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50', jaEstava && 'opacity-50')}
                    >
                      <input
                        type="checkbox"
                        checked={marcadas.has(ref.referenceCode) || jaEstava}
                        disabled={jaEstava}
                        onChange={() => toggleMarcada(ref.referenceCode)}
                        className="w-4 h-4 text-[var(--bbtk-red)] rounded"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {ref.referenceCode} {jaEstava && <span className="text-xs text-gray-400">(já selecionada)</span>}
                        </div>
                        <div className="text-xs text-gray-600">
                          {ref.referenceName}
                          {ref.categoria && ` · ${ref.categoria}`}
                          {ref.genero && ` · ${ref.genero}`}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleAdicionar} disabled={marcadas.size === 0}>
            Adicionar {marcadas.size > 0 ? `(${marcadas.size})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
