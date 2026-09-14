'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
import { formatDate, formatNumber } from '@/lib/utils';
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
  total: number;
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

  const gruposOrdenados = Array.from(grupos.entries())
    .map(([name, item]) => ({ name, value: item.value, ordens: item.ordens.size }))
    .filter((item) => item.value > 0 || item.ordens > 0)
    .sort((a, b) => b.value - a.value);
  const total = gruposOrdenados.reduce((acc, item) => acc + item.value, 0);

  return gruposOrdenados
    .slice(0, limit)
    .map((item) => ({ ...item, total }));
}

function formatQuantidadeComPercentual(value: number, total: number): string {
  const percentual = total > 0 ? (value / total) * 100 : 0;
  return `${formatNumber(value)} (${percentual.toFixed(1)}%)`;
}

function ChartTooltip({ active, payload, total }: { active?: boolean; payload?: Array<{ payload: ChartDatum }>; total: number }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-gray-900">{item.name}</div>
      <div className="text-gray-600">Pendente: {formatQuantidadeComPercentual(item.value, total)}</div>
      <div className="text-gray-600">OPs: {formatNumber(item.ordens)}</div>
    </div>
  );
}

function HorizontalKpiChart({ title, data, color }: { title: string; data: ChartDatum[]; color: string }) {
  const total = data[0]?.total || 0;
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
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, left: 12, bottom: 4 }}>
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
              <Tooltip content={<ChartTooltip total={total} />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={14}>
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(value: number) => formatQuantidadeComPercentual(value, total)}
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
  const total = data[0]?.total || 0;
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
                  <Tooltip content={<ChartTooltip total={total} />} />
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
                  <span className="shrink-0 font-semibold text-gray-900">{formatQuantidadeComPercentual(item.value, total)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

type ResumoQuantidades = Pick<EmProducaoRow, 'quantidadeOp' | 'quantidadeFinalizada' | 'quantidadePendente' | 'percentFinalizado'> & {
  diasAtraso: number;
};

type MatrizTamanho = {
  key: string;
  tamanho: string;
  resumo: ResumoQuantidades;
};

type MatrizCor = {
  key: string;
  cor: string;
  resumo: ResumoQuantidades;
  tamanhos: MatrizTamanho[];
};

type MatrizOpReferencia = {
  key: string;
  row: EmProducaoRow;
  resumo: ResumoQuantidades;
  cores: MatrizCor[];
};

const ORDEM_TAMANHOS = ['UN', 'PP', 'P', 'M', 'G', 'GG', 'XG', 'EG', '2', '4', '6', '8', '10', '12', '14', '16'];

function resumirQuantidades(rows: EmProducaoRow[]): ResumoQuantidades {
  const quantidadeOp = rows.reduce((total, row) => total + row.quantidadeOp, 0);
  const quantidadeFinalizada = rows.reduce((total, row) => total + row.quantidadeFinalizada, 0);
  const quantidadePendente = rows.reduce((total, row) => total + row.quantidadePendente, 0);
  return {
    quantidadeOp,
    quantidadeFinalizada,
    quantidadePendente,
    percentFinalizado: quantidadeOp > 0 ? (quantidadeFinalizada / quantidadeOp) * 100 : 0,
    diasAtraso: Math.max(0, ...rows.map((row) => row.diasAtraso)),
  };
}

function ordenarTamanho(a: MatrizTamanho, b: MatrizTamanho): number {
  const indiceA = ORDEM_TAMANHOS.indexOf(a.tamanho.toUpperCase());
  const indiceB = ORDEM_TAMANHOS.indexOf(b.tamanho.toUpperCase());
  if (indiceA !== -1 || indiceB !== -1) return (indiceA === -1 ? 999 : indiceA) - (indiceB === -1 ? 999 : indiceB);
  return a.tamanho.localeCompare(b.tamanho, 'pt-BR', { numeric: true });
}

function montarMatriz(rows: EmProducaoRow[]): MatrizOpReferencia[] {
  const grupos = new Map<string, EmProducaoRow[]>();

  rows.forEach((row) => {
    const referencia = row.referenceCode?.trim() || `produto-${row.productCode}`;
    const key = `${row.branchCode}-${row.orderCode}-${referencia}`;
    const grupo = grupos.get(key) || [];
    grupo.push(row);
    grupos.set(key, grupo);
  });

  return Array.from(grupos.entries())
    .map(([key, rowsDaOp]) => {
      const gruposCor = new Map<string, EmProducaoRow[]>();
      rowsDaOp.forEach((row) => {
        const cor = row.cor?.trim() || 'Sem cor';
        const grupo = gruposCor.get(cor) || [];
        grupo.push(row);
        gruposCor.set(cor, grupo);
      });

      const cores = Array.from(gruposCor.entries())
        .map(([cor, rowsDaCor]) => {
          const gruposTamanho = new Map<string, EmProducaoRow[]>();
          rowsDaCor.forEach((row) => {
            const tamanho = row.tamanho?.trim() || 'Sem tamanho';
            const grupo = gruposTamanho.get(tamanho) || [];
            grupo.push(row);
            gruposTamanho.set(tamanho, grupo);
          });

          const tamanhos = Array.from(gruposTamanho.entries())
            .map(([tamanho, rowsDoTamanho]) => ({
              key: `${key}-${cor}-${tamanho}`,
              tamanho,
              resumo: resumirQuantidades(rowsDoTamanho),
            }))
            .sort(ordenarTamanho);

          return {
            key: `${key}-${cor}`,
            cor,
            resumo: resumirQuantidades(rowsDaCor),
            tamanhos,
          };
        })
        .sort((a, b) => b.resumo.quantidadePendente - a.resumo.quantidadePendente || a.cor.localeCompare(b.cor, 'pt-BR'));

      return {
        key,
        row: rowsDaOp[0],
        resumo: resumirQuantidades(rowsDaOp),
        cores,
      };
    })
    .sort((a, b) => b.resumo.quantidadePendente - a.resumo.quantidadePendente || a.row.orderCode - b.row.orderCode);
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
  const [opsExpandidas, setOpsExpandidas] = useState<Set<string>>(() => new Set());
  const [coresExpandidas, setCoresExpandidas] = useState<Set<string>>(() => new Set());
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

  const rowsDetalhados = useMemo(() => data?.rows || [], [data]);
  const matriz = useMemo(() => montarMatriz(rowsDetalhados), [rowsDetalhados]);

  function alternarExpandido(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
    setter((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(key)) proximo.delete(key);
      else proximo.add(key);
      return proximo;
    });
  }


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
  }, [matriz.length, opsExpandidas, coresExpandidas, isLoading]);

  function sincronizarScrollPeloTopo() {
    const topo = topScrollRef.current;
    const tabela = tabelaScrollRef.current;
    if (!topo || !tabela) return;
    tabela.scrollLeft = topo.scrollLeft;
  }
  const totais = useMemo(() => {
    return rowsDetalhados.reduce(
      (acc, row) => {
        acc.quantidadeOp += row.quantidadeOp;
        acc.quantidadeFinalizada += row.quantidadeFinalizada;
        acc.quantidadePendente += row.quantidadePendente;
        return acc;
      },
      { quantidadeOp: 0, quantidadeFinalizada: 0, quantidadePendente: 0 }
    );
  }, [rowsDetalhados]);


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
    if (!data || rowsDetalhados.length === 0) return;
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
      data: rowsDetalhados as unknown as Record<string, unknown>[],
      totals: {
        branchName: `TOTAL (${rowsDetalhados.length} itens)`,
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
        <Button onClick={exportarExcel} disabled={!data || rowsDetalhados.length === 0 || isLoading} variant="secondary">
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
        <HorizontalKpiChart title="Linha" data={graficos.linha} color="#2095d2" />
        <HorizontalKpiChart title="Categoria" data={graficos.categoria} color="#d32232" />
        <HorizontalKpiChart title="Colecao" data={graficos.colecao} color="#6b5aa6" />
        <DonutKpiChart title="Genero" data={graficos.genero} />
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{matriz.length} OPs / referências</CardTitle>
            <p className="mt-1 text-xs font-normal text-gray-500">Clique na OP para ver as cores e, depois, na cor para detalhar os tamanhos.</p>
          </div>
        </CardHeader>
        <div ref={topScrollRef} onScroll={sincronizarScrollPeloTopo} className="mb-2 overflow-x-auto overflow-y-hidden">
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <Table ref={tabelaScrollRef} className="scrollbar-x-hidden max-h-[640px] overflow-auto" tableClassName="text-[10px] lg:text-xs min-w-[1480px]">
            <TableHead className="sticky top-0 z-10">
              <TableRow>
                <TableCell isHeader className="whitespace-nowrap !px-2 !py-2">OP / REFERÊNCIA</TableCell>
                <TableCell isHeader className="whitespace-nowrap !px-2 !py-2">COR / TAMANHO</TableCell>
                <TableCell isHeader className="whitespace-nowrap !px-2 !py-2">FILIAL</TableCell>
                <TableCell isHeader className="whitespace-nowrap !px-2 !py-2">STATUS</TableCell>
                <TableCell isHeader align="center" className="whitespace-nowrap !px-2 !py-2">INÍCIO</TableCell>
                <TableCell isHeader align="center" className="whitespace-nowrap !px-2 !py-2">PREVISÃO</TableCell>
                <TableCell isHeader align="right" className="whitespace-nowrap !px-2 !py-2">QTDE OP</TableCell>
                <TableCell isHeader align="right" className="whitespace-nowrap !px-2 !py-2">FINALIZADA</TableCell>
                <TableCell isHeader align="right" className="whitespace-nowrap !px-2 !py-2">PENDENTE</TableCell>
                <TableCell isHeader align="right" className="whitespace-nowrap !px-2 !py-2">% FINAL.</TableCell>
                <TableCell isHeader align="right" className="whitespace-nowrap !px-2 !py-2">ATRASO</TableCell>
                <TableCell isHeader className="whitespace-nowrap !px-2 !py-2">COLEÇÃO</TableCell>
                <TableCell isHeader className="whitespace-nowrap !px-2 !py-2">CATEGORIA</TableCell>
                <TableCell isHeader className="whitespace-nowrap !px-2 !py-2">LINHA</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={14} align="center" className="py-10 text-gray-500">Carregando...</TableCell>
                </TableRow>
              ) : matriz.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} align="center" className="py-10 text-gray-500">Nenhum item encontrado</TableCell>
                </TableRow>
              ) : (
                <>
                  {matriz.map((op) => {
                    const opExpandida = opsExpandidas.has(op.key);
                    return (
                      <Fragment key={op.key}>
                        <TableRow key={op.key} className={op.resumo.diasAtraso > 0 ? 'bg-red-50/40' : 'bg-white'}>
                          <TableCell className="!px-2 !py-2">
                            <button type="button" onClick={() => alternarExpandido(setOpsExpandidas, op.key)} aria-expanded={opExpandida} className="flex max-w-[280px] items-start gap-1.5 text-left font-semibold text-gray-900 hover:text-[var(--bbtk-purple)]">
                              <span className="mt-0.5 text-gray-400">{opExpandida ? '−' : '+'}</span>
                              <span className="min-w-0"><span className="block truncate">OP {formatNumber(op.row.orderCode)} · {op.row.referenceCode || `Cód. ${op.row.productCode}`}</span><span className="block truncate text-[10px] font-normal text-gray-500" title={op.row.descricao}>{op.row.descricao}</span></span>
                            </button>
                          </TableCell>
                          <TableCell className="!px-2 !py-2 text-gray-400">{op.cores.length} {op.cores.length === 1 ? 'cor' : 'cores'}</TableCell>
                          <TableCell className="whitespace-nowrap !px-2 !py-2">{op.row.branchName}</TableCell>
                          <TableCell className="whitespace-nowrap !px-2 !py-2">{op.row.statusLabel}</TableCell>
                          <TableCell align="center" className="whitespace-nowrap !px-2 !py-2">{op.row.dtInicio ? formatDate(op.row.dtInicio) : '-'}</TableCell>
                          <TableCell align="center" className="whitespace-nowrap !px-2 !py-2">{op.row.dtPrevisao ? formatDate(op.row.dtPrevisao) : '-'}</TableCell>
                          <TableCell align="right" className="whitespace-nowrap !px-2 !py-2 font-semibold">{formatNumber(op.resumo.quantidadeOp)}</TableCell>
                          <TableCell align="right" className="whitespace-nowrap !px-2 !py-2 font-semibold">{formatNumber(op.resumo.quantidadeFinalizada)}</TableCell>
                          <TableCell align="right" className="whitespace-nowrap !px-2 !py-2 font-semibold">{formatNumber(op.resumo.quantidadePendente)}</TableCell>
                          <TableCell align="right" className="whitespace-nowrap !px-2 !py-2 font-semibold">{op.resumo.percentFinalizado.toFixed(1)}%</TableCell>
                          <TableCell align="right" className={op.resumo.diasAtraso > 0 ? 'whitespace-nowrap !px-2 !py-2 font-semibold text-red-600' : 'whitespace-nowrap !px-2 !py-2'}>{op.resumo.diasAtraso > 0 ? `${op.resumo.diasAtraso}d` : '-'}</TableCell>
                          <TableCell className="whitespace-nowrap !px-2 !py-2">{op.row.colecao || '-'}</TableCell>
                          <TableCell className="whitespace-nowrap !px-2 !py-2">{op.row.categoria || '-'}</TableCell>
                          <TableCell className="whitespace-nowrap !px-2 !py-2">{op.row.linha || '-'}</TableCell>
                        </TableRow>
                        {opExpandida && op.cores.map((cor) => {
                          const corExpandida = coresExpandidas.has(cor.key);
                          return (
                            <Fragment key={cor.key}>
                              <TableRow key={cor.key} className="bg-slate-50/70">
                                <TableCell className="!px-2 !py-2" />
                                <TableCell className="!px-2 !py-2">
                                  <button type="button" onClick={() => alternarExpandido(setCoresExpandidas, cor.key)} aria-expanded={corExpandida} className="flex max-w-[220px] items-center gap-1.5 pl-4 text-left font-medium text-gray-700 hover:text-[var(--bbtk-purple)]">
                                    <span className="text-gray-400">{corExpandida ? '−' : '+'}</span>
                                    <span className="truncate">{cor.cor}</span>
                                  </button>
                                </TableCell>
                                <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{formatNumber(cor.resumo.quantidadeOp)}</TableCell>
                                <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{formatNumber(cor.resumo.quantidadeFinalizada)}</TableCell>
                                <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{formatNumber(cor.resumo.quantidadePendente)}</TableCell>
                                <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{cor.resumo.percentFinalizado.toFixed(1)}%</TableCell>
                                <TableCell align="right" className={cor.resumo.diasAtraso > 0 ? 'whitespace-nowrap !px-2 !py-2 text-red-600' : 'whitespace-nowrap !px-2 !py-2'}>{cor.resumo.diasAtraso > 0 ? `${cor.resumo.diasAtraso}d` : '-'}</TableCell>
                                <TableCell colSpan={7} className="!px-2 !py-2 text-gray-400">{cor.tamanhos.length} {cor.tamanhos.length === 1 ? 'tamanho' : 'tamanhos'}</TableCell>
                              </TableRow>
                              {corExpandida && cor.tamanhos.map((tamanho) => (
                                <TableRow key={tamanho.key} className="bg-white">
                                  <TableCell className="!px-2 !py-2" />
                                  <TableCell className="!px-2 !py-2 pl-12 font-medium text-gray-600">{tamanho.tamanho}</TableCell>
                                  <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{formatNumber(tamanho.resumo.quantidadeOp)}</TableCell>
                                  <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{formatNumber(tamanho.resumo.quantidadeFinalizada)}</TableCell>
                                  <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{formatNumber(tamanho.resumo.quantidadePendente)}</TableCell>
                                  <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{tamanho.resumo.percentFinalizado.toFixed(1)}%</TableCell>
                                  <TableCell align="right" className={tamanho.resumo.diasAtraso > 0 ? 'whitespace-nowrap !px-2 !py-2 text-red-600' : 'whitespace-nowrap !px-2 !py-2'}>{tamanho.resumo.diasAtraso > 0 ? `${tamanho.resumo.diasAtraso}d` : '-'}</TableCell>
                                  <TableCell colSpan={7} className="!px-2 !py-2 text-gray-300">—</TableCell>
                                </TableRow>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  <TableRow isHighlighted className="sticky bottom-0 z-10">
                    <TableCell colSpan={6} className="font-bold">TOTAL ({rowsDetalhados.length} itens)</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.quantidadeOp)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.quantidadeFinalizada)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatNumber(totais.quantidadePendente)}</TableCell>
                    <TableCell colSpan={5} />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
      </Card>
    </div>
  );
}
