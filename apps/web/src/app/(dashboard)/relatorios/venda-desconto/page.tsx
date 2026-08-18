'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  VendaDescontoFiltro,
  VendaDescontoResponse,
  VendaDescontoFiltrosResponse,
  VendaDescontoClassificacao,
  VendaDescontoRow,
  vendaDescontoApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatNumber, formatMoney, formatPercentSimple } from '@/lib/utils';
import { exportToExcel, ExcelColumn } from '@/lib/exportExcel';

// Aliases para consistência
const formatCurrency = formatMoney;
const formatPercent = formatPercentSimple;

const TIPO_CLASSIFICACAO_OPTIONS: { value: VendaDescontoClassificacao; label: string }[] = [
  { value: 'categoria', label: 'Por Categoria' },
  { value: 'linha', label: 'Por Linha' },
  { value: 'colecao', label: 'Por Coleção' },
  { value: 'status', label: 'Por Status' },
];

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

export default function VendaDescontoPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [data, setData] = useState<VendaDescontoResponse | null>(null);
  const [filtros, setFiltros] = useState<VendaDescontoFiltrosResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(1); // Primeiro dia do mês
    return d.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [classificacao, setClassificacao] = useState<VendaDescontoClassificacao>('status');
  const [itensClassificacao, setItensClassificacao] = useState<string[]>([]);
  const [branchesSelecionados, setBranchesSelecionados] = useState<number[]>([]);

  // Ordenação
  const [sortKey, setSortKey] = useState<string | null>('vendas');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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
      const filtro: VendaDescontoFiltro = {
        dataInicio,
        dataFim,
        classificacao,
        itensClassificacao: itensClassificacao.length > 0 ? itensClassificacao : undefined,
        branches: branchesSelecionados.length > 0 ? branchesSelecionados : undefined,
      };

      const response = await vendaDescontoApi.getVendaDesconto(token, filtro);
      setData(response);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Erro desconhecido';
      setErro(mensagem);
      showToast('Erro ao carregar dados', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token, dataInicio, dataFim, classificacao, itensClassificacao, branchesSelecionados, showToast]);

  useEffect(() => {
    carregarFiltros();
  }, [carregarFiltros]);

  // Opções de classificação baseadas no tipo selecionado
  const classificacaoOpcoes = useMemo(() => {
    if (!filtros) return [];
    const map: Record<VendaDescontoClassificacao, string[]> = {
      categoria: filtros.categorias,
      linha: filtros.linhas,
      colecao: filtros.colecoes,
      status: filtros.status,
    };
    return map[classificacao]?.map(v => ({ value: v, label: v })) || [];
  }, [filtros, classificacao]);

  // Lojas para o seletor
  const lojasParaSelecao = useMemo(() => {
    if (!filtros?.branches) return [];
    return filtros.branches.map(b => ({
      value: b.branch_code,
      label: b.branch_name,
    }));
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

  function getSortValue(row: VendaDescontoRow, key: string): string | number {
    switch (key) {
      case 'codigo': return row.codigo;
      case 'descricao': return row.descricao;
      case 'categoria': return row.categoria || '';
      case 'linha': return row.linha || '';
      case 'status': return row.status || '';
      case 'colecao': return row.colecao || '';
      case 'custoProducao': return row.custoProducao;
      case 'pdvOriginal': return row.pdvOriginal;
      case 'pdvAtual': return row.pdvAtual;
      case 'markup': return row.markup;
      case 'descontoPct': return row.descontoPct;
      case 'pdvVenda': return row.pdvVenda;
      case 'vendas': return row.vendas;
      case 'estoqueFim': return row.estoqueFim;
      case 'giro': return row.giro;
      case 'ttEstqVdaOriginal': return row.ttEstqVdaOriginal;
      case 'ttEstqVdaAtual': return row.ttEstqVdaAtual;
      case 'pctDesconto': return row.pctDesconto;
      case 'ttVdaVda': return row.ttVdaVda;
      case 'ttDescontoVenda': return row.ttDescontoVenda;
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

  // Export Excel
  async function handleExport() {
    if (!data?.rows.length) return;
    setExportando(true);

    try {
      const columns: ExcelColumn[] = [
        { header: 'Código', key: 'codigo', width: 18 },
        { header: 'Descrição', key: 'descricao', width: 40 },
        { header: 'Categoria', key: 'categoria', width: 15 },
        { header: 'Linha', key: 'linha', width: 15 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Coleção', key: 'colecao', width: 15 },
        { header: 'Custo Produção', key: 'custoProducao', width: 14, type: 'currency' },
        { header: 'PDV Original', key: 'pdvOriginal', width: 14, type: 'currency' },
        { header: 'PDV Atual', key: 'pdvAtual', width: 14, type: 'currency' },
        { header: 'Markup', key: 'markup', width: 10, type: 'number' },
        { header: '% Desconto', key: 'descontoPct', width: 12, type: 'percent' },
        { header: 'PDV Venda', key: 'pdvVenda', width: 14, type: 'currency' },
        { header: 'Vendas', key: 'vendas', width: 10, type: 'number' },
        { header: 'Estoque Fim', key: 'estoqueFim', width: 12, type: 'number' },
        { header: '% Giro', key: 'giro', width: 10, type: 'percent' },
        { header: 'TT Estq Original', key: 'ttEstqVdaOriginal', width: 16, type: 'currency' },
        { header: 'TT Estq Atual', key: 'ttEstqVdaAtual', width: 16, type: 'currency' },
        { header: '% Desc Estq', key: 'pctDesconto', width: 12, type: 'percent' },
        { header: 'TT Venda', key: 'ttVdaVda', width: 14, type: 'currency' },
        { header: 'TT Desc Venda', key: 'ttDescontoVenda', width: 14, type: 'currency' },
      ];

      exportToExcel({
        data: sortedRows as unknown as Record<string, unknown>[],
        columns,
        filename: `venda-desconto-${dataInicio}-${dataFim}`,
      });
      showToast('Exportado com sucesso', 'success');
    } catch {
      showToast('Erro ao exportar', 'error');
    } finally {
      setExportando(false);
    }
  }

  // Reset classificação quando muda o tipo
  useEffect(() => {
    setItensClassificacao([]);
  }, [classificacao]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Venda e Desconto por Classificação</h1>
          <p className="text-sm text-gray-500 mt-1">
            Relatório 5: Análise de vendas e descontos por categoria, linha, coleção ou status
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
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Classificação</label>
            <Select
              value={classificacao}
              onChange={(e) => setClassificacao(e.target.value as VendaDescontoClassificacao)}
              options={TIPO_CLASSIFICACAO_OPTIONS}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {classificacao === 'categoria' ? 'Categorias' :
               classificacao === 'linha' ? 'Linhas' :
               classificacao === 'colecao' ? 'Coleções' : 'Status'}
            </label>
            <Select
              value={itensClassificacao[0] || ''}
              onChange={(e) => setItensClassificacao(e.target.value ? [e.target.value] : [])}
              options={[{ value: '', label: 'Todos' }, ...classificacaoOpcoes]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lojas</label>
            <FilialMultiSelect
              options={lojasParaSelecao}
              selected={branchesSelecionados}
              onChange={setBranchesSelecionados}
            />
          </div>
        </div>
        <div className="px-4 pb-4">
          <Button onClick={carregarDados} disabled={isLoading}>
            {isLoading ? 'Carregando...' : 'Buscar'}
          </Button>
        </div>
      </Card>

      {/* KPIs */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            title="Venda Total Qtd"
            value={formatNumber(data.gerais.vendaTotalGeralQtd)}
            subtitle={`Promoção: ${formatPercent(data.gerais.participacaoPromoQtd)}`}
          />
          <KPICard
            title="Venda Total R$"
            value={formatCurrency(data.gerais.vendaTotalGeralValor)}
            subtitle={`Promoção: ${formatPercent(data.gerais.participacaoPromoValor)}`}
          />
          <KPICard
            title="Total Vendido"
            value={formatCurrency(data.totais.ttVdaVda)}
            subtitle={`${formatNumber(data.totais.vendas)} peças`}
          />
          <KPICard
            title="Desconto Concedido"
            value={formatCurrency(data.totais.ttDescontoVenda)}
            subtitle={`Giro: ${formatPercent(data.totais.giro)}`}
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
          <CardTitle>Detalhamento por Produto</CardTitle>
          {data && (
            <span className="text-sm text-gray-500">{formatNumber(data.rows.length)} produtos</span>
          )}
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <TableRow>
                <ThSortPcp label="Código" sortKeyName="codigo" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                <ThSortPcp label="Descrição" sortKeyName="descricao" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                <ThSortPcp label="Categoria" sortKeyName="categoria" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                <ThSortPcp label="Linha" sortKeyName="linha" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                <ThSortPcp label="Status" sortKeyName="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                <ThSortPcp label="Coleção" sortKeyName="colecao" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="left" />
                <ThSortPcp label="Custo Prod." sortKeyName="custoProducao" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Custo de Produção" />
                <ThSortPcp label="PDV Orig." sortKeyName="pdvOriginal" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="PDV Original" />
                <ThSortPcp label="PDV Atual" sortKeyName="pdvAtual" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <ThSortPcp label="Markup" sortKeyName="markup" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <ThSortPcp label="% Desc" sortKeyName="descontoPct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="% Desconto" />
                <ThSortPcp label="PDV Venda" sortKeyName="pdvVenda" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Preço Médio de Venda" />
                <ThSortPcp label="Vendas" sortKeyName="vendas" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <ThSortPcp label="Est. Fim" sortKeyName="estoqueFim" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Estoque Final" />
                <ThSortPcp label="Giro" sortKeyName="giro" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                <ThSortPcp label="TT Est Orig" sortKeyName="ttEstqVdaOriginal" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Total Estoque x PDV Original" />
                <ThSortPcp label="TT Est Atual" sortKeyName="ttEstqVdaAtual" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Total Estoque x PDV Atual" />
                <ThSortPcp label="% Desc Est" sortKeyName="pctDesconto" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="% Desconto no Estoque" />
                <ThSortPcp label="TT Venda" sortKeyName="ttVdaVda" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Faturamento" />
                <ThSortPcp label="TT Desc Vda" sortKeyName="ttDescontoVenda" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" title="Total Desconto nas Vendas" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={20} align="center" className="py-8 text-gray-500">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : !data?.rows.length ? (
                <TableRow>
                  <TableCell colSpan={20} align="center" className="py-8 text-gray-500">
                    Nenhum dado encontrado. Selecione os filtros e clique em Buscar.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedRows.map((row, idx) => (
                    <TableRow key={row.codigo + idx} className="hover:bg-gray-50">
                      <TableCell className="font-mono text-xs">{row.codigo}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={row.descricao}>{row.descricao}</TableCell>
                      <TableCell>{row.categoria || '-'}</TableCell>
                      <TableCell>{row.linha || '-'}</TableCell>
                      <TableCell>{row.status || '-'}</TableCell>
                      <TableCell>{row.colecao || '-'}</TableCell>
                      <TableCell align="right">{formatCurrency(row.custoProducao)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.pdvOriginal)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.pdvAtual)}</TableCell>
                      <TableCell align="right">{formatNumber(row.markup, 2)}</TableCell>
                      <TableCell align="right" className={row.descontoPct > 0 ? 'text-red-600' : ''}>
                        {formatPercent(row.descontoPct)}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(row.pdvVenda)}</TableCell>
                      <TableCell align="right">{formatNumber(row.vendas)}</TableCell>
                      <TableCell align="right">{formatNumber(row.estoqueFim)}</TableCell>
                      <TableCell align="right">{formatPercent(row.giro)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.ttEstqVdaOriginal)}</TableCell>
                      <TableCell align="right">{formatCurrency(row.ttEstqVdaAtual)}</TableCell>
                      <TableCell align="right" className={row.pctDesconto > 0 ? 'text-red-600' : ''}>
                        {formatPercent(row.pctDesconto)}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(row.ttVdaVda)}</TableCell>
                      <TableCell align="right" className={row.ttDescontoVenda > 0 ? 'text-orange-600' : ''}>
                        {formatCurrency(row.ttDescontoVenda)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Linha de totais */}
                  <TableRow className="bg-gray-100 font-semibold">
                    <TableCell colSpan={12} align="right">TOTAL</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.vendas)}</TableCell>
                    <TableCell align="right">{formatNumber(data.totais.estoqueFim)}</TableCell>
                    <TableCell align="right">{formatPercent(data.totais.giro)}</TableCell>
                    <TableCell align="right">{formatCurrency(data.totais.ttEstqVdaOriginal)}</TableCell>
                    <TableCell align="right">{formatCurrency(data.totais.ttEstqVdaAtual)}</TableCell>
                    <TableCell align="right">{formatPercent(data.totais.pctDesconto)}</TableCell>
                    <TableCell align="right">{formatCurrency(data.totais.ttVdaVda)}</TableCell>
                    <TableCell align="right">{formatCurrency(data.totais.ttDescontoVenda)}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Resumo Gerais */}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Participação no Período</CardTitle>
          </CardHeader>
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            <div>
              <p className="text-gray-500">Venda Total Geral (Qtd)</p>
              <p className="text-xl font-semibold">{formatNumber(data.gerais.vendaTotalGeralQtd)}</p>
            </div>
            <div>
              <p className="text-gray-500">Participação Promoção (Qtd)</p>
              <p className="text-xl font-semibold">{formatPercent(data.gerais.participacaoPromoQtd)}</p>
            </div>
            <div>
              <p className="text-gray-500">Venda Total Geral (R$)</p>
              <p className="text-xl font-semibold">{formatCurrency(data.gerais.vendaTotalGeralValor)}</p>
            </div>
            <div>
              <p className="text-gray-500">Participação Promoção (R$)</p>
              <p className="text-xl font-semibold">{formatPercent(data.gerais.participacaoPromoValor)}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
