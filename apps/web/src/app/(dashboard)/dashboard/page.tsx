'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { KPICard } from '@/components/dashboard/KPICard';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Badge, VariationBadge } from '@/components/ui/Badge';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { vendasApi, VendasResponse, VendasDiariasResponse, ComparativoAnoResponse, VendedoresResponse, TopProdutosResponse, ProjecaoFiliaisResponse, FilialComparativo, ProjecaoFilial, ProdutoFiltro, ClassificacaoDimensao } from '@/lib/api';
import { formatMoney, formatNumber, FILIAIS, getMonthStart, getToday, isMesUnico } from '@/lib/utils';
import { exportToCsv } from '@/lib/exportCsv';
import { useAuth } from '@/contexts/AuthContext';

type LinhaComparativo = FilialComparativo & { proj?: ProjecaoFilial; bateMeta: boolean | null; debitoMeta: number | null };

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
  tm_cliente: (f) => f.atual.tm_cliente,
  tm_cliente_ant: (f) => f.ano_anterior.tm_cliente,
  var_tm_cliente: (f) => f.variacao.tm_cliente,
  pa: (f) => f.atual.pa,
  pa_ant: (f) => f.ano_anterior.pa,
  var_pa: (f) => f.variacao.pa,
  pac: (f) => f.atual.pac,
  pac_ant: (f) => f.ano_anterior.pac,
  var_pac: (f) => f.variacao.pac,
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
  const comparativoScrollRef = useRef<HTMLDivElement>(null);

  function rolarComparativo(direcao: 'esquerda' | 'direita') {
    comparativoScrollRef.current?.scrollBy({ left: direcao === 'esquerda' ? -320 : 320, behavior: 'smooth' });
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
        granularidade === 'diario'
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
  }, [dataInicio, dataFim, filiaisSelecionadas, produtoFiltro]);

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
    // A Fabrica (branch_code 2) vende em 3 canais/linhas (2/2.1/2.3 - varejo/delivery/
    // atacado, ver vendas.routes.ts) mas so tem UMA meta cadastrada, ja repetida pelo
    // backend nas 3 linhas com base no faturamento COMBINADO delas - o debito precisa
    // usar a mesma base combinada, senao cada linha calcularia o debito contra o alvo
    // inteiro usando so a fatia dela do faturamento (numero gigante e enganoso).
    const FABRICA_DIVIDIDA_CODES = [2, 2.1, 2.3];
    const faturamentoFabricaCombinado = (comparativo?.filiais || [])
      .filter((f) => FABRICA_DIVIDIDA_CODES.includes(f.branch_code))
      .reduce((s, f) => s + f.atual.faturamento, 0);

    const base = (comparativo?.filiais || []).map((f) => {
      const proj = projecaoMap.get(f.branch_code);
      const bateMeta = f.meta.valor > 0 && proj ? proj.projecao >= f.meta.valor : null;
      const faturamentoParaDebito = FABRICA_DIVIDIDA_CODES.includes(f.branch_code) ? faturamentoFabricaCombinado : f.atual.faturamento;
      const debitoMeta = f.meta.valor > 0 ? Math.max(0, f.meta.valor - faturamentoParaDebito) : null;
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

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function exportarComparativo() {
    exportToCsv(
      `comparativo-filiais-${dataInicio}-a-${dataFim}`,
      [
        { header: 'Filial', value: (f: LinhaComparativo) => f.branch_name },
        { header: 'Meta', value: (f: LinhaComparativo) => f.meta.valor },
        { header: 'Faturamento', value: (f: LinhaComparativo) => f.atual.faturamento },
        { header: '% Meta', value: (f: LinhaComparativo) => f.meta.pct },
        { header: 'Faturamento Ant.', value: (f: LinhaComparativo) => f.ano_anterior.faturamento },
        { header: 'Var % Faturamento', value: (f: LinhaComparativo) => f.variacao.faturamento },
        { header: '%TT Faturamento', value: (f: LinhaComparativo) => f.atual.pct_tt_faturamento },
        { header: 'Projecao', value: (f: LinhaComparativo) => f.proj?.projecao ?? '' },
        { header: 'PA', value: (f: LinhaComparativo) => f.atual.pa },
        { header: 'PA Ant.', value: (f: LinhaComparativo) => f.ano_anterior.pa },
        { header: 'Var % PA', value: (f: LinhaComparativo) => f.variacao.pa },
        { header: 'TM', value: (f: LinhaComparativo) => f.atual.tm },
        { header: 'TM Ant.', value: (f: LinhaComparativo) => f.ano_anterior.tm },
        { header: 'Var % TM', value: (f: LinhaComparativo) => f.variacao.tm },
        { header: 'Meta Dia', value: (f: LinhaComparativo) => f.meta.meta_dia },
        { header: 'Pecas', value: (f: LinhaComparativo) => f.atual.pecas },
        { header: 'Pecas Ant.', value: (f: LinhaComparativo) => f.ano_anterior.pecas },
        { header: 'Debito para Meta', value: (f: LinhaComparativo) => f.debitoMeta ?? '' },
        { header: '%TT Pecas', value: (f: LinhaComparativo) => f.atual.pct_tt_pecas },
        { header: 'Var % Pecas', value: (f: LinhaComparativo) => f.variacao.pecas },
        { header: 'PM', value: (f: LinhaComparativo) => f.atual.pm },
        { header: 'PM Ant.', value: (f: LinhaComparativo) => f.ano_anterior.pm },
        { header: 'Var % PM', value: (f: LinhaComparativo) => f.variacao.pm },
        { header: 'TM Cliente', value: (f: LinhaComparativo) => f.atual.tm_cliente },
        { header: 'TM Cliente Ant.', value: (f: LinhaComparativo) => f.ano_anterior.tm_cliente },
        { header: 'Var % TM Cliente', value: (f: LinhaComparativo) => f.variacao.tm_cliente },
        { header: 'PAC', value: (f: LinhaComparativo) => f.atual.pac },
        { header: 'PAC Ant.', value: (f: LinhaComparativo) => f.ano_anterior.pac },
        { header: 'Var % PAC', value: (f: LinhaComparativo) => f.variacao.pac },
        { header: 'Clientes', value: (f: LinhaComparativo) => f.atual.clientes },
        { header: 'Clientes Ant.', value: (f: LinhaComparativo) => f.ano_anterior.clientes },
        { header: 'Var % Clientes', value: (f: LinhaComparativo) => f.variacao.clientes },
        { header: 'Atendimento', value: (f: LinhaComparativo) => f.atual.transacoes },
        { header: 'Atend. Ant.', value: (f: LinhaComparativo) => f.ano_anterior.transacoes },
        { header: 'Var % Atendimento', value: (f: LinhaComparativo) => f.variacao.transacoes },
        { header: 'Devolucoes', value: (f: LinhaComparativo) => f.devolucoes.valor },
        { header: 'Qtde Dev', value: (f: LinhaComparativo) => f.devolucoes.qtde },
        { header: '% Dev', value: (f: LinhaComparativo) => f.devolucoes.pct },
        { header: '% CN', value: (f: LinhaComparativo) => f.clientes_novos.pct },
        { header: 'Clientes Novos', value: (f: LinhaComparativo) => f.clientes_novos.qtde },
        { header: 'Faturamento CN', value: (f: LinhaComparativo) => f.clientes_novos.faturamento },
        { header: 'Vs Ano Ant.', value: (f: LinhaComparativo) => f.proj?.variacao_vs_ano_anterior ?? '' },
        { header: 'Bate Meta', value: (f: LinhaComparativo) => f.bateMeta === null ? '' : f.bateMeta ? 'Sim' : 'Nao' },
      ],
      linhas
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
            <CardTitle>Vendas Diarias</CardTitle>
          </CardHeader>
          <LoadingOverlay active={isLoading}>
            <LineChart data={vendasDiarias?.dados || []} granularidade={mesUnico ? 'diario' : 'mensal'} />
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
        <Table ref={comparativoScrollRef}>
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
              <ThSort label="TM Cliente" sortKeyName="tm_cliente" />
              <ThSort label="TM Cliente Ant." sortKeyName="tm_cliente_ant" />
              <ThSort label="Var %" sortKeyName="var_tm_cliente" align="center" />
              <ThSort label="PAC" sortKeyName="pac" />
              <ThSort label="PAC Ant." sortKeyName="pac_ant" />
              <ThSort label="Var %" sortKeyName="var_pac" align="center" />
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
                    {f.meta.valor > 0 ? <VariationBadge value={f.meta.pct - 100} /> : '-'}
                  </TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(f.ano_anterior.faturamento)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.faturamento} /></TableCell>
                  <TableCell align="center" className="whitespace-nowrap text-gray-500">{f.atual.pct_tt_faturamento.toFixed(1)}%</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{proj ? formatMoney(proj.projecao) : '-'}</TableCell>
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
                  <TableCell align="right" className="whitespace-nowrap">{formatMoney(f.atual.tm_cliente)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(f.ano_anterior.tm_cliente)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.tm_cliente} /></TableCell>
                  <TableCell align="right" className="whitespace-nowrap">{f.atual.pac.toFixed(2)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap text-gray-500">{f.ano_anterior.pac.toFixed(2)}</TableCell>
                  <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={f.variacao.pac} /></TableCell>
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
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(comparativo.total.ano_anterior.faturamento)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap"><VariationBadge value={comparativo.total.variacao.faturamento.percentual} /></TableCell>
                <TableCell align="center" className="whitespace-nowrap">100%</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">
                  {projecao ? formatMoney(projecao.total.projecao) : '-'}
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
                <TableCell align="right" className="font-bold whitespace-nowrap">{formatMoney(comparativo.total.atual.tm_cliente)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{formatMoney(comparativo.total.ano_anterior.tm_cliente)}</TableCell>
                <TableCell align="center" className="whitespace-nowrap">-</TableCell>
                <TableCell align="right" className="font-bold whitespace-nowrap">{comparativo.total.atual.pac.toFixed(2)}</TableCell>
                <TableCell align="right" className="whitespace-nowrap text-gray-500">{comparativo.total.ano_anterior.pac.toFixed(2)}</TableCell>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ranking Vendedores */}
        <Card>
          <CardHeader>
            <CardTitle>Ranking Vendedores</CardTitle>
          </CardHeader>
          <LoadingOverlay active={isLoading} className="max-h-96 overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell isHeader>#</TableCell>
                  <TableCell isHeader>Vendedor</TableCell>
                  <TableCell isHeader align="right">Fat.</TableCell>
                  <TableCell isHeader align="right">Pcs</TableCell>
                  <TableCell isHeader align="right">PA</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vendedores?.vendedores.slice(0, 15).map((v, i) => (
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
                    <TableCell align="right">{formatNumber(v.pecas)}</TableCell>
                    <TableCell align="right">{v.pa.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
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
