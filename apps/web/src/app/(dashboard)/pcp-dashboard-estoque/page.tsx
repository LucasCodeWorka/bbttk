'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart } from '@/components/charts/BarChart';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { Input } from '@/components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardEstoqueBucket, DashboardEstoqueResponse, DashboardEstoqueSaldoTipo, PcpClassificacaoDimensao, PcpLojaFiltro, pcpApi } from '@/lib/pcpApi';
import { cn, formatDate, formatMoney, formatNumber, getToday } from '@/lib/utils';

const FILTROS_PRIORITARIOS = ['colecao', 'linha', 'grupo', 'categoria', 'genero', 'status'];

const GRAFICOS: Array<{ key: keyof DashboardEstoqueResponse['graficos']; title: string; color: string }> = [
  { key: 'linha', title: 'Estoque por linha', color: 'var(--bbtk-green)' },
  { key: 'colecao', title: 'Estoque por colecao', color: 'var(--bbtk-red)' },
  { key: 'categoria', title: 'Estoque por categoria', color: 'var(--bbtk-orange)' },
  { key: 'filial', title: 'Estoque por filial', color: 'var(--bbtk-blue)' },
];

function ChartCard({ title, data, color }: { title: string; data: DashboardEstoqueBucket[]; color: string }) {
  const chartData = data.map((item) => ({
    name: item.label,
    value: item.quantidade,
    color,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <BarChart data={chartData} horizontal formatValue={(value) => formatNumber(value)} />
    </Card>
  );
}

function atualizacaoLabel(value: string | null) {
  if (!value) return 'Sem snapshot';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function saldoQuantidade(saldos: DashboardEstoqueSaldoTipo[], stockCode: number) {
  return saldos.find((saldo) => saldo.stockCode === stockCode)?.quantidade || 0;
}

export default function DashboardEstoquePage() {
  const { token, user } = useAuth();
  const [dataCorte, setDataCorte] = useState(getToday());
  const [search, setSearch] = useState('');
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [tiposEstoqueSelecionados, setTiposEstoqueSelecionados] = useState<string[]>([]);
  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [tiposEstoque, setTiposEstoque] = useState<{ stockCode: number; label: string; qtd_skus: number }[]>([]);
  const [lojasFiltro, setLojasFiltro] = useState<PcpLojaFiltro[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [data, setData] = useState<DashboardEstoqueResponse | null>(null);
  const [referenciasAbertas, setReferenciasAbertas] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setErro(null);
    try {
      const response = await pcpApi.getDashboardEstoque(token, {
        data: dataCorte,
        search,
        branches: filiaisSelecionadas.length ? filiaisSelecionadas : undefined,
        stockCodes: tiposEstoqueSelecionados.length ? tiposEstoqueSelecionados.map(Number) : undefined,
        tipo: produtoFiltro.tipo,
        categoria: produtoFiltro.categoria,
        grupo: produtoFiltro.grupo,
        linha: produtoFiltro.linha,
        colecao: produtoFiltro.colecao,
        genero: produtoFiltro.genero,
        modelo: produtoFiltro.modelo,
        tecido: produtoFiltro.tecido,
        lancamento: produtoFiltro.lancamento,
        status: produtoFiltro.status,
        motorPromocional: produtoFiltro.motorPromocional,
        campanha: produtoFiltro.campanha,
      });
      setData(response);
      setReferenciasAbertas(new Set());
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao carregar analise de estoque');
    } finally {
      setIsLoading(false);
    }
  }, [dataCorte, filiaisSelecionadas, produtoFiltro, search, tiposEstoqueSelecionados, token]);

  useEffect(() => {
    if (!token) return;
    pcpApi.getFiltrosDashboardEstoque(token)
      .then((response) => {
        setClassificacoes(response.classificacoes);
        setTiposEstoque(response.tiposEstoque);
        setLojasFiltro(response.lojas);
      })
      .catch((error) => console.error('Erro ao carregar filtros da analise de estoque:', error));
  }, [token]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const filialOptions = useMemo(() => {
    return lojasFiltro
      .filter((loja) => user?.role === 'admin' || user?.branchCodes.includes(loja.branch_code))
      .map((loja) => ({ value: loja.branch_code, label: loja.branch_name }));
  }, [lojasFiltro, user]);

  const classificacoesOrdenadas = useMemo(() => {
    return [...classificacoes].sort((a, b) => {
      const ia = FILTROS_PRIORITARIOS.indexOf(a.chave);
      const ib = FILTROS_PRIORITARIOS.indexOf(b.chave);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.label.localeCompare(b.label);
    });
  }, [classificacoes]);

  const filtrosAtivos = useMemo(() => {
    const totalClassificacoes = Object.values(produtoFiltro).reduce((sum, values) => sum + (values?.length || 0), 0);
    return totalClassificacoes + filiaisSelecionadas.length + tiposEstoqueSelecionados.length + (search.trim() ? 1 : 0);
  }, [filiaisSelecionadas, produtoFiltro, search, tiposEstoqueSelecionados]);

  function limparFiltros() {
    setSearch('');
    setFiliaisSelecionadas([]);
    setTiposEstoqueSelecionados([]);
    setProdutoFiltro({});
  }

  function toggleReferencia(referencia: string) {
    setReferenciasAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(referencia)) next.delete(referencia);
      else next.add(referencia);
      return next;
    });
  }

  const total = data?.total;
  const tiposSaldoTabela = data?.tiposSaldo || [];
  const tabelaColSpan = 8 + tiposSaldoTabela.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analise de Estoque</h1>
          <p className="text-sm text-gray-500 mt-1">
            Posicao em {data ? formatDate(data.data) : formatDate(dataCorte)} · ultimo saldo capturado ate {atualizacaoLabel(data?.atualizadoEm || null)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <label className="block text-sm font-medium text-gray-700 mb-1">Data do estoque</label>
            <Input type="date" value={dataCorte} onChange={(e) => setDataCorte(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={limparFiltros} disabled={filtrosAtivos === 0}>
            Limpar filtros
          </Button>
          <Button onClick={carregarDados} disabled={isLoading}>
            Atualizar
          </Button>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Buscar produto</label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Referencia ou descricao"
            />
          </div>
          <FilialMultiSelect
            label="Filiais"
            options={filialOptions}
            selected={filiaisSelecionadas}
            onChange={setFiliaisSelecionadas}
            className="w-full"
          />
          <ClassificacaoMultiSelect
            label="Tipo de estoque"
            options={tiposEstoque.map((tipo) => ({
              value: String(tipo.stockCode),
              label: tipo.label,
              meta: formatNumber(tipo.qtd_skus),
            }))}
            selected={tiposEstoqueSelecionados}
            onChange={setTiposEstoqueSelecionados}
            className="w-full"
          />
          {classificacoesOrdenadas.map((dimensao) => (
            <ClassificacaoMultiSelect
              key={dimensao.chave}
              label={dimensao.label}
              options={dimensao.opcoes.map((opcao) => ({
                value: opcao.valor,
                label: opcao.valor,
                meta: formatNumber(opcao.qtd_skus),
              }))}
              selected={produtoFiltro[dimensao.chave] || []}
              onChange={(values) => setProdutoFiltro((prev) => ({ ...prev, [dimensao.chave]: values.length ? values : undefined }))}
              className="w-full"
            />
          ))}
        </div>
      </Card>

      {erro && (
        <Card className="border-l-4 border-l-[var(--bbtk-red)]">
          <p className="text-sm font-medium text-red-700">{erro}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KPICard title="Pecas em estoque" value={formatNumber(total?.quantidade || 0)} color="red" isLoading={isLoading} />
        <KPICard title="Valor a custo" value={formatMoney(total?.valorCusto || 0)} color="green" valueSize="md" isLoading={isLoading} />
        <KPICard title="SKUs com saldo" value={formatNumber(total?.skus || 0)} color="purple" isLoading={isLoading} />
        <KPICard title="Referencias" value={formatNumber(total?.referencias || 0)} color="blue" isLoading={isLoading} />
        <KPICard title="Filiais/locais" value={formatNumber(total?.filiais || 0)} color="yellow" isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {GRAFICOS.map((grafico) => (
          <ChartCard
            key={grafico.key}
            title={grafico.title}
            color={grafico.color}
            data={data?.graficos[grafico.key] || []}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Referencias em estoque</CardTitle>
          <span className="text-xs text-gray-400">Ordenado por quantidade</span>
        </CardHeader>
        <Table className="max-h-[560px] overflow-y-auto" tableClassName="min-w-[1180px]">
          <TableHead>
            <TableRow>
              <TableCell isHeader>Referencia</TableCell>
              <TableCell isHeader>Descricao</TableCell>
              <TableCell isHeader>Colecao</TableCell>
              <TableCell isHeader>Linha</TableCell>
              <TableCell isHeader>Categoria</TableCell>
              <TableCell isHeader align="right">Pecas</TableCell>
              {tiposSaldoTabela.map((tipo) => (
                <TableCell key={tipo.stockCode} isHeader align="right" title={tipo.label}>
                  {tipo.label}
                </TableCell>
              ))}
              <TableCell isHeader align="right">Custo un.</TableCell>
              <TableCell isHeader align="right">Valor</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={tabelaColSpan}>
                    <div className="h-5 animate-pulse rounded bg-gray-100" />
                  </TableCell>
                </TableRow>
              ))
            ) : (data?.itens || []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={tabelaColSpan} className="text-center text-gray-500">
                  Nenhum saldo encontrado para os filtros selecionados.
                </TableCell>
              </TableRow>
            ) : (
              data!.itens.map((item) => {
                const aberta = referenciasAbertas.has(item.referencia);
                return (
                  <Fragment key={item.referencia}>
                    <TableRow>
                      <TableCell className="font-semibold text-gray-900">
                        <button
                          type="button"
                          onClick={() => toggleReferencia(item.referencia)}
                          className={cn(
                            'inline-flex items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-100',
                            item.grades.length === 0 && 'cursor-default hover:bg-transparent'
                          )}
                          disabled={item.grades.length === 0}
                          title={aberta ? 'Recolher grade' : 'Expandir grade'}
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-gray-200 text-xs text-gray-600">
                            {aberta ? '-' : '+'}
                          </span>
                          {item.referencia}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate" title={item.descricao}>{item.descricao}</TableCell>
                      <TableCell>{item.colecao || '-'}</TableCell>
                      <TableCell>{item.linha || '-'}</TableCell>
                      <TableCell>{item.categoria || '-'}</TableCell>
                      <TableCell align="right" className="font-semibold">{formatNumber(item.quantidade)}</TableCell>
                      {tiposSaldoTabela.map((tipo) => (
                        <TableCell key={`${item.referencia}-${tipo.stockCode}`} align="right">
                          {formatNumber(saldoQuantidade(item.saldos, tipo.stockCode))}
                        </TableCell>
                      ))}
                      <TableCell align="right">{item.custo === null ? '-' : formatMoney(item.custo)}</TableCell>
                      <TableCell align="right">{formatMoney(item.valorCusto)}</TableCell>
                    </TableRow>
                    {aberta && item.grades.map((grade) => (
                      <TableRow key={`${item.referencia}-${grade.cor}-${grade.tamanho}`} className="bg-gray-50/60">
                        <TableCell className="pl-12 text-gray-700">
                          {grade.cor} / {grade.tamanho}
                        </TableCell>
                        <TableCell className="text-gray-400">Cor / tamanho</TableCell>
                        <TableCell>{item.colecao || '-'}</TableCell>
                        <TableCell>{item.linha || '-'}</TableCell>
                        <TableCell>{item.categoria || '-'}</TableCell>
                        <TableCell align="right" className="font-medium">{formatNumber(grade.quantidade)}</TableCell>
                        {tiposSaldoTabela.map((tipo) => (
                          <TableCell key={`${item.referencia}-${grade.cor}-${grade.tamanho}-${tipo.stockCode}`} align="right">
                            {formatNumber(saldoQuantidade(grade.saldos, tipo.stockCode))}
                          </TableCell>
                        ))}
                        <TableCell align="right">{grade.custo === null ? '-' : formatMoney(grade.custo)}</TableCell>
                        <TableCell align="right">{formatMoney(grade.valorCusto)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
