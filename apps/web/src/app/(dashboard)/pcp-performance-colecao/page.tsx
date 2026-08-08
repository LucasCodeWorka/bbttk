'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { KPICard } from '@/components/dashboard/KPICard';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  PcpClassificacaoDimensao,
  PerformanceColecaoResponse,
  PerformanceColecaoRow,
  performanceColecaoApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { ExcelColumn, exportToExcel } from '@/lib/exportExcel';

type SortKey = keyof PerformanceColecaoRow;

const COLUNAS: Array<{
  key: SortKey;
  label: string;
  align?: 'left' | 'right' | 'center';
  type?: 'text' | 'number' | 'currency' | 'percent';
  width: number;
}> = [
  { key: 'grupo', label: 'GRUPO', width: 18, type: 'text' },
  { key: 'referenceCode', label: 'REFERENCIA', width: 16, type: 'text' },
  { key: 'descricao', label: 'DESCRICAO', width: 32, type: 'text' },
  { key: 'categoria', label: 'CATEGORIA', width: 16, type: 'text' },
  { key: 'linha', label: 'LINHA', width: 16, type: 'text' },
  { key: 'custo', label: 'CUSTO', align: 'right', width: 12, type: 'currency' },
  { key: 'pdvVarejo', label: 'PDV VAREJO', align: 'right', width: 13, type: 'currency' },
  { key: 'markupVarejo', label: 'MKUP VAR', align: 'right', width: 11, type: 'number' },
  { key: 'pdvAtacado', label: 'PDV ATACADO', align: 'right', width: 14, type: 'currency' },
  { key: 'markupAtacado', label: 'MKUP ATA', align: 'right', width: 11, type: 'number' },
  { key: 'entrouDpa', label: 'ENTROU DPA', align: 'center', width: 13, type: 'text' },
  { key: 'qtdeProduzida', label: 'QTDE PRODUZIDA', align: 'right', width: 15, type: 'number' },
  { key: 'vendaMes1', label: 'VDA 1 MES', align: 'right', width: 12, type: 'number' },
  { key: 'vendaMes2', label: 'VDA 2 MES', align: 'right', width: 12, type: 'number' },
  { key: 'vendaMes3', label: 'VDA 3 MES', align: 'right', width: 12, type: 'number' },
  { key: 'estoqueFinal', label: 'ESTQ FINAL', align: 'right', width: 12, type: 'number' },
  { key: 'giro', label: 'GIRO', align: 'right', width: 10, type: 'number' },
  { key: 'totalVendaValor', label: 'TT $ VENDA', align: 'right', width: 14, type: 'currency' },
  { key: 'totalEstoqueCusto', label: 'TT ESTQ $ CUSTO', align: 'right', width: 17, type: 'currency' },
];

function defaultDataInicio(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 2);
  date.setDate(1);
  return date.toISOString().split('T')[0];
}

function hoje(): string {
  return new Date().toISOString().split('T')[0];
}

function formatCell(row: PerformanceColecaoRow, key: SortKey): string {
  const value = row[key];
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'entrouDpa') return formatDate(String(value));
  if (key === 'custo' || key === 'pdvVarejo' || key === 'pdvAtacado' || key === 'totalVendaValor' || key === 'totalEstoqueCusto') {
    return formatMoney(Number(value));
  }
  if (key === 'markupVarejo' || key === 'markupAtacado') return Number(value).toFixed(2).replace('.', ',');
  if (key === 'giro') return Number(value).toFixed(2).replace('.', ',');
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

function ThSort({
  coluna,
  sortKey,
  sortDir,
  onSort,
}: {
  coluna: (typeof COLUNAS)[number];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === coluna.key;
  return (
    <TableCell
      isHeader
      align={coluna.align}
      onClick={() => onSort(coluna.key)}
      className="cursor-pointer select-none whitespace-nowrap bg-gray-50 hover:bg-gray-100 !px-2 !py-2"
    >
      <span className={cn('flex items-center gap-1.5', coluna.align === 'right' && 'justify-end', coluna.align === 'center' && 'justify-center')}>
        <span>{coluna.label}</span>
        <span className={active ? 'text-[var(--bbtk-purple)]' : 'text-gray-300'}>{active && sortDir === 'desc' ? 'v' : '^'}</span>
      </span>
    </TableCell>
  );
}

export default function PcpPerformanceColecaoPage() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [dataInicio, setDataInicio] = useState(defaultDataInicio);
  const [dataFim, setDataFim] = useState(hoje);
  const [colecao, setColecao] = useState<string[]>([]);
  const [branches, setBranches] = useState<number[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<PerformanceColecaoResponse | null>(null);
  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [colecoesDisponiveis, setColecoesDisponiveis] = useState<{ valor: string; qtd_skus: number }[]>([]);
  const [lojas, setLojas] = useState<{ branchCode: number; label: string }[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('totalVendaValor');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const tabelaScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    if (!token) return;
    performanceColecaoApi
      .getFiltros(token)
      .then((response) => {
        setColecoesDisponiveis(response.colecoes);
        setClassificacoes(response.classificacoes);
        setLojas(response.lojas);
      })
      .catch((error) => {
        showToast('Erro ao carregar filtros de Performance Colecao', 'error');
        console.error(error);
      });
  }, [token, showToast]);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await performanceColecaoApi.getPerformance(token, {
        dataInicio,
        dataFim,
        colecao: colecao.length ? colecao : undefined,
        branches: branches.length ? branches : undefined,
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
        search: search.trim() || undefined,
      });
      setData(response);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao carregar Performance Colecao', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, dataInicio, dataFim, colecao, branches, produtoFiltro, search, showToast]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);


  function atualizarProdutoFiltro(chave: string, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const rowsOrdenadas = useMemo(() => {
    const rows = data?.rows || [];
    return [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  useEffect(() => {
    const tabela = tabelaScrollRef.current;
    const topo = topScrollRef.current;
    if (!tabela || !topo) return;

    let frame = 0;
    const atualizarLargura = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setScrollWidth(tabela.scrollWidth);
        topo.scrollLeft = tabela.scrollLeft;
      });
    };

    const sincronizarTopo = () => {
      topo.scrollLeft = tabela.scrollLeft;
    };

    tabela.addEventListener('scroll', sincronizarTopo, { passive: true });
    atualizarLargura();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(atualizarLargura) : null;
    resizeObserver?.observe(tabela);
    window.addEventListener('resize', atualizarLargura);

    return () => {
      cancelAnimationFrame(frame);
      tabela.removeEventListener('scroll', sincronizarTopo);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', atualizarLargura);
    };
  }, [rowsOrdenadas.length, isLoading]);

  function sincronizarScrollPeloTopo() {
    const topo = topScrollRef.current;
    const tabela = tabelaScrollRef.current;
    if (!topo || !tabela) return;
    tabela.scrollLeft = topo.scrollLeft;
  }
  const totais = useMemo(() => {
    return rowsOrdenadas.reduce(
      (acc, row) => {
        acc.qtdeProduzida += row.qtdeProduzida;
        acc.vendaMes1 += row.vendaMes1;
        acc.vendaMes2 += row.vendaMes2;
        acc.vendaMes3 += row.vendaMes3;
        acc.valorMes1 += row.valorMes1;
        acc.valorMes2 += row.valorMes2;
        acc.valorMes3 += row.valorMes3;
        acc.estoqueFinal += row.estoqueFinal;
        acc.totalVendaValor += row.totalVendaValor;
        acc.totalVendaCusto += row.totalVendaCusto;
        acc.totalEstoqueCusto += row.totalEstoqueCusto;
        acc.totalEstoqueVenda += row.totalEstoqueVenda;
        return acc;
      },
      { qtdeProduzida: 0, vendaMes1: 0, vendaMes2: 0, vendaMes3: 0, valorMes1: 0, valorMes2: 0, valorMes3: 0, estoqueFinal: 0, totalVendaValor: 0, totalVendaCusto: 0, totalEstoqueCusto: 0, totalEstoqueVenda: 0 }
    );
  }, [rowsOrdenadas]);


  const resumoFinal = useMemo(() => {
    const meses = data?.periodo.meses || ['Mes 1', 'Mes 2', 'Mes 3'];
    const vendaMeses = [
      { label: `Vendas ${meses[0] || '1o Mes'}`, quantidade: totais.vendaMes1, valor: totais.valorMes1 },
      { label: `Vendas ${meses[1] || '2o Mes'}`, quantidade: totais.vendaMes2, valor: totais.valorMes2 },
      { label: `Vendas ${meses[2] || '3o Mes'}`, quantidade: totais.vendaMes3, valor: totais.valorMes3 },
    ];
    const totalPecasVendidas = totais.vendaMes1 + totais.vendaMes2 + totais.vendaMes3;
    const totalValorVendido = totais.valorMes1 + totais.valorMes2 + totais.valorMes3;
    const basePecas = totalPecasVendidas + totais.estoqueFinal;
    const baseValorVenda = totalValorVendido + totais.totalEstoqueVenda;
    const baseValorCusto = totais.totalVendaCusto + totais.totalEstoqueCusto;
    let acumulado = 0;

    return {
      meses: vendaMeses.map((mes) => {
        acumulado += mes.quantidade;
        return {
          ...mes,
          percentualPecas: basePecas > 0 ? (mes.quantidade / basePecas) * 100 : 0,
          sobra: Math.max(totais.qtdeProduzida - acumulado, 0),
          percentualValor: baseValorVenda > 0 ? (mes.valor / baseValorVenda) * 100 : 0,
        };
      }),
      total: {
        quantidade: totalPecasVendidas,
        percentualPecas: basePecas > 0 ? (totalPecasVendidas / basePecas) * 100 : 0,
        sobra: totais.estoqueFinal,
        valor: totalValorVendido,
        percentualValor: baseValorVenda > 0 ? (totalValorVendido / baseValorVenda) * 100 : 0,
      },
      sobra: {
        quantidade: totais.estoqueFinal,
        valorCusto: totais.totalEstoqueCusto,
        valorVenda: totais.totalEstoqueVenda,
        percentualQuantidade: basePecas > 0 ? (totais.estoqueFinal / basePecas) * 100 : 0,
        percentualCusto: baseValorCusto > 0 ? (totais.totalEstoqueCusto / baseValorCusto) * 100 : 0,
        percentualVenda: baseValorVenda > 0 ? (totais.totalEstoqueVenda / baseValorVenda) * 100 : 0,
      },
    };
  }, [data?.periodo.meses, totais]);
  function exportarExcel() {
    if (!data || rowsOrdenadas.length === 0) return;
    const columns: ExcelColumn[] = COLUNAS.map((coluna) => ({
      key: coluna.key,
      header: coluna.label,
      width: coluna.width,
      type: coluna.type === 'currency' || coluna.type === 'percent' || coluna.type === 'number' || coluna.type === 'text' ? coluna.type : undefined,
    }));

    exportToExcel({
      filename: `Performance_Colecao_${dataInicio}_${dataFim}`,
      sheetName: 'Performance',
      title: `Performance Colecao - ${formatDate(dataInicio)} a ${formatDate(dataFim)}`,
      columns,
      data: rowsOrdenadas as unknown as Record<string, unknown>[],
      totals: {
        grupo: `TOTAL (${rowsOrdenadas.length} refs)`,
        qtdeProduzida: totais.qtdeProduzida,
        vendaMes1: totais.vendaMes1,
        vendaMes2: totais.vendaMes2,
        vendaMes3: totais.vendaMes3,
        estoqueFinal: totais.estoqueFinal,
        totalVendaValor: totais.totalVendaValor,
        totalEstoqueCusto: totais.totalEstoqueCusto,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Performance Colecao</h1>
          <p className="text-gray-500 text-sm mt-1">
            Venda, producao, estoque e giro por referencia no periodo selecionado
          </p>
        </div>
        <Button onClick={exportarExcel} disabled={!data || rowsOrdenadas.length === 0 || isLoading} variant="secondary">
          Exportar Excel
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Input label="Data inicio" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <Input label="Data fim" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          <ClassificacaoMultiSelect
            label="Colecao"
            options={colecoesDisponiveis.map((option) => ({ value: option.valor, label: option.valor, meta: formatNumber(option.qtd_skus) }))}
            selected={colecao}
            onChange={setColecao}
            className="w-full"
          />
          <FilialMultiSelect
            label="Lojas"
            options={lojas.map((loja) => ({ value: loja.branchCode, label: loja.label }))}
            selected={branches}
            onChange={setBranches}
            className="w-full"
          />
          <Input label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Referencia ou descricao" />
          <div className="flex items-end">
            <Button onClick={carregarDados} isLoading={isLoading} className="w-full">Atualizar</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {classificacoes
            .filter((dim) => dim.chave === 'categoria' || dim.chave === 'linha' || dim.chave === 'genero' || dim.chave === 'status')
            .map((dim) => (
              <ClassificacaoMultiSelect
                key={dim.chave}
                label={dim.label}
                options={dim.opcoes.map((option) => ({ value: option.valor, label: option.valor, meta: formatNumber(option.qtd_skus) }))}
                selected={produtoFiltro[dim.chave] || []}
                onChange={(valores) => atualizarProdutoFiltro(dim.chave, valores)}
                className="w-44"
              />
            ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KPICard title="Referencias" value={formatNumber(data?.kpis.referencias || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Venda no periodo" value={formatMoney(data?.kpis.totalVendaValor || 0)} color="green" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Part. colecao" value={`${(data?.kpis.participacaoColecaoPercent || 0).toFixed(1)}%`} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Qtde produzida" value={formatNumber(data?.kpis.qtdeProduzida || 0)} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Estoque final" value={formatNumber(data?.kpis.estoqueFinal || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro medio" value={data?.kpis.giroMedioPercent === null || data?.kpis.giroMedioPercent === undefined ? '-' : data.kpis.giroMedioPercent.toFixed(2).replace('.', ',')} color="purple" valueSize="sm" isLoading={isLoading} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Resumo final</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-5">
          <div className="overflow-x-auto">
            <table className="min-w-[620px] w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-900">
                  <th className="border border-gray-300 px-3 py-2 text-left">Meses</th>
                  <th className="border border-gray-300 px-3 py-2 text-right">%</th>
                  <th className="border border-gray-300 px-3 py-2 text-right">Pcs vendidas</th>
                  <th className="border border-gray-300 px-3 py-2 text-right">Qtde de sobra</th>
                  <th className="border border-gray-300 px-3 py-2 text-right">Total do mes</th>
                  <th className="border border-gray-300 px-3 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {resumoFinal.meses.map((row) => (
                  <tr key={row.label}>
                    <td className="border border-gray-300 bg-blue-100 px-3 py-2 font-semibold text-gray-900">{row.label}</td>
                    <td className="border border-gray-300 px-3 py-2 text-right font-semibold">{row.percentualPecas.toFixed(0)}%</td>
                    <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(row.quantidade)}</td>
                    <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(row.sobra)}</td>
                    <td className="border border-gray-300 bg-green-50 px-3 py-2 text-right">{formatMoney(row.valor)}</td>
                    <td className="border border-gray-300 px-3 py-2 text-right font-semibold">{row.percentualValor.toFixed(0)}%</td>
                  </tr>
                ))}
                <tr className="bg-blue-100 font-bold text-gray-900">
                  <td className="border border-gray-300 px-3 py-2">TOTAL</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.total.percentualPecas.toFixed(0)}%</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(resumoFinal.total.quantidade)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(resumoFinal.total.sobra)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatMoney(resumoFinal.total.valor)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.total.percentualValor.toFixed(0)}%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto self-start">
            <table className="min-w-[460px] w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th colSpan={3} className="border border-gray-300 bg-gray-100 px-3 py-2 text-center uppercase text-gray-900">Sobra de estoque</th>
                </tr>
                <tr className="bg-blue-100 text-gray-900">
                  <th className="border border-gray-300 px-3 py-2 text-right">Qtde</th>
                  <th className="border border-gray-300 px-3 py-2 text-right">Valor custo</th>
                  <th className="border border-gray-300 px-3 py-2 text-right">Valor de venda</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-gray-300 px-3 py-2 text-right text-lg">{formatNumber(resumoFinal.sobra.quantidade)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right text-lg">{formatMoney(resumoFinal.sobra.valorCusto)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right text-lg">{formatMoney(resumoFinal.sobra.valorVenda)}</td>
                </tr>
                <tr className="bg-blue-50 font-bold">
                  <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.sobra.percentualQuantidade.toFixed(2)}%</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.sobra.percentualCusto.toFixed(2)}%</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.sobra.percentualVenda.toFixed(2)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detalhamento</CardTitle>
          {data && (
            <p className="text-xs text-gray-500">
              {formatDate(data.periodo.dataInicio)} a {formatDate(data.periodo.dataFim)} | {rowsOrdenadas.length} referencias
            </p>
          )}
        </CardHeader>

        <div ref={topScrollRef} onScroll={sincronizarScrollPeloTopo} className="mb-2 overflow-x-auto overflow-y-hidden">
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <Table ref={tabelaScrollRef} className="scrollbar-x-hidden max-h-[760px] overflow-auto" tableClassName="text-[10px] lg:text-xs min-w-[1900px]">
            <TableHead className="sticky top-0 z-10">
              <TableRow>
                {COLUNAS.map((coluna) => (
                  <ThSort key={coluna.key} coluna={coluna} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">Carregando...</TableCell>
                </TableRow>
              ) : rowsOrdenadas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">Nenhuma referencia encontrada</TableCell>
                </TableRow>
              ) : (
                <>
                  {rowsOrdenadas.map((row) => (
                    <TableRow key={`${row.grupo || 'sem-grupo'}-${row.referenceCode}`}>
                      {COLUNAS.map((coluna) => (
                        <TableCell key={coluna.key} align={coluna.align} className="whitespace-nowrap !px-2 !py-2">
                          {coluna.key === 'descricao' ? (
                            <span className="block max-w-[260px] truncate" title={row.descricao}>{row.descricao}</span>
                          ) : (
                            formatCell(row, coluna.key)
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow isHighlighted className="sticky bottom-0 z-20 bg-yellow-50 shadow-[0_-1px_0_rgba(148,163,184,0.35)]">
                    <TableCell colSpan={11} className="font-bold">TOTAL ({rowsOrdenadas.length} refs)</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.qtdeProduzida)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.vendaMes1)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.vendaMes2)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.vendaMes3)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.estoqueFinal)}</TableCell>
                    <TableCell align="right" className="font-bold">-</TableCell>
                    <TableCell align="right" className="font-bold">{formatMoney(totais.totalVendaValor)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatMoney(totais.totalEstoqueCusto)}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
      </Card>
    </div>
  );
}
