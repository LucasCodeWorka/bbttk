'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { KPICard } from '@/components/dashboard/KPICard';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Badge, VariationBadge } from '@/components/ui/Badge';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { vendasApi, VendasResponse, VendasDiariasResponse, ComparativoAnoResponse, VendedoresResponse, TopProdutosResponse, ProjecaoFiliaisResponse, FilialComparativo, ProjecaoFilial, ProdutoFiltro, ClassificacaoDimensao } from '@/lib/api';
import { formatMoney, formatNumber, FILIAIS, getMonthStart, getToday, isMesUnico } from '@/lib/utils';
import { exportToXlsx, XlsxCellStyle } from '@/lib/exportXlsx';
import { useAuth } from '@/contexts/AuthContext';

type LinhaComparativo = FilialComparativo & { proj?: ProjecaoFilial; bateMeta: boolean | null; debitoMeta: number | null; isTotal?: boolean };

// Valor numerico de cada coluna ordenavel, usado tanto pro clique no cabecalho quanto pro export
const SORT_GETTERS: Record<string, (f: LinhaComparativo) => number> = {
  debito_meta: (f) => f.debitoMeta ?? -Infinity,
  faturamento: (f) => f.atual.faturamento,
  pct_tt_faturamento: (f) => f.atual.pct_tt_faturamento,
  fat_ant: (f) => f.ano_anterior.faturamento,
  var_faturamento: (f) => f.variacao.faturamento,
  pecas: (f) => f.atual.pecas,
  pct_tt_pecas: (f) => f.atual.pct_tt_pecas,
  pecas_ant: (f) => f.ano_anterior.pecas,
  var_pecas: (f) => f.variacao.pecas,
  pm: (f) => f.atual.pm,
  pm_ant: (f) => f.ano_anterior.pm,
  var_pm: (f) => f.variacao.pm,
  tm: (f) => f.atual.tm,
  tm_ant: (f) => f.ano_anterior.tm,
  var_tm: (f) => f.variacao.tm,
  pa: (f) => f.atual.pa,
  pa_ant: (f) => f.ano_anterior.pa,
  var_pa: (f) => f.variacao.pa,
  clientes: (f) => f.atual.clientes,
  clientes_ant: (f) => f.ano_anterior.clientes,
  var_clientes: (f) => f.variacao.clientes,
  atendimento: (f) => f.atual.transacoes,
  atendimento_ant: (f) => f.ano_anterior.transacoes,
  var_atendimento: (f) => f.variacao.transacoes,
  devolucoes_valor: (f) => f.devolucoes.valor,
  devolucoes_qtde: (f) => f.devolucoes.qtde,
  devolucoes_pct: (f) => f.devolucoes.pct,
  pct_cn: (f) => f.clientes_novos.pct,
  clientes_novos: (f) => f.clientes_novos.qtde,
  faturamento_cn: (f) => f.clientes_novos.faturamento,
  meta: (f) => f.meta.valor,
  pct_meta: (f) => f.meta.pct,
  meta_dia: (f) => f.meta.meta_dia,
  projecao: (f) => f.proj?.projecao ?? -Infinity,
  pct_proj: (f) => f.meta.valor > 0 && f.proj ? (f.proj.projecao / f.meta.valor) * 100 : -Infinity,
  vs_ano_ant: (f) => f.proj?.variacao_vs_ano_anterior ?? -Infinity,
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [dataInicio, setDataInicio] = useState(getMonthStart());
  const [dataFim, setDataFim] = useState(getToday());
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [limiteRankingVendedores, setLimiteRankingVendedores] = useState<'10' | '20' | 'todos'>('10');
  const [graficoVendasModo, setGraficoVendasModo] = useState<'dia' | 'hora'>('dia');
  const comparativoScrollRef = useRef<HTMLDivElement>(null);
  const comparativoTopScrollRef = useRef<HTMLDivElement>(null);
  const [comparativoScrollWidth, setComparativoScrollWidth] = useState(0);

  function rolarComparativo(direcao: 'esquerda' | 'direita') {
    comparativoScrollRef.current?.scrollBy({ left: direcao === 'esquerda' ? -320 : 320, behavior: 'smooth' });
  }

  function sincronizarComparativoPeloTopo() {
    const topo = comparativoTopScrollRef.current;
    const tabela = comparativoScrollRef.current;
    if (!topo || !tabela) return;
    tabela.scrollLeft = topo.scrollLeft;
  }

  // Filtro de classificacao de produto (categoria, genero, grupo, linha, colecao, tecido)
  const [classificacoes, setClassificacoes] = useState<ClassificacaoDimensao[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<ProdutoFiltro>({});

  // Dados
  const [vendas, setVendas] = useState<VendasResponse | null>(null);
  const [vendasDiarias, setVendasDiarias] = useState<VendasDiariasResponse | null>(null);
  const [comparativo, setComparativo] = useState<ComparativoAnoResponse | null>(null);
  const [vendedores, setVendedores] = useState<VendedoresResponse | null>(null);
  const [produtos, setProdutos] = useState<TopProdutosResponse | null>(null);
  const [projecao, setProjecao] = useState<ProjecaoFiliaisResponse | null>(null);

  const mesUnico = isMesUnico(dataInicio, dataFim);

  const carregarDados = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchCodes = filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined;
      const granularidade = isMesUnico(dataInicio, dataFim) ? 'diario' : 'mensal';

      const [vendasRes, diariasRes, compRes, vendRes, prodRes, projRes] = await Promise.all([
        vendasApi.getPeriodo(dataInicio, dataFim, branchCodes, produtoFiltro),
        graficoVendasModo === 'hora'
          ? vendasApi.getHorarias(dataInicio, dataFim, branchCodes, produtoFiltro)
          : granularidade === 'diario'
            ? vendasApi.getDiarias(dataInicio, dataFim, branchCodes, produtoFiltro)
            : vendasApi.getMensais(dataInicio, dataFim, branchCodes, produtoFiltro),
        vendasApi.getComparativoAno(dataInicio, dataFim, branchCodes, produtoFiltro),
        vendasApi.getVendedores(dataInicio, dataFim, branchCodes, produtoFiltro),
        vendasApi.getTopProdutos(dataInicio, dataFim, branchCodes, produtoFiltro),
        vendasApi.getProjecaoFiliais(produtoFiltro),
      ]);

      setVendas(vendasRes);
      setVendasDiarias(diariasRes);
      setComparativo(compRes);
      setVendedores(vendRes);
      setProdutos(prodRes);
      setProjecao(projRes);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dataInicio, dataFim, filiaisSelecionadas, produtoFiltro, graficoVendasModo]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Carrega as opcoes de classificacao de produto uma unica vez
  useEffect(() => {
    vendasApi.getClassificacoes()
      .then((res) => setClassificacoes(res.dimensoes))
      .catch((error) => console.error('Erro ao carregar classificacoes:', error));
  }, []);

  function atualizarProdutoFiltro(chave: keyof ProdutoFiltro, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  // Filtrar filiais do usuário
  const filiaisDisponiveis = Object.entries(FILIAIS)
    .filter(([code]) => {
      if (user?.role === 'admin') return true;
      return user?.branchCodes.includes(parseInt(code));
    })
    .map(([code, name]) => ({ value: code, label: name }));

  const filialOptions = filiaisDisponiveis.map((f) => ({ value: parseInt(f.value), label: f.label }));

  // Dados para o gráfico de barras - todas as filiais, nao so as primeiras 8
  const dadosBarras = vendas?.filiais?.map(f => ({
    name: f.branch_name,
    value: f.faturamento,
  })) || [];

  // Criar mapa de projeções
  const projecaoMap = new Map(projecao?.filiais.map(p => [p.branch_code, p]));

  // Linhas da tabela Comparativo, ja com projecao/bateMeta anexados e ordenadas
  // pela coluna clicada (default: numero da filial, crescente)
  const linhas: LinhaComparativo[] = useMemo(() => {
    const base = (comparativo?.filiais || []).map((f) => {
      const proj = projecaoMap.get(f.branch_code);
      const bateMeta = f.meta.valor > 0 && proj ? proj.projecao >= f.meta.valor : null;
      const debitoMeta = f.meta.valor > 0 ? Math.max(0, f.meta.valor - f.atual.faturamento) : null;
      return { ...f, proj, bateMeta, debitoMeta };
    });

    if (sortKey === 'branch_name' || !sortKey) {
      base.sort((a, b) => (a.branch_code - b.branch_code) * (sortKey === 'branch_name' && sortDir === 'desc' ? -1 : 1));
      return base;
    }

    const getter = SORT_GETTERS[sortKey];
    if (getter) {
      base.sort((a, b) => (getter(a) - getter(b)) * (sortDir === 'asc' ? 1 : -1));
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparativo, projecao, sortKey, sortDir]);

  const vendedoresRanking = useMemo(() => {
    const lista = vendedores?.vendedores || [];
    if (limiteRankingVendedores === 'todos') return lista;
    return lista.slice(0, Number(limiteRankingVendedores));
  }, [vendedores, limiteRankingVendedores]);

  const totaisVendedoresRanking = useMemo(() => {
    const faturamento = vendedoresRanking.reduce((sum, v) => sum + v.faturamento, 0);
    const meta = vendedoresRanking.reduce((sum, v) => sum + v.meta, 0);
    const debitoMeta = vendedoresRanking.reduce((sum, v) => sum + v.debito_meta, 0);
    const projecaoTotal = vendedoresRanking.reduce((sum, v) => sum + v.projecao, 0);
    const pecas = vendedoresRanking.reduce((sum, v) => sum + v.pecas, 0);
    const transacoes = vendedoresRanking.reduce((sum, v) => sum + v.transacoes, 0);

    return {
      faturamento,
      meta,
      debitoMeta,
      pctMeta: meta > 0 ? (faturamento / meta) * 100 : 0,
      pctProj: meta > 0 ? (projecaoTotal / meta) * 100 : 0,
      pa: transacoes > 0 ? pecas / transacoes : 0,
      tm: transacoes > 0 ? faturamento / transacoes : 0,
    };
  }, [vendedoresRanking]);
  useEffect(() => {
    const tabela = comparativoScrollRef.current;
    const topo = comparativoTopScrollRef.current;
    if (!tabela || !topo) return;

    let frame = 0;
    const atualizarLargura = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setComparativoScrollWidth(tabela.scrollWidth);
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
    const tableElement = tabela.querySelector('table');
    if (tableElement) resizeObserver?.observe(tableElement);
    window.addEventListener('resize', atualizarLargura);

    return () => {
      cancelAnimationFrame(frame);
      tabela.removeEventListener('scroll', sincronizarTopo);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', atualizarLargura);
    };
  }, [linhas.length, isLoading]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function criarLinhaTotalComparativo(): LinhaComparativo | null {
    if (!comparativo) return null;

    const metaTotal = comparativo.filiais.reduce((s, f) => s + f.meta.valor, 0);
    const debitoMetaTotal = linhas.reduce((s, f) => s + (f.debitoMeta || 0), 0);
    const devolucoesValorTotal = comparativo.filiais.reduce((s, f) => s + f.devolucoes.valor, 0);
    const devolucoesQtdeTotal = comparativo.filiais.reduce((s, f) => s + f.devolucoes.qtde, 0);
    const clientesNovosTotal = comparativo.filiais.reduce((s, f) => s + f.clientes_novos.qtde, 0);
    const faturamentoClientesNovosTotal = comparativo.filiais.reduce((s, f) => s + f.clientes_novos.faturamento, 0);

    return {
      branch_code: 0,
      branch_name: 'TOTAL',
      atual: {
        ...comparativo.total.atual,
        pct_tt_faturamento: 100,
        pct_tt_pecas: 100,
      },
      ano_anterior: comparativo.total.ano_anterior,
      variacao: {
        faturamento: comparativo.total.variacao.faturamento.percentual,
        pecas: comparativo.total.variacao.pecas.percentual,
        transacoes: comparativo.total.variacao.transacoes.percentual,
        clientes: comparativo.total.variacao.clientes.percentual,
        pm: comparativo.total.variacao.pm.percentual,
        tm: comparativo.total.variacao.tm.percentual,
        tm_cliente: 0,
        pa: comparativo.total.variacao.pa.percentual,
        pac: 0,
      },
      devolucoes: { valor: devolucoesValorTotal, qtde: devolucoesQtdeTotal, pct: 0 },
      clientes_novos: { qtde: clientesNovosTotal, faturamento: faturamentoClientesNovosTotal, pct: 0 },
      meta: { valor: metaTotal, pct: 0, meta_dia: 0 },
      proj: projecao
        ? {
            branch_code: 0,
            branch_name: 'TOTAL',
            realizado: projecao.total.realizado,
            caminhada: 0,
            projecao: projecao.total.projecao,
            falta: projecao.total.falta,
            ano_anterior_completo: projecao.total.ano_anterior_completo,
            variacao_vs_ano_anterior: projecao.total.variacao_vs_ano_anterior,
          }
        : undefined,
      bateMeta: null,
      debitoMeta: debitoMetaTotal,
      isTotal: true,
    };
  }


  function formatarPercentualExportacao(value: number): string {
    return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;
  }

  function calcularPctProjecao(projecaoValor: number | undefined, metaValor: number): number | null {
    return metaValor > 0 && typeof projecaoValor === 'number' ? (projecaoValor / metaValor) * 100 : null;
  }

  function renderBadgeAtingimentoMeta(pct: number) {
    const atingimento = Math.max(0, pct);
    const variant = atingimento >= 100 ? 'success' : atingimento > 90 ? 'warning' : 'danger';

    return (
      <Badge variant={variant}>
        {formatarPercentualExportacao(atingimento)}
      </Badge>
    );
  }
  function estiloAtingimentoMeta(pct: number): XlsxCellStyle {
    const atingimento = Math.max(0, pct);
    return atingimento >= 100 ? 'success' : atingimento > 90 ? 'warning' : 'danger';
  }

  function estiloVariacao(value: number): XlsxCellStyle {
    return value > 0 ? 'success' : value < 0 ? 'danger' : 'neutral';
  }

  function estiloDevolucao(pct: number): XlsxCellStyle {
    return pct > 10 ? 'danger' : pct > 5 ? 'warning' : 'neutral';
  }

  function estiloLinhaTotal(f: LinhaComparativo): XlsxCellStyle | undefined {
    return f.isTotal ? 'total' : undefined;
  }

  function estiloAntigo(f: LinhaComparativo): XlsxCellStyle {
    return f.isTotal ? 'totalMuted' : 'muted';
  }
  function exportarComparativo() {
    const linhaTotal = criarLinhaTotalComparativo();
    const linhasExportacao = linhaTotal ? [...linhas, linhaTotal] : linhas;

    exportToXlsx(
      `comparativo-filiais-${dataInicio}-a-${dataFim}`,
      [
        { header: 'Filial', value: (f: LinhaComparativo) => f.branch_name, style: estiloLinhaTotal },
        { header: 'Meta', value: (f: LinhaComparativo) => formatMoney(f.meta.valor) },
        { header: 'Faturamento', value: (f: LinhaComparativo) => formatMoney(f.atual.faturamento) },
        { header: '% Meta', value: (f: LinhaComparativo) => f.isTotal ? '-' : formatarPercentualExportacao(Math.max(0, f.meta.pct)), style: (f: LinhaComparativo) => f.isTotal ? 'total' : estiloAtingimentoMeta(f.meta.pct) },
        { header: 'Faturamento Ant.', value: (f: LinhaComparativo) => formatMoney(f.ano_anterior.faturamento), style: estiloAntigo },
        { header: 'Var % Faturamento', value: (f: LinhaComparativo) => formatarPercentualExportacao(f.variacao.faturamento), style: (f: LinhaComparativo) => estiloVariacao(f.variacao.faturamento) },
        { header: '%TT Faturamento', value: (f: LinhaComparativo) => formatarPercentualExportacao(f.atual.pct_tt_faturamento), style: (f: LinhaComparativo) => f.isTotal ? 'total' : 'muted' },
        { header: 'Projecao', value: (f: LinhaComparativo) => f.proj ? formatMoney(f.proj.projecao) : '' },
        { header: '% Proj', value: (f: LinhaComparativo) => { const pct = calcularPctProjecao(f.proj?.projecao, f.meta.valor); return pct === null ? '' : formatarPercentualExportacao(pct); }, style: (f: LinhaComparativo) => { const pct = calcularPctProjecao(f.proj?.projecao, f.meta.valor); return pct === null ? estiloLinhaTotal(f) : estiloAtingimentoMeta(pct); } },
        { header: 'PA', value: (f: LinhaComparativo) => f.atual.pa },
        { header: 'PA Ant.', value: (f: LinhaComparativo) => f.ano_anterior.pa, style: estiloAntigo },
        { header: 'Var % PA', value: (f: LinhaComparativo) => f.isTotal ? '-' : formatarPercentualExportacao(f.variacao.pa), style: (f: LinhaComparativo) => f.isTotal ? 'total' : estiloVariacao(f.variacao.pa) },
        { header: 'TM', value: (f: LinhaComparativo) => formatMoney(f.atual.tm) },
        { header: 'TM Ant.', value: (f: LinhaComparativo) => formatMoney(f.ano_anterior.tm), style: estiloAntigo },
        { header: 'Var % TM', value: (f: LinhaComparativo) => f.isTotal ? '-' : formatarPercentualExportacao(f.variacao.tm), style: (f: LinhaComparativo) => f.isTotal ? 'total' : estiloVariacao(f.variacao.tm) },
        { header: 'Meta Dia', value: (f: LinhaComparativo) => f.isTotal ? '-' : formatMoney(f.meta.meta_dia) },
        { header: 'Pecas', value: (f: LinhaComparativo) => f.atual.pecas },
        { header: 'Pecas Ant.', value: (f: LinhaComparativo) => f.ano_anterior.pecas, style: estiloAntigo },
        { header: 'Debito para Meta', value: (f: LinhaComparativo) => f.debitoMeta === null ? '' : formatMoney(f.debitoMeta) },
        { header: '%TT Pecas', value: (f: LinhaComparativo) => formatarPercentualExportacao(f.atual.pct_tt_pecas), style: (f: LinhaComparativo) => f.isTotal ? 'total' : 'muted' },
        { header: 'Var % Pecas', value: (f: LinhaComparativo) => formatarPercentualExportacao(f.variacao.pecas), style: (f: LinhaComparativo) => estiloVariacao(f.variacao.pecas) },
        { header: 'PM', value: (f: LinhaComparativo) => formatMoney(f.atual.pm) },
        { header: 'PM Ant.', value: (f: LinhaComparativo) => formatMoney(f.ano_anterior.pm), style: estiloAntigo },
        { header: 'Var % PM', value: (f: LinhaComparativo) => formatarPercentualExportacao(f.variacao.pm), style: (f: LinhaComparativo) => estiloVariacao(f.variacao.pm) },
        { header: 'Clientes', value: (f: LinhaComparativo) => f.atual.clientes },
        { header: 'Clientes Ant.', value: (f: LinhaComparativo) => f.ano_anterior.clientes, style: estiloAntigo },
        { header: 'Var % Clientes', value: (f: LinhaComparativo) => f.isTotal ? '-' : formatarPercentualExportacao(f.variacao.clientes), style: (f: LinhaComparativo) => f.isTotal ? 'total' : estiloVariacao(f.variacao.clientes) },
        { header: 'Atendimento', value: (f: LinhaComparativo) => f.atual.transacoes },
        { header: 'Atend. Ant.', value: (f: LinhaComparativo) => f.ano_anterior.transacoes, style: estiloAntigo },
        { header: 'Var % Atendimento', value: (f: LinhaComparativo) => formatarPercentualExportacao(f.variacao.transacoes), style: (f: LinhaComparativo) => estiloVariacao(f.variacao.transacoes) },
        { header: 'Devolucoes', value: (f: LinhaComparativo) => formatMoney(f.devolucoes.valor) },
        { header: 'Qtde Dev', value: (f: LinhaComparativo) => f.devolucoes.qtde },
        { header: '% Dev', value: (f: LinhaComparativo) => f.isTotal ? '-' : formatarPercentualExportacao(f.devolucoes.pct), style: (f: LinhaComparativo) => f.isTotal ? 'total' : estiloDevolucao(f.devolucoes.pct) },
        { header: '% CN', value: (f: LinhaComparativo) => f.isTotal ? '-' : formatarPercentualExportacao(f.clientes_novos.pct), style: (f: LinhaComparativo) => f.isTotal ? 'total' : 'muted' },
        { header: 'Clientes Novos', value: (f: LinhaComparativo) => f.clientes_novos.qtde },
        { header: 'Faturamento CN', value: (f: LinhaComparativo) => formatMoney(f.clientes_novos.faturamento) },
        { header: 'Vs Ano Ant.', value: (f: LinhaComparativo) => f.proj ? formatarPercentualExportacao(f.proj.variacao_vs_ano_anterior) : '', style: (f: LinhaComparativo) => f.proj ? estiloVariacao(f.proj.variacao_vs_ano_anterior) : estiloLinhaTotal(f) },
        { header: 'Bate Meta', value: (f: LinhaComparativo) => f.isTotal || f.bateMeta === null ? '' : f.bateMeta ? 'Sim' : 'Nao', style: (f: LinhaComparativo) => f.isTotal ? 'total' : f.bateMeta === null ? undefined : f.bateMeta ? 'success' : 'danger' },
      ],
      linhasExportacao,
      { sheetName: 'Comparativo por filial', rowStyle: estiloLinhaTotal }
    );
  }
  function exportarRankingVendedores() {
    const linhasExportacao = vendedoresRanking.map((v, i) => ({ ...v, posicao: i + 1, isTotal: false }));
    const linhasComTotal = [
      ...linhasExportacao,
      {
        posicao: 'TOTAL',
        seller_name: 'TOTAL',
        faturamento: totaisVendedoresRanking.faturamento,
        meta: totaisVendedoresRanking.meta,
        debito_meta: totaisVendedoresRanking.debitoMeta,
        pct_meta: totaisVendedoresRanking.pctMeta,
        pct_proj: totaisVendedoresRanking.pctProj,
        pa: totaisVendedoresRanking.pa,
        tm: totaisVendedoresRanking.tm,
        isTotal: true,
      },
    ];

    exportToXlsx(
      `ranking-vendedores-${dataInicio}-a-${dataFim}`,
      [
        { header: '#', value: (v: typeof linhasComTotal[number]) => v.posicao, style: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : v.posicao === 1 ? 'rankGold' : v.posicao === 2 ? 'rankSilver' : v.posicao === 3 ? 'rankBronze' : undefined },
        { header: 'Vendedor', value: (v: typeof linhasComTotal[number]) => v.seller_name, style: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : undefined },
        { header: 'Faturamento', value: (v: typeof linhasComTotal[number]) => formatMoney(v.faturamento), style: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : undefined },
        { header: 'Meta', value: (v: typeof linhasComTotal[number]) => formatMoney(v.meta), style: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : undefined },
        { header: 'Debito', value: (v: typeof linhasComTotal[number]) => formatMoney(v.debito_meta), style: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : undefined },
        { header: '% Meta', value: (v: typeof linhasComTotal[number]) => v.meta > 0 ? formatarPercentualExportacao(v.pct_meta) : '', style: (v: typeof linhasComTotal[number]) => v.meta > 0 ? estiloAtingimentoMeta(v.pct_meta) : v.isTotal ? 'total' : undefined },
        { header: '% Proj', value: (v: typeof linhasComTotal[number]) => v.meta > 0 ? formatarPercentualExportacao(v.pct_proj) : '', style: (v: typeof linhasComTotal[number]) => v.meta > 0 ? estiloAtingimentoMeta(v.pct_proj) : v.isTotal ? 'total' : undefined },
        { header: 'PA', value: (v: typeof linhasComTotal[number]) => v.pa.toFixed(2), style: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : undefined },
        { header: 'TM', value: (v: typeof linhasComTotal[number]) => formatMoney(v.tm), style: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : undefined },
      ],
      linhasComTotal,
      { sheetName: 'Ranking vendedores', rowStyle: (v: typeof linhasComTotal[number]) => v.isTotal ? 'total' : undefined }
    );
  }
  function ThSort({ label, sortKeyName, align = 'right' }: { label: string; sortKeyName: string; align?: 'left' | 'right' | 'center' }) {
    const active = sortKey === sortKeyName || (sortKeyName === 'branch_name' && !sortKey);
    return (
      <TableCell isHeader align={align} className="whitespace-nowrap" onClick={() => handleSort(sortKeyName)}>
        {label}
        {active && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </TableCell>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard de Vendas</h1>

        {/* Filtros */}
        <div className="flex flex-wrap items-end gap-3">
          <Input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            label="Inicio"
            className="w-36"
          />
          <Input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            label="Fim"
            className="w-36"
          />
          <FilialMultiSelect
            selected={filiaisSelecionadas}
            onChange={setFiliaisSelecionadas}
            options={filialOptions}
            label="Filial"
            className="w-52"
          />
          <Button onClick={carregarDados} isLoading={isLoading}>
            Atualizar
          </Button>
        </div>
      </div>

      {/* Filtros de Produto (classificacao) */}
      {classificacoes.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {classificacoes.map((dim) => (
            <ClassificacaoMultiSelect
              key={dim.chave}
              label={dim.label}
              options={dim.opcoes.map((o) => ({ value: o.valor, label: o.valor }))}
              selected={produtoFiltro[dim.chave as keyof ProdutoFiltro] || []}
              onChange={(valores) => atualizarProdutoFiltro(dim.chave as keyof ProdutoFiltro, valores)}
              className="w-44"
            />
          ))}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KPICard
          title="Venda"
          value={formatMoney(vendas?.total?.faturamento || 0)}
          variation={comparativo?.total?.variacao?.faturamento?.percentual}
          color="red"
          valueSize="xs"
          isLoading={isLoading}
        />
        <KPICard
          title="Quantidade"
          value={formatNumber(vendas?.total?.pecas || 0)}
          variation={comparativo?.total?.variacao?.pecas?.percentual}
          color="green"
          valueSize="xs"
          isLoading={isLoading}
        />
        <KPICard
          title="TKM"
          value={formatMoney(vendas?.total?.tm || 0)}
          variation={comparativo?.total?.variacao?.tm?.percentual}
          color="yellow"
          valueSize="xs"
          isLoading={isLoading}
        />
        <KPICard
          title="PA"
          value={(vendas?.total?.pa || 0).toFixed(2)}
          variation={comparativo?.total?.variacao?.pa?.percentual}
          color="purple"
          valueSize="xs"
          isLoading={isLoading}
        />
        <KPICard
          title="Atendimento"
          value={formatNumber(vendas?.total?.transacoes || 0)}
          variation={comparativo?.total?.variacao?.transacoes?.percentual}
          color="blue"
          valueSize="xs"
          isLoading={isLoading}
        />
        <KPICard
          title="Clientes"
          value={formatNumber(vendas?.total?.clientes || 0)}
          variation={comparativo?.total?.variacao?.clientes?.percentual}
          color="red"
          valueSize="xs"
          isLoading={isLoading}
        />
        <KPICard
          title="Preco Medio"
          value={formatMoney(vendas?.total?.pm || 0)}
          variation={comparativo?.total?.variacao?.pm?.percentual}
          color="green"
          valueSize="xs"
          isLoading={isLoading}
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{graficoVendasModo === 'hora' ? 'Vendas por Hora' : 'Vendas Diarias'}</CardTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setGraficoVendasModo((modo) => (modo === 'dia' ? 'hora' : 'dia'))}
            >
              {graficoVendasModo === 'hora' ? 'Ver por dia' : 'Ver por hora'}
            </Button>
          </CardHeader>
          <LoadingOverlay active={isLoading}>
            <LineChart data={vendasDiarias?.dados || []} granularidade={graficoVendasModo === 'hora' ? 'horario' : mesUnico ? 'diario' : 'mensal'} />
          </LoadingOverlay>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vendas por Filial</CardTitle>
          </CardHeader>
          <div className="mb-4 pb-4 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total</p>
            <p className="text-sm font-bold text-gray-900">{formatMoney(vendas?.total?.faturamento || 0)}</p>
          </div>
          <LoadingOverlay active={isLoading}>
            <BarChart data={dadosBarras} horizontal />
          </LoadingOverlay>
        </Card>
      </div>

      {/* Tabela de Filiais - todas as colunas */}
      <Card>
        <CardHeader>
          <CardTitle>Comparativo por Filial</CardTitle>
          <Button variant="secondary" size="sm" onClick={exportarComparativo}>
            Exportar Excel
          </Button>
        </CardHeader>
        <LoadingOverlay active={isLoading}>
        <div className="relative">
        <button
          type="button"
          aria-label="Rolar tabela para a esquerda"
          onClick={() => rolarComparativo('esquerda')}
          className="absolute -left-4 top-1/2 -translate-y-1/2 z-20 text-gray-300 hover:text-gray-600 text-2xl leading-none transition-colors"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Rolar tabela para a direita"
          onClick={() => rolarComparativo('direita')}
          className="absolute -right-4 top-1/2 -translate-y-1/2 z-20 text-gray-300 hover:text-gray-600 text-2xl leading-none transition-colors"
        >
          ›
        </button>
        <div
          ref={comparativoTopScrollRef}
          onScroll={sincronizarComparativoPeloTopo}
          className="mb-2 overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: comparativoScrollWidth || '100%', height: 1 }} />
        </div>
        <Table ref={comparativoScrollRef} className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TableHead>
            <TableRow>
              <ThSort label="Filial" sortKeyName="branch_name" align="left" />
              <ThSort label="Meta" sortKeyName="meta" />
              <ThSort label="Faturamento" sortKeyName="faturamento" />
              <ThSort label="% Meta" sortKeyName="pct_meta" align="center" />
              <ThSort label="Fat. Ant." sortKeyName="fat_ant" />
              <ThSort label="Var %" sortKeyName="var_faturamento" align="center" />
              <ThSort label="%TT" sortKeyName="pct_tt_faturamento" align="center" />
              <ThSort label="Projecao" sortKeyName="projecao" />
              <ThSort label="% Proj" sortKeyName="pct_proj" align="center" />
              <ThSort label="PA" sortKeyName="pa" />
              <ThSort label="PA Ant." sortKeyName="pa_ant" />
              <ThSort label="Var %" sortKeyName="var_pa" align="center" />
              <ThSort label="TM" sortKeyName="tm" />
              <ThSort label="TM Ant." sortKeyName="tm_ant" />
              <ThSort label="Var %" sortKeyName="var_tm" align="center" />
              <ThSort label="Meta Dia" sortKeyName="meta_dia" />
              <ThSort label="Pecas" sortKeyName="pecas" />
              <ThSort label="Pecas Ant." sortKeyName="pecas_ant" />
              <ThSort label="Debito p/ Meta" sortKeyName="debito_meta" />
              <ThSort label="%TT" sortKeyName="pct_tt_pecas" align="center" />
              <ThSort label="Var %" sortKeyName="var_pecas" align="center" />
              <ThSort label="PM" sortKeyName="pm" />
              <ThSort label="PM Ant." sortKeyName="pm_ant" />
              <ThSort label="Var %" sortKeyName="var_pm" align="center" />
              <ThSort label="Clientes" sortKeyName="clientes" />
              <ThSort label="Clientes Ant." sortKeyName="clientes_ant" />
              <ThSort label="Var %" sortKeyName="var_clientes" align="center" />
              <ThSort label="Atendimento" sortKeyName="atendimento" />
              <ThSort label="Atend. Ant." sortKeyName="atendimento_ant" />
              <ThSort label="Var %" sortKeyName="var_atendimento" align="center" />
              <ThSort label="Devolucoes" sortKeyName="devolucoes_valor" />
              <ThSort label="Qtde Dev" sortKeyName="devolucoes_qtde" />
              <ThSort label="% Dev" sortKeyName="devolucoes_pct" align="center" />
              <ThSort label="% CN" sortKeyName="pct_cn" align="center" />
              <ThSort label="Clientes Novos" sortKeyName="clientes_novos" />
              <ThSort label="Faturamento CN" sortKeyName="faturamento_cn" />
              <ThSort label="Vs Ano Ant." sortKeyName="vs_ano_ant" align="center" />
              <TableCell isHeader align="center" className="whitespace-nowrap">Bate Meta</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {linhas.map((f) => {
              const proj = f.proj;
              const bateMeta = f.bateMeta;
              return (
                <TableRow
                  key={f.branch_code}
                  onClick={() => setFiliaisSelecionadas([f.branch_code])}
                >
                  <TableCell className="font-medium whitespace-nowrap sticky left-0 bg-white">{f.branch_name}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{f.meta.valor > 0 ? formatMoney(f.meta.valor) : '-'}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatMoney(f.atual.faturamento)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap">
                    {f.meta.valor > 0 ? renderBadgeAtingimentoMeta(f.meta.pct) : '-'}
                  </TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(f.ano_anterior.faturamento)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.faturamento} /></TableCell>
                  <TableCell align="center" className="whitespace-nowrap text-gray-500">{f.atual.pct_tt_faturamento.toFixed(1)}%</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{proj ? formatMoney(proj.projecao) : '-'}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap">
                    {(() => {
                      const pctProj = calcularPctProjecao(proj?.projecao, f.meta.valor);
                      return pctProj === null ? '-' : renderBadgeAtingimentoMeta(pctProj);
                    })()}
                  </TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{f.atual.pa.toFixed(2)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{f.ano_anterior.pa.toFixed(2)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.pa} /></TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatMoney(f.atual.tm)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(f.ano_anterior.tm)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.tm} /></TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{f.meta.valor > 0 ? formatMoney(f.meta.meta_dia) : '-'}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatNumber(f.atual.pecas)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatNumber(f.ano_anterior.pecas)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{f.debitoMeta === null ? '-' : formatMoney(f.debitoMeta)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap text-gray-500">{f.atual.pct_tt_pecas.toFixed(1)}%</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.pecas} /></TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatMoney(f.atual.pm)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(f.ano_anterior.pm)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.pm} /></TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatNumber(f.atual.clientes)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatNumber(f.ano_anterior.clientes)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.clientes} /></TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatNumber(f.atual.transacoes)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatNumber(f.ano_anterior.transacoes)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.transacoes} /></TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatMoney(f.devolucoes.valor)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatNumber(f.devolucoes.qtde)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap">
                    <Badge variant={f.devolucoes.pct > 10 ? 'danger' : f.devolucoes.pct > 5 ? 'warning' : 'default'}>
                      {f.devolucoes.pct.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell align="center" className="whitespace-nowrap text-gray-500">{f.clientes_novos.pct.toFixed(1)}%</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatNumber(f.clientes_novos.qtde)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{formatMoney(f.clientes_novos.faturamento)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap">
                    {proj ? <VariationBadge value={proj.variacao_vs_ano_anterior} /> : '-'}
                  </TableCell>
                  <TableCell align="center" className="whitespace-nowrap">
                    {bateMeta === null ? '-' : (
                      <Badge variant={bateMeta ? 'success' : 'danger'}>{bateMeta ? 'Sim' : 'Nao'}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {/* Linha de Total */}
            {comparativo && (
              <TableRow isHighlighted>
                <TableCell className="font-bold whitespace-nowrap sticky left-0 bg-yellow-50">TOTAL</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {formatMoney(comparativo.filiais.reduce((s, f) => s + f.meta.valor, 0))}
                </TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{formatMoney(comparativo.total.atual.faturamento)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap">
                  {(() => {
                    const metaTotal = comparativo.filiais.reduce((s, f) => s + f.meta.valor, 0);
                    const pctMetaTotal = metaTotal > 0 ? (comparativo.total.atual.faturamento / metaTotal) * 100 : 0;
                    return metaTotal > 0 ? renderBadgeAtingimentoMeta(pctMetaTotal) : '-';
                  })()}
                </TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(comparativo.total.ano_anterior.faturamento)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={comparativo.total.variacao.faturamento.percentual} /></TableCell>
                <TableCell align="center" className="whitespace-nowrap">100%</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {projecao ? formatMoney(projecao.total.projecao) : '-'}
                </TableCell>
                <TableCell align="center" className="whitespace-nowrap">
                  {(() => {
                    const metaTotal = comparativo.filiais.reduce((s, f) => s + f.meta.valor, 0);
                    const pctProjTotal = calcularPctProjecao(projecao?.total.projecao, metaTotal);
                    return pctProjTotal === null ? '-' : renderBadgeAtingimentoMeta(pctProjTotal);
                  })()}
                </TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{comparativo.total.atual.pa.toFixed(2)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{comparativo.total.ano_anterior.pa.toFixed(2)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{formatMoney(comparativo.total.atual.tm)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(comparativo.total.ano_anterior.tm)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{formatNumber(comparativo.total.atual.pecas)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatNumber(comparativo.total.ano_anterior.pecas)}</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {formatMoney(linhas.reduce((s, f) => s + (f.debitoMeta || 0), 0))}
                </TableCell>
                <TableCell align="center" className="whitespace-nowrap">100%</TableCell>
                <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={comparativo.total.variacao.pecas.percentual} /></TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{formatMoney(comparativo.total.atual.pm)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(comparativo.total.ano_anterior.pm)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{formatNumber(comparativo.total.atual.clientes)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatNumber(comparativo.total.ano_anterior.clientes)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{formatNumber(comparativo.total.atual.transacoes)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatNumber(comparativo.total.ano_anterior.transacoes)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={comparativo.total.variacao.transacoes.percentual} /></TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {formatMoney(comparativo.filiais.reduce((s, f) => s + f.devolucoes.valor, 0))}
                </TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {formatNumber(comparativo.filiais.reduce((s, f) => s + f.devolucoes.qtde, 0))}
                </TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {formatNumber(comparativo.filiais.reduce((s, f) => s + f.clientes_novos.qtde, 0))}
                </TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {formatMoney(comparativo.filiais.reduce((s, f) => s + f.clientes_novos.faturamento, 0))}
                </TableCell>
                <TableCell align="center" className="whitespace-nowrap">
                  {projecao ? <VariationBadge value={projecao.total.variacao_vs_ano_anterior} /> : '-'}
                </TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
        </LoadingOverlay>
      </Card>

      {/* Vendedores e Produtos */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.75fr)] gap-6">
        {/* Ranking Vendedores */}
        <Card>
          <CardHeader>
            <CardTitle>Ranking Vendedores</CardTitle>
            <div className="flex items-center gap-2">
              <Select
                aria-label="Quantidade de vendedores no ranking"
                value={limiteRankingVendedores}
                onChange={(e) => setLimiteRankingVendedores(e.target.value as '10' | '20' | 'todos')}
                options={[
                  { value: '10', label: 'TOP 10' },
                  { value: '20', label: 'TOP 20' },
                  { value: 'todos', label: 'TODOS' },
                ]}
                className="w-32"
              />
              <Button variant="secondary" size="sm" onClick={exportarRankingVendedores}>
                Exportar Excel
              </Button>
            </div>
          </CardHeader>
          <LoadingOverlay active={isLoading} className="max-h-96 overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell isHeader>#</TableCell>
                  <TableCell isHeader>Vendedor</TableCell>
                  <TableCell isHeader align="right">Fat.</TableCell>
                  <TableCell isHeader align="right">Meta</TableCell>
                  <TableCell isHeader align="right">Debito</TableCell>
                  <TableCell isHeader align="center">% Meta</TableCell>
                  <TableCell isHeader align="center">% Proj</TableCell>
                  <TableCell isHeader align="right">PA</TableCell>
                  <TableCell isHeader align="right">TM</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vendedoresRanking.map((v, i) => (
                  <TableRow key={v.seller_code}>
                    <TableCell>
                      {i < 3 ? (
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${
                          i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                        }`}>
                          {i + 1}
                        </span>
                      ) : (
                        <span className="text-gray-500">{i + 1}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{v.seller_name}</TableCell>
                    <TableCell align="right">{formatMoney(v.faturamento)}</TableCell>
                    <TableCell align="right">{v.meta > 0 ? formatMoney(v.meta) : '-'}</TableCell>
                    <TableCell align="right">{v.meta > 0 ? formatMoney(v.debito_meta) : '-'}</TableCell>
                    <TableCell align="center">{v.meta > 0 ? renderBadgeAtingimentoMeta(v.pct_meta) : '-'}</TableCell>
                    <TableCell align="center">{v.meta > 0 ? renderBadgeAtingimentoMeta(v.pct_proj) : '-'}</TableCell>
                    <TableCell align="right">{v.pa.toFixed(2)}</TableCell>
                    <TableCell align="right">{formatMoney(v.tm)}</TableCell>
                  </TableRow>
                ))}
                {vendedoresRanking.length > 0 && (
                  <TableRow isHighlighted>
                    <TableCell className="font-bold" colSpan={2}>TOTAL</TableCell>
                    <TableCell align="right" className="font-bold">{formatMoney(totaisVendedoresRanking.faturamento)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatMoney(totaisVendedoresRanking.meta)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatMoney(totaisVendedoresRanking.debitoMeta)}</TableCell>
                    <TableCell align="center">{totaisVendedoresRanking.meta > 0 ? renderBadgeAtingimentoMeta(totaisVendedoresRanking.pctMeta) : '-'}</TableCell>
                    <TableCell align="center">{totaisVendedoresRanking.meta > 0 ? renderBadgeAtingimentoMeta(totaisVendedoresRanking.pctProj) : '-'}</TableCell>
                    <TableCell align="right" className="font-bold">{totaisVendedoresRanking.pa.toFixed(2)}</TableCell>
                    <TableCell align="right" className="font-bold">{formatMoney(totaisVendedoresRanking.tm)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </LoadingOverlay>
        </Card>

        {/* Top Produtos */}
        <Card>
          <CardHeader>
            <CardTitle>Top Produtos</CardTitle>
          </CardHeader>
          <LoadingOverlay active={isLoading} className="max-h-96 overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell isHeader>#</TableCell>
                  <TableCell isHeader>Produto</TableCell>
                  <TableCell isHeader align="right">Qtd</TableCell>
                  <TableCell isHeader align="right">Valor</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {produtos?.produtos.map((p, i) => (
                  <TableRow key={p.referencia}>
                    <TableCell>
                      {i < 3 ? (
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${
                          i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                        }`}>
                          {i + 1}
                        </span>
                      ) : (
                        <span className="text-gray-500">{i + 1}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium" title={`${p.referencia} - ${p.nome}`}>
                      {p.referencia}
                      <span className="text-gray-400 font-normal">
                        {' '}- {p.nome.length > 20 ? p.nome.substring(0, 20) + '...' : p.nome}
                      </span>
                    </TableCell>
                    <TableCell align="right">{formatNumber(p.quantidade)}</TableCell>
                    <TableCell align="right">{formatMoney(p.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </LoadingOverlay>
        </Card>
      </div>
    </div>
  );
}
