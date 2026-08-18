'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  ResumoPromocaoFiltro,
  ResumoPromocaoResponse,
  ResumoPromocaoLojaRow,
  VendaDescontoFiltrosResponse,
  resumoPromocaoApi,
  vendaDescontoApi,
} from '@/lib/pcpApi';
import { cn, formatNumber, formatMoney, formatPercentSimple } from '@/lib/utils';
import { exportToExcel, ExcelColumn } from '@/lib/exportExcel';

// Aliases para consistência
const formatCurrency = formatMoney;
const formatPercent = formatPercentSimple;

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
      className={cn('cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap', className)}
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

export default function ResumoPromocaoPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [data, setData] = useState<ResumoPromocaoResponse | null>(null);
  const [filtros, setFiltros] = useState<VendaDescontoFiltrosResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(1); // Primeiro dia do mês
    return d.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [branchesSelecionados, setBranchesSelecionados] = useState<number[]>([]);
  const [statusPromoSelecionados, setStatusPromoSelecionados] = useState<string[]>([]);

  // Ordenação
  const [sortKey, setSortKey] = useState<string | null>('branchCode');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const carregarFiltros = useCallback(async () => {
    if (!token) return;
    try {
      const response = await vendaDescontoApi.getFiltros(token);
      setFiltros(response);
    } catch (error) {
      console.error('Erro ao carregar filtros:', error);
    }
  }, [token]);

  const carregarDados = useCallback(async () => {
    if (!token || !dataInicio || !dataFim) return;

    setIsLoading(true);
    setErro(null);

    try {
      const filtro: ResumoPromocaoFiltro = {
        dataInicio,
        dataFim,
        branches: branchesSelecionados.length > 0 ? branchesSelecionados : undefined,
        statusPromo: statusPromoSelecionados.length > 0 ? statusPromoSelecionados : undefined,
      };

      const response = await resumoPromocaoApi.getResumoPromocao(token, filtro);
      setData(response);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Erro desconhecido';
      setErro(mensagem);
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token, dataInicio, dataFim, branchesSelecionados, statusPromoSelecionados, showToast]);

  useEffect(() => {
    carregarFiltros();
  }, [carregarFiltros]);

  // Lojas para o seletor
  const lojasParaSelecao = useMemo(() => {
    if (!filtros?.branches) return [];
    return filtros.branches.map(b => ({
      branchCode: b.branch_code,
      label: b.branch_name,
    }));
  }, [filtros]);

  // Status disponíveis para filtro de promoção
  const statusOpcoes = useMemo(() => {
    if (!filtros?.status) return [];
    return filtros.status.map(s => ({ value: s, label: s }));
  }, [filtros]);

  // Ordenação
  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function getSortValue(row: ResumoPromocaoLojaRow, key: string): string | number {
    switch (key) {
      case 'branchCode': return row.branchCode;
      case 'branchName': return row.branchName;
      case 'vendaTotalPromo': return row.vendaTotalPromo;
      case 'vendaTotalGeralPeriodo': return row.vendaTotalGeralPeriodo;
      case 'participacaoPromoPct': return row.participacaoPromoPct;
      case 'estoqueFinalPromo': return row.estoqueFinalPromo;
      case 'estoqueFinalGeralPecas': return row.estoqueFinalGeralPecas;
      case 'participacaoEstoquePromoPct': return row.participacaoEstoquePromoPct;
      default: return 0;
    }
  }

  const sortedRows = useMemo(() => {
    if (!data?.rows || !sortKey) return data?.rows || [];
    return [...data.rows].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string, 'pt-BR')
        : (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data?.rows, sortKey, sortDir]);

  // Totais calculados
  const totais = useMemo(() => {
    if (!data?.rows.length) return null;
    const vendaTotalPromo = data.rows.reduce((sum, r) => sum + r.vendaTotalPromo, 0);
    const vendaTotalGeralPeriodo = data.rows.reduce((sum, r) => sum + r.vendaTotalGeralPeriodo, 0);
    const estoqueFinalPromo = data.rows.reduce((sum, r) => sum + r.estoqueFinalPromo, 0);
    const estoqueFinalGeralPecas = data.rows.reduce((sum, r) => sum + r.estoqueFinalGeralPecas, 0);

    return {
      vendaTotalPromo,
      vendaTotalGeralPeriodo,
      participacaoPromoPct: vendaTotalGeralPeriodo > 0 ? (vendaTotalPromo / vendaTotalGeralPeriodo) * 100 : 0,
      estoqueFinalPromo,
      estoqueFinalGeralPecas,
      participacaoEstoquePromoPct: estoqueFinalGeralPecas > 0 ? (estoqueFinalPromo / estoqueFinalGeralPecas) * 100 : 0,
    };
  }, [data]);

  // Export Excel
  async function handleExport() {
    if (!data?.rows.length) return;
    setExportando(true);

    try {
      const columns: ExcelColumn[] = [
        { header: 'Loja', key: 'branchName', width: 30 },
        { header: 'Venda Promoção R$', key: 'vendaTotalPromo', width: 18, format: 'currency' },
        { header: 'Venda Total R$', key: 'vendaTotalGeralPeriodo', width: 18, format: 'currency' },
        { header: '% Participação Venda', key: 'participacaoPromoPct', width: 20, format: 'percent' },
        { header: 'Estoque Promoção', key: 'estoqueFinalPromo', width: 18, format: 'number' },
        { header: 'Estoque Total', key: 'estoqueFinalGeralPecas', width: 15, format: 'number' },
        { header: '% Participação Estoque', key: 'participacaoEstoquePromoPct', width: 22, format: 'percent' },
      ];

      await exportToExcel(
        sortedRows,
        columns,
        `resumo-promocao-${dataInicio}-${dataFim}.xlsx`,
      );
      showToast('Exportado com sucesso', 'success');
    } catch {
      showToast('Erro ao exportar', 'error');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resumo da Promoção por Loja</h1>
          <p className="text-sm text-gray-500 mt-1">
            Relatório 5.1: Totais de promoção agrupados por loja
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={carregarDados}
            disabled={isLoading}
          >
            {isLoading ? 'Carregando...' : 'Atualizar'}
          </Button>
          <Button
            onClick={handleExport}
            disabled={exportando || !data?.rows.length}
          >
            {exportando ? 'Exportando...' : 'Exportar Excel'}
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data Início</label>
            <Input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data Fim</label>
            <Input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lojas</label>
            <FilialMultiSelect
              lojas={lojasParaSelecao}
              value={branchesSelecionados}
              onChange={setBranchesSelecionados}
              placeholder="Todas"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status Promoção</label>
            <select
              multiple
              value={statusPromoSelecionados}
              onChange={(e) => setStatusPromoSelecionados(
                Array.from(e.target.selectedOptions, opt => opt.value)
              )}
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[var(--bbtk-purple)] focus:border-transparent"
            >
              {statusOpcoes.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Ctrl+click para múltipla seleção. Vazio = todos exceto ATIVO.
            </p>
          </div>
        </div>
        <div className="px-4 pb-4">
          <Button onClick={carregarDados} disabled={isLoading}>
            {isLoading ? 'Carregando...' : 'Buscar'}
          </Button>
        </div>
      </Card>

      {/* KPIs */}
      {totais && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            title="Venda Promoção"
            value={formatCurrency(totais.vendaTotalPromo)}
            subtitle={`${formatPercent(totais.participacaoPromoPct)} do total`}
          />
          <KPICard
            title="Venda Total"
            value={formatCurrency(totais.vendaTotalGeralPeriodo)}
            subtitle="Período selecionado"
          />
          <KPICard
            title="Estoque Promoção"
            value={formatNumber(totais.estoqueFinalPromo)}
            subtitle={`${formatPercent(totais.participacaoEstoquePromoPct)} do total`}
          />
          <KPICard
            title="Estoque Total"
            value={formatNumber(totais.estoqueFinalGeralPecas)}
            subtitle="Peças em estoque"
          />
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {erro}
        </div>
      )}

      {/* Tabela */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Resumo por Loja</CardTitle>
          {data && (
            <span className="text-sm text-gray-500">{formatNumber(data.rows.length)} lojas</span>
          )}
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <TableRow>
                <ThSortPcp label="Loja" sortKeyName="branchName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                <ThSortPcp label="Venda Promoção R$" sortKeyName="vendaTotalPromo" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <ThSortPcp label="Venda Total R$" sortKeyName="vendaTotalGeralPeriodo" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <ThSortPcp label="% Participação" sortKeyName="participacaoPromoPct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Participação da promoção na venda" />
                <ThSortPcp label="Estoque Promo" sortKeyName="estoqueFinalPromo" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Estoque final em promoção (peças)" />
                <ThSortPcp label="Estoque Total" sortKeyName="estoqueFinalGeralPecas" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Estoque final total (peças)" />
                <ThSortPcp label="% Estoque Promo" sortKeyName="participacaoEstoquePromoPct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Participação do estoque em promoção" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" className="py-8 text-gray-500">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : !data?.rows.length ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" className="py-8 text-gray-500">
                    Nenhum dado encontrado. Selecione os filtros e clique em Buscar.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedRows.map((row) => (
                    <TableRow key={row.branchCode} className="hover:bg-gray-50">
                      <TableCell className="font-medium">{row.branchName}</TableCell>
                      <TableCell align="right">{formatCurrency(row.vendaTotalPromo)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.vendaTotalGeralPeriodo)}</TableCell>
                      <TableCell align="right" className={row.participacaoPromoPct > 20 ? 'text-green-600 font-medium' : ''}>
                        {formatPercent(row.participacaoPromoPct)}
                      </TableCell>
                      <TableCell align="right">{formatNumber(row.estoqueFinalPromo)}</TableCell>
                      <TableCell align="right">{formatNumber(row.estoqueFinalGeralPecas)}</TableCell>
                      <TableCell align="right" className={row.participacaoEstoquePromoPct > 30 ? 'text-orange-600 font-medium' : ''}>
                        {formatPercent(row.participacaoEstoquePromoPct)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Linha de totais */}
                  {totais && (
                    <TableRow className="bg-gray-100 font-semibold">
                      <TableCell>TOTAL</TableCell>
                      <TableCell align="right">{formatCurrency(totais.vendaTotalPromo)}</TableCell>
                      <TableCell align="right">{formatCurrency(totais.vendaTotalGeralPeriodo)}</TableCell>
                      <TableCell align="right">{formatPercent(totais.participacaoPromoPct)}</TableCell>
                      <TableCell align="right">{formatNumber(totais.estoqueFinalPromo)}</TableCell>
                      <TableCell align="right">{formatNumber(totais.estoqueFinalGeralPecas)}</TableCell>
                      <TableCell align="right">{formatPercent(totais.participacaoEstoquePromoPct)}</TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
