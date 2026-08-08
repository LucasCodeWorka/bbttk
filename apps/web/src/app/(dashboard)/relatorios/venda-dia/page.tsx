'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  VendaDiaFiltro,
  VendaDiaResponse,
  VendaDiaFiltrosResponse,
  VendaDiaTipoClassificacao,
  VendaDiaLinha,
  vendaDiaApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { exportToExcel, ExcelColumn } from '@/lib/exportExcel';

const TIPO_CLASSIFICACAO_OPTIONS: { value: VendaDiaTipoClassificacao; label: string }[] = [
  { value: 'categoria', label: 'Por Categoria' },
  { value: 'linha', label: 'Por Linha' },
  { value: 'colecao', label: 'Por Coleção' },
  { value: 'status', label: 'Por Status' },
];

// Limpa o nome da loja removendo "BEBETENKITE" e códigos numéricos
function cleanBranchName(name: string): string {
  return name
    .replace(/BEBETENKITE\s*/gi, '')
    .replace(/^\d+\s*[-–]\s*/, '')
    .replace(/^\s*[-–]\s*/, '')
    .trim();
}

// Cores para as barras do gráfico (usando paleta do projeto)
const BAR_COLORS = [
  'var(--bbtk-red)',
  'var(--bbtk-blue)',
  'var(--bbtk-purple)',
  'var(--bbtk-green)',
  'var(--bbtk-orange)',
  'var(--bbtk-turquoise)',
  'var(--bbtk-pink)',
  'var(--bbtk-yellow)',
];

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
      <span className="flex items-center gap-1 justify-center">
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

// Gráfico de barras horizontais com nomes completos
function HorizontalBarChart({
  data,
  maxValue,
}: {
  data: { label: string; fullName?: string; value: number; color: string }[];
  maxValue: number;
}) {
  if (data.length === 0) return null;

  return (
    <div className="space-y-2">
      {data.map((item, idx) => {
        const widthPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        return (
          <div key={idx} className="space-y-0.5">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-gray-700">{item.fullName || item.label}</span>
              <span className="text-gray-600 tabular-nums">{formatNumber(item.value)}</span>
            </div>
            <div className="h-4 bg-gray-100 rounded overflow-hidden">
              <div
                className="h-full rounded transition-all duration-300"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: item.color,
                  minWidth: item.value > 0 ? '4px' : '0',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function VendaDiaPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [data, setData] = useState<VendaDiaResponse | null>(null);
  const [filtros, setFiltros] = useState<VendaDiaFiltrosResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros
  const [tipoClassificacao, setTipoClassificacao] = useState<VendaDiaTipoClassificacao>('categoria');
  const [classificacaoValores, setClassificacaoValores] = useState<string[]>([]);
  const [branchesSelecionados, setBranchesSelecionados] = useState<number[]>([]);
  const [agruparLojas, setAgruparLojas] = useState(false);

  // Ordenação
  const [sortKey, setSortKey] = useState<string | null>('vendaMes');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Período do gráfico
  const [chartPeriodo, setChartPeriodo] = useState<'dia' | 'semana' | 'mes'>('mes');

  const carregarFiltros = useCallback(async () => {
    if (!token) return;
    try {
      const response = await vendaDiaApi.getFiltros(token);
      setFiltros(response);
    } catch (error) {
      console.error('Erro ao carregar filtros:', error);
    }
  }, [token]);

  const carregarDados = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setErro(null);

    try {
      const filtro: VendaDiaFiltro = {
        tipoClassificacao,
        classificacaoValores: classificacaoValores.length > 0 ? classificacaoValores : undefined,
        branches: branchesSelecionados.length > 0 ? branchesSelecionados : undefined,
        agruparLojas,
      };

      const response = await vendaDiaApi.getVendaDia(token, filtro);
      setData(response);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Erro desconhecido';
      setErro(mensagem);
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token, tipoClassificacao, classificacaoValores, branchesSelecionados, agruparLojas, showToast]);

  useEffect(() => {
    carregarFiltros();
  }, [carregarFiltros]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Opções de classificação baseadas no tipo selecionado
  const classificacaoOpcoes = useMemo(() => {
    if (!filtros) return [];
    const dim = filtros.classificacoes.find(c => c.tipo === tipoClassificacao);
    return dim?.opcoes.map(o => ({ value: o.valor, label: `${o.valor} (${formatNumber(o.qtd_skus)})` })) || [];
  }, [filtros, tipoClassificacao]);

  // Resetar classificação selecionada ao mudar o tipo
  useEffect(() => {
    setClassificacaoValores([]);
  }, [tipoClassificacao]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function getSortValue(row: VendaDiaLinha, key: string): string | number {
    switch (key) {
      case 'loja':
        // Ordenar por branchCode internamente, Total sempre no final
        if (row.branchCode === null) return sortDir === 'asc' ? 999999 : -1;
        return row.branchCode;
      case 'branchCode':
        if (row.branchCode === null) return sortDir === 'asc' ? 999999 : -1;
        return row.branchCode;
      case 'estoqueDiaAnterior':
        return row.estoqueDiaAnterior;
      case 'vendaDiaAnterior':
        return row.vendaDiaAnterior;
      case 'vendaUltimaSemana':
        return row.vendaUltimaSemana;
      case 'vendaMes':
        return row.vendaMes;
      case 'giroMes':
        return row.giroMes ?? -1;
      default:
        return 0;
    }
  }

  const sortedLinhas = useMemo(() => {
    if (!data) return [];

    // Separar linha TOTAL das demais
    const totalRow = data.linhas.find(l => l.branchCode === null);
    const otherRows = data.linhas.filter(l => l.branchCode !== null);

    // Se não houver sortKey, retorna na ordem original com TOTAL no final
    if (!sortKey) {
      return totalRow ? [...otherRows, totalRow] : otherRows;
    }

    // Ordenar apenas as linhas que não são TOTAL
    const sorted = [...otherRows].sort((a, b) => {
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

    // Sempre colocar TOTAL no final
    return totalRow ? [...sorted, totalRow] : sorted;
  }, [data, sortKey, sortDir]);

  // Dados para o gráfico (exclui linha de total)
  const chartData = useMemo(() => {
    if (!data || agruparLojas) return { items: [], maxValue: 0 };

    const linhasSemTotal = data.linhas.filter(l => l.branchCode !== null);

    // Selecionar o valor correto baseado no período
    const getValorPorPeriodo = (linha: VendaDiaLinha) => {
      switch (chartPeriodo) {
        case 'dia':
          return linha.vendaDiaAnterior;
        case 'semana':
          return linha.vendaUltimaSemana;
        case 'mes':
        default:
          return linha.vendaMes;
      }
    };

    // Ordenar pelo valor do período selecionado (descendente)
    const ordenado = [...linhasSemTotal].sort((a, b) => getValorPorPeriodo(b) - getValorPorPeriodo(a));

    const items = ordenado.map((l, idx) => ({
      label: l.branchAbrev,
      fullName: cleanBranchName(l.branchName),
      value: getValorPorPeriodo(l),
      color: BAR_COLORS[idx % BAR_COLORS.length],
    }));

    return {
      items,
      maxValue: Math.max(...items.map(i => i.value), 0),
    };
  }, [data, agruparLojas, chartPeriodo]);

  const handleExportExcel = useCallback(() => {
    if (!data || data.linhas.length === 0) return;

    setExportando(true);
    try {
      const dataHoje = new Date().toISOString().split('T')[0];

      const columns: ExcelColumn[] = [
        { key: 'loja', header: 'LOJA', width: 20, type: 'text' },
        { key: 'estoque', header: 'ESTQ DIA ANT', width: 14, type: 'number' },
        { key: 'vendaDia', header: 'VENDA DIA ANT', width: 14, type: 'number' },
        { key: 'vendaSemana', header: 'VENDA SEMANA', width: 14, type: 'number' },
        { key: 'vendaMes', header: 'VENDA MÊS', width: 14, type: 'number' },
        { key: 'giro', header: 'GIRO MÊS', width: 12, type: 'number' },
      ];

      const dados = sortedLinhas.map(row => ({
        loja: row.branchCode === null ? 'TOTAL' : cleanBranchName(row.branchName),
        estoque: row.estoqueDiaAnterior,
        vendaDia: row.vendaDiaAnterior,
        vendaSemana: row.vendaUltimaSemana,
        vendaMes: row.vendaMes,
        giro: row.giroMes,
      }));

      const tipoLabel = TIPO_CLASSIFICACAO_OPTIONS.find(o => o.value === data.tipoClassificacao)?.label || data.tipoClassificacao;
      const filtroLabel = data.classificacaoSelecionada.length > 0
        ? data.classificacaoSelecionada.join(', ')
        : 'Todos';

      exportToExcel({
        filename: `VendaDia_${tipoLabel}_${dataHoje}`,
        sheetName: 'Venda do Dia',
        title: `Relatório Venda do Dia - ${tipoLabel}: ${filtroLabel} (Ref: ${formatDate(data.dataReferencia)})`,
        columns,
        data: dados,
      });

      showToast('Excel exportado com sucesso', 'success');
    } catch (error) {
      showToast('Erro ao exportar Excel', 'error');
    } finally {
      setExportando(false);
    }
  }, [data, sortedLinhas, showToast]);

  const lojasParaFiltro = useMemo(() => {
    if (!filtros) return [];
    return filtros.lojas.map(l => ({
      branch_code: l.branchCode,
      branch_name: l.label,
    }));
  }, [filtros]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Venda do Dia por Classificação</h1>
        <p className="text-sm text-gray-500 mt-1">
          Vendas diárias, semanais e mensais por loja, filtradas por classificação
        </p>
      </div>

      {/* Card de informação */}
      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm text-gray-700">
          <strong>Como funciona:</strong> O relatório traz a venda do dia anterior, a venda acumulada dos
          últimos 7 dias e a venda acumulada do mês (do dia 1 até ontem). Selecione uma classificação
          (Categoria, Linha, Coleção ou Status) e escolha os valores desejados.
        </p>
      </Card>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="block text-xs font-medium text-gray-600 mb-1">Classificar por</label>
          <Select
            options={TIPO_CLASSIFICACAO_OPTIONS}
            value={tipoClassificacao}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTipoClassificacao(e.target.value as VendaDiaTipoClassificacao)}
          />
        </div>

        <div className="w-64">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {TIPO_CLASSIFICACAO_OPTIONS.find(o => o.value === tipoClassificacao)?.label.replace('Por ', '')}
          </label>
          <Select
            options={[{ value: '', label: 'Todas' }, ...classificacaoOpcoes]}
            value={classificacaoValores[0] || ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setClassificacaoValores(e.target.value ? [e.target.value] : [])}
          />
        </div>

        <FilialMultiSelect
          options={lojasParaFiltro.map(l => ({ value: l.branch_code, label: l.branch_name }))}
          selected={branchesSelecionados}
          onChange={setBranchesSelecionados}
          className="w-52"
          label="Lojas"
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none pb-2">
          <input
            type="checkbox"
            checked={agruparLojas}
            onChange={(e) => setAgruparLojas(e.target.checked)}
            className="rounded border-gray-300 text-[var(--bbtk-red)] focus:ring-[var(--bbtk-red)]"
          />
          Agrupar lojas
        </label>

        <Button onClick={carregarDados} isLoading={isLoading}>
          Atualizar
        </Button>

        <Button
          variant="secondary"
          onClick={handleExportExcel}
          isLoading={exportando}
          disabled={!data || data.linhas.length === 0}
        >
          Exportar Excel
        </Button>
      </div>

      {/* KPIs */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard
            title="Estoque Atual"
            value={formatNumber(data.kpis.estoqueTotal)}
            color="blue"
            isLoading={isLoading}
          />
          <KPICard
            title={`Venda ${formatDate(data.dataReferencia)}`}
            value={formatNumber(data.kpis.vendaDiaAnteriorTotal)}
            color="green"
            isLoading={isLoading}
          />
          <KPICard
            title="Venda Semana"
            value={formatNumber(data.kpis.vendaUltimaSemanaTotal)}
            color="purple"
            isLoading={isLoading}
          />
          <KPICard
            title="Venda Mês"
            value={formatNumber(data.kpis.vendaMesTotal)}
            color="red"
            isLoading={isLoading}
          />
        </div>
      )}

      {/* KPIs secundários */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard
            title="Giro Mês"
            value={data.kpis.giroMesTotal !== null ? data.kpis.giroMesTotal.toFixed(1) : '-'}
            color="yellow"
            valueSize="md"
            isLoading={isLoading}
          />
          <KPICard
            title="TM Dia (pç/venda)"
            value={data.kpis.ticketMedioDia !== null ? data.kpis.ticketMedioDia.toFixed(1) : '-'}
            color="blue"
            valueSize="md"
            isLoading={isLoading}
          />
          <KPICard
            title="TM Semana"
            value={data.kpis.ticketMedioSemana !== null ? data.kpis.ticketMedioSemana.toFixed(1) : '-'}
            color="blue"
            valueSize="md"
            isLoading={isLoading}
          />
          <KPICard
            title="TM Mês"
            value={data.kpis.ticketMedioMes !== null ? data.kpis.ticketMedioMes.toFixed(1) : '-'}
            color="blue"
            valueSize="md"
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Período de referência */}
      {data && (
        <div className="text-xs text-gray-500">
          <span className="font-medium">Períodos:</span>{' '}
          Dia: {formatDate(data.dataReferencia)} |{' '}
          Semana: {formatDate(data.periodoSemana.inicio)} a {formatDate(data.periodoSemana.fim)} |{' '}
          Mês: {formatDate(data.periodoMes.inicio)} a {formatDate(data.periodoMes.fim)}
        </div>
      )}

      {/* Tabela + Gráfico lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tabela */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              Vendas por Loja (peças)
              {data && data.classificacaoSelecionada.length > 0 && (
                <span className="font-normal text-gray-500 ml-2">
                  - {TIPO_CLASSIFICACAO_OPTIONS.find(o => o.value === data.tipoClassificacao)?.label.replace('Por ', '')}:{' '}
                  {data.classificacaoSelecionada.join(', ')}
                </span>
              )}
            </CardTitle>
          </CardHeader>

          {erro && (
            <div className="text-red-600 text-sm mb-4">
              Erro: {erro}
            </div>
          )}

          <div className="overflow-x-auto">
            <Table tableClassName="text-sm">
              <TableHead className="sticky top-0 z-10">
                <TableRow>
                  <ThSortPcp
                    label="LOJA"
                    sortKeyName="loja"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="left"
                    title="Ordenar por código da loja"
                  />
                  <ThSortPcp
                    label="ESTQ"
                    sortKeyName="estoqueDiaAnterior"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="right"
                    title="Estoque Dia Anterior"
                  />
                  <ThSortPcp
                    label="DIA"
                    sortKeyName="vendaDiaAnterior"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="right"
                    title="Venda Dia Anterior"
                  />
                  <ThSortPcp
                    label="SEM"
                    sortKeyName="vendaUltimaSemana"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="right"
                    title="Venda Última Semana"
                  />
                  <ThSortPcp
                    label="MÊS"
                    sortKeyName="vendaMes"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="right"
                    title="Venda Mês"
                  />
                  <ThSortPcp
                    label="GIRO"
                    sortKeyName="giroMes"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="right"
                    title="Giro Mês = Vendas / Estoque"
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <div className="animate-pulse text-gray-400">Carregando...</div>
                    </TableCell>
                  </TableRow>
                ) : sortedLinhas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                      Nenhum dado encontrado para os filtros selecionados
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedLinhas.map((linha) => {
                    const isTotal = linha.branchCode === null;
                    return (
                      <TableRow
                        key={linha.branchCode ?? 'total'}
                        isHighlighted={isTotal}
                        className={cn(
                          'hover:bg-gray-50 transition-colors',
                          isTotal && 'font-semibold bg-gray-100'
                        )}
                      >
                        <TableCell>
                          {isTotal ? (
                            <span className="font-bold">TOTAL</span>
                          ) : (
                            cleanBranchName(linha.branchName)
                          )}
                        </TableCell>
                        <TableCell align="right">{formatNumber(linha.estoqueDiaAnterior)}</TableCell>
                        <TableCell align="right">{formatNumber(linha.vendaDiaAnterior)}</TableCell>
                        <TableCell align="right">{formatNumber(linha.vendaUltimaSemana)}</TableCell>
                        <TableCell align="right">{formatNumber(linha.vendaMes)}</TableCell>
                        <TableCell align="right">
                          {linha.giroMes !== null ? linha.giroMes.toFixed(1) : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Gráfico */}
        {data && !agruparLojas && chartData.items.length > 0 && (
          <Card className="lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>
                Venda {chartPeriodo === 'dia' ? 'Dia' : chartPeriodo === 'semana' ? 'Semana' : 'Mês'} por Loja
              </CardTitle>
            </CardHeader>

            {/* Paginador de período */}
            <div className="flex border border-gray-200 rounded-lg overflow-hidden mb-4">
              <button
                onClick={() => setChartPeriodo('dia')}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                  chartPeriodo === 'dia'
                    ? 'bg-[var(--bbtk-purple)] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                DIA
              </button>
              <button
                onClick={() => setChartPeriodo('semana')}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium transition-colors border-l border-r border-gray-200',
                  chartPeriodo === 'semana'
                    ? 'bg-[var(--bbtk-purple)] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                SEMANA
              </button>
              <button
                onClick={() => setChartPeriodo('mes')}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                  chartPeriodo === 'mes'
                    ? 'bg-[var(--bbtk-purple)] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                MÊS
              </button>
            </div>

            <HorizontalBarChart
              data={chartData.items}
              maxValue={chartData.maxValue}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
