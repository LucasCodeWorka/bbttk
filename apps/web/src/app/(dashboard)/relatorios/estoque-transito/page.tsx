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
  EstoqueTransitoFiltrosResponse,
  EstoqueTransitoResponse,
  EstoqueTransitoRow,
  EstoqueTransitoStatus,
  estoqueTransitoApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { ExcelColumn, exportToExcel } from '@/lib/exportExcel';

type SortKey = keyof EstoqueTransitoRow;

// A tabela e a prova de auditoria: documento + item + produto + quantidade aberta +
// idade. A ordem das colunas segue o caminho de investigacao (quem/quando -> o que ->
// quanto -> quando baixou), nao a ordem alfabetica.
const COLUNAS: Array<{ key: SortKey; label: string; align?: 'left' | 'right' | 'center'; type?: 'text' | 'number'; width: number }> = [
  { key: 'statusTransito', label: 'STATUS', width: 13, type: 'text' },
  { key: 'metodoBaixa', label: 'ORIGEM DA BAIXA', width: 16, type: 'text' },
  { key: 'entradaDocs', label: 'DOC. ENTRADA', width: 16, type: 'text' },
  { key: 'destinoBranchName', label: 'LOJA DESTINO', width: 22, type: 'text' },
  { key: 'saidaTransactionCode', label: 'DOC. SAIDA', align: 'right', width: 12, type: 'text' },
  { key: 'saidaTransactionDate', label: 'DT. SAIDA', align: 'center', width: 12, type: 'text' },
  { key: 'diasEmTransito', label: 'IDADE (D)', align: 'right', width: 11, type: 'number' },
  { key: 'saidaOperationCode', label: 'OPER.', align: 'right', width: 9, type: 'text' },
  { key: 'saidaOperationDescription', label: 'DESC. OPERACAO', width: 24, type: 'text' },
  { key: 'productSku', label: 'SKU', width: 16, type: 'text' },
  { key: 'referenceCode', label: 'REFERENCIA', width: 14, type: 'text' },
  { key: 'productName', label: 'PRODUTO', width: 30, type: 'text' },
  { key: 'colorName', label: 'COR', width: 16, type: 'text' },
  { key: 'size', label: 'TAM.', align: 'center', width: 8, type: 'text' },
  { key: 'categoria', label: 'CATEGORIA', width: 16, type: 'text' },
  { key: 'linha', label: 'LINHA', width: 16, type: 'text' },
  { key: 'genero', label: 'GENERO', width: 12, type: 'text' },
  { key: 'colecao', label: 'COLECAO', width: 16, type: 'text' },
  { key: 'quantidadeSaida', label: 'QT. SAIU', align: 'right', width: 11, type: 'number' },
  { key: 'quantidadeRecebida', label: 'QT. RECEBIDA', align: 'right', width: 13, type: 'number' },
  { key: 'quantidadeEmTransito', label: 'QT. ABERTA', align: 'right', width: 12, type: 'number' },
  { key: 'primeiraEntradaDate', label: '1a BAIXA', align: 'center', width: 12, type: 'text' },
  { key: 'ultimaEntradaDate', label: 'ULT. BAIXA', align: 'center', width: 12, type: 'text' },
];

// Status e "estado", nao "serie": cor reservada + rotulo sempre escrito do lado
// (nunca identificar so pela cor).
const STATUS_BADGE: Record<EstoqueTransitoStatus, string> = {
  em_transito: 'bg-red-100 text-red-700',
  parcial: 'bg-yellow-100 text-yellow-700',
  recebido: 'bg-green-100 text-green-700',
};

const STATUS_LABEL: Record<EstoqueTransitoStatus, string> = {
  em_transito: 'Em transito',
  parcial: 'Parcial',
  recebido: 'Recebido',
};

const STATUS_OPCOES: EstoqueTransitoStatus[] = ['em_transito', 'parcial', 'recebido'];

// Toda baixa vem do vinculo do TOTVS. 'fifo'/'misto' so apareceriam numa foto gerada
// por versao antiga do script - ficam mapeados pra nao quebrar a tela nesse caso.
const METODO_BADGE: Record<string, string> = {
  vinculo: 'bg-green-100 text-green-700',
  fifo: 'bg-gray-100 text-gray-600',
  misto: 'bg-blue-100 text-blue-700',
};

const METODO_LABEL: Record<string, string> = {
  vinculo: 'Vinculo TOTVS',
  fifo: 'Aproximado (foto antiga)',
  misto: 'Misto (foto antiga)',
};

const DIMENSOES = ['categoria', 'linha', 'genero', 'statusProduto'] as const;
type DimensaoChave = (typeof DIMENSOES)[number];

function ThSortPcp({
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
      className="cursor-pointer select-none whitespace-nowrap bg-gray-50 hover:bg-gray-100 !px-1.5 !py-1.5"
    >
      <span className={cn('flex items-center gap-1.5', coluna.align === 'right' && 'justify-end', coluna.align === 'center' && 'justify-center')}>
        <span>{coluna.label}</span>
        <span className={active ? 'text-[var(--bbtk-purple)]' : 'text-gray-300'}>{active && sortDir === 'desc' ? 'v' : '^'}</span>
      </span>
    </TableCell>
  );
}

// Barra de proporcao desenhada em HTML/CSS (o projeto ja abandonou o Recharts pra
// barra categorica horizontal). Serie unica por painel -> sem legenda, e o valor
// vai escrito do lado de toda barra em vez de depender da cor.
const TOM_BARRA = {
  roxo: 'bg-[var(--bbtk-purple)]',
  vermelho: 'bg-[var(--bbtk-red)]',
  cinza: 'bg-gray-400',
} as const;

function BarraProporcao({ valor, maximo, tom }: { valor: number; maximo: number; tom: keyof typeof TOM_BARRA }) {
  const pct = maximo > 0 ? Math.max((valor / maximo) * 100, valor > 0 ? 2 : 0) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-gray-100">
      <div className={cn('h-2 rounded-full', TOM_BARRA[tom])} style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatCell(row: EstoqueTransitoRow, key: SortKey): string {
  const value = row[key];
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

export default function EstoqueTransitoPage() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [branches, setBranches] = useState<number[]>([]);
  const [statusSelecionado, setStatusSelecionado] = useState<EstoqueTransitoStatus[]>([]);
  const [search, setSearch] = useState('');
  const [idadeMin, setIdadeMin] = useState('');
  const [idadeMax, setIdadeMax] = useState('');
  const [apenasPendentes, setApenasPendentes] = useState(true);
  const [confiabilidade, setConfiabilidade] = useState<'todas' | 'vinculo' | 'sem_vinculo'>('todas');
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<EstoqueTransitoResponse | null>(null);
  const [filtrosDisponiveis, setFiltrosDisponiveis] = useState<EstoqueTransitoFiltrosResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('quantidadeEmTransito');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const tabelaScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    if (!token) return;
    estoqueTransitoApi
      .getFiltros(token)
      .then(setFiltrosDisponiveis)
      .catch((error) => {
        showToast('Erro ao carregar filtros de Estoque em Transito', 'error');
        console.error(error);
      });
  }, [token, showToast]);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await estoqueTransitoApi.getEstoqueTransito(token, {
        status: statusSelecionado.length > 0 ? statusSelecionado : undefined,
        branches: branches.length > 0 ? branches : undefined,
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        statusProduto: produtoFiltro.statusProduto,
        search: search.trim() || undefined,
        idadeMin: idadeMin.trim() ? Number(idadeMin) : undefined,
        idadeMax: idadeMax.trim() ? Number(idadeMax) : undefined,
        apenasPendentes,
        confiabilidade: confiabilidade === 'todas' ? undefined : confiabilidade,
      });
      setData(response);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao carregar Estoque em Transito', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, statusSelecionado, branches, produtoFiltro, search, idadeMin, idadeMax, apenasPendentes, confiabilidade, showToast]);

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
      setSortDir('desc');
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
          acc.quantidadeSaida += row.quantidadeSaida;
          acc.quantidadeRecebida += row.quantidadeRecebida;
          acc.quantidadeEmTransito += row.quantidadeEmTransito;
          return acc;
        },
        { quantidadeSaida: 0, quantidadeRecebida: 0, quantidadeEmTransito: 0 }
      ),
    [rowsOrdenadas]
  );

  const maxIdadeBucket = useMemo(() => Math.max(1, ...(data?.idadeBuckets || []).map((b) => b.pecas)), [data]);
  const maxLoja = useMemo(() => Math.max(1, ...(data?.porLoja || []).map((l) => l.pecasEmTransito)), [data]);
  const totalStatusPecas = useMemo(() => (data?.porStatus || []).reduce((total, s) => total + s.pecas, 0), [data]);

  function toggleStatus(status: EstoqueTransitoStatus) {
    setStatusSelecionado((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  }

  function limparFiltros() {
    setProdutoFiltro({});
    setBranches([]);
    setStatusSelecionado([]);
    setSearch('');
    setIdadeMin('');
    setIdadeMax('');
    setApenasPendentes(true);
    setConfiabilidade('todas');
  }

  function exportarExcel() {
    if (!data || rowsOrdenadas.length === 0) return;
    const columns: ExcelColumn[] = COLUNAS.map((coluna) => ({
      key: coluna.key,
      header: coluna.label,
      width: coluna.width,
      type: coluna.type,
      getValue:
        coluna.key === 'statusTransito'
          ? (row) => STATUS_LABEL[row.statusTransito as EstoqueTransitoStatus]
          : coluna.key === 'metodoBaixa'
            ? (row) =>
                row.metodoBaixa
                  ? METODO_LABEL[row.metodoBaixa as string]
                  : row.temVinculo
                    ? 'Vinculo, sem baixa'
                    : 'Sem baixa'
            : undefined,
    }));
    exportToExcel({
      filename: `Estoque_Em_Transito_${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Em Transito',
      title: `Estoque em Transito (Fabrica -> Loja) - janela ${data.janela.inicio ? formatDate(data.janela.inicio) : '-'} a ${
        data.janela.fim ? formatDate(data.janela.fim) : '-'
      } - foto de ${data.atualizadoEm ? new Date(data.atualizadoEm).toLocaleString('pt-BR') : '-'}`,
      columns,
      data: rowsOrdenadas as unknown as Record<string, unknown>[],
      totals: {
        statusTransito: data.linhasTruncadas
          ? `SUBTOTAL (${rowsOrdenadas.length} de ${data.kpis.linhas} linhas do recorte)`
          : `TOTAL (${rowsOrdenadas.length} linhas)`,
        quantidadeSaida: totais.quantidadeSaida,
        quantidadeRecebida: totais.quantidadeRecebida,
        quantidadeEmTransito: totais.quantidadeEmTransito,
      },
    });
  }

  const classificacoesPorChave = useMemo(() => {
    const mapa = new Map<string, EstoqueTransitoFiltrosResponse['classificacoes'][number]>();
    for (const dimensao of filtrosDisponiveis?.classificacoes || []) mapa.set(dimensao.chave, dimensao);
    return mapa;
  }, [filtrosDisponiveis]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Estoque em Transito</h1>
          <p className="text-gray-500 text-sm mt-1">
            Saida de transferencia da Fabrica baixada contra a entrada registrada em cada loja, item a item. O que nao foi baixado fica como pendencia, com
            idade em dias pra auditoria.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={limparFiltros} variant="secondary" disabled={isLoading}>
            Limpar filtros
          </Button>
          <Button onClick={exportarExcel} disabled={!data || rowsOrdenadas.length === 0 || isLoading} variant="secondary">
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* Aviso de lacuna de dado: aparece sozinho enquanto o ETL nao estiver gravando item
          de transferencia. Sem ele, "nenhuma saida recente" seria lido como "a rede parou
          de transferir mercadoria", que e a conclusao errada. Some quando o ETL voltar. */}
      {data?.cobertura.incompleta && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
          <p className="font-semibold">Dado de origem incompleto — este relatorio NAO mostra transito atual</p>
          <p className="mt-1">
            A saida de transferencia mais recente com item gravado e de{' '}
            <strong>{data.cobertura.ultimaSaida ? formatDate(data.cobertura.ultimaSaida) : '-'}</strong>, ou seja{' '}
            <strong>{formatNumber(data.cobertura.defasagemDias || 0)} dias atras</strong>. O ETL do TOTVS parou de gravar os itens das operacoes de
            transferencia, entao transferencia feita depois dessa data nao tem como ser contada aqui — nao e que a rede tenha parado de transferir.
          </p>
          <p className="mt-1">
            Use este relatorio como <strong>auditoria do passivo</strong> (baixa de transferencia atrasada, limpeza de cadastro), nunca como previsao de
            chegada de mercadoria. Corrigir exige reprocessar o ETL a partir do corte — ver{' '}
            <code className="rounded bg-red-100 px-1">DIAGNOSTICO-DEVOLUTIVA-ACOMPANHAMENTO-LINHA.md</code>.
          </p>
        </div>
      )}

      {/* Aviso estrutural: sem esse contexto o relatorio e lido como "estoque futuro", o que ele nao e. */}
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-xs text-yellow-900">
        <p className="font-semibold">Como ler este relatorio</p>
        <p className="mt-1">
          Toda baixa vem do <strong>vinculo documento-a-documento do TOTVS</strong>: o ERP aponta exatamente qual documento de entrada recebeu cada saida, e a
          coluna <strong>DOC. ENTRADA</strong> mostra qual e, pra abrir e conferir. Nao ha estimativa no calculo.
        </p>
        <p className="mt-1">
          Por isso, uma linha pendente significa uma coisa so: <strong>a saida nao tem entrada correspondente registrada no ERP</strong>. Ou a mercadoria nao
          chegou, ou a loja nao lancou o recebimento. Nos dois casos ha o que cobrar, e o documento de saida identifica de quem.
        </p>
        <p className="mt-1">
          Linha marcada <strong>Sem vinculo</strong> e o caso mais grave: o ERP nao relaciona aquela saida a entrada nenhuma, entao ela aparece 100% aberta.
          Idade alta continua indicando atraso de lancamento ou residuo contabil, nao caminhao na estrada.
        </p>
        {data && (
          <p className="mt-2">
            Janela apurada: {data.janela.inicio ? formatDate(data.janela.inicio) : '-'} a {data.janela.fim ? formatDate(data.janela.fim) : '-'} · Foto gerada
            em {data.atualizadoEm ? new Date(data.atualizadoEm).toLocaleString('pt-BR') : '-'} (materializada por{' '}
            <code className="rounded bg-yellow-100 px-1">npm run rebuild:estoque-transito -w apps/api</code>)
          </p>
        )}
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <Input label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Documento, SKU, referencia, produto ou loja" />
          <Input label="Idade minima (dias)" type="number" value={idadeMin} onChange={(e) => setIdadeMin(e.target.value)} placeholder="0" />
          <Input label="Idade maxima (dias)" type="number" value={idadeMax} onChange={(e) => setIdadeMax(e.target.value)} placeholder="sem limite" />
          <div className="flex items-end">
            <Button onClick={carregarDados} isLoading={isLoading} className="w-full">
              Atualizar
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          {filtrosDisponiveis && (
            <FilialMultiSelect
              label="Loja destino"
              options={filtrosDisponiveis.lojas.map((loja) => ({ value: loja.branch_code, label: loja.branch_name }))}
              selected={branches}
              onChange={setBranches}
              className="w-56"
            />
          )}

          {DIMENSOES.map((chave) => {
            const dimensao = classificacoesPorChave.get(chave);
            if (!dimensao) return null;
            return (
              <ClassificacaoMultiSelect
                key={chave}
                label={dimensao.label}
                options={dimensao.opcoes.map((opcao) => ({ value: opcao.valor, label: opcao.valor, meta: formatNumber(opcao.qtd_skus) }))}
                selected={(produtoFiltro[chave] as string[]) || []}
                onChange={(valores) => atualizarProdutoFiltro(chave, valores)}
                className="w-44"
              />
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-4">
          <span className="text-sm font-medium text-gray-700">Status:</span>
          {STATUS_OPCOES.map((status) => (
            <label key={status} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={statusSelecionado.includes(status)}
                onChange={() => toggleStatus(status)}
                className="w-4 h-4 text-[var(--bbtk-red)] rounded"
              />
              <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium', STATUS_BADGE[status])}>{STATUS_LABEL[status]}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-gray-700 ml-auto">
            <input
              type="checkbox"
              checked={apenasPendentes}
              onChange={(e) => setApenasPendentes(e.target.checked)}
              className="w-4 h-4 text-[var(--bbtk-red)] rounded"
            />
            Mostrar so o que ainda tem saldo aberto
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-sm font-medium text-gray-700">Confiabilidade:</span>
          {(
            [
              { valor: 'todas', label: 'Tudo' },
              { valor: 'vinculo', label: 'Com vinculo no ERP' },
              { valor: 'sem_vinculo', label: 'Sem vinculo nenhum' },
            ] as const
          ).map((opcao) => (
            <button
              key={opcao.valor}
              type="button"
              onClick={() => setConfiabilidade(opcao.valor)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                confiabilidade === opcao.valor
                  ? 'border-[var(--bbtk-purple)] bg-[var(--bbtk-purple)] text-white'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {opcao.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        <KPICard title="Pecas abertas" value={formatNumber(data?.kpis.pecasEmTransito || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard
          title="Abertas c/ vinculo"
          value={formatNumber(data?.kpis.pecasAbertasComVinculo || 0)}
          subtitle="confirmado pelo ERP"
          color="red"
          valueSize="sm"
          isLoading={isLoading}
        />
        <KPICard title="Abertas +90 dias" value={formatNumber(data?.kpis.pendenciasAntigas90d || 0)} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard
          title="Em loja fechada"
          value={formatNumber(data?.kpis.pecasLojasFechadas || 0)}
          subtitle="residuo contabil, nao acionavel"
          color="yellow"
          valueSize="sm"
          isLoading={isLoading}
        />
        <KPICard title="Documentos" value={formatNumber(data?.kpis.documentos || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Pecas que sairam" value={formatNumber(data?.kpis.pecasSaida || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Pecas ja recebidas" value={formatNumber(data?.kpis.pecasRecebidas || 0)} color="green" valueSize="sm" isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Idade da pendencia</CardTitle>
          </CardHeader>
          <p className="text-xs text-gray-500 -mt-2 mb-3">Pecas abertas por faixa de dias desde a saida. Faixa alta = atraso de lancamento provavel.</p>
          <div className="space-y-2.5">
            {(data?.idadeBuckets || []).map((bucket) => (
              <div key={bucket.label}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-gray-700">{bucket.label}</span>
                  <span className="font-semibold text-gray-900">
                    {formatNumber(bucket.pecas)} <span className="font-normal text-gray-400">pcs · {formatNumber(bucket.linhas)} linhas</span>
                  </span>
                </div>
                <div className="mt-1">
                  <BarraProporcao valor={bucket.pecas} maximo={maxIdadeBucket} tom={bucket.min >= 61 ? 'vermelho' : 'roxo'} />
                </div>
              </div>
            ))}
            {!isLoading && (data?.idadeBuckets || []).every((bucket) => bucket.pecas === 0) && (
              <p className="py-6 text-center text-xs text-gray-500">Nenhuma pendencia na selecao atual</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pendencia por loja destino</CardTitle>
          </CardHeader>
          <p className="text-xs text-gray-500 -mt-2 mb-3">
            Ordenado pela quantidade aberta. Clique na loja pra filtrar a tabela abaixo. Loja marcada FECHADA e residuo contabil: mercadoria que saiu antes do
            fechamento e cuja entrada nunca foi baixada — nao ha o que cobrar.
          </p>
          <div className="max-h-[320px] space-y-2.5 overflow-y-auto pr-1">
            {(data?.porLoja || []).map((loja) => (
              <button
                key={loja.branchCode}
                type="button"
                onClick={() => setBranches([loja.branchCode])}
                className="block w-full text-left"
                title={`Documentos: ${loja.documentos} · Saida mais antiga: ${loja.maisAntiga ? formatDate(loja.maisAntiga) : '-'} · Mais recente: ${
                  loja.maisRecente ? formatDate(loja.maisRecente) : '-'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-gray-700">
                    {loja.branchName}
                    {loja.lojaFechada && <span className="ml-1 rounded bg-gray-200 px-1 py-0.5 text-[10px] font-medium text-gray-600">FECHADA</span>}
                  </span>
                  <span className="shrink-0 font-semibold text-gray-900">
                    {formatNumber(loja.pecasEmTransito)} <span className="font-normal text-gray-400">pcs · {formatNumber(loja.documentos)} docs</span>
                  </span>
                </div>
                <div className="mt-1">
                  <BarraProporcao valor={loja.pecasEmTransito} maximo={maxLoja} tom={loja.lojaFechada ? 'cinza' : 'roxo'} />
                </div>
              </button>
            ))}
            {!isLoading && (data?.porLoja || []).length === 0 && <p className="py-6 text-center text-xs text-gray-500">Nenhuma loja na selecao atual</p>}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confiabilidade da apuracao</CardTitle>
          </CardHeader>
          <p className="text-xs text-gray-500 -mt-2 mb-3">Quanto do recorte o ERP relaciona a um documento de entrada, e quanto ele nao relaciona a nenhum.</p>
          {data && (
            <div className="space-y-3">
              {(
                [
                  {
                    chave: 'vinculo' as const,
                    label: 'Com vinculo no ERP',
                    pecas: data.confiabilidade.pecasComVinculo,
                    linhas: data.confiabilidade.linhasComVinculo,
                    abertas: data.kpis.pecasAbertasComVinculo,
                  },
                  {
                    chave: 'sem_vinculo' as const,
                    label: 'Sem vinculo nenhum',
                    pecas: data.confiabilidade.pecasSemVinculo,
                    linhas: data.confiabilidade.linhasSemVinculo,
                    abertas: data.kpis.pecasAbertasSemVinculo,
                  },
                ]
              ).map((item) => (
                <button key={item.chave} type="button" onClick={() => setConfiabilidade(item.chave)} className="block w-full text-left">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium', METODO_BADGE[item.chave])}>{item.label}</span>
                    <span className="font-semibold text-gray-900">
                      {formatNumber(item.pecas)} <span className="font-normal text-gray-400">pcs · {formatNumber(item.linhas)} linhas</span>
                    </span>
                  </div>
                  <div className="mt-1">
                    <BarraProporcao
                      valor={item.pecas}
                      maximo={Math.max(1, data.confiabilidade.pecasComVinculo + data.confiabilidade.pecasSemVinculo)}
                      tom={item.chave === 'vinculo' ? 'roxo' : 'cinza'}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">{formatNumber(item.abertas)} pecas abertas nesse grupo</p>
                </button>
              ))}

              <p className="border-t border-gray-100 pt-3 text-[11px] text-gray-500">
                O vinculo e lido direto do TOTVS (`originDestination`) e cobre a janela inteira — a saida mais antiga com vinculo e de{' '}
                <strong>{data.confiabilidade.primeiraSaidaComVinculo ? formatDate(data.confiabilidade.primeiraSaidaComVinculo) : '-'}</strong>. Nao ha
                estimativa no calculo: o que o ERP nao relaciona fica aberto.
              </p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Ciclo da transferencia</CardTitle>
          </CardHeader>
          <p className="text-xs text-gray-500 -mt-2 mb-3">Quanto de cada linha ja foi baixado na loja de destino.</p>
          <div className="space-y-3">
            {(data?.porStatus || []).map((status) => (
              <div key={status.status}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium', STATUS_BADGE[status.status])}>{status.label}</span>
                  <span className="font-semibold text-gray-900">
                    {formatNumber(status.pecas)} <span className="font-normal text-gray-400">pcs · {formatNumber(status.linhas)} linhas</span>
                  </span>
                </div>
                <div className="mt-1">
                  <BarraProporcao valor={status.pecas} maximo={Math.max(1, totalStatusPecas)} tom={status.status === 'em_transito' ? 'vermelho' : 'roxo'} />
                </div>
              </div>
            ))}
            {!isLoading && (data?.porStatus || []).length === 0 && <p className="py-6 text-center text-xs text-gray-500">Nenhum status na selecao atual</p>}
          </div>

          {data && (
            <dl className="mt-4 space-y-1.5 border-t border-gray-100 pt-3 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Linhas na selecao</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(data.kpis.linhas)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Linhas sem nenhuma baixa</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(data.kpis.pendencias)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Linhas baixadas em parte</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(data.kpis.parciais)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Linhas totalmente recebidas</dt>
                <dd className="font-semibold text-gray-900">{formatNumber(data.kpis.recebidas)}</dd>
              </div>
            </dl>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Auditoria documento a documento</CardTitle>
        </CardHeader>
        <p className="text-xs text-gray-500 -mt-2 mb-3">
          Uma linha por item de documento de saida.{' '}
          {data?.linhasTruncadas ? (
            <span className="font-medium text-[var(--bbtk-red)]">
              O recorte atual tem {formatNumber(data.kpis.linhas)} linhas e a tabela mostra as {formatNumber(data.limiteLinhas)} maiores — os KPIs e as
              distribuicoes acima seguem calculados sobre o total, mas o Excel exporta so o que esta na tabela. Feche mais o filtro pra exportar completo.
            </span>
          ) : (
            <>Mostrando as {formatNumber(data?.kpis.linhas || 0)} linhas do recorte, sem corte.</>
          )}
        </p>

        <div ref={topScrollRef} onScroll={sincronizarScrollPeloTopo} className="mb-2 overflow-x-auto overflow-y-hidden">
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <Table ref={tabelaScrollRef} className="scrollbar-x-hidden max-h-[760px] overflow-auto" tableClassName="text-[10px] lg:text-xs min-w-[2400px]">
          <TableHead className="sticky top-0 z-10">
            <TableRow>
              {COLUNAS.map((coluna) => (
                <ThSortPcp key={coluna.key} coluna={coluna} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : rowsOrdenadas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">
                  Nenhuma linha encontrada. Se a foto nunca foi gerada, rode a materializacao antes.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {rowsOrdenadas.map((row) => (
                  <TableRow key={row.id} className={row.diasEmTransito > 90 && row.quantidadeEmTransito > 0 ? 'bg-red-50/40' : ''}>
                    {COLUNAS.map((coluna) => (
                      <TableCell key={coluna.key} align={coluna.align} className="whitespace-nowrap !px-1.5 !py-1.5">
                        {coluna.key === 'statusTransito' ? (
                          <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium', STATUS_BADGE[row.statusTransito])}>
                            {STATUS_LABEL[row.statusTransito]}
                          </span>
                        ) : coluna.key === 'metodoBaixa' ? (
                          // Sem baixa ainda: o que importa pro auditor nao e "vazio", e se
                          // existe vinculo pra cobrar ou se a linha e so aproximacao.
                          row.metodoBaixa ? (
                            <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium', METODO_BADGE[row.metodoBaixa])}>
                              {METODO_LABEL[row.metodoBaixa]}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">{row.temVinculo ? 'Vinculo, sem baixa' : 'Sem baixa'}</span>
                          )
                        ) : coluna.key === 'entradaDocs' ? (
                          row.entradaDocs ? (
                            <span className="font-medium text-gray-700" title={`Documento(s) de entrada apontado(s) pelo TOTVS: ${row.entradaDocs}`}>
                              {row.entradaDocs}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )
                        ) : coluna.key === 'saidaTransactionDate' || coluna.key === 'primeiraEntradaDate' || coluna.key === 'ultimaEntradaDate' ? (
                          row[coluna.key] ? (
                            formatDate(String(row[coluna.key]))
                          ) : (
                            '-'
                          )
                        ) : coluna.key === 'productName' || coluna.key === 'saidaOperationDescription' ? (
                          <span className="block max-w-[220px] truncate" title={String(row[coluna.key] ?? '')}>
                            {formatCell(row, coluna.key)}
                          </span>
                        ) : coluna.key === 'quantidadeEmTransito' && row.quantidadeEmTransito > 0 ? (
                          <span className="font-semibold text-[var(--bbtk-red)]">{formatNumber(row.quantidadeEmTransito)}</span>
                        ) : coluna.key === 'diasEmTransito' ? (
                          <span className={row.diasEmTransito > 90 && row.quantidadeEmTransito > 0 ? 'font-semibold text-[var(--bbtk-red)]' : ''}>
                            {formatNumber(row.diasEmTransito)}
                          </span>
                        ) : coluna.key === 'saidaTransactionCode' || coluna.key === 'saidaOperationCode' ? (
                          String(row[coluna.key])
                        ) : (
                          formatCell(row, coluna.key)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow isHighlighted className="sticky bottom-0 z-20 bg-yellow-50 shadow-[0_-1px_0_rgba(148,163,184,0.35)]">
                  <TableCell colSpan={18} className="font-bold">
                    {data?.linhasTruncadas
                      ? `SUBTOTAL DA TABELA (${formatNumber(rowsOrdenadas.length)} de ${formatNumber(data.kpis.linhas)} linhas)`
                      : `TOTAL (${formatNumber(rowsOrdenadas.length)} linhas)`}
                  </TableCell>
                  <TableCell align="right" className="font-bold">
                    {formatNumber(totais.quantidadeSaida)}
                  </TableCell>
                  <TableCell align="right" className="font-bold">
                    {formatNumber(totais.quantidadeRecebida)}
                  </TableCell>
                  <TableCell align="right" className="font-bold">
                    {formatNumber(totais.quantidadeEmTransito)}
                  </TableCell>
                  <TableCell align="center" className="font-bold">
                    -
                  </TableCell>
                  <TableCell align="center" className="font-bold">
                    -
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
