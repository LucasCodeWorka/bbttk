'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  analiseGradeApi,
  relatorioBaseApi,
  AnaliseGradeResponse,
  PcpClassificacaoDimensao,
  PcpGradeReferencia,
  PcpGradeDetalheSku,
} from '@/lib/pcpApi';
import { RELATORIO_BASE_BRANCH_ORDER } from '@/lib/pcpBranches';
import { cn, formatMoney, formatNumber } from '@/lib/utils';
import { exportMultiSheetExcel, ExcelColumn } from '@/lib/exportExcel';

const STATUS_STYLE = {
  saudavel: 'bg-green-100 text-green-700',
  atencao: 'bg-yellow-100 text-yellow-700',
  critica: 'bg-red-100 text-red-700',
  ok: 'bg-green-100 text-green-700',
  risco: 'bg-red-100 text-red-700',
};

const STATUS_LABEL = {
  saudavel: 'Saudavel',
  atencao: 'Atencao',
  critica: 'Critica',
  ok: 'OK',
  risco: 'Risco',
};

const CURVA_STYLE = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-gray-200 text-gray-700',
  C: 'bg-red-100 text-red-700',
  D: 'bg-yellow-100 text-yellow-700',
};

const HEATMAP_RANKING_OPTIONS = [
  { value: 15, label: 'Top 15' },
  { value: 30, label: 'Top 30' },
  { value: 50, label: 'Top 50' },
];

type HeatmapStatus = 'vermelho' | 'amarelo' | 'verde';

// Mesmo par bg-100/text-700 do componente Badge (usado no Comercial inteiro - Dashboard,
// Comissoes, etc.) - pedido explicito do usuario pra manter consistencia visual com o
// resto do app em vez do vermelho/amarelo/verde saturado validado pela skill de dataviz
// (que passava CVD/contraste mais limpo, mas destoava do restante das telas). O numero
// em cada celula continua sempre visivel (nunca so a cor) como mitigação.
const HEATMAP_STATUS_STYLE: Record<HeatmapStatus, string> = {
  vermelho: 'bg-red-100 text-red-700',
  amarelo: 'bg-yellow-100 text-yellow-700',
  verde: 'bg-green-100 text-green-700',
};

const HEATMAP_STATUS_LABEL: Record<HeatmapStatus, string> = {
  vermelho: 'Ruptura / baixo estoque',
  amarelo: 'Atencao',
  verde: 'Saudavel',
};

interface CelulaHeatmap {
  estoque: number;
  emProducao: number;
  mediaMensal: number;
  cobertura: number | null;
  status: HeatmapStatus;
}

// Soma estoque/venda de todas as cores de uma referencia, por tamanho - o heatmap e
// tamanho x referencia (nao entra a dimensao cor), diferente da "Matriz por cor e
// tamanho" do drill-down que mostra cada cor separada.
function agregarPorTamanho(detalhes: PcpGradeDetalheSku[], riscoCoberturaMeses: number): Map<string, CelulaHeatmap> {
  const soma = new Map<string, { estoque: number; emProducao: number; mediaMensal: number }>();
  for (const d of detalhes) {
    const atual = soma.get(d.tamanho) || { estoque: 0, emProducao: 0, mediaMensal: 0 };
    atual.estoque += d.estoque;
    atual.emProducao += d.emProducao;
    atual.mediaMensal += d.mediaMensal;
    soma.set(d.tamanho, atual);
  }

  const mapa = new Map<string, CelulaHeatmap>();
  for (const [tamanho, valores] of soma) {
    const cobertura = valores.mediaMensal > 0 ? Math.round((valores.estoque / valores.mediaMensal) * 100) / 100 : null;
    let status: HeatmapStatus;
    if (valores.estoque <= 0) status = 'vermelho';
    else if (cobertura !== null && cobertura < riscoCoberturaMeses) status = 'vermelho';
    else if (cobertura !== null && cobertura < riscoCoberturaMeses * 2) status = 'amarelo';
    else status = 'verde';
    mapa.set(tamanho, { estoque: valores.estoque, emProducao: valores.emProducao, mediaMensal: valores.mediaMensal, cobertura, status });
  }
  return mapa;
}

function Badge({ value, className }: { value: string; className: string }) {
  return <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-semibold', className)}>{value}</span>;
}

function ThSortPcp({
  label,
  sortKeyName,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
  className,
  title,
}: {
  label: string;
  sortKeyName: string;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
  title?: string;
}) {
  const active = sortKey === sortKeyName;
  return (
    <TableCell
      isHeader
      align={align}
      className={cn('cursor-pointer select-none hover:bg-gray-100', className)}
      onClick={() => onSort(sortKeyName)}
      title={title}
    >
      <span className="flex items-center gap-1.5">
        <span>{label}</span>
        {active ? (
          <span className="text-[var(--bbtk-purple)]">{sortDir === 'asc' ? '▲' : '▼'}</span>
        ) : (
          <span className="text-gray-300">▲</span>
        )}
      </span>
    </TableCell>
  );
}

function coberturaLabel(value: number | null) {
  return value === null ? '-' : `${value.toFixed(2)} m`;
}

function buildMatriz(detalhes: PcpGradeDetalheSku[]) {
  const cores = [...new Set(detalhes.map((d) => d.cor))].sort((a, b) => a.localeCompare(b));
  const tamanhos = [...new Set(detalhes.map((d) => d.tamanho))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const mapa = new Map<string, PcpGradeDetalheSku>();
  for (const detalhe of detalhes) mapa.set(`${detalhe.cor}|||${detalhe.tamanho}`, detalhe);
  return { cores, tamanhos, mapa };
}

function DetalheReferencia({ referencia }: { referencia: PcpGradeReferencia }) {
  const { cores, tamanhos, mapa } = useMemo(() => buildMatriz(referencia.detalhes), [referencia.detalhes]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <p className="text-xs text-gray-400 uppercase">Curva</p>
          <Badge value={referencia.curva} className={CURVA_STYLE[referencia.curva]} />
        </Card>
        <Card>
          <p className="text-xs text-gray-400 uppercase">Cobertura geral</p>
          <p className="text-lg font-semibold">{coberturaLabel(referencia.coberturaGeral)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400 uppercase">Estoque</p>
          <p className="text-lg font-semibold">{formatNumber(referencia.estoqueTotal)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400 uppercase">Media mensal</p>
          <p className="text-lg font-semibold">{formatNumber(referencia.mediaMensal)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400 uppercase">SKUs em risco</p>
          <p className="text-lg font-semibold">{referencia.skusEmRisco} de {referencia.totalSkus}</p>
        </Card>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Saldo por filial</h3>
        {referencia.saldoPorFilial.length === 0 ? (
          <p className="text-xs text-gray-400">Sem saldo em nenhuma filial.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>Filial</TableCell>
                <TableCell isHeader align="right">Estoque</TableCell>
                <TableCell isHeader align="right">% do total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {referencia.saldoPorFilial.map((f) => (
                <TableRow key={f.branchCode}>
                  <TableCell className="font-medium">{f.branchName}</TableCell>
                  <TableCell align="right">{formatNumber(f.estoque)}</TableCell>
                  <TableCell align="right">
                    {referencia.estoqueTotal > 0 ? `${((f.estoque / referencia.estoqueTotal) * 100).toFixed(1)}%` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Matriz por cor e tamanho</h3>
        <Table className="max-h-[440px]">
          <TableHead>
            <TableRow>
              <TableCell isHeader>Cor</TableCell>
              {tamanhos.map((tamanho) => (
                <TableCell key={tamanho} isHeader align="center">{tamanho}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {cores.map((cor) => (
              <TableRow key={cor}>
                <TableCell className="font-medium">{cor}</TableCell>
                {tamanhos.map((tamanho) => {
                  const celula = mapa.get(`${cor}|||${tamanho}`);
                  if (!celula) return <TableCell key={tamanho} align="center" className="text-gray-300">-</TableCell>;
                  return (
                    <TableCell
                      key={tamanho}
                      align="center"
                      className={cn(
                        'min-w-36 text-xs align-top',
                        celula.status === 'risco' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'
                      )}
                    >
                      <div className="font-semibold">{STATUS_LABEL[celula.status]}</div>
                      <div>Est: {formatNumber(celula.estoque)}</div>
                      {celula.emProducao > 0 && <div>Em Prod: {formatNumber(celula.emProducao)}</div>}
                      <div>V: {formatNumber(celula.vendaMes1)} / {formatNumber(celula.vendaMes2)} / {formatNumber(celula.vendaMes3)}</div>
                      <div>Med: {formatNumber(celula.mediaMensal)}</div>
                      <div>Cob: {coberturaLabel(celula.cobertura)}</div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Detalhamento por SKU</h3>
        <Table className="max-h-[440px]">
          <TableHead>
            <TableRow>
              <TableCell isHeader>Ref-Cor-Tam</TableCell>
              <TableCell isHeader>SKU</TableCell>
              <TableCell isHeader>Cor</TableCell>
              <TableCell isHeader>Tamanho</TableCell>
              <TableCell isHeader align="right">Estoque</TableCell>
              <TableCell isHeader align="right">Mes 1</TableCell>
              <TableCell isHeader align="right">Mes 2</TableCell>
              <TableCell isHeader align="right">Mes 3</TableCell>
              <TableCell isHeader align="right">Media</TableCell>
              <TableCell isHeader align="right">Cobertura</TableCell>
              <TableCell isHeader align="center">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {referencia.detalhes.map((d) => (
              <TableRow key={d.sku}>
                <TableCell className="font-medium">{d.refCorTam}</TableCell>
                <TableCell className="text-xs text-gray-400">{d.sku}</TableCell>
                <TableCell>{d.cor}</TableCell>
                <TableCell>{d.tamanho}</TableCell>
                <TableCell align="right">{formatNumber(d.estoque)}</TableCell>
                <TableCell align="right">{formatNumber(d.vendaMes1)}</TableCell>
                <TableCell align="right">{formatNumber(d.vendaMes2)}</TableCell>
                <TableCell align="right">{formatNumber(d.vendaMes3)}</TableCell>
                <TableCell align="right">{formatNumber(d.mediaMensal)}</TableCell>
                <TableCell align="right">{coberturaLabel(d.cobertura)}</TableCell>
                <TableCell align="center">
                  <Badge value={STATUS_LABEL[d.status]} className={STATUS_STYLE[d.status]} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function PcpAnaliseGradePage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<AnaliseGradeResponse | null>(null);
  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [referenciaBusca, setReferenciaBusca] = useState('');
  const [referenciaExpandida, setReferenciaExpandida] = useState<string | null>(null);
  const [heatmapLimit, setHeatmapLimit] = useState(15);
  const [sortKey, setSortKey] = useState<string | null>('percentGradeEmRisco');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [heatmapSortKey, setHeatmapSortKey] = useState<string | null>(null);
  const [heatmapSortDir, setHeatmapSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function handleHeatmapSort(key: string) {
    if (heatmapSortKey === key) {
      setHeatmapSortDir(heatmapSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setHeatmapSortKey(key);
      setHeatmapSortDir('desc');
    }
  }

  function getSortValue(ref: PcpGradeReferencia, key: string): string | number {
    switch (key) {
      case 'referenceCode': return ref.referenceCode || '';
      case 'curva': return ref.curva || '';
      case 'estoqueTotal': return ref.estoqueTotal || 0;
      case 'emProducao': return ref.emProducao || 0;
      case 'vendaMes1': return ref.vendaMes1 || 0;
      case 'vendaMes2': return ref.vendaMes2 || 0;
      case 'vendaMes3': return ref.vendaMes3 || 0;
      case 'mediaMensal': return ref.mediaMensal || 0;
      case 'coberturaGeral': return ref.coberturaGeral ?? -1;
      case 'totalSkus': return ref.totalSkus || 0;
      case 'skusEmRisco': return ref.skusEmRisco || 0;
      case 'percentGradeEmRisco': return ref.percentGradeEmRisco || 0;
      case 'status': return ref.status || '';
      default: return '';
    }
  }

  const referenciasSorted = useMemo(() => {
    if (!data) return [];
    const lista = [...data.referencias];
    if (!sortKey) return lista;

    return lista.sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      let cmp = 0;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = Number(aVal) - Number(bVal);
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

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
      const filtro = {
        referencia: referenciaBusca.trim() || undefined,
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
        branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
      };
      const gradeRes = await analiseGradeApi.getGrade(token, filtro);
      setData(gradeRes);
    } catch (error) {
      showToast('Erro ao carregar Analise de Grade', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, produtoFiltro, filiaisSelecionadas, referenciaBusca]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  function atualizarProdutoFiltro(chave: string, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  const meses = data?.config.meses || ['Mes 1', 'Mes 2', 'Mes 3'];

  // As referencias ja chegam ordenadas por prioridade de risco (curva + % em risco) -
  // o heatmap so pega as N primeiras dessa mesma ordem, entao mostra sempre quem mais
  // precisa de atencao primeiro, nao uma amostra aleatoria.
  const heatmap = useMemo(() => {
    const referencias = (data?.referencias || []).slice(0, heatmapLimit);
    const riscoCoberturaMeses = data?.config.riscoCoberturaMeses ?? 1;

    const tamanhosSet = new Set<string>();
    const porReferencia = referencias.map((referencia) => {
      const mapa = agregarPorTamanho(referencia.detalhes, riscoCoberturaMeses);
      for (const tamanho of mapa.keys()) tamanhosSet.add(tamanho);
      return { referencia, mapa };
    });
    const tamanhos = [...tamanhosSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    let linhas = porReferencia.map(({ referencia, mapa }) => ({
      referencia,
      mapa,
      completude: tamanhos.length > 0 ? Math.round((mapa.size / tamanhos.length) * 100) : 0,
    }));

    // Ordenação customizada do heatmap
    if (heatmapSortKey) {
      linhas = [...linhas].sort((a, b) => {
        let aVal: string | number = '';
        let bVal: string | number = '';

        if (heatmapSortKey === 'referencia') {
          aVal = a.referencia.referenceCode || '';
          bVal = b.referencia.referenceCode || '';
        } else if (heatmapSortKey === 'completude') {
          aVal = a.completude;
          bVal = b.completude;
        } else {
          // Ordenação por tamanho específico
          const tamanho = heatmapSortKey;
          const aCelula = a.mapa.get(tamanho);
          const bCelula = b.mapa.get(tamanho);
          aVal = aCelula?.estoque ?? -1;
          bVal = bCelula?.estoque ?? -1;
        }

        const cmp = typeof aVal === 'string'
          ? aVal.localeCompare(bVal as string)
          : Number(aVal) - Number(bVal);
        return heatmapSortDir === 'asc' ? cmp : -cmp;
      });
    }

    return { tamanhos, linhas, riscoCoberturaMeses };
  }, [data, heatmapLimit, heatmapSortKey, heatmapSortDir]);

  // Função para exportar para Excel
  const handleExportExcel = useCallback(() => {
    if (!data || data.referencias.length === 0) return;

    const dataHoje = new Date().toISOString().split('T')[0];
    const mesesLabels = data.config.meses || ['Mes 1', 'Mes 2', 'Mes 3'];

    // Aba 1: Referencias
    const colunasRefs: ExcelColumn[] = [
      { key: 'referenceCode', header: 'REFERÊNCIA', width: 15, type: 'text' },
      { key: 'referenceName', header: 'DESCRIÇÃO', width: 35, type: 'text' },
      { key: 'curva', header: 'CURVA', width: 8, type: 'text' },
      { key: 'estoqueTotal', header: 'ESTOQUE', width: 12, type: 'number' },
      { key: 'emProducao', header: 'EM PROD.', width: 12, type: 'number' },
      { key: 'vendaMes1', header: mesesLabels[0], width: 12, type: 'number' },
      { key: 'vendaMes2', header: mesesLabels[1], width: 12, type: 'number' },
      { key: 'vendaMes3', header: mesesLabels[2], width: 12, type: 'number' },
      { key: 'mediaMensal', header: 'MÉDIA MENSAL', width: 14, type: 'number' },
      { key: 'coberturaGeral', header: 'COBERTURA', width: 12, type: 'number' },
      { key: 'totalSkus', header: 'SKUS', width: 8, type: 'number' },
      { key: 'skusEmRisco', header: 'SKUS RISCO', width: 12, type: 'number' },
      { key: 'percentGradeEmRisco', header: '% RISCO', width: 10, type: 'number' },
      { key: 'status', header: 'STATUS', width: 12, type: 'text' },
    ];

    const dadosRefs = referenciasSorted.map(r => ({
      referenceCode: r.referenceCode,
      referenceName: r.referenceName,
      curva: r.curva,
      estoqueTotal: r.estoqueTotal,
      emProducao: r.emProducao || 0,
      vendaMes1: r.vendaMes1,
      vendaMes2: r.vendaMes2,
      vendaMes3: r.vendaMes3,
      mediaMensal: r.mediaMensal,
      coberturaGeral: r.coberturaGeral ?? '',
      totalSkus: r.totalSkus,
      skusEmRisco: r.skusEmRisco,
      percentGradeEmRisco: r.percentGradeEmRisco,
      status: STATUS_LABEL[r.status] || r.status,
    }));

    // Aba 2: SKUs detalhados
    const colunasSkus: ExcelColumn[] = [
      { key: 'referenceCode', header: 'REFERÊNCIA', width: 15, type: 'text' },
      { key: 'refCorTam', header: 'REF-COR-TAM', width: 25, type: 'text' },
      { key: 'sku', header: 'SKU', width: 18, type: 'text' },
      { key: 'cor', header: 'COR', width: 15, type: 'text' },
      { key: 'tamanho', header: 'TAMANHO', width: 10, type: 'text' },
      { key: 'estoque', header: 'ESTOQUE', width: 12, type: 'number' },
      { key: 'vendaMes1', header: mesesLabels[0], width: 12, type: 'number' },
      { key: 'vendaMes2', header: mesesLabels[1], width: 12, type: 'number' },
      { key: 'vendaMes3', header: mesesLabels[2], width: 12, type: 'number' },
      { key: 'mediaMensal', header: 'MÉDIA MENSAL', width: 14, type: 'number' },
      { key: 'cobertura', header: 'COBERTURA', width: 12, type: 'number' },
      { key: 'status', header: 'STATUS', width: 12, type: 'text' },
    ];

    const dadosSkus: Record<string, unknown>[] = [];
    for (const ref of data.referencias) {
      for (const d of ref.detalhes) {
        dadosSkus.push({
          referenceCode: ref.referenceCode,
          refCorTam: d.refCorTam,
          sku: d.sku,
          cor: d.cor,
          tamanho: d.tamanho,
          estoque: d.estoque,
          vendaMes1: d.vendaMes1,
          vendaMes2: d.vendaMes2,
          vendaMes3: d.vendaMes3,
          mediaMensal: d.mediaMensal,
          cobertura: d.cobertura ?? '',
          status: STATUS_LABEL[d.status] || d.status,
        });
      }
    }

    exportMultiSheetExcel(`AnaliseGrade_${dataHoje}`, [
      {
        sheetName: 'Referências',
        columns: colunasRefs,
        data: dadosRefs,
        title: 'Análise de Grade - Referências',
      },
      {
        sheetName: 'SKUs Detalhados',
        columns: colunasSkus,
        data: dadosSkus,
        title: 'Análise de Grade - Detalhe por SKU',
      },
    ]);
  }, [data, referenciasSorted]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Analise de Grade</h1>
        <p className="text-gray-500 text-sm mt-1">
          Risco de ruptura por referencia, cor e tamanho com cobertura menor que 1 mes.
        </p>
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm font-medium text-gray-800">Regra de risco</p>
        <p className="text-xs text-gray-600 mt-1">
          Risco = cobertura menor que {data?.config.riscoCoberturaMeses ?? 1} mes. A cobertura usa a media mensal de venda dos ultimos 3 meses fechados.
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        {classificacoes.map((dim) => (
          <ClassificacaoMultiSelect
            key={dim.chave}
            label={dim.label}
            options={dim.opcoes.map((option) => ({ value: option.valor, label: option.valor }))}
            selected={produtoFiltro[dim.chave] || []}
            onChange={(valores) => atualizarProdutoFiltro(dim.chave, valores)}
            className="w-44"
          />
        ))}
        <FilialMultiSelect
          selected={filiaisSelecionadas}
          onChange={setFiliaisSelecionadas}
          options={RELATORIO_BASE_BRANCH_ORDER.map((b) => ({ value: b.branchCode, label: b.label }))}
          label="Loja"
          className="w-52"
        />
        <Input
          label="Buscar referencia"
          value={referenciaBusca}
          onChange={(e) => setReferenciaBusca(e.target.value)}
          className="w-48"
          placeholder="Codigo da referencia"
        />
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
        {data && data.referencias.length > 0 && (
          <button
            onClick={handleExportExcel}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Exportar Excel
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <KPICard
          title="Referencias analisadas"
          value={isLoading || !data ? '-' : formatNumber(data.indicadores.referenciasTotal)}
          color="blue"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPICard
          title="Referencias criticas"
          value={isLoading || !data ? '-' : formatNumber(data.indicadores.referenciasCriticas)}
          color="red"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPICard
          title="SKUs em risco"
          value={isLoading || !data ? '-' : `${formatNumber(data.indicadores.skusEmRiscoTotal)} de ${formatNumber(data.indicadores.totalSkus)}`}
          color="yellow"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPICard
          title="% SKUs em risco"
          value={isLoading || !data ? '-' : `${data.indicadores.percentSkusEmRisco.toFixed(1)}%`}
          color="green"
          valueSize="md"
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mapa de calor - estoque por referencia x tamanho</CardTitle>
          <Select
            label="Mostrar"
            value={heatmapLimit}
            onChange={(e) => setHeatmapLimit(Number(e.target.value))}
            options={HEATMAP_RANKING_OPTIONS}
            className="w-32"
          />
        </CardHeader>
        <p className="text-xs text-gray-500 -mt-2 mb-3">
          Estoque atual em pecas (somado entre cores) por referencia e tamanho - mostra as {heatmapLimit}{' '}
          referencias com maior prioridade de risco, mesma ordem da tabela abaixo.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-3 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300" />
            Ruptura / baixo estoque - cobertura menor que {heatmap.riscoCoberturaMeses} mes
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
            Atencao - cobertura entre {heatmap.riscoCoberturaMeses} e {heatmap.riscoCoberturaMeses * 2} meses
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-300" />
            Saudavel - cobertura acima de {heatmap.riscoCoberturaMeses * 2} meses
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-white border border-gray-300" />
            Sem SKU cadastrado nesse tamanho
          </span>
        </div>
        {isLoading ? (
          <div className="py-8 text-center text-gray-500">Carregando...</div>
        ) : heatmap.linhas.length === 0 ? (
          <div className="py-8 text-center text-gray-500">Nenhuma referencia para mostrar</div>
        ) : (
          <Table className="max-h-[520px]">
            <TableHead className="sticky top-0 z-10">
              <TableRow>
                <ThSortPcp label="Referencia" sortKeyName="referencia" sortKey={heatmapSortKey} sortDir={heatmapSortDir} onSort={handleHeatmapSort} />
                {heatmap.tamanhos.map((tamanho) => (
                  <ThSortPcp key={tamanho} label={tamanho} sortKeyName={tamanho} sortKey={heatmapSortKey} sortDir={heatmapSortDir} onSort={handleHeatmapSort} align="center" />
                ))}
                <ThSortPcp label="Compl." sortKeyName="completude" sortKey={heatmapSortKey} sortDir={heatmapSortDir} onSort={handleHeatmapSort} align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {heatmap.linhas.map(({ referencia, mapa, completude }) => (
                <TableRow key={referencia.referenceCode}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {referencia.referenceCode}
                    <span className="block text-xs text-gray-400 truncate max-w-[200px]" title={referencia.referenceName}>
                      {referencia.referenceName}
                    </span>
                  </TableCell>
                  {heatmap.tamanhos.map((tamanho) => {
                    const celula = mapa.get(tamanho);
                    if (!celula) {
                      return <TableCell key={tamanho} align="center" className="text-gray-300">-</TableCell>;
                    }
                    return (
                      <TableCell
                        key={tamanho}
                        align="center"
                        className={cn('font-semibold', HEATMAP_STATUS_STYLE[celula.status])}
                        title={`${HEATMAP_STATUS_LABEL[celula.status]} - cobertura ${coberturaLabel(celula.cobertura)} - media mensal ${formatNumber(celula.mediaMensal)}${celula.emProducao > 0 ? ` - em producao ${formatNumber(celula.emProducao)}` : ''}`}
                      >
                        {formatNumber(celula.estoque)}
                        {celula.emProducao > 0 && (
                          <span className="block text-[10px] font-normal opacity-75">+{formatNumber(celula.emProducao)} prod.</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell align="right" className="font-semibold">{completude}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{data?.referencias.length || 0} referencias</CardTitle>
        </CardHeader>
        <Table>
          <TableHead>
            <TableRow>
              <ThSortPcp label="Referencia" sortKeyName="referenceCode" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <ThSortPcp label="Curva" sortKeyName="curva" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="center" />
              <ThSortPcp label="Estoque" sortKeyName="estoqueTotal" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label="Em Prod." sortKeyName="emProducao" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Pecas em Producao (O.P. abertas)" />
              <ThSortPcp label={meses[0]} sortKeyName="vendaMes1" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label={meses[1]} sortKeyName="vendaMes2" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label={meses[2]} sortKeyName="vendaMes3" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label="Media mensal" sortKeyName="mediaMensal" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label="Cobertura" sortKeyName="coberturaGeral" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label="SKUs" sortKeyName="totalSkus" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label="SKUs risco" sortKeyName="skusEmRisco" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label="% risco" sortKeyName="percentGradeEmRisco" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThSortPcp label="Status" sortKeyName="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="center" />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={13} align="center" className="py-8 text-gray-500">Carregando...</TableCell>
              </TableRow>
            ) : referenciasSorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} align="center" className="py-8 text-gray-500">Nenhuma referencia encontrada</TableCell>
              </TableRow>
            ) : (
              referenciasSorted.map((r) => {
                const expandida = referenciaExpandida === r.referenceCode;
                return (
                  <Fragment key={r.referenceCode}>
                    <TableRow onClick={() => setReferenciaExpandida(expandida ? null : r.referenceCode)}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-gray-400 text-xs">{expandida ? '▼' : '▶'}</span>
                          <span className="font-medium text-gray-800">{r.referenceCode}</span>
                        </span>
                        <span className="block text-xs text-gray-400 truncate max-w-[260px] pl-4" title={r.referenceName}>{r.referenceName}</span>
                      </TableCell>
                      <TableCell align="center"><Badge value={r.curva} className={CURVA_STYLE[r.curva]} /></TableCell>
                      <TableCell align="right">{formatNumber(r.estoqueTotal)}</TableCell>
                      <TableCell align="right">{r.emProducao > 0 ? formatNumber(r.emProducao) : '-'}</TableCell>
                      <TableCell align="right">{formatNumber(r.vendaMes1)}</TableCell>
                      <TableCell align="right">{formatNumber(r.vendaMes2)}</TableCell>
                      <TableCell align="right">{formatNumber(r.vendaMes3)}</TableCell>
                      <TableCell align="right">{formatNumber(r.mediaMensal)}</TableCell>
                      <TableCell align="right">{coberturaLabel(r.coberturaGeral)}</TableCell>
                      <TableCell align="right">{formatNumber(r.totalSkus)}</TableCell>
                      <TableCell align="right">{formatNumber(r.skusEmRisco)}</TableCell>
                      <TableCell align="right">{r.percentGradeEmRisco.toFixed(1)}%</TableCell>
                      <TableCell align="center"><Badge value={STATUS_LABEL[r.status]} className={STATUS_STYLE[r.status]} /></TableCell>
                    </TableRow>
                    {expandida && (
                      <TableRow>
                        <TableCell colSpan={13} className="bg-gray-50 p-4">
                          <DetalheReferencia referencia={r} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
