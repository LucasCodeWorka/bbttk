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
import {
  curvaAbcApi,
  relatorioBaseApi,
  CurvaAbcResumoResponse,
  ReferenciaAbc,
  CurvaLetra,
  CurvaAbcSkusResponse,
  PcpClassificacaoDimensao,
} from '@/lib/pcpApi';
import { cn, formatMoney, formatNumber } from '@/lib/utils';

const CURVA_STYLE: Record<CurvaLetra, { border: string; bg: string; text: string; badge: string }> = {
  A: { border: 'border-l-green-500', bg: 'bg-green-50', text: 'text-green-700', badge: 'bg-green-100 text-green-700' },
  B: { border: 'border-l-gray-400', bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-200 text-gray-700' },
  C: { border: 'border-l-red-400', bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
  D: { border: 'border-l-yellow-400', bg: 'bg-yellow-50', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-700' },
};

const SORT_OPTIONS = [
  { value: 'rankValor', label: 'Rank Valor' },
  { value: 'valorMedioMensal', label: 'Media Valor Mensal' },
  { value: 'rankQtd', label: 'Rank Quantidade' },
  { value: 'representatividadeValor', label: 'Representatividade' },
  { value: 'mediaPorSku', label: 'Media / SKU' },
  { value: 'qtdVendida', label: 'Qtd Vendida' },
];

function TrendArrow({ tendencia }: { tendencia: 'up' | 'down' | 'flat' }) {
  if (tendencia === 'up') return <span className="text-green-600">UP</span>;
  if (tendencia === 'down') return <span className="text-red-600">DOWN</span>;
  return <span className="text-gray-400">-</span>;
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
          <p className="text-gray-400 uppercase tracking-wide">Valor 3 meses</p>
          <p className="font-semibold text-gray-800">{formatMoney(resumo.valorReais)}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Quantidade</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.quantidade)}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Total SKUs</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.totalSkus)}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Media mensal</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.mediaMensal)}</p>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2 pt-2 border-t">{resumo.percentDoTotal.toFixed(1)}% do valor vendido analisado</p>
    </Card>
  );
}

function UltimaRefCard({ resumo }: { resumo: CurvaAbcResumoResponse['curvas'][number] }) {
  const style = CURVA_STYLE[resumo.curva];
  const ref = resumo.ultimaReferencia;
  return (
    <Card className={cn('border-l-4', style.border)}>
      <p className="text-xs text-gray-400 uppercase tracking-wide">Ultima ref. Curva {resumo.curva}</p>
      {ref ? (
        <>
          <p className={cn('text-lg font-bold mt-1', style.text)}>{ref.referenceCode}</p>
          <p className="text-xs text-gray-500 truncate" title={ref.referenceName}>{ref.referenceName}</p>
          <p className="text-xs text-gray-400 mt-1">
            {formatMoney(ref.valorMedioMensal)} media mensal | {formatNumber(ref.qtdVendida)} unidades
          </p>
          <p className="text-xs text-gray-400">
            Rank Valor #{ref.rankValor} | Acum. {ref.representatividadeAcumulada.toFixed(2)}%
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-400 mt-2">Sem referencias nessa curva</p>
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
  const [ordenarPor, setOrdenarPor] = useState<'rankQtd' | 'rankValor' | 'mediaPorSku' | 'qtdVendida' | 'representatividadeValor' | 'valorMedioMensal'>('rankValor');

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
      showToast('Erro ao carregar Curva ABCD', 'error');
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

  async function abrirSkus(ref: ReferenciaAbc) {
    if (!token) return;
    setSkusModal({ referencia: ref.referenceCode, nome: ref.referenceName });
    setSkusLoading(true);
    try {
      const res = await curvaAbcApi.getSkus(token, { referencia: ref.referenceCode, page: 1, pageSize: 200 });
      setSkusData(res);
    } catch (error) {
      showToast('Erro ao carregar SKUs da referencia', 'error');
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
      if (ordenarPor === 'mediaPorSku' || ordenarPor === 'qtdVendida' || ordenarPor === 'representatividadeValor' || ordenarPor === 'valorMedioMensal') return b[ordenarPor] - a[ordenarPor];
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
            Referencias classificadas pela media mensal de valor dos ultimos {data?.config.mesesFechados ?? 3} meses fechados
          </p>
        </div>
        {user?.role === 'admin' && (
          <Button variant="secondary" size="sm" onClick={() => window.location.href = '/pcp/relatorio-base-config'}>
            Configuracoes do PCP
          </Button>
        )}
      </div>

      {data && (
        <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
          <p className="text-sm font-medium text-gray-800">Regras de classificacao</p>
          <ul className="text-xs text-gray-600 mt-1 space-y-0.5">
            <li><strong>Base:</strong> media mensal de valor dos ultimos {data.config.mesesFechados} meses fechados.</li>
            <li><strong>Curva A:</strong> referencias ate {data.config.curvaALimitePercent}% do valor medio mensal acumulado.</li>
            <li><strong>Curva B:</strong> referencias acima de {data.config.curvaALimitePercent}% e ate {data.config.curvaBLimitePercent}% do valor acumulado.</li>
            <li><strong>Curva C:</strong> referencias acima de {data.config.curvaBLimitePercent}% e ate {data.config.curvaCLimitePercent}% do valor acumulado.</li>
            <li><strong>Curva D:</strong> referencias restantes, acima de {data.config.curvaCLimitePercent}% do valor acumulado.</li>
          </ul>
          <p className="text-xs text-gray-400 mt-2">{data.totalAnalisadas} referencias analisadas (com venda no periodo).</p>
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
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Ultima referencia por curva</h2>
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
        <Input label="Buscar referencia" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-52" placeholder="Codigo ou nome" />
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
          <CardTitle>{referenciasFiltradas.length} referencias</CardTitle>
        </CardHeader>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell isHeader>Referencia</TableCell>
              <TableCell isHeader align="center">Curva</TableCell>
              <TableCell isHeader align="right">Rank Valor</TableCell>
              <TableCell isHeader align="right">% Valor</TableCell>
              <TableCell isHeader align="right">% Acum.</TableCell>
              <TableCell isHeader align="right">Media Valor</TableCell>
              <TableCell isHeader align="right">Valor 3 Meses</TableCell>
              <TableCell isHeader align="right">Rank Qtd</TableCell>
              <TableCell isHeader align="right">Qtd Vendida</TableCell>
              <TableCell isHeader align="right">Media Mensal</TableCell>
              <TableCell isHeader align="right">SKUs</TableCell>
              <TableCell isHeader align="right">Media/SKU</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={12} align="center" className="py-8 text-gray-500">Carregando...</TableCell>
              </TableRow>
            ) : referenciasFiltradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} align="center" className="py-8 text-gray-500">Nenhuma referencia encontrada</TableCell>
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
                  <TableCell align="right">#{r.rankValor}</TableCell>
                  <TableCell align="right">{r.representatividadeValor.toFixed(2)}%</TableCell>
                  <TableCell align="right">{r.representatividadeAcumulada.toFixed(2)}%</TableCell>
                  <TableCell align="right">{formatMoney(r.valorMedioMensal)}</TableCell>
                  <TableCell align="right">{formatMoney(r.valorReais)}</TableCell>
                  <TableCell align="right">#{r.rankQtd}</TableCell>
                  <TableCell align="right">{formatNumber(r.qtdVendida)}</TableCell>
                  <TableCell align="right">{formatNumber(r.mediaMensal)}</TableCell>
                  <TableCell align="right">{formatNumber(r.totalSkus)}</TableCell>
                  <TableCell align="right">
                    {formatNumber(r.mediaPorSku)} <TrendArrow tendencia={r.tendenciaMediaSku} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Modal isOpen={!!skusModal} onClose={() => { setSkusModal(null); setSkusData(null); }} title={skusModal ? `${skusModal.referencia} - ${skusModal.nome}` : ''} size="lg">
        {skusLoading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Carregando SKUs...</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>Ref - Cor - Tam</TableCell>
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
                  <TableCell colSpan={6} align="center" className="py-6 text-gray-500">Nenhum SKU com movimento</TableCell>
                </TableRow>
              ) : (
                skusData?.linhas.map((s) => (
                  <TableRow key={s.sku}>
                    <TableCell>{s.refCorTam}</TableCell>
                    <TableCell className="text-xs text-gray-400">{s.sku}</TableCell>
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
