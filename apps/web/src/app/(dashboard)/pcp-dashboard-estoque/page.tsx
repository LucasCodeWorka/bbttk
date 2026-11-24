'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge } from '@/components/ui/Badge';
import { BarChart } from '@/components/charts/BarChart';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { Input } from '@/components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { useAuth } from '@/contexts/AuthContext';
import { ExcelColumn, exportToExcel } from '@/lib/exportExcel';
import { DashboardEstoqueBucket, DashboardEstoqueProdutoSugestao, DashboardEstoqueReferencia, DashboardEstoqueResponse, DashboardEstoqueSaldoTipo, PcpClassificacaoDimensao, PcpLojaFiltro, pcpApi } from '@/lib/pcpApi';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';

const FILTROS_OCULTOS = new Set(['grupo', 'campanha', 'motorPromocional']);
const FILTROS_PRIORITARIOS = ['colecao', 'linha', 'categoria', 'genero', 'status', 'lancamento', 'modelo', 'tecido', 'tipo'];
type SortDir = 'asc' | 'desc';
type SortKey = 'referencia' | 'descricao' | 'colecao' | 'linha' | 'categoria' | 'quantidade' | 'custo' | 'valorCusto' | 'participacao' | 'valorVarejo' | 'valorAtacado' | `saldo-${number}`;

// Devolutiva 13/11: a tela abre no estoque do dia anterior, igual a Visao Geral.
// Data LOCAL (nao toISOString, que e UTC e vira o dia seguinte depois das 21h).
function getOntem(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPercent(value: number) {
  return `${formatNumber(value, 2)}%`;
}

function participacao(valor: number, total: number) {
  return total > 0 ? (valor / total) * 100 : 0;
}

const GRAFICOS: Array<{ key: keyof DashboardEstoqueResponse['graficos']; title: string; color: string }> = [
  { key: 'filial', title: 'Estoque por filial', color: 'var(--bbtk-blue)' },
  { key: 'linha', title: 'Estoque por linha', color: 'var(--bbtk-green)' },
  { key: 'categoria', title: 'Estoque por categoria', color: 'var(--bbtk-orange)' },
  { key: 'status', title: 'Estoque por status', color: 'var(--bbtk-purple)' },
  { key: 'colecao', title: 'Estoque por colecao', color: 'var(--bbtk-red)' },
];

function ChartCard({ title, data, color }: { title: string; data: DashboardEstoqueBucket[]; color: string }) {
  const chartData = data.map((item) => ({
    name: item.label,
    value: item.quantidade,
    displayValue: `${formatNumber(item.quantidade)} (${formatNumber(item.pctQuantidade, 1)}%)`,
    color,
  }));

  return (
    <Card className="flex h-[360px] flex-col overflow-hidden">
      <CardHeader>
        <CardTitle size="xs">{title}</CardTitle>
      </CardHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <BarChart data={chartData} horizontal formatValue={(value) => formatNumber(value)} />
      </div>
    </Card>
  );
}

function atualizacaoLabel(value: string | null) {
  if (!value) return 'Sem snapshot';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function saldoQuantidade(saldos: DashboardEstoqueSaldoTipo[], stockCode: number) {
  return saldos.find((saldo) => saldo.stockCode === stockCode)?.quantidade || 0;
}

function sortValue(item: DashboardEstoqueReferencia, key: SortKey): string | number {
  if (key.startsWith('saldo-')) return saldoQuantidade(item.saldos, Number(key.replace('saldo-', '')));
  switch (key) {
    case 'referencia':
    case 'descricao':
    case 'colecao':
    case 'linha':
    case 'categoria':
      return (item[key] || '').toString().toLocaleLowerCase('pt-BR');
    case 'custo':
      return item.custo ?? 0;
    case 'quantidade':
      return item.quantidade;
    case 'valorCusto':
    case 'participacao':
      return item.valorCusto;
    case 'valorVarejo':
      return item.valorVarejo;
    case 'valorAtacado':
      return item.valorAtacado;
    default:
      return 0;
  }
}

function ProdutoMultiSelect({
  token,
  selected,
  onChange,
}: {
  token: string | null;
  selected: DashboardEstoqueProdutoSugestao[];
  onChange: (selected: DashboardEstoqueProdutoSugestao[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const [sugestoes, setSugestoes] = useState<DashboardEstoqueProdutoSugestao[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPosicao({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 360) });
  }, [open, selected.length]);

  useEffect(() => {
    if (!token || busca.trim().length < 2) {
      setSugestoes([]);
      return;
    }

    const handle = window.setTimeout(() => {
      setIsLoading(true);
      pcpApi.getProdutosDashboardEstoque(token, busca)
        .then((response) => setSugestoes(response.produtos))
        .catch(() => setSugestoes([]))
        .finally(() => setIsLoading(false));
    }, 250);

    return () => window.clearTimeout(handle);
  }, [busca, token]);

  function adicionar(produto: DashboardEstoqueProdutoSugestao) {
    if (!selected.some((item) => item.referencia === produto.referencia)) onChange([...selected, produto]);
    setBusca('');
    setSugestoes([]);
    setOpen(false);
  }

  function remover(referencia: string) {
    onChange(selected.filter((item) => item.referencia !== referencia));
  }

  const sugestoesFiltradas = sugestoes.filter((produto) => !selected.some((item) => item.referencia === produto.referencia));

  return (
    <div className="min-w-0" ref={containerRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">Buscar produto</label>
      <div className="min-h-[42px] rounded-lg border border-gray-300 bg-white px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--bbtk-red)] focus-within:border-transparent">
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((produto) => (
            <Badge key={produto.referencia} variant="info" className="max-w-[260px] pr-1">
              <span className="truncate">{produto.referencia}</span>
              <button
                type="button"
                onClick={() => remover(produto.referencia)}
                className="ml-1.5 hover:text-red-600"
                aria-label={`Remover ${produto.referencia}`}
              >
                x
              </button>
            </Badge>
          ))}
          <input
            ref={inputRef}
            value={busca}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setBusca(e.target.value);
              setOpen(true);
            }}
            placeholder={selected.length ? 'Adicionar outra referencia...' : 'Digite referencia ou descricao'}
            className="min-w-[140px] flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none"
          />
        </div>
      </div>

      {open && posicao && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[60] max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
          style={{ top: posicao.top, left: posicao.left, width: posicao.width }}
        >
          {busca.trim().length < 2 ? (
            <p className="px-3 py-3 text-sm text-gray-400">Digite pelo menos 2 caracteres</p>
          ) : isLoading ? (
            <p className="px-3 py-3 text-sm text-gray-400">Buscando...</p>
          ) : sugestoesFiltradas.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400">Nenhum produto encontrado</p>
          ) : (
            sugestoesFiltradas.map((produto) => (
              <button
                key={produto.referencia}
                type="button"
                onClick={() => adicionar(produto)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-800">{produto.referencia}</span>
                  <span className="block truncate text-xs text-gray-500">{produto.descricao}</span>
                </span>
                <span className="shrink-0 text-xs text-gray-400">{formatNumber(produto.skus)} SKUs</span>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function DashboardEstoquePage() {
  const { token, user } = useAuth();
  const carregouInicial = useRef(false);
  const [dataCorte, setDataCorte] = useState(getOntem());
  const [produtosSelecionados, setProdutosSelecionados] = useState<DashboardEstoqueProdutoSugestao[]>([]);
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [tiposEstoqueSelecionados, setTiposEstoqueSelecionados] = useState<string[]>([]);
  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [tiposEstoque, setTiposEstoque] = useState<{ stockCode: number; label: string; qtd_skus: number }[]>([]);
  const [lojasFiltro, setLojasFiltro] = useState<PcpLojaFiltro[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [data, setData] = useState<DashboardEstoqueResponse | null>(null);
  const [referenciasAbertas, setReferenciasAbertas] = useState<Set<string>>(new Set());
  const [agruparPorCorSalva, setAgruparPorCorSalva] = useState(false);
  const requisicaoAtual = useRef(0);
  const [sortKey, setSortKey] = useState<SortKey>('quantidade');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregarDados = useCallback(async (opcoes: {
    refresh?: boolean;
    agruparPorCorSalva?: boolean;
    preservarExpansao?: boolean;
  } = {}) => {
    if (!token) return;
    const requisicao = ++requisicaoAtual.current;
    setIsLoading(true);
    setErro(null);
    try {
      const response = await pcpApi.getDashboardEstoque(token, {
        data: dataCorte,
        produtos: produtosSelecionados.length ? produtosSelecionados.map((produto) => produto.referencia) : undefined,
        branches: filiaisSelecionadas.length ? filiaisSelecionadas : undefined,
        stockCodes: tiposEstoqueSelecionados.length ? tiposEstoqueSelecionados.map(Number) : undefined,
        tipo: produtoFiltro.tipo,
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        colecao: produtoFiltro.colecao,
        genero: produtoFiltro.genero,
        modelo: produtoFiltro.modelo,
        tecido: produtoFiltro.tecido,
        lancamento: produtoFiltro.lancamento,
        status: produtoFiltro.status,
        agruparPorCorSalva: opcoes.agruparPorCorSalva ?? agruparPorCorSalva,
        refresh: opcoes.refresh ?? false,
      });
      if (requisicao !== requisicaoAtual.current) return;
      setData(response);
      if (!opcoes.preservarExpansao) setReferenciasAbertas(new Set());
    } catch (error) {
      if (requisicao !== requisicaoAtual.current) return;
      setData(null);
      setErro(error instanceof Error ? error.message : 'Erro ao carregar análise de estoque');
    } finally {
      if (requisicao === requisicaoAtual.current) setIsLoading(false);
    }
  }, [agruparPorCorSalva, dataCorte, filiaisSelecionadas, produtoFiltro, produtosSelecionados, tiposEstoqueSelecionados, token]);

  useEffect(() => {
    if (!token) return;
    pcpApi.getFiltrosDashboardEstoque(token)
      .then((response) => {
        setClassificacoes(response.classificacoes);
        setTiposEstoque(response.tiposEstoque);
        setLojasFiltro(response.lojas);
      })
      .catch((error) => console.error('Erro ao carregar filtros da análise de estoque:', error));
  }, [token]);

  useEffect(() => {
    if (!token || carregouInicial.current) return;
    carregouInicial.current = true;
    carregarDados();
  }, [carregarDados, token]);

  const filialOptions = useMemo(() => {
    return lojasFiltro
      .filter((loja) => user?.role === 'admin' || user?.branchCodes.includes(loja.branch_code))
      .map((loja) => ({ value: loja.branch_code, label: loja.branch_name }));
  }, [lojasFiltro, user]);

  const classificacoesOrdenadas = useMemo(() => {
    return classificacoes.filter((item) => !FILTROS_OCULTOS.has(item.chave)).sort((a, b) => {
      const ia = FILTROS_PRIORITARIOS.indexOf(a.chave);
      const ib = FILTROS_PRIORITARIOS.indexOf(b.chave);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.label.localeCompare(b.label);
    });
  }, [classificacoes]);

  const filtrosAtivos = useMemo(() => {
    const totalClassificacoes = Object.values(produtoFiltro).reduce((sum, values) => sum + (values?.length || 0), 0);
    return totalClassificacoes + filiaisSelecionadas.length + tiposEstoqueSelecionados.length + produtosSelecionados.length;
  }, [filiaisSelecionadas, produtoFiltro, produtosSelecionados.length, tiposEstoqueSelecionados]);

  function limparFiltros() {
    setProdutosSelecionados([]);
    setFiliaisSelecionadas([]);
    setTiposEstoqueSelecionados([]);
    setProdutoFiltro({});
  }

  function toggleReferencia(referencia: string) {
    setReferenciasAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(referencia)) next.delete(referencia);
      else next.add(referencia);
      return next;
    });
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'referencia' || key === 'descricao' || key === 'colecao' || key === 'linha' || key === 'categoria' ? 'asc' : 'desc');
    }
  }

  function ThSort({ label, sortKeyName, align = 'left', title }: { label: string; sortKeyName: SortKey; align?: 'left' | 'right' | 'center'; title?: string }) {
    const active = sortKey === sortKeyName;
    return (
      <TableCell isHeader align={align} title={title || label} onClick={() => handleSort(sortKeyName)}>
        <span className={cn('inline-flex items-center gap-1', align === 'right' && 'justify-end w-full')}>
          <span className="truncate">{label}</span>
          {/* Seta grafica (era a letra "v", lida pelo cliente como parte do titulo: "PECAS V") */}
          {active && <span className="text-[var(--bbtk-purple)]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
        </span>
      </TableCell>
    );
  }

  const total = data?.total;
  const tiposSaldoTabela = data?.tiposSaldo || [];
  const tabelaColSpan = 11 + tiposSaldoTabela.length;
  const totalValorCusto = total?.valorCusto || 0;
  // A caixa recarrega na hora; a grade vem do backend ja somada por cor (tamanho 'TODOS').
  const corAgrupada = agruparPorCorSalva;
  const itensOrdenados = useMemo(() => {
    const itens = data?.itens || [];
    return [...itens].sort((a, b) => {
      const aVal = sortValue(a, sortKey);
      const bVal = sortValue(b, sortKey);
      const cmp = typeof aVal === 'string' || typeof bVal === 'string'
        ? String(aVal).localeCompare(String(bVal), 'pt-BR')
        : aVal - bVal;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data?.itens, sortDir, sortKey]);

  function exportarExcel() {
    if (!data || itensOrdenados.length === 0) return;

    const colunas: ExcelColumn[] = [
      { key: 'referencia', header: 'Referencia', width: 18, type: 'text' },
      { key: 'descricao', header: 'Descricao', width: 36, type: 'text' },
      { key: 'colecao', header: 'Colecao', width: 24, type: 'text' },
      { key: 'linha', header: 'Linha', width: 18, type: 'text' },
      { key: 'categoria', header: 'Categoria', width: 18, type: 'text' },
      { key: 'quantidade', header: 'TT Geral', width: 12, type: 'number' },
      ...tiposSaldoTabela.map((tipo) => ({
        key: `saldo_${tipo.stockCode}`,
        header: tipo.label,
        width: 15,
        type: 'number' as const,
      })),
      { key: 'custo', header: 'Custo un.', width: 13, type: 'currency' },
      { key: 'valorCusto', header: 'Valor a custo', width: 16, type: 'currency' },
      { key: 'participacao', header: 'Part. % (custo)', width: 14, type: 'number' },
      { key: 'valorVarejo', header: 'Valor a preco varejo', width: 18, type: 'currency' },
      { key: 'valorAtacado', header: 'Valor a preco atacado', width: 18, type: 'currency' },
    ];

    const dados = itensOrdenados.map((item) => {
      const row: Record<string, unknown> = {
        referencia: item.referencia,
        descricao: item.descricao,
        colecao: item.colecao || '',
        linha: item.linha || '',
        categoria: item.categoria || '',
        quantidade: item.quantidade,
        custo: item.custo ?? '',
        valorCusto: item.valorCusto,
        participacao: Math.round(participacao(item.valorCusto, totalValorCusto) * 100) / 100,
        valorVarejo: item.valorVarejo,
        valorAtacado: item.valorAtacado,
      };

      for (const tipo of tiposSaldoTabela) {
        row[`saldo_${tipo.stockCode}`] = saldoQuantidade(item.saldos, tipo.stockCode);
      }

      return row;
    });

    const totals: Record<string, number | string> = {
      referencia: 'Total',
      quantidade: itensOrdenados.reduce((sum, item) => sum + item.quantidade, 0),
      valorCusto: itensOrdenados.reduce((sum, item) => sum + item.valorCusto, 0),
      participacao: 100,
      valorVarejo: itensOrdenados.reduce((sum, item) => sum + item.valorVarejo, 0),
      valorAtacado: itensOrdenados.reduce((sum, item) => sum + item.valorAtacado, 0),
    };

    for (const tipo of tiposSaldoTabela) {
      totals[`saldo_${tipo.stockCode}`] = itensOrdenados.reduce((sum, item) => sum + saldoQuantidade(item.saldos, tipo.stockCode), 0);
    }

    exportToExcel({
      filename: `ReferenciasEstoque_${data.data}`,
      sheetName: 'Referencias',
      title: `Referencias em estoque - ${formatDate(data.data)}`,
      columns: colunas,
      data: dados,
      totals,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Análise de Estoque</h1>
          <p className="text-sm text-gray-500 mt-1">
            Posicao em {data ? formatDate(data.data) : formatDate(dataCorte)} · ultimo saldo capturado ate {atualizacaoLabel(data?.atualizadoEm || null)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <label className="block text-sm font-medium text-gray-700 mb-1">Data do estoque</label>
            <Input type="date" value={dataCorte} onChange={(e) => setDataCorte(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer pb-2 text-sm text-gray-700" title="Ao abrir a referencia, mostra uma linha por cor somando os tons (claro, medio, escuro) e todos os tamanhos. Usa os grupos do Agrupamento de Cores e ignora numeros e palavras de tom no nome da cor.">
            <input
              type="checkbox"
              checked={agruparPorCorSalva}
              disabled={isLoading}
              onChange={(event) => {
                const agrupar = event.target.checked;
                setAgruparPorCorSalva(agrupar);
                void carregarDados({ agruparPorCorSalva: agrupar, preservarExpansao: true });
              }}
              className="h-4 w-4 rounded border-gray-300 text-[var(--bbtk-purple)] focus:ring-[var(--bbtk-purple)]"
            />
            Agrupamento por cores
          </label>
          <Button variant="secondary" onClick={limparFiltros} disabled={filtrosAtivos === 0}>
            Limpar filtros
          </Button>
          <Button onClick={() => carregarDados({ refresh: true })} isLoading={isLoading}>
            Atualizar
          </Button>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProdutoMultiSelect token={token} selected={produtosSelecionados} onChange={setProdutosSelecionados} />
          <FilialMultiSelect
            label="Filiais"
            options={filialOptions}
            selected={filiaisSelecionadas}
            onChange={setFiliaisSelecionadas}
            className="w-full"
          />
          <ClassificacaoMultiSelect
            label="Tipo de estoque"
            options={tiposEstoque.map((tipo) => ({
              value: String(tipo.stockCode),
              label: tipo.label,
              meta: formatNumber(tipo.qtd_skus),
            }))}
            selected={tiposEstoqueSelecionados}
            onChange={setTiposEstoqueSelecionados}
            className="w-full"
          />
          {classificacoesOrdenadas.map((dimensao) => (
            <ClassificacaoMultiSelect
              key={dimensao.chave}
              label={dimensao.label}
              options={dimensao.opcoes.map((opcao) => ({
                value: opcao.valor,
                label: opcao.valor,
                meta: formatNumber(opcao.qtd_skus),
              }))}
              selected={produtoFiltro[dimensao.chave] || []}
              onChange={(values) => setProdutoFiltro((prev) => ({ ...prev, [dimensao.chave]: values.length ? values : undefined }))}
              className="w-full"
            />
          ))}
        </div>
      </Card>

      {erro && (
        <Card className="border-l-4 border-l-[var(--bbtk-red)]">
          <p className="text-sm font-medium text-red-700">{erro}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <KPICard title="Pecas em estoque" value={formatNumber(total?.quantidade || 0)} color="red" isLoading={isLoading} />
        <KPICard title="Valor a custo" value={formatMoney(total?.valorCusto || 0)} color="green" valueSize="md" isLoading={isLoading} />
        <KPICard title="SKUs com saldo" value={formatNumber(total?.skus || 0)} color="purple" isLoading={isLoading} />
        <KPICard title="Referencias" value={formatNumber(total?.referencias || 0)} color="blue" isLoading={isLoading} />
        <KPICard title="Filiais/locais" value={formatNumber(total?.filiais || 0)} color="yellow" isLoading={isLoading} />
      </div>

      <LoadingOverlay active={isLoading}>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {GRAFICOS.map((grafico) => (
          <ChartCard
            key={grafico.key}
            title={grafico.title}
            color={grafico.color}
            data={data?.graficos[grafico.key] || []}
          />
        ))}
      </div>
      </LoadingOverlay>

      <Card>
        <CardHeader>
          <CardTitle>Referencias em estoque</CardTitle>
          <Button variant="secondary" size="sm" onClick={exportarExcel} disabled={!data || itensOrdenados.length === 0 || isLoading}>
            Exportar Excel
          </Button>
        </CardHeader>
        <Table topScroll className="max-h-[560px] overflow-y-auto" tableClassName="min-w-[1180px]">
          <TableHead>
            <TableRow>
              <ThSort label="Referencia" sortKeyName="referencia" />
              <ThSort label="Descricao" sortKeyName="descricao" />
              <ThSort label="Colecao" sortKeyName="colecao" />
              <ThSort label="Linha" sortKeyName="linha" />
              <ThSort label="Categoria" sortKeyName="categoria" />
              <ThSort label="TT Geral" sortKeyName="quantidade" align="right" title="Total geral de pecas (todos os tipos de saldo)" />
              {tiposSaldoTabela.map((tipo) => (
                <ThSort key={tipo.stockCode} label={tipo.label} sortKeyName={`saldo-${tipo.stockCode}`} align="right" title={tipo.label} />
              ))}
              <ThSort label="Custo un." sortKeyName="custo" align="right" />
              <ThSort label="Valor a custo" sortKeyName="valorCusto" align="right" />
              <ThSort label="Part. %" sortKeyName="participacao" align="right" title="Participacao no valor total do estoque a preco de custo" />
              <ThSort label="Valor varejo" sortKeyName="valorVarejo" align="right" title="Estoque total valorizado a preco de venda varejo (tabela)" />
              <ThSort label="Valor atacado" sortKeyName="valorAtacado" align="right" title="Estoque total valorizado a preco de venda atacado (tabela)" />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={tabelaColSpan}>
                    <div className="h-5 animate-pulse rounded bg-gray-100" />
                  </TableCell>
                </TableRow>
              ))
            ) : itensOrdenados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tabelaColSpan} className="text-center text-gray-500">
                  Nenhum saldo encontrado para os filtros selecionados.
                </TableCell>
              </TableRow>
            ) : (
              <>
              {/* Devolutiva 13/11: linha de totais em cima (recorte inteiro, nao so o que esta visivel) */}
              <TableRow className="bg-purple-50/70 font-semibold text-gray-900">
                <TableCell className="font-bold">TOTAL</TableCell>
                <TableCell className="text-gray-500">{formatNumber(total?.referencias || 0)} referencias · {formatNumber(total?.skus || 0)} SKUs</TableCell>
                <TableCell>{''}</TableCell>
                <TableCell>{''}</TableCell>
                <TableCell>{''}</TableCell>
                <TableCell align="right" className="font-bold">{formatNumber(total?.quantidade || 0)}</TableCell>
                {tiposSaldoTabela.map((tipo) => (
                  <TableCell key={`total-${tipo.stockCode}`} align="right">{formatNumber(tipo.quantidade)}</TableCell>
                ))}
                <TableCell align="right">{''}</TableCell>
                <TableCell align="right">{formatMoney(totalValorCusto)}</TableCell>
                <TableCell align="right">{formatPercent(100)}</TableCell>
                <TableCell align="right">{formatMoney(total?.valorVarejo || 0)}</TableCell>
                <TableCell align="right">{formatMoney(total?.valorAtacado || 0)}</TableCell>
              </TableRow>
              {itensOrdenados.map((item) => {
                const aberta = referenciasAbertas.has(item.referencia);
                return (
                  <Fragment key={item.referencia}>
                    <TableRow>
                      <TableCell className="font-semibold text-gray-900">
                        <button
                          type="button"
                          onClick={() => toggleReferencia(item.referencia)}
                          className={cn(
                            'inline-flex items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-100',
                            item.grades.length === 0 && 'cursor-default hover:bg-transparent'
                          )}
                          disabled={item.grades.length === 0}
                          title={aberta ? 'Recolher grade' : 'Expandir grade'}
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-gray-200 text-xs text-gray-600">
                            {aberta ? '-' : '+'}
                          </span>
                          {item.referencia}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate" title={item.descricao}>{item.descricao}</TableCell>
                      <TableCell>{item.colecao || '-'}</TableCell>
                      <TableCell>{item.linha || '-'}</TableCell>
                      <TableCell>{item.categoria || '-'}</TableCell>
                      <TableCell align="right" className="font-semibold">{formatNumber(item.quantidade)}</TableCell>
                      {tiposSaldoTabela.map((tipo) => (
                        <TableCell key={`${item.referencia}-${tipo.stockCode}`} align="right">
                          {formatNumber(saldoQuantidade(item.saldos, tipo.stockCode))}
                        </TableCell>
                      ))}
                      <TableCell align="right">{item.custo === null ? '-' : formatMoney(item.custo)}</TableCell>
                      <TableCell align="right">{formatMoney(item.valorCusto)}</TableCell>
                      <TableCell align="right">{formatPercent(participacao(item.valorCusto, totalValorCusto))}</TableCell>
                      <TableCell align="right">{formatMoney(item.valorVarejo)}</TableCell>
                      <TableCell align="right">{formatMoney(item.valorAtacado)}</TableCell>
                    </TableRow>
                    {aberta && item.grades.map((grade) => (
                      <TableRow key={`${item.referencia}-${grade.cor}-${grade.tamanho}`} className="bg-gray-50/60">
                        <TableCell className="pl-12 text-gray-700">
                          {corAgrupada ? `${grade.cor} TOTAL` : `${grade.cor} / ${grade.tamanho}`}
                        </TableCell>
                        <TableCell className="text-gray-400">
                          {corAgrupada ? `Tons e tamanhos somados · ${formatNumber(grade.skus)} SKUs` : 'Cor / tamanho'}
                        </TableCell>
                        <TableCell>{item.colecao || '-'}</TableCell>
                        <TableCell>{item.linha || '-'}</TableCell>
                        <TableCell>{item.categoria || '-'}</TableCell>
                        <TableCell align="right" className="font-medium">{formatNumber(grade.quantidade)}</TableCell>
                        {tiposSaldoTabela.map((tipo) => (
                          <TableCell key={`${item.referencia}-${grade.cor}-${grade.tamanho}-${tipo.stockCode}`} align="right">
                            {formatNumber(saldoQuantidade(grade.saldos, tipo.stockCode))}
                          </TableCell>
                        ))}
                        <TableCell align="right">{grade.custo === null ? '-' : formatMoney(grade.custo)}</TableCell>
                        <TableCell align="right">{formatMoney(grade.valorCusto)}</TableCell>
                        <TableCell align="right">{formatPercent(participacao(grade.valorCusto, totalValorCusto))}</TableCell>
                        <TableCell align="right">{formatMoney(grade.valorVarejo)}</TableCell>
                        <TableCell align="right">{formatMoney(grade.valorAtacado)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
              </>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
