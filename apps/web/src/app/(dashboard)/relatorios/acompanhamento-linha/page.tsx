'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
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

  function handleExportExcel() {
    if (!data || sortedLinhas.length === 0) return;
    setExportando(true);
    try {
      const columns: ExcelColumn[] = [
        { key: 'classificacao', header: TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label.toUpperCase() || 'CLASSIFICACAO', width: 22, type: 'text' },
        { key: 'vendaValorAtual', header: 'VENDA R$ ATUAL', width: 14, type: 'currency' },
        { key: 'vendaValorAnoAnterior', header: 'VENDA R$ A.A.', width: 14, type: 'currency' },
        { key: 'evolucaoValorPercent', header: 'EVOL R$ %', width: 12, type: 'number' },
        { key: 'vendaPecasAtual', header: 'VENDA PÇ ATUAL', width: 13, type: 'number' },
        { key: 'vendaPecasAnoAnterior', header: 'VENDA PÇ A.A.', width: 13, type: 'number' },
        { key: 'evolucaoPecasPercent', header: 'EVOL PÇ %', width: 12, type: 'number' },
        { key: 'participacaoPercent', header: 'PART %', width: 10, type: 'number' },
        { key: 'coberturaMesesAtual', header: 'COB MESES', width: 11, type: 'number' },
        { key: 'coberturaMesesAnoAnterior', header: 'COB MESES A.A.', width: 13, type: 'number' },
        { key: 'estoqueFisico', header: 'ESTOQUE FISICO', width: 13, type: 'number' },
        { key: 'pecasEmProducao', header: 'PEÇAS EM PRODUÇÃO', width: 17, type: 'number' },
      ];

      exportToExcel({
        filename: `Acompanhamento_${tipoClassificacao}_${new Date().toISOString().slice(0, 10)}`,
        sheetName: 'Acompanhamento',
        title: `Acompanhamento Diário por ${TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label} - Canal: ${CANAL_OPTIONS.find((o) => o.value === canal)?.label}`,
        columns,
        data: sortedLinhas as unknown as Record<string, unknown>[],
        totals: {
          classificacao: `TOTAL (${sortedLinhas.length})`,
          vendaValorAtual: data.kpis.vendaValorTotal,
          vendaValorAnoAnterior: data.kpis.vendaValorAnoAnteriorTotal,
          estoqueFisico: data.kpis.estoqueFisicoTotal,
          pecasEmProducao: data.kpis.pecasEmProducaoTotal,
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
            Venda por categoria/linha/gênero comparada com o ano anterior, cobertura, estoque e peças em produção
          </p>
        </div>
        <Button variant="secondary" onClick={() => setMostrarModalMetas(true)}>
          Cadastrar Metas
        </Button>
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm text-gray-700">
          <strong>Como funciona:</strong> Venda em R$ e em peças do período selecionado comparada com o mesmo
          intervalo de dias do ano anterior, por categoria/linha/gênero. Cobertura é sempre em meses (estoque ÷
          venda média mensal do período) - a do ano anterior usa o estoque e a venda de então, não o de hoje.
          Estoque é o físico disponível na loja (código 1) - <strong>estoque em trânsito não é sincronizado
          hoje</strong>, então não entra na conta.
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <KPICard title="Venda Atual" value={formatMoney(data.kpis.vendaValorTotal)} color="green" isLoading={isLoading} />
          <KPICard title="Venda Ano Anterior" value={formatMoney(data.kpis.vendaValorAnoAnteriorTotal)} color="blue" isLoading={isLoading} />
          <KPICard title="Evolução vs A.A." value={formatPercentDelta(data.kpis.evolucaoValorPercent)} color="purple" isLoading={isLoading} />
          <KPICard title="Estoque Físico" value={formatNumber(data.kpis.estoqueFisicoTotal)} color="yellow" isLoading={isLoading} />
          <KPICard title="Peças em Produção" value={formatNumber(data.kpis.pecasEmProducaoTotal)} color="red" isLoading={isLoading} />
        </div>
      )}

      {data && (
        <div className="text-xs text-gray-500">
          <span className="font-medium">Períodos:</span> Atual: {formatDate(data.periodoAtual.inicio)} a {formatDate(data.periodoAtual.fim)} |
          {' '}Ano Anterior: {formatDate(data.periodoAnoAnterior.inicio)} a {formatDate(data.periodoAnoAnterior.fim)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Vendas por {TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label}
          </CardTitle>
        </CardHeader>

        {erro && <div className="text-red-600 text-sm mb-4">Erro: {erro}</div>}

        <div className="overflow-x-auto">
          <Table tableClassName="text-sm min-w-[1400px]">
            <TableHead className="sticky top-0 z-10">
              <TableRow>
                <ThSortPcp label={TIPO_CLASSIFICACAO_DIARIO_OPTIONS.find((o) => o.value === tipoClassificacao)?.label.toUpperCase() || ''} sortKeyName="classificacao" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="left" />
                <ThSortPcp label="VENDA R$" sortKeyName="vendaValorAtual" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Venda em R$, mês atual até ontem" />
                <ThSortPcp label="VENDA R$ A.A." sortKeyName="vendaValorAnoAnterior" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Venda em R$, mesmo período do ano anterior" />
                <ThSortPcp label="EVOL R$" sortKeyName="evolucaoValorPercent" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Crescimento em R$ vs ano anterior" />
                <ThSortPcp label="VENDA PÇ" sortKeyName="vendaPecasAtual" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Venda em peças, mês atual até ontem" />
                <ThSortPcp label="VENDA PÇ A.A." sortKeyName="vendaPecasAnoAnterior" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" />
                <ThSortPcp label="EVOL PÇ" sortKeyName="evolucaoPecasPercent" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" />
                <ThSortPcp label="PART %" sortKeyName="participacaoPercent" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Participação no total vendido no filtro atual" />
                <ThSortPcp label="COB MESES" sortKeyName="coberturaMesesAtual" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Cobertura atual em meses = estoque físico / venda média mensal" />
                <ThSortPcp label="COB MESES A.A." sortKeyName="coberturaMesesAnoAnterior" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Cobertura em meses no mesmo período do ano anterior (estoque e venda de então)" />
                <ThSortPcp label="ESTOQUE" sortKeyName="estoqueFisico" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Estoque físico disponível na loja" />
                <ThSortPcp label="EM PRODUÇÃO" sortKeyName="pecasEmProducao" sortKey={sortKey} sortDir={sortDir} onSort={(k) => handleSort(k as SortKeyDiario)} align="right" title="Peças em Ordem de Produção aberta (rede toda)" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={12} align="center" className="py-8"><div className="animate-pulse text-gray-400">Carregando...</div></TableCell>
                </TableRow>
              ) : sortedLinhas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center" className="py-8 text-gray-500">Nenhum dado encontrado para os filtros selecionados</TableCell>
                </TableRow>
              ) : (
                sortedLinhas.map((linha) => (
                  <TableRow key={linha.classificacao} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="font-medium">{linha.classificacao}</TableCell>
                    <TableCell align="right">{formatMoney(linha.vendaValorAtual)}</TableCell>
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
                    <TableCell align="right">{linha.coberturaMesesAnoAnterior !== null ? linha.coberturaMesesAnoAnterior.toFixed(1) : '-'}</TableCell>
                    <TableCell align="right">{formatNumber(linha.estoqueFisico)}</TableCell>
                    <TableCell align="right">{formatNumber(linha.pecasEmProducao)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
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
