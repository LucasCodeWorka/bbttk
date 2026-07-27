'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { curvaAbcApi, relatorioBaseApi, CurvaAbcResumoResponse, ReferenciaAbc, CurvaLetra, CurvaAbcSkusResponse, PcpClassificacaoDimensao } from '@/lib/pcpApi';
import { pcpConfigApi, PcpCurvaAbcConfig } from '@/lib/api';
import { cn, formatMoney, formatNumber } from '@/lib/utils';

const CURVA_STYLE: Record<CurvaLetra, { border: string; bg: string; text: string; badge: string }> = {
  A: { border: 'border-l-green-500', bg: 'bg-green-50', text: 'text-green-700', badge: 'bg-green-100 text-green-700' },
  B: { border: 'border-l-gray-400', bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-200 text-gray-700' },
  C: { border: 'border-l-red-400', bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  D: { border: 'border-l-yellow-400', bg: 'bg-yellow-50', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-700' },
};

const SORT_OPTIONS = [
  { value: 'rankQtd', label: 'Rank Quantidade' },
  { value: 'rankValor', label: 'Rank Valor' },
  { value: 'mediaPorSku', label: 'Média / SKU' },
  { value: 'qtdVendida', label: 'Qtd Vendida' },
];

function TrendArrow({ tendencia }: { tendencia: 'up' | 'down' | 'flat' }) {
  if (tendencia === 'up') return <span className="text-green-600">▲</span>;
  if (tendencia === 'down') return <span className="text-red-600">▼</span>;
  return <span className="text-gray-400">–</span>;
}

function CurvaCard({ resumo }: { resumo: CurvaAbcResumoResponse['curvas'][number] }) {
  const style = CURVA_STYLE[resumo.curva];
  return (
    <Card className={cn('border-l-4', style.border, style.bg)}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={cn('font-bold', style.text)}>Curva {resumo.curva}</h3>
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', style.badge)}>{resumo.totalReferencias} refs</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Quantidade</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.quantidade)}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Valor (R$)</p>
          <p className="font-semibold text-gray-800">{formatMoney(resumo.valorReais)}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Total SKUs</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.totalSkus)}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Média mensal</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.mediaMensal)}</p>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2 pt-2 border-t">{resumo.percentDoTotal.toFixed(1)}% das referências analisadas</p>
    </Card>
  );
}

function UltimaRefCard({ resumo }: { resumo: CurvaAbcResumoResponse['curvas'][number] }) {
  const style = CURVA_STYLE[resumo.curva];
  const ref = resumo.ultimaReferencia;
  return (
    <Card className={cn('border-l-4', style.border)}>
      <p className="text-xs text-gray-400 uppercase tracking-wide">Última ref. Curva {resumo.curva}</p>
      {ref ? (
        <>
          <p className={cn('text-lg font-bold mt-1', style.text)}>{ref.referenceCode}</p>
          <p className="text-xs text-gray-500 truncate" title={ref.referenceName}>{ref.referenceName}</p>
          <p className="text-xs text-gray-400 mt-1">
            {formatNumber(ref.qtdVendida)} unidades · {ref.totalSkus} SKUs
          </p>
          <p className="text-xs text-gray-400">
            Rank Qtd #{ref.rankQtd} · Média/SKU {ref.mediaPorSku}
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-400 mt-2">Sem referências nessa curva</p>
      )}
    </Card>
  );
}

export default function PcpCurvaAbcPage() {
  const { token, user } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<CurvaAbcResumoResponse | null>(null);

  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});

  const [curvaSelecionada, setCurvaSelecionada] = useState<CurvaLetra | 'todas'>('todas');
  const [busca, setBusca] = useState('');
  const [ordenarPor, setOrdenarPor] = useState<'rankQtd' | 'rankValor' | 'mediaPorSku' | 'qtdVendida'>('rankQtd');

  const [configModalAberto, setConfigModalAberto] = useState(false);
  const [config, setConfig] = useState<PcpCurvaAbcConfig | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  const [skusModal, setSkusModal] = useState<{ referencia: string; nome: string } | null>(null);
  const [skusData, setSkusData] = useState<CurvaAbcSkusResponse | null>(null);
  const [skusLoading, setSkusLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    relatorioBaseApi
      .getFiltrosRelatorioBase(token)
      .then((res) => setClassificacoes(res.classificacoes))
      .catch((error) => console.error('Erro ao carregar filtros:', error));
  }, [token]);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await curvaAbcApi.getResumo(token, {
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
      });
      setData(response);
    } catch (error) {
      showToast('Erro ao carregar Curva ABC', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, produtoFiltro]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  function atualizarProdutoFiltro(chave: string, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  async function abrirConfig() {
    if (!token) return;
    try {
      const res = await pcpConfigApi.getCurvaAbcConfig(token);
      setConfig(res.config);
      setConfigModalAberto(true);
    } catch (error) {
      showToast('Erro ao carregar configuração', 'error');
      console.error(error);
    }
  }

  async function salvarConfig() {
    if (!token || !config) return;
    setSalvandoConfig(true);
    try {
      await pcpConfigApi.updateCurvaAbcConfig(token, config);
      showToast('Configuração salva!', 'success');
      setConfigModalAberto(false);
      carregarDados();
    } catch (error) {
      showToast('Erro ao salvar configuração', 'error');
      console.error(error);
    } finally {
      setSalvandoConfig(false);
    }
  }

  async function abrirSkus(ref: ReferenciaAbc) {
    if (!token) return;
    setSkusModal({ referencia: ref.referenceCode, nome: ref.referenceName });
    setSkusLoading(true);
    try {
      const res = await curvaAbcApi.getSkus(token, { referencia: ref.referenceCode, page: 1, pageSize: 200 });
      setSkusData(res);
    } catch (error) {
      showToast('Erro ao carregar SKUs da referência', 'error');
      console.error(error);
    } finally {
      setSkusLoading(false);
    }
  }

  const referenciasFiltradas = useMemo(() => {
    let lista = data?.referencias || [];
    if (curvaSelecionada !== 'todas') lista = lista.filter((r) => r.curva === curvaSelecionada);
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase();
      lista = lista.filter((r) => r.referenceCode.toLowerCase().includes(termo) || r.referenceName.toLowerCase().includes(termo));
    }
    return [...lista].sort((a, b) => {
      if (ordenarPor === 'mediaPorSku' || ordenarPor === 'qtdVendida') return b[ordenarPor] - a[ordenarPor];
      return a[ordenarPor] - b[ordenarPor];
    });
  }, [data, curvaSelecionada, busca, ordenarPor]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Curva ABCD</h1>
          <p className="text-gray-500 text-sm mt-1">
            Referências classificadas por quantidade vendida nos últimos {data?.config.giroDias ?? '—'} dias
          </p>
        </div>
        {user?.role === 'admin' && (
          <Button variant="secondary" size="sm" onClick={abrirConfig}>
            Editar regras de classificação
          </Button>
        )}
      </div>

      {data && (
        <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
          <p className="text-sm font-medium text-gray-800">Regras de classificação</p>
          <ul className="text-xs text-gray-600 mt-1 space-y-0.5">
            <li><strong>Curva A:</strong> referências com {formatNumber(data.config.metaCurvaAUnidades)} unidades ou mais no período.</li>
            <li><strong>Curva B:</strong> todas as referências restantes, exceto as separadas para Curva C e D.</li>
            <li><strong>Curva C:</strong> os {data.config.curvaCPercent}% de referências seguintes à cauda (Curva D), no ranking de quantidade.</li>
            <li><strong>Curva D:</strong> os {data.config.curvaDPercent}% de referências com menor quantidade vendida (cauda do ranking).</li>
          </ul>
          <p className="text-xs text-gray-400 mt-2">{data.totalAnalisadas} referências analisadas (com venda no período).</p>
        </Card>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Resumo por curva</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {isLoading || !data
            ? [1, 2, 3, 4].map((i) => <Card key={i} className="h-40 animate-pulse bg-gray-50"><span /></Card>)
            : data.curvas.map((c) => <CurvaCard key={c.curva} resumo={c} />)}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Última referência por curva</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {isLoading || !data
            ? [1, 2, 3, 4].map((i) => <Card key={i} className="h-24 animate-pulse bg-gray-50"><span /></Card>)
            : data.curvas.map((c) => <UltimaRefCard key={c.curva} resumo={c} />)}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {(['todas', 'A', 'B', 'C', 'D'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurvaSelecionada(c)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                curvaSelecionada === c ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
              )}
            >
              {c === 'todas' ? 'Todas' : c}
            </button>
          ))}
        </div>
        <Input label="Buscar referência" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-52" placeholder="Código ou nome" />
        <Select label="Ordenar" value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value as typeof ordenarPor)} options={SORT_OPTIONS} className="w-48" />
        {classificacoes
          .filter((d) => d.chave === 'linha' || d.chave === 'genero')
          .map((dim) => (
            <ClassificacaoMultiSelect
              key={dim.chave}
              label={dim.label}
              options={dim.opcoes.map((option) => ({ value: option.valor, label: option.valor }))}
              selected={produtoFiltro[dim.chave] || []}
              onChange={(valores) => atualizarProdutoFiltro(dim.chave, valores)}
              className="w-44"
            />
          ))}
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{referenciasFiltradas.length} referências</CardTitle>
        </CardHeader>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell isHeader>Referência</TableCell>
              <TableCell isHeader align="center">Curva</TableCell>
              <TableCell isHeader align="right">Rank Qtd</TableCell>
              <TableCell isHeader align="right">Qtd Vendida</TableCell>
              <TableCell isHeader align="right">Média Mensal</TableCell>
              <TableCell isHeader align="right">SKUs</TableCell>
              <TableCell isHeader align="right">Média/SKU</TableCell>
              <TableCell isHeader align="right">Rank Valor</TableCell>
              <TableCell isHeader align="right">Valor (R$)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} align="center" className="py-8 text-gray-500">Carregando...</TableCell>
              </TableRow>
            ) : referenciasFiltradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" className="py-8 text-gray-500">Nenhuma referência encontrada</TableCell>
              </TableRow>
            ) : (
              referenciasFiltradas.map((r) => (
                <TableRow key={r.referenceCode} onClick={() => abrirSkus(r)}>
                  <TableCell>
                    <span className="font-medium text-gray-800">{r.referenceCode}</span>
                    <span className="block text-xs text-gray-400 truncate max-w-[240px]" title={r.referenceName}>{r.referenceName}</span>
                  </TableCell>
                  <TableCell align="center">
                    <span className={cn('inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold', CURVA_STYLE[r.curva].badge)}>
                      {r.curva}
                    </span>
                  </TableCell>
                  <TableCell align="right">#{r.rankQtd}</TableCell>
                  <TableCell align="right">{formatNumber(r.qtdVendida)}</TableCell>
                  <TableCell align="right">{formatNumber(r.mediaMensal)}</TableCell>
                  <TableCell align="right">{formatNumber(r.totalSkus)}</TableCell>
                  <TableCell align="right">
                    {formatNumber(r.mediaPorSku)} <TrendArrow tendencia={r.tendenciaMediaSku} />
                  </TableCell>
                  <TableCell align="right">#{r.rankValor}</TableCell>
                  <TableCell align="right">{formatMoney(r.valorReais)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Modal isOpen={configModalAberto} onClose={() => setConfigModalAberto(false)} title="Regras de classificação da Curva ABCD" size="sm">
        {config && (
          <div className="space-y-4">
            <Input
              label="Janela de análise (dias)"
              type="number"
              value={config.giroDias}
              onChange={(e) => setConfig({ ...config, giroDias: Number(e.target.value) })}
            />
            <Input
              label="Curva A - unidades mínimas no período"
              type="number"
              value={config.metaCurvaAUnidades}
              onChange={(e) => setConfig({ ...config, metaCurvaAUnidades: Number(e.target.value) })}
            />
            <Input
              label="Curva D - % das referências (cauda)"
              type="number"
              step="0.1"
              value={config.curvaDPercent}
              onChange={(e) => setConfig({ ...config, curvaDPercent: Number(e.target.value) })}
            />
            <Input
              label="Curva C - % das referências (acima da cauda)"
              type="number"
              step="0.1"
              value={config.curvaCPercent}
              onChange={(e) => setConfig({ ...config, curvaCPercent: Number(e.target.value) })}
            />
            <div className="flex justify-end pt-2 border-t">
              <Button onClick={salvarConfig} isLoading={salvandoConfig}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!skusModal} onClose={() => { setSkusModal(null); setSkusData(null); }} title={skusModal ? `${skusModal.referencia} — ${skusModal.nome}` : ''} size="lg">
        {skusLoading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Carregando SKUs...</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>SKU</TableCell>
                <TableCell isHeader align="right">Qtd Vendida</TableCell>
                <TableCell isHeader align="right">Valor (R$)</TableCell>
                <TableCell isHeader align="right">Estoque Varejo</TableCell>
                <TableCell isHeader align="right">Estoque Atacado</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(skusData?.linhas || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" className="py-6 text-gray-500">Nenhum SKU com movimento</TableCell>
                </TableRow>
              ) : (
                skusData?.linhas.map((s) => (
                  <TableRow key={s.sku}>
                    <TableCell>{s.sku}</TableCell>
                    <TableCell align="right">{formatNumber(s.qtdVendida)}</TableCell>
                    <TableCell align="right">{formatMoney(s.valorReais)}</TableCell>
                    <TableCell align="right">{formatNumber(s.estoqueVarejo)}</TableCell>
                    <TableCell align="right">{formatNumber(s.estoqueAtacado)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Modal>
    </div>
  );
}
