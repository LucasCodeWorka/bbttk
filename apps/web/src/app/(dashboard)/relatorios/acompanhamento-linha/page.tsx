'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  VendaDiaFiltrosResponse,
  vendaDiaApi,
  AcompanhamentoDiarioResponse,
  AcompanhamentoDiarioLinha,
  TipoClassificacaoDiario,
  Canal,
} from '@/lib/pcpApi';
import { metaClassificacaoApi, PcpMetaClassificacaoItem } from '@/lib/api';
import { cn, formatDate, formatMoney, formatNumber, MESES } from '@/lib/utils';
import { exportToExcel, ExcelColumn } from '@/lib/exportExcel';

const TIPO_CLASSIFICACAO_DIARIO_OPTIONS: { value: TipoClassificacaoDiario; label: string }[] = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'linha', label: 'Linha' },
  { value: 'colecao', label: 'Coleção' },
  { value: 'status', label: 'Status' },
  { value: 'genero', label: 'Gênero' },
];

const CANAL_OPTIONS: { value: Canal; label: string }[] = [
  { value: 'varejo', label: 'Varejo' },
  { value: 'atacado', label: 'Atacado' },
  { value: 'todos', label: 'Todos' },
];

function formatPercentDelta(value: number | null): string {
  if (value === null) return '-';
  const sinal = value > 0 ? '+' : '';
  return `${sinal}${value.toFixed(1)}%`;
}

function inicioMesAtual(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

function ontem(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// Limpa o nome da loja removendo "BEBETENKITE" e códigos numéricos
function cleanBranchName(name: string): string {
  return name
    .replace(/^\s*\d+\s*\p{Pd}?\s*/u, '')
    .replace(/\bBEBETENKITE\b\s*\p{Pd}?\s*/giu, '')
    .replace(/^\s*\p{Pd}\s*/u, '')
    .trim();
}

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

type SortKeyDiario = keyof AcompanhamentoDiarioLinha;

export default function AcompanhamentoLinhaPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [data, setData] = useState<AcompanhamentoDiarioResponse | null>(null);
  const [filtros, setFiltros] = useState<VendaDiaFiltrosResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [tipoClassificacao, setTipoClassificacao] = useState<TipoClassificacaoDiario>('categoria');
  const [canal, setCanal] = useState<Canal>('varejo');
  const [branchesSelecionados, setBranchesSelecionados] = useState<number[]>([]);
  const [dataInicio, setDataInicio] = useState(inicioMesAtual);
  const [dataFim, setDataFim] = useState(ontem);

  const [sortKey, setSortKey] = useState<SortKeyDiario>('vendaValorAtual');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [mostrarModalMetas, setMostrarModalMetas] = useState(false);
  const tabelaScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    if (!token) return;
    vendaDiaApi.getFiltros(token).then(setFiltros).catch((error) => console.error('Erro ao carregar filtros:', error));
  }, [token]);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setErro(null);
    try {
      const response = await vendaDiaApi.getAcompanhamento(token, {
        tipoClassificacao,
        canal,
        branches: branchesSelecionados.length > 0 ? branchesSelecionados : undefined,
        dataInicio,
        dataFim,
      });
      setData(response);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Erro desconhecido';
      setErro(mensagem);
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token, tipoClassificacao, canal, branchesSelecionados, dataInicio, dataFim, showToast]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const lojasParaFiltro = useMemo(() => {
    if (!filtros) return [];
    return filtros.lojas.map((l) => ({ branch_code: l.branchCode, branch_name: cleanBranchName(l.label) || l.label }));
  }, [filtros]);

  function handleSort(key: SortKeyDiario) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sortedLinhas = useMemo(() => {
    if (!data) return [];
    return [...data.linhas].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : Number(va ?? -1) - Number(vb ?? -1);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const labelClassificacao =
    TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label.toLowerCase() || 'classificação';

  // A meta do periodo soma apenas as classificacoes que tem meta cadastrada. Sem
  // dizer isso na tela, o card parece quebrado: o padrao da tela e o mes corrente,
  // que normalmente ainda nao tem meta lancada, e o valor sai em branco - o que e o
  // comportamento pedido, mas indistinguivel de erro.
  const metaCobertura = useMemo(() => {
    if (!data) return { comMeta: 0, total: 0 };
    return {
      comMeta: data.linhas.filter((linha) => linha.metaPeriodo !== null).length,
      total: data.linhas.length,
    };
  }, [data]);

  const rotuloPeriodoMeta = useMemo(() => {
    if (!data) return '';
    const [ano, mes] = data.periodoAtual.inicio.split('-');
    const nome = MESES[Number(mes)];
    return nome ? `${nome.slice(0, 3).toLowerCase()}/${ano}` : ano;
  }, [data]);

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
  }, [sortedLinhas.length, isLoading]);

  function sincronizarScrollPeloTopo() {
    const topo = topScrollRef.current;
    const tabela = tabelaScrollRef.current;
    if (!topo || !tabela) return;
    tabela.scrollLeft = topo.scrollLeft;
  }

  function handleExportExcel() {
    if (!data || sortedLinhas.length === 0) return;
    setExportando(true);
    try {
      const columns: ExcelColumn[] = [
        { key: 'classificacao', header: TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label.toUpperCase() || 'CLASSIFICACAO', width: 22, type: 'text' },
        { key: 'vendaValorAtual', header: 'VENDA R$ ATUAL', width: 14, type: 'currency' },
        { key: 'metaPeriodo', header: 'META R$ PERÍODO', width: 15, type: 'currency' },
        { key: 'atingimentoMetaPercent', header: 'ATING. META %', width: 14, type: 'number' },
        { key: 'vendaValorAnoAnterior', header: 'VENDA R$ A.A.', width: 14, type: 'currency' },
        { key: 'evolucaoValorPercent', header: 'EVOL R$ %', width: 12, type: 'number' },
        { key: 'vendaPecasAtual', header: 'VENDA PÇ ATUAL', width: 13, type: 'number' },
        { key: 'vendaPecasAnoAnterior', header: 'VENDA PÇ A.A.', width: 13, type: 'number' },
        { key: 'evolucaoPecasPercent', header: 'EVOL PÇ %', width: 12, type: 'number' },
        { key: 'participacaoPercent', header: 'PART %', width: 10, type: 'number' },
        { key: 'coberturaMesesAtual', header: 'COB MESES', width: 11, type: 'number' },
        { key: 'coberturaMesesEstoqueTransito', header: 'COB MESES C/ TRÂNSITO', width: 20, type: 'number' },
        { key: 'coberturaMesesAnoAnterior', header: 'COB MESES A.A.', width: 15, type: 'number' },
        { key: 'estoqueFisico', header: 'ESTOQUE FISICO', width: 13, type: 'number' },
        { key: 'pecasEmTransito', header: 'PEÇAS EM TRÂNSITO', width: 17, type: 'number' },
        { key: 'estoqueMaisTransito', header: 'ESTOQUE + TRÂNSITO', width: 18, type: 'number' },
        { key: 'pecasEmProducao', header: 'PEÇAS EM PRODUÇÃO', width: 17, type: 'number' },
      ];

      exportToExcel({
        filename: `Acompanhamento_${tipoClassificacao}_${new Date().toISOString().slice(0, 10)}`,
        sheetName: 'Acompanhamento',
        title: `Acompanhamento Diário por ${TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label} - Canal: ${CANAL_OPTIONS.find((o) => o.value === canal)?.label}  |  COB MESES do TOTAL é recalculada (estoque total ÷ venda média mensal), não é a média da coluna`,
        columns,
        data: sortedLinhas as unknown as Record<string, unknown>[],
        totals: {
          classificacao: `TOTAL (${sortedLinhas.length})`,
          vendaValorAtual: data.totais.vendaValorAtual,
          vendaValorAnoAnterior: data.totais.vendaValorAnoAnterior,
          evolucaoValorPercent: data.totais.evolucaoValorPercent ?? '',
          vendaPecasAtual: data.totais.vendaPecasAtual,
          vendaPecasAnoAnterior: data.totais.vendaPecasAnoAnterior,
          evolucaoPecasPercent: data.totais.evolucaoPecasPercent ?? '',
          participacaoPercent: data.totais.participacaoPercent,
          metaPeriodo: data.totais.metaPeriodo ?? '',
          atingimentoMetaPercent: data.totais.atingimentoMetaPercent ?? '',
          coberturaMesesAtual: data.totais.coberturaMesesAtual ?? '',
          coberturaMesesEstoqueTransito: data.totais.coberturaMesesEstoqueTransito ?? '',
          coberturaMesesAnoAnterior: data.totais.coberturaMesesAnoAnterior ?? '',
          estoqueFisico: data.totais.estoqueFisico,
          pecasEmTransito: data.totais.pecasEmTransito,
          estoqueMaisTransito: data.totais.estoqueMaisTransito,
          pecasEmProducao: data.totais.pecasEmProducao,
        },
      });
      showToast('Excel exportado com sucesso', 'success');
    } catch {
      showToast('Erro ao exportar Excel', 'error');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Acompanhamento por Linha</h1>
          <p className="text-sm text-gray-500 mt-1">
            Venda por classificação comparada com o ano anterior, meta, cobertura, estoque e peças em produção
          </p>
        </div>
        <Button variant="secondary" onClick={() => setMostrarModalMetas(true)}>
          Cadastrar Metas
        </Button>
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm text-gray-700">
          <strong>Como funciona:</strong> Venda em R$ e em peças do período selecionado comparada com o mesmo
          intervalo de dias do ano anterior. A meta é proporcional aos dias selecionados: meta mensal ÷ dias do
          mês × dias do período; sem meta cadastrada, fica em branco. Cobertura é sempre em meses, normalizada pelos
          dias reais de cada mês; a do ano anterior usa o estoque e a venda de então, não o de hoje. Estoque considera
          o saldo físico da loja; para DPA, inclui físico e segunda qualidade, e para Atacado, somente o estoque atacado.
          Vendas de produtos sem o valor da classificação escolhida aparecem em <strong>SEM CLASSIFICAÇÃO</strong>, para
          que os totais conciliem com o dashboard comercial.
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="block text-xs font-medium text-gray-600 mb-1">Classificar por</label>
          <Select
            options={TIPO_CLASSIFICACAO_DIARIO_OPTIONS}
            value={tipoClassificacao}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTipoClassificacao(e.target.value as TipoClassificacaoDiario)}
          />
        </div>

        <div className="w-40">
          <label className="block text-xs font-medium text-gray-600 mb-1">Canal</label>
          <Select options={CANAL_OPTIONS} value={canal} onChange={(e: ChangeEvent<HTMLSelectElement>) => setCanal(e.target.value as Canal)} />
        </div>

        <FilialMultiSelect
          options={lojasParaFiltro.map((l) => ({ value: l.branch_code, label: l.branch_name }))}
          selected={branchesSelecionados}
          onChange={setBranchesSelecionados}
          className="w-52"
          label="Lojas"
        />

        <Input label="De" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-40" />
        <Input label="Até" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-40" />

        <Button onClick={carregarDados} isLoading={isLoading}>
          Atualizar
        </Button>

        <Button variant="secondary" onClick={handleExportExcel} isLoading={exportando} disabled={!data || sortedLinhas.length === 0}>
          Exportar Excel
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8 gap-4">
          <KPICard title="Venda Atual" value={formatMoney(data.kpis.vendaValorTotal)} color="green" isLoading={isLoading} />
          {/* Meta do periodo = meta mensal de LOJA (Comercial, nivel_3) / dias do mes *
              dias selecionados, e a meta diaria e esse valor dividido pelos dias do
              periodo (formula pedida na devolutiva). Vem da meta que o usuario ja
              cadastra todo mes no modulo Comercial - nao do cadastro por classificacao
              desta tela (esse so alimenta as colunas META R$/ATING. META da tabela,
              que sabem repartir por categoria/linha/colecao). Os dois ficam em branco
              so quando falta meta de loja cadastrada no Comercial pras lojas/canal
              selecionados naquele mes. */}
          <KPICard
            title="Meta do Período"
            value={data.kpis.metaPeriodoTotal === null ? '—' : formatMoney(data.kpis.metaPeriodoTotal)}
            subtitle={
              data.kpis.metaPeriodoTotal === null
                ? `sem meta de loja cadastrada no Comercial em ${rotuloPeriodoMeta}`
                : `meta de loja (Comercial) ÷ dias do mês × ${data.diasPeriodo} ${data.diasPeriodo === 1 ? 'dia' : 'dias'}`
            }
            color="purple"
            isLoading={isLoading}
          />
          <KPICard
            title="Meta Diária"
            value={data.kpis.metaDiaria === null ? '—' : formatMoney(data.kpis.metaDiaria)}
            subtitle={
              data.kpis.metaDiaria === null
                ? `cadastre a meta de loja de ${rotuloPeriodoMeta} no módulo Comercial`
                : `meta do período ÷ ${data.diasPeriodo} ${data.diasPeriodo === 1 ? 'dia' : 'dias'} do período`
            }
            color="purple"
            isLoading={isLoading}
          />
          <KPICard title="Venda Ano Anterior" value={formatMoney(data.kpis.vendaValorAnoAnteriorTotal)} color="blue" isLoading={isLoading} />
          <KPICard title="Evolução vs A.A." value={formatPercentDelta(data.kpis.evolucaoValorPercent)} color="purple" isLoading={isLoading} />
          <KPICard title="Estoque Físico" value={formatNumber(data.kpis.estoqueFisicoTotal)} color="yellow" isLoading={isLoading} />
          <KPICard
            title="Em Trânsito"
            value={formatNumber(data.kpis.pecasEmTransitoTotal)}
            subtitle={`Estoque + trânsito: ${formatNumber(data.kpis.estoqueMaisTransitoTotal)}`}
            color="purple"
            isLoading={isLoading}
          />
          <KPICard title="Peças em Produção" value={formatNumber(data.kpis.pecasEmProducaoTotal)} color="red" isLoading={isLoading} />
        </div>
      )}

      {data && (
        <div className="space-y-1 text-xs text-gray-500">
          <div>
            <span className="font-medium">Períodos:</span> Atual: {formatDate(data.periodoAtual.inicio)} a {formatDate(data.periodoAtual.fim)} |
            {' '}Ano Anterior: {formatDate(data.periodoAnoAnterior.inicio)} a {formatDate(data.periodoAnoAnterior.fim)}
          </div>
          {/* As colunas META R$/ATING. META da tabela abaixo vem do cadastro por
              classificacao desta tela ("Cadastrar Metas"), separado da meta de loja
              que alimenta os cards acima - por isso a cobertura costuma ser parcial. */}
          <div>
            <span className="font-medium">Meta por {labelClassificacao}:</span>{' '}
            {metaCobertura.comMeta} de {metaCobertura.total} itens com meta cadastrada em {rotuloPeriodoMeta}
            {metaCobertura.comMeta < metaCobertura.total && ' · cadastre o restante no botão "Cadastrar Metas"'}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Vendas por {TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label}
          </CardTitle>
        </CardHeader>

        {erro && <div className="text-red-600 text-sm mb-4">Erro: {erro}</div>}

        <div ref={topScrollRef} onScroll={sincronizarScrollPeloTopo} className="mb-2 overflow-x-auto overflow-y-hidden">
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <Table ref={tabelaScrollRef} className="scrollbar-x-hidden max-h-[520px] overflow-auto" tableClassName="text-sm min-w-[1650px]">
            <TableHead className="sticky top-0 z-10">
              <TableRow>
                <ThSortPcp label={TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label.toUpperCase() || ''} sortKeyName="classificacao" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="left" />
                <ThSortPcp label="VENDA R$" sortKeyName="vendaValorAtual" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Venda em R$, mês atual até ontem" />
                <ThSortPcp label="META R$" sortKeyName="metaPeriodo" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Meta mensal proporcional aos dias selecionados" />
                <ThSortPcp label="ATING. META" sortKeyName="atingimentoMetaPercent" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Percentual realizado da meta proporcional do período" />
                <ThSortPcp label="VENDA R$ A.A." sortKeyName="vendaValorAnoAnterior" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Venda em R$, mesmo período do ano anterior" />
                <ThSortPcp label="EVOL R$" sortKeyName="evolucaoValorPercent" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Crescimento em R$ vs ano anterior" />
                <ThSortPcp label="VENDA PÇ" sortKeyName="vendaPecasAtual" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Venda em peças, mês atual até ontem" />
                <ThSortPcp label="VENDA PÇ A.A." sortKeyName="vendaPecasAnoAnterior" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" />
                <ThSortPcp label="EVOL PÇ" sortKeyName="evolucaoPecasPercent" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" />
                <ThSortPcp label="PART %" sortKeyName="participacaoPercent" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Participação no total vendido no filtro atual" />
                <ThSortPcp label="COB MESES" sortKeyName="coberturaMesesAtual" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Cobertura atual em meses = estoque físico / venda média mensal" />
                <ThSortPcp label="COB C/ TRÂNSITO" sortKeyName="coberturaMesesEstoqueTransito" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Cobertura em meses contando também o que está a caminho = (estoque + trânsito) / venda média mensal. Sempre maior ou igual à COB MESES." />
                <ThSortPcp label="COB MESES A.A." sortKeyName="coberturaMesesAnoAnterior" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Cobertura em meses no mesmo período do ano anterior, com o estoque e a venda de então" />
                <ThSortPcp label="ESTOQUE" sortKeyName="estoqueFisico" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Estoque físico disponível na loja" />
                <ThSortPcp label="EM TRÂNSITO" sortKeyName="pecasEmTransito" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Peças transferidas do DPA que ainda não chegaram ao destino. Não constam no estoque de nenhuma loja, por isso são contadas à parte. Fonte: vínculo documento-a-documento do TOTVS (relatório Estoque em Trânsito)." />
                <ThSortPcp label="ESTOQUE + TRÂNSITO" sortKeyName="estoqueMaisTransito" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Soma do estoque físico com as peças a caminho" />
                <ThSortPcp label="EM PRODUÇÃO" sortKeyName="pecasEmProducao" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Peças em Ordem de Produção aberta (rede toda)" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={17} align="center" className="py-8"><div className="animate-pulse text-gray-400">Carregando...</div></TableCell>
                </TableRow>
              ) : sortedLinhas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={17} align="center" className="py-8 text-gray-500">Nenhum dado encontrado para os filtros selecionados</TableCell>
                </TableRow>
              ) : data ? (
                <>
                  {sortedLinhas.map((linha) => (
                  <TableRow key={linha.classificacao} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="font-medium">{linha.classificacao}</TableCell>
                    <TableCell align="right">{formatMoney(linha.vendaValorAtual)}</TableCell>
                    <TableCell align="right">{linha.metaPeriodo !== null ? formatMoney(linha.metaPeriodo) : '-'}</TableCell>
                    <TableCell align="right" className={linha.atingimentoMetaPercent !== null && linha.atingimentoMetaPercent < 100 ? 'text-red-600' : 'text-green-600'}>
                      {linha.atingimentoMetaPercent !== null ? `${linha.atingimentoMetaPercent.toFixed(1)}%` : '-'}
                    </TableCell>
                    <TableCell align="right">{formatMoney(linha.vendaValorAnoAnterior)}</TableCell>
                    <TableCell align="right" className={linha.evolucaoValorPercent !== null && linha.evolucaoValorPercent < 0 ? 'text-red-600' : 'text-green-600'}>
                      {formatPercentDelta(linha.evolucaoValorPercent)}
                    </TableCell>
                    <TableCell align="right">{formatNumber(linha.vendaPecasAtual)}</TableCell>
                    <TableCell align="right">{formatNumber(linha.vendaPecasAnoAnterior)}</TableCell>
                    <TableCell align="right" className={linha.evolucaoPecasPercent !== null && linha.evolucaoPecasPercent < 0 ? 'text-red-600' : 'text-green-600'}>
                      {formatPercentDelta(linha.evolucaoPecasPercent)}
                    </TableCell>
                    <TableCell align="right">{linha.participacaoPercent.toFixed(1)}%</TableCell>
                    <TableCell align="right">{linha.coberturaMesesAtual !== null ? linha.coberturaMesesAtual.toFixed(1) : '-'}</TableCell>
                    <TableCell align="right">{linha.coberturaMesesEstoqueTransito !== null ? linha.coberturaMesesEstoqueTransito.toFixed(1) : '-'}</TableCell>
                    <TableCell align="right">{linha.coberturaMesesAnoAnterior !== null ? linha.coberturaMesesAnoAnterior.toFixed(1) : '-'}</TableCell>
                    <TableCell align="right">{formatNumber(linha.estoqueFisico)}</TableCell>
                    <TableCell align="right" className={linha.pecasEmTransito > 0 ? 'text-[var(--bbtk-purple)]' : 'text-gray-400'}>
                      {formatNumber(linha.pecasEmTransito)}
                    </TableCell>
                    <TableCell align="right">{formatNumber(linha.estoqueMaisTransito)}</TableCell>
                    <TableCell align="right">{formatNumber(linha.pecasEmProducao)}</TableCell>
                  </TableRow>
                  ))}
                  <TableRow className="sticky bottom-0 z-20 bg-gray-100 font-bold border-t-2 border-gray-300 shadow-[0_-1px_0_rgba(148,163,184,0.35)]">
                    <TableCell>TOTAL ({sortedLinhas.length})</TableCell>
                    <TableCell align="right">{formatMoney(data.totais.vendaValorAtual)}</TableCell>
                    <TableCell align="right">{data.totais.metaPeriodo !== null ? formatMoney(data.totais.metaPeriodo) : '-'}</TableCell>
                    <TableCell align="right">{data.totais.atingimentoMetaPercent !== null ? `${data.totais.atingimentoMetaPercent.toFixed(1)}%` : '-'}</TableCell>
                    <TableCell align="right">{formatMoney(data.totais.vendaValorAnoAnterior)}</TableCell>
                    <TableCell align="right">{formatPercentDelta(data.totais.evolucaoValorPercent)}</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.vendaPecasAtual)}</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.vendaPecasAnoAnterior)}</TableCell>
                    <TableCell align="right">{formatPercentDelta(data.totais.evolucaoPecasPercent)}</TableCell>
                    <TableCell align="right">{data.totais.participacaoPercent.toFixed(1)}%</TableCell>
                    <TableCell align="right">{data.totais.coberturaMesesAtual !== null ? data.totais.coberturaMesesAtual.toFixed(1) : '-'}</TableCell>
                    <TableCell align="right">{data.totais.coberturaMesesEstoqueTransito !== null ? data.totais.coberturaMesesEstoqueTransito.toFixed(1) : '-'}</TableCell>
                    <TableCell align="right">{data.totais.coberturaMesesAnoAnterior !== null ? data.totais.coberturaMesesAnoAnterior.toFixed(1) : '-'}</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.estoqueFisico)}</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.pecasEmTransito)}</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.estoqueMaisTransito)}</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.pecasEmProducao)}</TableCell>
                  </TableRow>
                </>
              ) : null}
            </TableBody>
          </Table>
      </Card>

      <ModalCadastrarMetas isOpen={mostrarModalMetas} onClose={() => setMostrarModalMetas(false)} />
    </div>
  );
}

const TIPO_META_OPTIONS: { value: string; label: string }[] = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'linha', label: 'Linha' },
  { value: 'genero', label: 'Gênero' },
  { value: 'colecao', label: 'Coleção' },
  { value: 'status', label: 'Status' },
];

function ModalCadastrarMetas({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { showToast } = useToast();

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [tipoMeta, setTipoMeta] = useState('categoria');
  const [valoresDisponiveis, setValoresDisponiveis] = useState<string[]>([]);
  const [valorSelecionado, setValorSelecionado] = useState('');
  const [metaValorStr, setMetaValorStr] = useState('');
  const [metasCadastradas, setMetasCadastradas] = useState<PcpMetaClassificacaoItem[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const anoOptions = Array.from({ length: 4 }, (_, i) => {
    const year = new Date().getFullYear() + 1 - i;
    return { value: year, label: String(year) };
  });
  const mesOptions = MESES.slice(1).map((m, i) => ({ value: i + 1, label: m }));

  const carregarMetas = useCallback(async () => {
    if (!token || !isOpen) return;
    setCarregando(true);
    try {
      const res = await metaClassificacaoApi.getMetas(token, ano, mes);
      setMetasCadastradas(res.metas);
    } catch (error) {
      showToast('Erro ao carregar metas cadastradas', 'error');
      console.error(error);
    } finally {
      setCarregando(false);
    }
  }, [token, isOpen, ano, mes, showToast]);

  useEffect(() => {
    carregarMetas();
  }, [carregarMetas]);

  useEffect(() => {
    if (!token || !isOpen) return;
    setValorSelecionado('');
    metaClassificacaoApi
      .getValores(token, tipoMeta)
      .then((res) => setValoresDisponiveis(res.valores))
      .catch((error) => {
        showToast('Erro ao carregar valores de classificação', 'error');
        console.error(error);
      });
  }, [token, isOpen, tipoMeta, showToast]);

  async function handleAdicionar() {
    if (!token) return;
    const valorNum = parseFloat(metaValorStr.replace(',', '.'));
    if (!valorSelecionado) {
      showToast('Selecione o valor da classificação', 'error');
      return;
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      showToast('Informe uma meta válida', 'error');
      return;
    }

    setSalvando(true);
    try {
      await metaClassificacaoApi.salvarMetas(token, ano, mes, [{ tipoClassificacao: tipoMeta, valorClassificacao: valorSelecionado, metaValor: valorNum }]);
      showToast('Meta salva!', 'success');
      setMetaValorStr('');
      carregarMetas();
    } catch (error) {
      showToast('Erro ao salvar meta', 'error');
      console.error(error);
    } finally {
      setSalvando(false);
    }
  }

  async function handleRemover(id: number) {
    if (!token) return;
    try {
      await metaClassificacaoApi.deleteMeta(token, id);
      setMetasCadastradas((prev) => prev.filter((m) => m.id !== id));
    } catch (error) {
      showToast('Erro ao remover meta', 'error');
      console.error(error);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cadastrar Metas por Classificação" size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Select label="Ano" options={anoOptions} value={ano} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAno(parseInt(e.target.value, 10))} className="w-28" />
          <Select label="Mês" options={mesOptions} value={mes} onChange={(e: ChangeEvent<HTMLSelectElement>) => setMes(parseInt(e.target.value, 10))} className="w-40" />
        </div>

        <div className="border-t pt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Adicionar meta</p>
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Classificar por" options={TIPO_META_OPTIONS} value={tipoMeta} onChange={(e: ChangeEvent<HTMLSelectElement>) => setTipoMeta(e.target.value)} className="w-40" />
            <Select
              label="Valor"
              options={[{ value: '', label: 'Selecione...' }, ...valoresDisponiveis.map((v) => ({ value: v, label: v }))]}
              value={valorSelecionado}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setValorSelecionado(e.target.value)}
              className="w-56"
            />
            <Input label="Meta (R$)" type="number" step="0.01" min="0" value={metaValorStr} onChange={(e) => setMetaValorStr(e.target.value)} className="w-40" />
            <Button onClick={handleAdicionar} isLoading={salvando}>
              Adicionar
            </Button>
          </div>
        </div>

        <div className="border-t pt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">
            Metas cadastradas em {MESES[mes]}/{ano}
          </p>
          {carregando ? (
            <p className="text-sm text-gray-500">Carregando...</p>
          ) : metasCadastradas.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma meta cadastrada para esse período.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5">Tipo</th>
                    <th className="text-left px-3 py-1.5">Valor</th>
                    <th className="text-right px-3 py-1.5">Meta</th>
                    <th className="text-center px-3 py-1.5 w-24">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {metasCadastradas.map((meta) => (
                    <tr key={meta.id}>
                      <td className="px-3 py-1.5">{TIPO_META_OPTIONS.find((o) => o.value === meta.tipoClassificacao)?.label || meta.tipoClassificacao}</td>
                      <td className="px-3 py-1.5">{meta.valorClassificacao}</td>
                      <td className="px-3 py-1.5 text-right">{formatMoney(Number(meta.metaValor))}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button type="button" onClick={() => handleRemover(meta.id)} className="text-xs text-gray-400 hover:text-red-600 hover:underline">
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
