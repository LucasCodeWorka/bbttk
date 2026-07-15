'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { KPICard } from '@/components/dashboard/KPICard';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { VariationBadge } from '@/components/ui/Badge';
import { vendasApi, VendasResponse, VendasDiariasResponse, ComparativoAnoResponse, VendedoresResponse, TopProdutosResponse, ProjecaoFiliaisResponse } from '@/lib/api';
import { formatMoney, formatNumber, FILIAIS, getMonthStart, getToday } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [dataInicio, setDataInicio] = useState(getMonthStart());
  const [dataFim, setDataFim] = useState(getToday());
  const [filialSelecionada, setFilialSelecionada] = useState<number | ''>('');

  // Dados
  const [vendas, setVendas] = useState<VendasResponse | null>(null);
  const [vendasDiarias, setVendasDiarias] = useState<VendasDiariasResponse | null>(null);
  const [comparativo, setComparativo] = useState<ComparativoAnoResponse | null>(null);
  const [vendedores, setVendedores] = useState<VendedoresResponse | null>(null);
  const [produtos, setProdutos] = useState<TopProdutosResponse | null>(null);
  const [projecao, setProjecao] = useState<ProjecaoFiliaisResponse | null>(null);

  const carregarDados = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchCode = filialSelecionada || undefined;

      const [vendasRes, diariasRes, compRes, vendRes, prodRes, projRes] = await Promise.all([
        vendasApi.getPeriodo(dataInicio, dataFim, branchCode),
        vendasApi.getDiarias(dataInicio, dataFim, branchCode),
        vendasApi.getComparativoAno(dataInicio, dataFim),
        vendasApi.getVendedores(branchCode),
        vendasApi.getTopProdutos(branchCode),
        vendasApi.getProjecaoFiliais(),
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
  }, [dataInicio, dataFim, filialSelecionada]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Filtrar filiais do usuário
  const filiaisDisponiveis = Object.entries(FILIAIS)
    .filter(([code]) => {
      if (user?.role === 'admin') return true;
      return user?.branchCodes.includes(parseInt(code));
    })
    .map(([code, name]) => ({ value: code, label: name }));

  const filialOptions = [{ value: '', label: 'Todas as Filiais' }, ...filiaisDisponiveis];

  // Dados para o gráfico de barras
  const dadosBarras = vendas?.filiais.slice(0, 8).map(f => ({
    name: f.branch_name.length > 12 ? f.branch_name.substring(0, 12) : f.branch_name,
    value: f.faturamento,
  })) || [];

  // Criar mapa de projeções
  const projecaoMap = new Map(projecao?.filiais.map(p => [p.branch_code, p]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard de Vendas</h1>
          <p className="text-gray-500 text-sm mt-1">
            {dataInicio} a {dataFim}
            {filialSelecionada && ` - ${FILIAIS[filialSelecionada]}`}
          </p>
        </div>

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
          <Select
            value={filialSelecionada}
            onChange={(e) => setFilialSelecionada(e.target.value ? parseInt(e.target.value) : '')}
            options={filialOptions}
            label="Filial"
            className="w-44"
          />
          <Button onClick={carregarDados} isLoading={isLoading}>
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Faturamento"
          value={formatMoney(vendas?.total.faturamento || 0)}
          variation={comparativo?.total.variacao.faturamento.percentual}
          color="red"
          isLoading={isLoading}
        />
        <KPICard
          title="Pecas"
          value={formatNumber(vendas?.total.pecas || 0)}
          variation={comparativo?.total.variacao.pecas.percentual}
          color="green"
          isLoading={isLoading}
        />
        <KPICard
          title="Ticket Medio"
          value={formatMoney(vendas?.total.tm || 0)}
          color="yellow"
          isLoading={isLoading}
        />
        <KPICard
          title="Pecas/Atendimento"
          value={(vendas?.total.pa || 0).toFixed(2)}
          color="purple"
          isLoading={isLoading}
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Vendas Diarias</CardTitle>
          </CardHeader>
          <LineChart data={vendasDiarias?.dados || []} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vendas por Filial</CardTitle>
          </CardHeader>
          <BarChart data={dadosBarras} />
        </Card>
      </div>

      {/* Tabela de Filiais */}
      <Card>
        <CardHeader>
          <CardTitle>Comparativo por Filial</CardTitle>
        </CardHeader>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell isHeader>Filial</TableCell>
              <TableCell isHeader align="right">Fat. Atual</TableCell>
              <TableCell isHeader align="right">Pecas</TableCell>
              <TableCell isHeader align="right">TM</TableCell>
              <TableCell isHeader align="right">Fat. Ant.</TableCell>
              <TableCell isHeader align="center">Var %</TableCell>
              <TableCell isHeader align="right">Projecao</TableCell>
              <TableCell isHeader align="center">Vs Ano Ant.</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {comparativo?.filiais.map((f) => {
              const proj = projecaoMap.get(f.branch_code);
              return (
                <TableRow
                  key={f.branch_code}
                  onClick={() => setFilialSelecionada(f.branch_code)}
                >
                  <TableCell className="font-medium">{f.branch_name}</TableCell>
                  <TableCell align="right">{formatMoney(f.atual.faturamento)}</TableCell>
                  <TableCell align="right">{formatNumber(f.atual.pecas)}</TableCell>
                  <TableCell align="right">{formatMoney(f.atual.tm)}</TableCell>
                  <TableCell align="right" className="text-gray-500">
                    {formatMoney(f.ano_anterior.faturamento)}
                  </TableCell>
                  <TableCell align="center">
                    <VariationBadge value={f.variacao.faturamento} />
                  </TableCell>
                  <TableCell align="right">
                    {proj ? formatMoney(proj.projecao) : '-'}
                  </TableCell>
                  <TableCell align="center">
                    {proj ? <VariationBadge value={proj.variacao_vs_ano_anterior} /> : '-'}
                  </TableCell>
                </TableRow>
              );
            })}
            {/* Linha de Total */}
            {comparativo && (
              <TableRow isHighlighted>
                <TableCell className="font-bold">TOTAL</TableCell>
                <TableCell align="right" className="font-bold">
                  {formatMoney(comparativo.total.atual.faturamento)}
                </TableCell>
                <TableCell align="right" className="font-bold">
                  {formatNumber(comparativo.total.atual.pecas)}
                </TableCell>
                <TableCell align="right" className="font-bold">
                  {formatMoney(comparativo.total.atual.tm)}
                </TableCell>
                <TableCell align="right" className="text-gray-500">
                  {formatMoney(comparativo.total.ano_anterior.faturamento)}
                </TableCell>
                <TableCell align="center">
                  <VariationBadge value={comparativo.total.variacao.faturamento.percentual} />
                </TableCell>
                <TableCell align="right" className="font-bold">
                  {projecao ? formatMoney(projecao.total.projecao) : '-'}
                </TableCell>
                <TableCell align="center">
                  {projecao ? <VariationBadge value={projecao.total.variacao_vs_ano_anterior} /> : '-'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Vendedores e Produtos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ranking Vendedores */}
        <Card>
          <CardHeader>
            <CardTitle>Ranking Vendedores</CardTitle>
          </CardHeader>
          <div className="max-h-96 overflow-y-auto">
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
          </div>
        </Card>

        {/* Top Produtos */}
        <Card>
          <CardHeader>
            <CardTitle>Top Produtos</CardTitle>
          </CardHeader>
          <div className="max-h-96 overflow-y-auto">
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
                    <TableCell className="font-medium" title={p.nome}>
                      {p.nome.length > 25 ? p.nome.substring(0, 25) + '...' : p.nome}
                    </TableCell>
                    <TableCell align="right">{formatNumber(p.quantidade)}</TableCell>
                    <TableCell align="right">{formatMoney(p.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
