'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { KPICard } from '@/components/dashboard/KPICard';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  SugestaoProducaoFiltrosResponse,
  SugestaoProducaoOpDetalhe,
  SugestaoProducaoResponse,
  sugestaoProducaoApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { ExcelColumn, exportToExcel } from '@/lib/exportExcel';
import {
  folhasSugestaoProducao, linhasVisiveisSugestaoProducao, montarMatrizSugestaoProducao,
  somarMetricasSugestao, type ModoCorSugestao, type SugestaoMatrizNo, type SugestaoMatrizSortKey,
} from '@/lib/sugestaoProducaoMatriz';

type SortKey = SugestaoMatrizSortKey;
const REFERENCIAS_POR_PAGINA = 50;

const COLUNAS: Array<{ key: SortKey; label: string; align?: 'left' | 'right' | 'center'; type?: 'text' | 'number'; width: number }> = [
  { key: 'referenceCode', label: 'REFERÊNCIA / COR / TAMANHO', width: 34, type: 'text' },
  { key: 'descricao', label: 'DESCRICAO', width: 28, type: 'text' },
  { key: 'categoria', label: 'CATEGORIA', width: 14, type: 'text' },
  { key: 'linha', label: 'LINHA', width: 14, type: 'text' },
  { key: 'estoqueAtual', label: 'EST. ATUAL', align: 'right', width: 13, type: 'number' },
  { key: 'emProducao', label: 'EM PROD.', align: 'right', width: 13, type: 'number' },
  { key: 'estoqueFuturo', label: 'EST. FUTURO', align: 'right', width: 14, type: 'number' },
  { key: 'vendaPeriodoAtual', label: 'VENDA ATUAL', align: 'right', width: 15, type: 'number' },
  { key: 'vendaPeriodoAnterior', label: 'VENDA ANT.', align: 'right', width: 17, type: 'number' },
  { key: 'vendaMediaMensal', label: 'VENDA MEDIA', align: 'right', width: 15, type: 'number' },
  { key: 'estoqueMinimo', label: 'EST. MINIMO', align: 'right', width: 14, type: 'number' },
  { key: 'corteMinimo', label: 'CORTE MIN.', align: 'right', width: 12, type: 'number' },
  { key: 'sugestaoProducao', label: 'SUGESTAO', align: 'right', width: 16, type: 'number' },
];

const STATUS_OP_BADGE: Record<number, string> = {
  5: 'bg-gray-100 text-gray-600',
  10: 'bg-yellow-100 text-yellow-700',
  20: 'bg-blue-100 text-blue-700',
};

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
      className={cn('cursor-pointer select-none whitespace-nowrap bg-gray-50 hover:bg-gray-100 !px-1.5 !py-1.5', coluna.key === 'referenceCode' && 'sticky left-0 z-30 min-w-[280px]')}
    >
      <span className={cn('flex items-center gap-1.5', coluna.align === 'right' && 'justify-end', coluna.align === 'center' && 'justify-center')}>
        <span>{coluna.label}</span>
        <span className={active ? 'text-[var(--bbtk-purple)]' : 'text-gray-300'}>{active && sortDir === 'desc' ? 'v' : '^'}</span>
      </span>
    </TableCell>
  );
}

function formatCell(row: SugestaoMatrizNo, key: SortKey): string {
  const value = row[key];
  if (key === 'corteMinimo' && value === null && row.cortesMinimos.length > 1) return 'Variável';
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return formatNumber(value, key === 'vendaMediaMensal' ? 2 : 0);
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
  const [modoCor, setModoCor] = useState<ModoCorSugestao>('padrao');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(1);
  const requisicaoAtual = useRef(0);
  const requisicaoOpsAtual = useRef(0);
  const tabelaScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [opsModalRow, setOpsModalRow] = useState<SugestaoMatrizNo | null>(null);
  const [opsModalData, setOpsModalData] = useState<SugestaoProducaoOpDetalhe[] | null>(null);
  const [opsModalLoading, setOpsModalLoading] = useState(false);

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
    const requisicao = ++requisicaoAtual.current;
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
      if (requisicao !== requisicaoAtual.current) return;
      setData(response);
      setPagina(1);
    } catch (error) {
      if (requisicao !== requisicaoAtual.current) return;
      setData(null);
      showToast(error instanceof Error ? error.message : 'Erro ao carregar Sugestao de Producao', 'error');
      console.error(error);
    } finally {
      if (requisicao === requisicaoAtual.current) setIsLoading(false);
    }
  }, [token, produtoFiltro, search, apenasComSugestao, showToast]);

  useEffect(() => {
    carregarDados();
    return () => { requisicaoAtual.current += 1; };
  }, [carregarDados]);

  async function abrirOpsModal(row: SugestaoMatrizNo) {
    if (!row.productCodes.length || row.emProducao <= 0 || !token) return;
    const requisicao = ++requisicaoOpsAtual.current;
    setOpsModalRow(row);
    setOpsModalData(null);
    setOpsModalLoading(true);
    try {
      const ops = await sugestaoProducaoApi.getOpsDetalheGrupo(token, row.productCodes);
      if (requisicao === requisicaoOpsAtual.current) setOpsModalData(ops);
    } catch (error) {
      if (requisicao !== requisicaoOpsAtual.current) return;
      showToast(error instanceof Error ? error.message : 'Erro ao carregar OPs', 'error');
      console.error(error);
    } finally {
      if (requisicao === requisicaoOpsAtual.current) setOpsModalLoading(false);
    }
  }

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

  const matriz = useMemo(() => montarMatrizSugestaoProducao(data?.rows || [], modoCor, sortKey, sortDir), [data, modoCor, sortKey, sortDir]);
  const totalPaginas = Math.max(1, Math.ceil(matriz.length / REFERENCIAS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const referenciasPagina = useMemo(() => matriz.slice((paginaAtual - 1) * REFERENCIAS_POR_PAGINA, paginaAtual * REFERENCIAS_POR_PAGINA), [matriz, paginaAtual]);
  const linhasVisiveis = useMemo(() => linhasVisiveisSugestaoProducao(referenciasPagina, expandidos), [referenciasPagina, expandidos]);

  function alternarNo(key: string) {
    setExpandidos((atual) => {
      const proximos = new Set(atual);
      if (proximos.has(key)) proximos.delete(key);
      else proximos.add(key);
      return proximos;
    });
  }

  function expandirPagina(expandir: boolean) {
    setExpandidos((atual) => {
      const proximos = new Set(atual);
      for (const ref of referenciasPagina) {
        for (const no of [ref, ...ref.children]) {
          if (expandir) proximos.add(no.key);
          else proximos.delete(no.key);
        }
      }
      return proximos;
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
  }, [linhasVisiveis.length, isLoading, modoCor]);

  function sincronizarScrollPeloTopo() {
    const topo = topScrollRef.current;
    const tabela = tabelaScrollRef.current;
    if (!topo || !tabela) return;
    tabela.scrollLeft = topo.scrollLeft;
  }

  const totais = useMemo(() => somarMetricasSugestao(data?.rows || []), [data]);

  function exportarExcel() {
    if (!data || !matriz.length) return;
    const descricoes = new Map(matriz.map((referencia) => [referencia.referenceCode, referencia.descricao]));
    const columns: ExcelColumn[] = [
      { key: 'referenceCode', header: 'REFERÊNCIA', width: 20, type: 'text' },
      { key: 'cor', header: modoCor === 'agrupada' ? 'COR AGRUPADA' : 'COR PADRÃO', width: 22, type: 'text' },
      { key: 'tamanho', header: 'TAMANHO', width: 10, type: 'text' },
      { key: 'skusOriginais', header: 'SKUS ORIGINAIS', width: 36, type: 'text' },
      { key: 'coresOriginais', header: 'CORES ORIGINAIS', width: 28, type: 'text' },
      ...COLUNAS.filter((coluna) => coluna.key !== 'referenceCode').map((coluna) => ({ key: coluna.key, header: coluna.label, width: coluna.width, type: coluna.type })),
      { key: 'cortesMinimos', header: 'CORTES MÍNIMOS POR SKU', width: 22, type: 'text' },
    ];
    exportToExcel({
      filename: `Sugestao_Producao_${modoCor}_${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Sugestao Producao',
      title: 'Relatorio Sugestao de Producao',
      columns,
      data: folhasSugestaoProducao(matriz).map((no) => ({
        ...no, descricao: descricoes.get(no.referenceCode), corteMinimo: no.corteMinimo ?? '', skusOriginais: no.skus.join(', '),
        coresOriginais: no.coresOriginais.join(', '), cortesMinimos: no.cortesMinimos.join(' / '),
      })),
      totals: {
        ...totais, corteMinimo: '', referenceCode: `TOTAL (${matriz.length} REFERÊNCIAS)`,
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
        <Button onClick={exportarExcel} disabled={!data || !matriz.length || isLoading} variant="secondary">
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
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <span className="text-xs font-semibold uppercase text-gray-500">Exibir cores</span>
          <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
            {(['padrao', 'agrupada'] as const).map((modo) => (
              <button key={modo} type="button" aria-pressed={modoCor === modo} onClick={() => setModoCor(modo)}
                className={cn('px-4 py-2 text-xs font-semibold transition-colors', modoCor === modo ? 'bg-[var(--bbtk-red)] text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>
                {modo === 'padrao' ? 'COR PADRÃO' : 'COR AGRUPADA'}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-500">Cores sem agrupamento cadastrado mantêm a cor padrão.</span>
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
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Matriz de Sugestão de Produção</CardTitle>
            <p className="mt-1 text-xs text-gray-500">Referência → Cor → Tamanho · Clique em + para detalhar</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => expandirPagina(true)} disabled={isLoading || !matriz.length}>Expandir página</Button>
            <Button size="sm" variant="secondary" onClick={() => expandirPagina(false)} disabled={isLoading || !matriz.length}>Recolher página</Button>
          </div>
        </CardHeader>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>{matriz.length ? (paginaAtual - 1) * REFERENCIAS_POR_PAGINA + 1 : 0}–{Math.min(paginaAtual * REFERENCIAS_POR_PAGINA, matriz.length)} de {formatNumber(matriz.length)} referências · {formatNumber(data?.rows.length || 0)} SKUs no resultado</span>
          {totalPaginas > 1 && <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPagina(paginaAtual - 1)} disabled={isLoading || paginaAtual === 1}>Anterior</Button>
            <span>Página {paginaAtual} de {totalPaginas}</span>
            <Button size="sm" variant="secondary" onClick={() => setPagina(paginaAtual + 1)} disabled={isLoading || paginaAtual === totalPaginas}>Próxima</Button>
          </div>}
        </div>

        <div ref={topScrollRef} onScroll={sincronizarScrollPeloTopo} className="mb-2 overflow-x-auto overflow-y-hidden">
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <Table ref={tabelaScrollRef} className="scrollbar-x-hidden max-h-[760px] overflow-auto" tableClassName="text-[10px] lg:text-xs min-w-[1500px]">
          <TableHead className="sticky top-0 z-30">
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
            ) : matriz.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">Nenhum SKU encontrado</TableCell>
              </TableRow>
            ) : (
              <>
                {linhasVisiveis.map((row) => (
                  <TableRow key={row.key} className={cn(row.nivel === 'referencia' ? 'bg-slate-100 font-semibold' : row.nivel === 'cor' ? 'bg-slate-50 font-medium' : 'bg-white')}>
                    {COLUNAS.map((coluna) => (
                      <TableCell key={coluna.key} align={coluna.align}
                        className={cn('whitespace-nowrap !px-1.5 !py-1.5', coluna.key === 'referenceCode' && 'sticky left-0 z-10 min-w-[280px] max-w-[320px] bg-inherit !px-3')}>
                        {coluna.key === 'referenceCode' ? (
                          <div className={cn(row.nivel === 'cor' && 'pl-5', row.nivel === 'tamanho' && 'pl-10')}>
                            {row.children.length > 0 ? <button type="button" onClick={() => alternarNo(row.key)} aria-expanded={expandidos.has(row.key)}
                              aria-label={`${expandidos.has(row.key) ? 'Recolher' : 'Expandir'} ${row.nivel === 'referencia' ? 'referência' : 'cor'} ${row.label}`}
                              className="flex w-full items-center gap-2 text-left" title={row.coresOriginais.join(', ')}>
                              <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-gray-400 bg-white text-xs font-normal text-gray-600">{expandidos.has(row.key) ? '−' : '+'}</span>
                              <span className="max-w-[240px] truncate">{row.label}</span>
                            </button> : <div className="flex items-center gap-2">
                              <span aria-hidden="true" className="w-4 text-center text-gray-400">·</span>
                              <span>Tamanho {row.label}</span>
                            </div>}
                            <div className="ml-6 mt-0.5 max-w-[230px] truncate text-[10px] font-normal text-gray-500" title={row.skus.join(', ')}>
                              {row.nivel === 'tamanho' && row.skus.length === 1 ? `SKU ${row.skus[0]}` : `${row.skus.length} SKUs${row.nivel === 'cor' && row.coresOriginais.length > 1 ? ` · ${row.coresOriginais.length} cores` : ''}`}
                            </div>
                          </div>
                        ) : coluna.key === 'descricao' ? (
                          <span className="block max-w-[200px] truncate" title={row.descricao}>{row.descricao}</span>
                        ) : coluna.key === 'sugestaoProducao' && row.sugestaoProducao > 0 ? (
                          <span className="font-semibold text-[var(--bbtk-red)]">{formatNumber(row.sugestaoProducao)}</span>
                        ) : coluna.key === 'emProducao' && row.emProducao > 0 && row.productCodes.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => abrirOpsModal(row)}
                            className="font-medium text-[var(--bbtk-purple)] underline decoration-dotted underline-offset-2 hover:text-[var(--bbtk-red)]"
                            title="Ver OPs em produção desta seleção"
                          >
                            {formatNumber(row.emProducao)}
                          </button>
                        ) : (
                          <span title={coluna.key === 'corteMinimo' ? `Corte mínimo por SKU: ${row.cortesMinimos.join(' / ')}` : undefined}
                            className={typeof row[coluna.key] === 'number' && Number(row[coluna.key]) < 0 ? 'text-red-700' : undefined}>{formatCell(row, coluna.key)}</span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow isHighlighted className="sticky bottom-0 z-20 bg-yellow-50 shadow-[0_-1px_0_rgba(148,163,184,0.35)]">
                  {COLUNAS.map((coluna) => {
                    const value = coluna.key in totais ? totais[coluna.key as keyof typeof totais] : null;
                    return <TableCell key={coluna.key} align={coluna.align} className={cn('whitespace-nowrap !px-1.5 font-bold', coluna.key === 'referenceCode' && 'sticky left-0 z-30 bg-yellow-50 !px-3')}>
                      {coluna.key === 'referenceCode' ? 'TOTAL DO RESULTADO' : coluna.key === 'descricao' ? `${formatNumber(matriz.length)} referências · todas as páginas` : coluna.key !== 'corteMinimo' && typeof value === 'number' ? formatNumber(value, coluna.key === 'vendaMediaMensal' ? 2 : 0) : '—'}
                    </TableCell>;
                  })}
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-gray-500">Os subtotais somam as sugestões calculadas por SKU. O corte mínimo continua sendo aplicado por SKU; “Variável” indica cortes diferentes no grupo.</p>
      </Card>

      <Modal
        isOpen={!!opsModalRow}
        onClose={() => { requisicaoOpsAtual.current += 1; setOpsModalRow(null); setOpsModalLoading(false); }}
        title={opsModalRow ? `OPs em produção — ${[opsModalRow.referenceCode, opsModalRow.cor, opsModalRow.tamanho].filter(Boolean).join(' · ')}` : 'OPs em produção'}
        size="lg"
      >
        {opsModalLoading ? (
          <p className="py-8 text-center text-gray-500 text-sm">Carregando...</p>
        ) : !opsModalData || opsModalData.length === 0 ? (
          <p className="py-8 text-center text-gray-500 text-sm">Nenhuma OP em aberto encontrada para esta seleção</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="px-2 py-1.5 text-left font-semibold">OP</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Filial</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Status</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Inicio</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Previsao</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Qtd. OP</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Finalizada</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Pendente</th>
                </tr>
              </thead>
              <tbody>
                {opsModalData.map((op) => (
                  <tr key={`${op.orderCode}-${op.branchCode}-${op.status}-${op.dtInicio}-${op.dtPrevisao}`} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 font-medium">{op.orderCode}</td>
                    <td className="px-2 py-1.5">{op.branchName}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium', STATUS_OP_BADGE[op.status] || 'bg-gray-100 text-gray-600')}>
                        {op.statusLabel}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{op.dtInicio ? formatDate(op.dtInicio) : '-'}</td>
                    <td className="px-2 py-1.5">{op.dtPrevisao ? formatDate(op.dtPrevisao) : '-'}</td>
                    <td className="px-2 py-1.5 text-right">{formatNumber(op.quantidadeOp)}</td>
                    <td className="px-2 py-1.5 text-right">{formatNumber(op.quantidadeFinalizada)}</td>
                    <td className="px-2 py-1.5 text-right">{formatNumber(op.quantidadePendente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
