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
import {
  EmProducaoResponse,
  EmProducaoRow,
  PcpClassificacaoDimensao,
  emProducaoApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { ExcelColumn, exportToExcel } from '@/lib/exportExcel';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type SortKey = keyof EmProducaoRow;

const COLUNAS: Array<{
  key: SortKey;
  label: string;
  align?: 'left' | 'right' | 'center';
  width: number;
  type?: 'text' | 'number' | 'percent';
}> = [
  { key: 'branchName', label: 'FILIAL', width: 16, type: 'text' },
  { key: 'orderCode', label: 'OP', align: 'right', width: 10, type: 'number' },
  { key: 'statusLabel', label: 'STATUS', width: 16, type: 'text' },
  { key: 'dtInicio', label: 'INICIO', align: 'center', width: 12, type: 'text' },
  { key: 'dtPrevisao', label: 'PREVISAO', align: 'center', width: 12, type: 'text' },
  { key: 'referenceCode', label: 'REFERENCIA', width: 14, type: 'text' },
  { key: 'descricao', label: 'DESCRICAO', width: 30, type: 'text' },
  { key: 'cor', label: 'COR', width: 18, type: 'text' },
  { key: 'tamanho', label: 'TAMANHO', width: 14, type: 'text' },
  { key: 'colecao', label: 'COLECAO', width: 18, type: 'text' },
  { key: 'categoria', label: 'CATEGORIA', width: 16, type: 'text' },
  { key: 'linha', label: 'LINHA', width: 16, type: 'text' },
  { key: 'genero', label: 'GENERO', width: 14, type: 'text' },
  { key: 'statusProduto', label: 'STATUS PROD.', width: 16, type: 'text' },
  { key: 'productCode', label: 'CODIGO', align: 'right', width: 10, type: 'number' },
  { key: 'quantidadeOp', label: 'QTDE OP', align: 'right', width: 11, type: 'number' },
  { key: 'quantidadeFinalizada', label: 'FINALIZADA', align: 'right', width: 12, type: 'number' },
  { key: 'quantidadePendente', label: 'PENDENTE', align: 'right', width: 12, type: 'number' },
  { key: 'percentFinalizado', label: '% FINAL.', align: 'right', width: 11, type: 'percent' },
  { key: 'diasEmProcesso', label: 'DIAS PROC.', align: 'right', width: 11, type: 'number' },
  { key: 'diasAtraso', label: 'DIAS ATRASO', align: 'right', width: 12, type: 'number' },
];


type ChartKey = 'colecao' | 'categoria' | 'linha' | 'genero';

type ChartDatum = {
  name: string;
  value: number;
  ordens: number;
};

const CHART_COLORS = ['#6b5aa6', '#d32232', '#b7cf2f', '#2095d2', '#f2b705', '#475569', '#0f766e', '#9333ea'];

function agruparPor(rows: EmProducaoRow[], key: ChartKey, fallback: string, limit = 8): ChartDatum[] {
  const grupos = new Map<string, { value: number; ordens: Set<string> }>();
  rows.forEach((row) => {
    const label = String(row[key] || '').trim() || fallback;
    const atual = grupos.get(label) || { value: 0, ordens: new Set<string>() };
    atual.value += row.quantidadePendente;
    atual.ordens.add(`${row.branchCode}-${row.orderCode}`);
    grupos.set(label, atual);
  });

  return Array.from(grupos.entries())
    .map(([name, item]) => ({ name, value: item.value, ordens: item.ordens.size }))
    .filter((item) => item.value > 0 || item.ordens > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartDatum }> }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-gray-900">{item.name}</div>
      <div className="text-gray-600">Pendente: {formatNumber(item.value)}</div>
      <div className="text-gray-600">OPs: {formatNumber(item.ordens)}</div>
    </div>
  );
}

function HorizontalKpiChart({ title, data, color }: { title: string; data: ChartDatum[]; color: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="h-64">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">Sem dados</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 50, left: 12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={118}
                tick={{ fontSize: 11, fill: '#334155' }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={14}>
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(value: number) => formatNumber(value)}
                  style={{ fontSize: 10, fill: '#475569', fontWeight: 500 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function DonutKpiChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="grid h-64 grid-cols-1 gap-2 md:grid-cols-[minmax(150px,1fr)_150px]">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400 md:col-span-2">Sem dados</div>
        ) : (
          <>
            <div className="relative min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">
                    {data.map((item, index) => (
                      <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xs font-semibold uppercase text-gray-400">Pendente</span>
                <span className="text-lg font-bold text-gray-900">{formatNumber(total)}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-2 text-xs">
              {data.slice(0, 6).map((item, index) => (
                <div key={item.name} className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate text-gray-600" title={item.name}>{item.name}</span>
                  <span className="font-semibold text-gray-900">{total ? ((item.value / total) * 100).toFixed(0) : 0}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
function formatCell(row: EmProducaoRow, key: SortKey): string {
  const value = row[key];
  if (value === null || value === undefined || value === '') return '-';
  if (key === 'dtInicio' || key === 'dtPrevisao' || key === 'insertDate' || key === 'lastChangeDate') return formatDate(String(value));
  if (key === 'percentFinalizado') return `${Number(value).toFixed(1)}%`;
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

export default function EmProducaoPage() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<EmProducaoResponse | null>(null);
  const [status, setStatus] = useState<string[]>([]);
  const [colecao, setColecao] = useState<string[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [search, setSearch] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [considerarSemReferencia, setConsiderarSemReferencia] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('quantidadePendente');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const tabelaScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  const [statusOptions, setStatusOptions] = useState<Array<{ valor: number; label: string; qtd: number }>>([]);
  const [colecoes, setColecoes] = useState<Array<{ valor: string; qtd_skus: number }>>([]);
  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);

  useEffect(() => {
    if (!token) return;
    emProducaoApi
      .getFiltros(token)
      .then((response) => {
        setStatusOptions(response.status);
        setColecoes(response.colecoes);
        setClassificacoes(response.classificacoes);
      })
      .catch((error) => {
        showToast('Erro ao carregar filtros de Em Producao', 'error');
        console.error(error);
      });
  }, [token, showToast]);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await emProducaoApi.getEmProducao(token, {
        status: status.length ? status.map(Number) : undefined,
        colecao: colecao.length ? colecao : undefined,
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        statusProduto: produtoFiltro.statusProduto,
        search: search.trim() || undefined,
        dataInicio: dataInicio || undefined,
        considerarSemReferencia,
      });
      setData(response);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao carregar Em Producao', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, status, colecao, produtoFiltro, search, dataInicio, considerarSemReferencia, showToast]);

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
        acc.quantidadeOp += row.quantidadeOp;
        acc.quantidadeFinalizada += row.quantidadeFinalizada;
        acc.quantidadePendente += row.quantidadePendente;
        return acc;
      },
      { quantidadeOp: 0, quantidadeFinalizada: 0, quantidadePendente: 0 }
    );
  }, [rowsOrdenadas]);


  const graficos = useMemo(() => {
    const rows = data?.rows || [];
    return {
      colecao: agruparPor(rows, 'colecao', 'Sem colecao'),
      categoria: agruparPor(rows, 'categoria', 'Sem categoria'),
      linha: agruparPor(rows, 'linha', 'Sem linha'),
      genero: agruparPor(rows, 'genero', 'Sem genero', 6),
    };
  }, [data]);
  function exportarExcel() {
    if (!data || rowsOrdenadas.length === 0) return;
    const columns: ExcelColumn[] = COLUNAS.map((coluna) => ({
      key: coluna.key,
      header: coluna.label,
      width: coluna.width,
      type: coluna.type,
    }));
    exportToExcel({
      filename: `Em_Producao_${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Em Producao',
      title: 'Relatorio Em Producao',
      columns,
      data: rowsOrdenadas as unknown as Record<string, unknown>[],
      totals: {
        branchName: `TOTAL (${rowsOrdenadas.length} itens)`,
        quantidadeOp: totais.quantidadeOp,
        quantidadeFinalizada: totais.quantidadeFinalizada,
        quantidadePendente: totais.quantidadePendente,
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Relatorios</p>
          <h1 className="text-2xl font-bold text-gray-900">Em Producao</h1>
          <p className="text-gray-500 text-sm mt-1">
            Snapshot das OPs em processo pela tabela ops_em_producao
          </p>
          {data?.atualizadoEm && (
            <p className="text-xs text-gray-400 mt-1">Atualizado em {new Date(data.atualizadoEm).toLocaleString('pt-BR')}</p>
          )}
        </div>
        <Button onClick={exportarExcel} disabled={!data || rowsOrdenadas.length === 0 || isLoading} variant="secondary">
          Exportar Excel
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <ClassificacaoMultiSelect
            label="Status OP"
            options={statusOptions.map((option) => ({ value: String(option.valor), label: option.label, meta: formatNumber(option.qtd) }))}
            selected={status}
            onChange={setStatus}
            className="w-full"
          />
          <ClassificacaoMultiSelect
            label="Colecao"
            options={colecoes.map((option) => ({ value: option.valor, label: option.valor, meta: formatNumber(option.qtd_skus) }))}
            selected={colecao}
            onChange={setColecao}
            className="w-full"
          />
          <Input label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="OP, codigo ou referencia" />
          <Input label="Inicio da OP" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 self-end h-10">
            <input
              type="checkbox"
              checked={considerarSemReferencia}
              onChange={(e) => setConsiderarSemReferencia(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-[var(--bbtk-red)] focus:ring-[var(--bbtk-red)]"
            />
            Considerar sem referencia
          </label>
          <div className="flex items-end">
            <Button onClick={carregarDados} isLoading={isLoading} className="w-full">Atualizar</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {classificacoes.map((dim) => (
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
        <KPICard title="OPs" value={formatNumber(data?.kpis.ordens || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Pendente" value={formatNumber(data?.kpis.quantidadePendente || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Finalizada" value={formatNumber(data?.kpis.quantidadeFinalizada || 0)} color="green" valueSize="sm" isLoading={isLoading} />
        <KPICard title="% finalizado" value={`${(data?.kpis.percentFinalizado || 0).toFixed(1)}%`} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Refs" value={formatNumber(data?.kpis.referencias || 0)} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title="OPs atrasadas" value={formatNumber(data?.kpis.ordensAtrasadas || 0)} color="red" valueSize="sm" isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <HorizontalKpiChart title="Colecao" data={graficos.colecao} color="#6b5aa6" />
        <HorizontalKpiChart title="Categoria" data={graficos.categoria} color="#d32232" />
        <HorizontalKpiChart title="Linha" data={graficos.linha} color="#2095d2" />
        <DonutKpiChart title="Genero" data={graficos.genero} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{rowsOrdenadas.length} itens de OP</CardTitle>
        </CardHeader>
        <div ref={topScrollRef} onScroll={sincronizarScrollPeloTopo} className="mb-2 overflow-x-auto overflow-y-hidden">
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <Table ref={tabelaScrollRef} className="scrollbar-x-hidden max-h-[640px] overflow-auto" tableClassName="text-[10px] lg:text-xs min-w-[1850px]">
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
                  <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">Nenhum item encontrado</TableCell>
                </TableRow>
              ) : (
                <>
                  {rowsOrdenadas.map((row) => (
                    <TableRow key={row.id} className={row.diasAtraso > 0 ? 'bg-red-50/40' : undefined}>
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
                  <TableRow isHighlighted className="sticky bottom-0 z-10">
                    <TableCell colSpan={15} className="font-bold">TOTAL ({rowsOrdenadas.length} itens)</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.quantidadeOp)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.quantidadeFinalizada)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.quantidadePendente)}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
      </Card>
    </div>
  );
}