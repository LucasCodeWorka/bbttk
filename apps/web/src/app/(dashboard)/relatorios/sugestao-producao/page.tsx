'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { KPICard } from '@/components/dashboard/KPICard';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { SugestaoProducaoFiltrosResponse, SugestaoProducaoResponse, SugestaoProducaoRow, sugestaoProducaoApi } from '@/lib/pcpApi';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { ExcelColumn, exportToExcel } from '@/lib/exportExcel';

type SortKey = keyof SugestaoProducaoRow;

const COLUNAS: Array<{ key: SortKey; label: string; align?: 'left' | 'right' | 'center'; type?: 'text' | 'number'; width: number }> = [
  { key: 'sku', label: 'SKU', width: 14, type: 'text' },
  { key: 'referenceCode', label: 'REFERENCIA', width: 14, type: 'text' },
  { key: 'descricao', label: 'DESCRICAO', width: 28, type: 'text' },
  { key: 'cor', label: 'COR', width: 14, type: 'text' },
  { key: 'tamanho', label: 'TAMANHO', width: 10, type: 'text' },
  { key: 'categoria', label: 'CATEGORIA', width: 14, type: 'text' },
  { key: 'linha', label: 'LINHA', width: 14, type: 'text' },
  { key: 'estoqueAtual', label: 'ESTOQUE ATUAL', align: 'right', width: 13, type: 'number' },
  { key: 'emProducao', label: 'EM PRODUCAO', align: 'right', width: 13, type: 'number' },
  { key: 'estoqueFuturo', label: 'ESTOQUE FUTURO', align: 'right', width: 14, type: 'number' },
  { key: 'vendaPeriodoAtual', label: 'VENDA PERIODO ATUAL', align: 'right', width: 15, type: 'number' },
  { key: 'vendaPeriodoAnterior', label: 'VENDA PERIODO ANTERIOR', align: 'right', width: 17, type: 'number' },
  { key: 'vendaMediaMensal', label: 'VENDA MEDIA MENSAL', align: 'right', width: 15, type: 'number' },
  { key: 'estoqueMinimo', label: 'ESTOQUE MINIMO', align: 'right', width: 14, type: 'number' },
  { key: 'corteMinimo', label: 'CORTE MINIMO', align: 'right', width: 12, type: 'number' },
  { key: 'sugestaoProducao', label: 'SUGESTAO PRODUCAO', align: 'right', width: 16, type: 'number' },
];

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

function formatCell(row: SugestaoProducaoRow, key: SortKey): string {
  const value = row[key];
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

export default function SugestaoProducaoPage() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [search, setSearch] = useState('');
  const [apenasComSugestao, setApenasComSugestao] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<SugestaoProducaoResponse | null>(null);
  const [filtrosDisponiveis, setFiltrosDisponiveis] = useState<SugestaoProducaoFiltrosResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('sugestaoProducao');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const tabelaScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    if (!token) return;
    sugestaoProducaoApi
      .getFiltros(token)
      .then(setFiltrosDisponiveis)
      .catch((error) => {
        showToast('Erro ao carregar filtros de Sugestao de Producao', 'error');
        console.error(error);
      });
  }, [token, showToast]);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await sugestaoProducaoApi.getSugestaoProducao(token, {
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
        search: search.trim() || undefined,
        apenasComSugestao,
      });
      setData(response);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao carregar Sugestao de Producao', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, produtoFiltro, search, apenasComSugestao, showToast]);

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
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
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

  const totais = useMemo(
    () =>
      rowsOrdenadas.reduce(
        (acc, row) => {
          acc.estoqueAtual += row.estoqueAtual;
          acc.emProducao += row.emProducao;
          acc.estoqueFuturo += row.estoqueFuturo;
          acc.sugestaoProducao += row.sugestaoProducao;
          return acc;
        },
        { estoqueAtual: 0, emProducao: 0, estoqueFuturo: 0, sugestaoProducao: 0 }
      ),
    [rowsOrdenadas]
  );

  function exportarExcel() {
    if (!data || rowsOrdenadas.length === 0) return;
    const columns: ExcelColumn[] = COLUNAS.map((coluna) => ({ key: coluna.key, header: coluna.label, width: coluna.width, type: coluna.type }));
    exportToExcel({
      filename: `Sugestao_Producao_${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Sugestao Producao',
      title: 'Relatorio Sugestao de Producao',
      columns,
      data: rowsOrdenadas as unknown as Record<string, unknown>[],
      totals: {
        sku: `TOTAL (${rowsOrdenadas.length} SKUs)`,
        estoqueAtual: totais.estoqueAtual,
        emProducao: totais.emProducao,
        estoqueFuturo: totais.estoqueFuturo,
        sugestaoProducao: totais.sugestaoProducao,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Sugestao de Producao</h1>
          <p className="text-gray-500 text-sm mt-1">
            Estoque + producao em aberto (rede toda) contra a venda media, com sugestao de corte arredondada pelo corte minimo de cada SKU
          </p>
        </div>
        <Button onClick={exportarExcel} disabled={!data || rowsOrdenadas.length === 0 || isLoading} variant="secondary">
          Exportar Excel
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <Input label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU, referencia ou descricao" />
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
            <input type="checkbox" checked={apenasComSugestao} onChange={(e) => setApenasComSugestao(e.target.checked)} className="w-4 h-4 text-[var(--bbtk-red)] rounded" />
            Mostrar so quem precisa produzir
          </label>
          <div className="flex items-end">
            <Button onClick={carregarDados} isLoading={isLoading} className="w-full">Atualizar</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {filtrosDisponiveis &&
            (['categoria', 'linha', 'genero', 'status'] as const).map((chave) => (
              <ClassificacaoMultiSelect
                key={chave}
                label={chave === 'categoria' ? 'Categoria' : chave === 'linha' ? 'Linha' : chave === 'genero' ? 'Genero' : 'Status'}
                options={filtrosDisponiveis[chave].map((opcao) => ({ value: opcao.valor, label: opcao.valor, meta: formatNumber(opcao.qtd_skus) }))}
                selected={produtoFiltro[chave] || []}
                onChange={(valores) => atualizarProdutoFiltro(chave, valores)}
                className="w-44"
              />
            ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPICard title="SKUs analisados" value={formatNumber(data?.kpis.skuCount || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="SKUs c/ sugestao" value={formatNumber(data?.kpis.skusComSugestao || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Total sugerido (pcs)" value={formatNumber(data?.kpis.totalSugerido || 0)} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Estoque atual (rede)" value={formatNumber(data?.kpis.totalEstoqueAtual || 0)} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Em producao (rede)" value={formatNumber(data?.kpis.totalEmProducao || 0)} color="green" valueSize="sm" isLoading={isLoading} />
      </div>

      {data && (
        <p className="text-xs text-gray-500">
          Periodo atual: {formatDate(data.periodo.atualInicio)} a {formatDate(data.periodo.atualFim)} · Periodo anterior:{' '}
          {formatDate(data.periodo.anteriorInicio)} a {formatDate(data.periodo.anteriorFim)} · Venda media: ultimos {data.config.coberturaMeses} meses ·
          Cobertura alvo: {data.config.coberturaAlvoMeses}x
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detalhamento por SKU</CardTitle>
        </CardHeader>

        <div ref={topScrollRef} onScroll={sincronizarScrollPeloTopo} className="mb-2 overflow-x-auto overflow-y-hidden">
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <Table ref={tabelaScrollRef} className="scrollbar-x-hidden max-h-[760px] overflow-auto" tableClassName="text-[10px] lg:text-xs min-w-[1700px]">
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
                <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">Nenhum SKU encontrado</TableCell>
              </TableRow>
            ) : (
              <>
                {rowsOrdenadas.map((row) => (
                  <TableRow key={row.sku} className={row.sugestaoProducao > 0 ? 'bg-red-50/40' : ''}>
                    {COLUNAS.map((coluna) => (
                      <TableCell key={coluna.key} align={coluna.align} className="whitespace-nowrap !px-2 !py-2">
                        {coluna.key === 'descricao' ? (
                          <span className="block max-w-[240px] truncate" title={row.descricao}>{row.descricao}</span>
                        ) : coluna.key === 'sugestaoProducao' && row.sugestaoProducao > 0 ? (
                          <span className="font-semibold text-[var(--bbtk-red)]">{formatNumber(row.sugestaoProducao)}</span>
                        ) : (
                          formatCell(row, coluna.key)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow isHighlighted className="sticky bottom-0 z-20 bg-yellow-50 shadow-[0_-1px_0_rgba(148,163,184,0.35)]">
                  <TableCell colSpan={7} className="font-bold">TOTAL ({rowsOrdenadas.length} SKUs)</TableCell>
                  <TableCell align="right" className="font-bold">{formatNumber(totais.estoqueAtual)}</TableCell>
                  <TableCell align="right" className="font-bold">{formatNumber(totais.emProducao)}</TableCell>
                  <TableCell align="right" className="font-bold">{formatNumber(totais.estoqueFuturo)}</TableCell>
                  <TableCell align="right" className="font-bold">-</TableCell>
                  <TableCell align="right" className="font-bold">-</TableCell>
                  <TableCell align="right" className="font-bold">-</TableCell>
                  <TableCell align="right" className="font-bold">-</TableCell>
                  <TableCell align="right" className="font-bold">-</TableCell>
                  <TableCell align="right" className="font-bold">{formatNumber(totais.sugestaoProducao)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
