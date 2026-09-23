'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, Dispatch, SetStateAction } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { KPICard } from '@/components/dashboard/KPICard';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  PcpClassificacaoDimensao,
  PerformanceColecaoCor,
  PerformanceColecaoMetricas,
  PerformanceColecaoResponse,
  PerformanceColecaoRow,
  PerformanceColecaoTamanho,
  performanceColecaoApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { ExcelColumn, exportToExcel } from '@/lib/exportExcel';
import { ordemGrade } from '@/lib/gradeOrdem';

type SortKey = keyof Omit<PerformanceColecaoRow, 'cores'>;
type MetricaKey = keyof PerformanceColecaoMetricas;

type Coluna<K extends string> = {
  key: K;
  label: string;
  align?: 'left' | 'right' | 'center';
  type?: 'text' | 'number' | 'currency' | 'percent';
  width: number;
};

const COLUNAS_IDENTIDADE: Array<Coluna<'colecao' | 'referenceCode' | 'descricao' | 'categoria' | 'linha'>> = [
  { key: 'colecao', label: 'COLECAO', width: 18, type: 'text' },
  { key: 'referenceCode', label: 'REFERENCIA', width: 16, type: 'text' },
  { key: 'descricao', label: 'DESCRICAO', width: 32, type: 'text' },
  { key: 'categoria', label: 'CATEGORIA', width: 16, type: 'text' },
  { key: 'linha', label: 'LINHA', width: 16, type: 'text' },
];

const COLUNAS_METRICA: Array<Coluna<MetricaKey>> = [
  { key: 'custo', label: 'CUSTO', align: 'right', width: 12, type: 'currency' },
  { key: 'pdvVarejo', label: 'PDV VAREJO', align: 'right', width: 13, type: 'currency' },
  { key: 'markupVarejo', label: 'MKUP VAR', align: 'right', width: 11, type: 'percent' },
  { key: 'pdvAtacado', label: 'PDV ATACADO', align: 'right', width: 14, type: 'currency' },
  { key: 'markupAtacado', label: 'MKUP ATA', align: 'right', width: 11, type: 'percent' },
  { key: 'qtdesLiberadas', label: 'QTDES LIBERADAS', align: 'right', width: 15, type: 'number' },
  { key: 'qtdeEntregue', label: 'QTDE ENTREGUE', align: 'right', width: 14, type: 'number' },
  { key: 'saldoAEntregar', label: 'SALDO A ENTREGAR', align: 'right', width: 15, type: 'number' },
  { key: 'percentEntregue', label: '% ENTREGUE', align: 'right', width: 12, type: 'percent' },
  { key: 'vendaMes1', label: 'VDA 1 MES', align: 'right', width: 12, type: 'number' },
  { key: 'vendaMes2', label: 'VDA 2 MES', align: 'right', width: 12, type: 'number' },
  { key: 'vendaMes3', label: 'VDA 3 MES', align: 'right', width: 12, type: 'number' },
  { key: 'estoqueFinal', label: 'ESTQ FINAL', align: 'right', width: 12, type: 'number' },
  { key: 'giroPeriodo', label: 'GIRO PERIODO', align: 'right', width: 13, type: 'number' },
  { key: 'giroAteHoje', label: 'GIRO ATE HOJE', align: 'right', width: 13, type: 'number' },
  { key: 'totalVendaValor', label: 'TT $ VENDA', align: 'right', width: 14, type: 'currency' },
  { key: 'totalEstoqueCusto', label: 'TT ESTQ $ CUSTO', align: 'right', width: 17, type: 'currency' },
];

const COLUNAS: Array<Coluna<SortKey>> = [...COLUNAS_IDENTIDADE, ...COLUNAS_METRICA];

function defaultDataInicio(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 2);
  date.setDate(1);
  return date.toISOString().split('T')[0];
}

function hoje(): string {
  return new Date().toISOString().split('T')[0];
}

function formatValue(value: unknown, key: SortKey): string {
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'custo' || key === 'pdvVarejo' || key === 'pdvAtacado' || key === 'totalVendaValor' || key === 'totalEstoqueCusto') {
    return formatMoney(Number(value));
  }
  if (key === 'markupVarejo' || key === 'markupAtacado' || key === 'percentEntregue') {
    return `${Number(value).toFixed(1).replace('.', ',')}%`;
  }
  if (key === 'giroAteHoje') return Number(value).toFixed(2).replace('.', ',');
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

function toggle(set: Dispatch<SetStateAction<Set<string>>>, chave: string) {
  set((anterior) => {
    const proximo = new Set(anterior);
    if (proximo.has(chave)) proximo.delete(chave);
    else proximo.add(chave);
    return proximo;
  });
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
  // Busca com debounce: o valor digitado (*Input) fica separado do valor APLICADO,
  // que e o que dispara a consulta. Sem isso cada tecla enfileirava um relatorio
  // pesado no pcp-api (que processa um por vez).
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<PerformanceColecaoResponse | null>(null);
  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [colecoesDisponiveis, setColecoesDisponiveis] = useState<{ valor: string; qtd_skus: number }[]>([]);
  const [lojas, setLojas] = useState<{ branchCode: number; label: string }[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('totalVendaValor');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [referenciasAbertas, setReferenciasAbertas] = useState<Set<string>>(new Set());
  const [coresAbertas, setCoresAbertas] = useState<Set<string>>(new Set());
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
    const timer = setTimeout(() => setSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

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
    const acc = rowsOrdenadas.reduce(
      (acc, row) => {
        acc.qtdesLiberadas += row.qtdesLiberadas;
        acc.qtdeEntregue += row.qtdeEntregue;
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
      { qtdesLiberadas: 0, qtdeEntregue: 0, vendaMes1: 0, vendaMes2: 0, vendaMes3: 0, valorMes1: 0, valorMes2: 0, valorMes3: 0, estoqueFinal: 0, totalVendaValor: 0, totalVendaCusto: 0, totalEstoqueCusto: 0, totalEstoqueVenda: 0 }
    );
    const saldoAEntregar = Math.max(acc.qtdesLiberadas - acc.qtdeEntregue, 0);
    const percentEntregue = acc.qtdesLiberadas > 0 ? (acc.qtdeEntregue / acc.qtdesLiberadas) * 100 : null;
    return { ...acc, saldoAEntregar, percentEntregue };
  }, [rowsOrdenadas]);

  const resumoProducaoColecao = data?.resumoProducao || {
    valorTotal: 0,
    custoTotal: 0,
    markup: null,
    pecas: 0,
    precoVendaMedio: null,
    precoCustoMedio: null,
  };

  const linhasResumoProducao = [
    { label: 'Valor Total da Colecao', currency: true, value: formatNumber(resumoProducaoColecao.valorTotal, 2) },
    { label: 'Custo Total da Colecao', currency: true, value: formatNumber(resumoProducaoColecao.custoTotal, 2) },
    { label: 'Markup da Colecao', currency: false, value: resumoProducaoColecao.markup === null ? '-' : formatNumber(resumoProducaoColecao.markup, 2) },
    { label: 'Pecas', currency: false, value: formatNumber(resumoProducaoColecao.pecas, 0) },
    { label: 'Preco de Venda Medio', currency: true, value: resumoProducaoColecao.precoVendaMedio === null ? '-' : formatNumber(resumoProducaoColecao.precoVendaMedio, 2) },
    { label: 'Preco de Custo Medio', currency: true, value: resumoProducaoColecao.precoCustoMedio === null ? '-' : formatNumber(resumoProducaoColecao.precoCustoMedio, 2) },
  ];


  const resumoFinal = useMemo(() => {
    const meses = data?.resumoMensal || [];
    const totalPecasVendidas = meses.reduce((sum, row) => sum + row.pecasVendidasColecao, 0);
    const totalEntregue = meses.reduce((sum, row) => sum + row.qtdeEntregue, 0);
    const totalVendaColecaoValor = meses.reduce((sum, row) => sum + row.vendaColecaoValor, 0);
    const totalVendaTotalPecas = meses.reduce((sum, row) => sum + row.vendaTotalPecas, 0);
    const ultimoMes = meses[meses.length - 1];
    const estoqueFinal = ultimoMes?.estoqueFinal || 0;
    const estoqueValorCusto = ultimoMes?.estoqueValorCusto || 0;
    const estoqueValorVenda = ultimoMes?.estoqueValorVenda || 0;
    const baseGiro = totalPecasVendidas + estoqueFinal;

    return {
      meses,
      total: {
        qtdeEntregue: totalEntregue,
        pecasVendidasColecao: totalPecasVendidas,
        estoqueFinal,
        estoqueValorCusto,
        estoqueValorVenda,
        markupEstoque: estoqueValorCusto > 0 ? estoqueValorVenda / estoqueValorCusto : null,
        giroPecasPercent: baseGiro > 0 ? (totalPecasVendidas / baseGiro) * 100 : 0,
        vendaColecaoValor: totalVendaColecaoValor,
        vendaTotalPecas: totalVendaTotalPecas,
        participacaoColecaoPecasPercent: totalVendaTotalPecas > 0 ? (totalPecasVendidas / totalVendaTotalPecas) * 100 : 0,
      },
    };
  }, [data?.resumoMensal]);
  function exportarExcel() {
    if (!data || rowsOrdenadas.length === 0) return;

    // Exporta no grao mais fino (1 linha por referencia+cor+tamanho) - mais util numa
    // planilha do que so o resumo por referencia que a tela mostra fechada por padrao.
    const linhas: Record<string, unknown>[] = [];
    for (const row of rowsOrdenadas) {
      for (const cor of row.cores) {
        const tamanhosOrdenados = [...cor.tamanhos].sort((a, b) => ordemGrade(a.tamanho) - ordemGrade(b.tamanho));
        for (const tamanho of tamanhosOrdenados) {
          linhas.push({
            colecao: row.colecao,
            referenceCode: row.referenceCode,
            descricao: row.descricao,
            categoria: row.categoria,
            linha: row.linha,
            cor: cor.cor,
            ...tamanho,
          });
        }
      }
    }

    const columns: ExcelColumn[] = [
      ...COLUNAS_IDENTIDADE.map((coluna) => ({ key: coluna.key, header: coluna.label, width: coluna.width, type: coluna.type })),
      { key: 'cor', header: 'COR', width: 14, type: 'text' as const },
      { key: 'tamanho', header: 'TAMANHO', width: 10, type: 'text' as const },
      ...COLUNAS_METRICA.map((coluna) => ({
        key: coluna.key,
        header: coluna.label,
        width: coluna.width,
        type: coluna.type === 'currency' || coluna.type === 'percent' || coluna.type === 'number' || coluna.type === 'text' ? coluna.type : undefined,
      })),
    ];

    exportToExcel({
      filename: `Performance_Colecao_${dataInicio}_${dataFim}`,
      sheetName: 'Performance',
      title: `Performance Colecao - ${formatDate(dataInicio)} a ${formatDate(dataFim)}`,
      columns,
      data: linhas,
      totals: {
        colecao: `TOTAL (${rowsOrdenadas.length} refs)`,
        qtdesLiberadas: totais.qtdesLiberadas,
        qtdeEntregue: totais.qtdeEntregue,
        saldoAEntregar: totais.saldoAEntregar,
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
          <Input label="Buscar" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Referencia ou descricao" />
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard title="Referencias" value={formatNumber(data?.kpis.referencias || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Venda no periodo" value={formatMoney(data?.kpis.totalVendaValor || 0)} subtitle={`${formatNumber(data?.kpis.qtdeVendida || 0)} peças vendidas`} color="green" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Part. colecao" value={`${(data?.kpis.participacaoColecaoPercent || 0).toFixed(1)}%`} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Qtdes liberadas" value={formatNumber(data?.kpis.qtdesLiberadas || 0)} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Qtde entregue" value={formatNumber(data?.kpis.qtdeEntregue || 0)} subtitle={data?.kpis.percentEntregue === null || data?.kpis.percentEntregue === undefined ? undefined : `${data.kpis.percentEntregue.toFixed(1)}% entregue`} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Saldo a entregar" value={formatNumber(data?.kpis.saldoAEntregar || 0)} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title={data ? `Estoque em ${formatDate(data.periodo.dataFim)}` : 'Estoque final'} value={formatNumber(data?.kpis.estoqueFinal || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro no periodo" value={formatNumber(data?.kpis.giroPeriodo || 0)} subtitle="peças vendidas" color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro ate hoje" value={data?.kpis.giroAteHoje === null || data?.kpis.giroAteHoje === undefined ? '-' : data.kpis.giroAteHoje.toFixed(2).replace('.', ',')} subtitle="vendido/estoque atual" color="purple" valueSize="sm" isLoading={isLoading} />
      </div>
      <p className="text-xs text-gray-500">
        Qtdes liberadas/entregue/saldo consideram OPs abertas ate a data fim escolhida, mas as quantidades finalizadas refletem o estado atual da producao (nao ha historico diario de OP pra reconstruir "como estava" numa data passada).
      </p>
      <Card className="max-w-md overflow-hidden !p-0">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {linhasResumoProducao.map((row, index) => (
              <tr key={row.label} className={index < 3 ? 'bg-gray-50' : 'bg-white'}>
                <td className="border border-gray-300 px-2 py-1 font-bold text-gray-900">{row.label}</td>
                <td className="w-12 border border-gray-300 px-2 py-1 text-center font-bold text-gray-900">{row.currency ? 'R$' : ''}</td>
                <td className="w-32 border border-gray-300 px-2 py-1 text-right font-bold text-gray-900">{isLoading || !data ? '-' : row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <LoadingOverlay active={isLoading}>
      <Card>
        <CardHeader>
          <CardTitle>Resumo final</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-[1320px] w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-900">
                <th className="border border-gray-300 px-3 py-2 text-left">Meses</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Qtde entregue</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Pcs vendidas</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Qtde de sobra</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Estoque custo</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Estoque venda</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Markup estoque</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Giro em pecas</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Venda colecao mes</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Venda total mes (pcs)</th>
                <th className="border border-gray-300 px-3 py-2 text-right">Part. colecao na venda total</th>
              </tr>
            </thead>
            <tbody>
              {resumoFinal.meses.map((row) => (
                <tr key={row.mes}>
                  <td className="border border-gray-300 bg-blue-100 px-3 py-2 font-semibold text-gray-900">Vendas {row.mes}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(row.qtdeEntregue)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(row.pecasVendidasColecao)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right" title={`Estoque em ${formatDate(row.dataEstoque)}`}>{formatNumber(row.estoqueFinal)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatMoney(row.estoqueValorCusto)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatMoney(row.estoqueValorVenda)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{row.markupEstoque === null ? '-' : row.markupEstoque.toFixed(2).replace('.', ',')}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right font-semibold">{row.giroPecasPercent.toFixed(1)}%</td>
                  <td className="border border-gray-300 bg-green-50 px-3 py-2 text-right">{formatMoney(row.vendaColecaoValor)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(row.vendaTotalPecas)}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right font-semibold">{row.participacaoColecaoPecasPercent.toFixed(1)}%</td>
                </tr>
              ))}
              <tr className="bg-blue-100 font-bold text-gray-900">
                <td className="border border-gray-300 px-3 py-2">TOTAL</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(resumoFinal.total.qtdeEntregue)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(resumoFinal.total.pecasVendidasColecao)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(resumoFinal.total.estoqueFinal)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{formatMoney(resumoFinal.total.estoqueValorCusto)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{formatMoney(resumoFinal.total.estoqueValorVenda)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.total.markupEstoque === null ? '-' : resumoFinal.total.markupEstoque.toFixed(2).replace('.', ',')}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.total.giroPecasPercent.toFixed(1)}%</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{formatMoney(resumoFinal.total.vendaColecaoValor)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{formatNumber(resumoFinal.total.vendaTotalPecas)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right">{resumoFinal.total.participacaoColecaoPecasPercent.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      </LoadingOverlay>

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
                  {rowsOrdenadas.map((row) => {
                    const chaveRef = `${row.colecao || 'sem-colecao'}-${row.referenceCode}`;
                    const refAberta = referenciasAbertas.has(chaveRef);
                    return (
                      <Fragment key={chaveRef}>
                        <TableRow>
                          {COLUNAS.map((coluna, idx) => (
                            <TableCell key={coluna.key} align={coluna.align} className="whitespace-nowrap !px-2 !py-2">
                              {idx === 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggle(setReferenciasAbertas, chaveRef)}
                                  className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded border border-gray-300 text-[10px] font-bold text-gray-600 hover:bg-gray-100"
                                  title={refAberta ? 'Recolher cores' : 'Expandir por cor'}
                                >
                                  {refAberta ? '−' : '+'}
                                </button>
                              )}
                              {coluna.key === 'descricao' ? (
                                <span className="block max-w-[260px] truncate" title={row.descricao}>{row.descricao}</span>
                              ) : (
                                formatValue(row[coluna.key], coluna.key)
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                        {refAberta && row.cores.map((cor: PerformanceColecaoCor) => {
                          const chaveCor = `${chaveRef}|${cor.cor}`;
                          const corAberta = coresAbertas.has(chaveCor);
                          return (
                            <Fragment key={chaveCor}>
                              <TableRow className="bg-gray-50">
                                <TableCell colSpan={COLUNAS_IDENTIDADE.length} className="whitespace-nowrap !px-2 !py-2 pl-6 font-medium text-gray-700">
                                  <button
                                    type="button"
                                    onClick={() => toggle(setCoresAbertas, chaveCor)}
                                    className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded border border-gray-300 text-[10px] font-bold text-gray-600 hover:bg-gray-100"
                                    title={corAberta ? 'Recolher tamanhos' : 'Expandir por tamanho'}
                                  >
                                    {corAberta ? '−' : '+'}
                                  </button>
                                  Cor: {cor.cor}
                                </TableCell>
                                {COLUNAS_METRICA.map((coluna) => (
                                  <TableCell key={coluna.key} align={coluna.align} className="whitespace-nowrap !px-2 !py-2">
                                    {formatValue(cor[coluna.key], coluna.key)}
                                  </TableCell>
                                ))}
                              </TableRow>
                              {corAberta && [...cor.tamanhos]
                                .sort((a, b) => ordemGrade(a.tamanho) - ordemGrade(b.tamanho))
                                .map((tamanho: PerformanceColecaoTamanho) => (
                                  <TableRow key={`${chaveCor}|${tamanho.tamanho}`} className="bg-gray-50/60">
                                    <TableCell colSpan={COLUNAS_IDENTIDADE.length} className="whitespace-nowrap !px-2 !py-2 pl-10 text-gray-500">
                                      Tamanho: {tamanho.tamanho}
                                    </TableCell>
                                    {COLUNAS_METRICA.map((coluna) => (
                                      <TableCell key={coluna.key} align={coluna.align} className="whitespace-nowrap !px-2 !py-2">
                                        {formatValue(tamanho[coluna.key], coluna.key)}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  <TableRow isHighlighted className="sticky bottom-0 z-20 bg-yellow-50 shadow-[0_-1px_0_rgba(148,163,184,0.35)]">
                    <TableCell colSpan={10} className="font-bold">TOTAL ({rowsOrdenadas.length} refs)</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.qtdesLiberadas)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.qtdeEntregue)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.saldoAEntregar)}</TableCell>
                    <TableCell align="right" className="font-bold">{totais.percentEntregue === null ? '-' : `${totais.percentEntregue.toFixed(1)}%`}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.vendaMes1)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.vendaMes2)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.vendaMes3)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.estoqueFinal)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.vendaMes1 + totais.vendaMes2 + totais.vendaMes3)}</TableCell>
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
