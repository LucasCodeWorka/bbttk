'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import {
  EstoqueSemGiroResponse,
  PcpClassificacaoDimensao,
  PcpLojaFiltro,
  pcpApi,
} from '@/lib/pcpApi';
import { cn, formatMoney, formatNumber } from '@/lib/utils';

const DIAS_OPTIONS = [
  { value: 30, label: 'Ate 30 dias sem girar' },
  { value: 60, label: '31 a 60 dias sem girar' },
  { value: 90, label: '61 a 90 dias sem girar' },
  { value: 91, label: 'Acima de 90 dias' },
];

const RANKING_OPTIONS = [
  { value: '10', label: 'Top 10' },
  { value: '25', label: 'Top 25' },
  { value: '50', label: 'Top 50' },
  { value: 'all', label: 'Todos SKUs' },
];

const COBERTURA_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: '6-12', label: 'Entre 6 e 12 meses' },
  { value: '12-24', label: 'Entre 12 e 24 meses' },
  { value: '24+', label: 'Acima de 24 meses' },
];

const CARD_COLORS = [
  'border-l-4 border-l-[var(--bbtk-red)]',
  'border-l-4 border-l-[var(--bbtk-green)]',
  'border-l-4 border-l-[var(--bbtk-yellow)]',
  'border-l-4 border-l-[var(--bbtk-purple)]',
];

const LOJA_LABELS: Record<number, string> = {
  1: 'IGU',
  2: 'FAB',
  3: 'BEN',
  4: 'DEL',
  5: 'L05',
  6: 'SOB',
  7: 'PAR',
  8: 'RIO',
  9: 'EXP',
  11: 'RPK',
  12: 'MES',
  13: 'EUS',
  17: 'NOR',
};

function shortLojaName(name: string, branchCode: number) {
  if (LOJA_LABELS[branchCode]) return LOJA_LABELS[branchCode];
  const clean = name.replace(/SHOPPING|PATIO|\s+/g, ' ').trim();
  return clean.slice(0, 4).toUpperCase() || `L${String(branchCode).padStart(2, '0')}`;
}

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function faixaDiasLabel(dias: number) {
  if (dias <= 30) return 'Ate 30 dias';
  if (dias <= 60) return '31 a 60 dias';
  if (dias <= 90) return '61 a 90 dias';
  return 'Acima de 90 dias';
}

function formatDiasSemGiro(
  dias: number,
  ultimaVenda: string | null,
  lojasSemVenda: number,
  lojasTotal: number
) {
  if (lojasSemVenda > 0 && lojasSemVenda === lojasTotal) return 'Nunca vendeu';
  if (!ultimaVenda || dias >= 9999) return 'Nunca vendeu';
  return `${formatNumber(dias)} dias`;
}

export default function PcpNovoPage() {
  const { token, user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [diasSelecionado, setDiasSelecionado] = useState(91);
  const [cobertura, setCobertura] = useState('');
  const [rankingLimit, setRankingLimit] = useState<'10' | '25' | '50' | 'all'>('10');
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [lojasFiltro, setLojasFiltro] = useState<PcpLojaFiltro[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [data, setData] = useState<EstoqueSemGiroResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregarDados = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setErro(null);
    try {
      const response = await pcpApi.getEstoqueSemGiro(token, {
        dias: diasSelecionado,
        cobertura: cobertura ? cobertura as '6-12' | '12-24' | '24+' : undefined,
        branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        limit: rankingLimit === 'all' ? 'all' : Number(rankingLimit),
      });
      setData(response);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao carregar estoque sem giro');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [cobertura, diasSelecionado, filiaisSelecionadas, produtoFiltro, rankingLimit, token]);

  useEffect(() => {
    if (!token) return;

    pcpApi.getFiltrosEstoqueSemGiro(token)
      .then((response) => {
        setClassificacoes(response.classificacoes);
        setLojasFiltro(response.lojas);
      })
      .catch((error) => {
        console.error('Erro ao carregar filtros PCP:', error);
      });
  }, [token]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const filialOptions = useMemo(() => {
    const lojas = lojasFiltro;
    return lojas
      .filter((loja) => {
        if (user?.role === 'admin') return true;
        return user?.branchCodes.includes(loja.branch_code);
      })
      .map((loja) => ({ value: loja.branch_code, label: loja.branch_name }));
  }, [lojasFiltro, user]);

  const lojasTabela = data?.lojas || [];
  const resumoSelecionado = data?.resumo.find((item) => item.dias === diasSelecionado);
  const totalColunasTabela = 5 + Math.max(lojasTabela.length, 1);
  const lojaColumnWidth = lojasTabela.length > 0 ? 49 / lojasTabela.length : 49;

  const top10Totais = useMemo(() => {
    if (!data) return null;

    const lojas = new Map<number, number>();
    const totais = data.top_skus.reduce(
      (acc, item) => {
        acc.quantidade += item.quantidade;
        acc.valor += item.valor;
        item.lojas.forEach((loja) => {
          lojas.set(loja.branch_code, (lojas.get(loja.branch_code) || 0) + loja.quantidade);
        });
        return acc;
      },
      { quantidade: 0, valor: 0 }
    );

    return { ...totais, lojas };
  }, [data]);

  const rankingLabel = rankingLimit === 'all' ? 'Todos SKUs' : `Top ${rankingLimit}`;
  const totalizadorLabel = rankingLimit === 'all'
    ? 'Total:'
    : `Amostra (${formatNumber(data?.top_skus.length || 0)} SKUs):`;

  const adicionais = data && top10Totais && rankingLimit !== 'all'
    ? {
        sku_count: Math.max(data.total.sku_count - data.top_skus.length, 0),
        quantidade: Math.max(data.total.quantidade - top10Totais.quantidade, 0),
        valor: Math.max(data.total.valor - top10Totais.valor, 0),
      }
    : null;

  const lojaDestaque = data?.resumo_lojas.reduce((maior, loja) =>
    loja.quantidade > maior.quantidade ? loja : maior,
    data.resumo_lojas[0]
  )?.branch_code;

  function atualizarProdutoFiltro(chave: string, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Estoque - Sem Giro</p>
          <h1 className="text-2xl font-bold text-gray-900">Estoque parado por SKU e loja</h1>
          <p className="text-gray-500 text-sm mt-1">Visao por codigo filho e referencia</p>
        </div>

        <div className="text-sm text-gray-500 md:text-right">
          <p>Atualizado em</p>
          <p className="font-semibold text-gray-900">{formatDateTime(data?.atualizado_em || null)}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrar periodo sem girar</CardTitle>
        </CardHeader>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {DIAS_OPTIONS.map((option) => {
            const active = diasSelecionado === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setDiasSelecionado(option.value)}
                className={cn(
                  'h-12 rounded-lg border text-sm font-semibold transition-all',
                  active
                    ? 'bg-[var(--bbtk-red)] text-white border-[var(--bbtk-red)]'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-[var(--bbtk-red)]'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {(data?.resumo || DIAS_OPTIONS.map((option) => ({
          dias: option.value,
          label: option.value > 90 ? '> 90 dias' : `${option.value} dias`,
          sku_count: 0,
          quantidade: 0,
          valor: 0,
          pct_total: 0,
        }))).map((item, index) => {
          const active = item.dias === diasSelecionado;
          return (
            <Card
              key={item.dias}
              className={cn(
                'cursor-pointer transition-all',
                CARD_COLORS[index % CARD_COLORS.length],
                active && 'ring-1 ring-[var(--bbtk-red)] bg-red-50'
              )}
              hover
            >
              <button type="button" className="w-full text-left" onClick={() => setDiasSelecionado(item.dias)}>
                <CardTitle className={cn(active && 'text-[var(--bbtk-red)]')}>
                  {item.label}{active ? ' - selecionado' : ''}
                </CardTitle>
                <CardValue className="mt-2">
                  {isLoading ? '-' : `${formatNumber(item.sku_count)} SKUs`}
                </CardValue>
                <p className="text-sm text-gray-600 mt-1">
                  {formatNumber(item.quantidade)} pc - {formatMoney(item.valor)}
                </p>
                <p className="text-sm text-gray-600">{item.pct_total.toFixed(1)}% do total</p>
              </button>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {classificacoes.map((dim) => (
          <ClassificacaoMultiSelect
            key={dim.chave}
            label={dim.label}
            options={dim.opcoes.map((option) => ({ value: option.valor, label: option.valor }))}
            selected={produtoFiltro[dim.chave] || []}
            onChange={(valores) => atualizarProdutoFiltro(dim.chave, valores)}
            className="w-44"
          />
        ))}
        <FilialMultiSelect
          selected={filiaisSelecionadas}
          onChange={setFiliaisSelecionadas}
          options={filialOptions}
          label="Loja"
          className="w-52"
        />
        <Select
          label="Cobertura"
          value={cobertura}
          onChange={(event) => setCobertura(event.target.value)}
          options={COBERTURA_OPTIONS}
          className="w-52"
        />
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
      </div>

      {erro && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{erro}</p>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>
              {rankingLabel} sem girar - {faixaDiasLabel(diasSelecionado)}
            </CardTitle>
            {resumoSelecionado && (
              <p className="text-xs text-gray-400 mt-1">
                {formatNumber(resumoSelecionado.quantidade)} pecas em estoque no filtro atual
              </p>
            )}
          </div>
          <Select
            label="Ranking"
            value={rankingLimit}
            onChange={(event) => setRankingLimit(event.target.value as '10' | '25' | '50' | 'all')}
            options={RANKING_OPTIONS}
            className="w-36"
          />
        </CardHeader>

        <Table className="overflow-x-visible" tableClassName="table-fixed text-[9px] sm:text-[10px] lg:text-[11px]">
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '7%' }} />
            {lojasTabela.length === 0 ? (
              <col style={{ width: '49%' }} />
            ) : lojasTabela.map((loja) => (
              <col key={`col-${loja.branch_code}`} style={{ width: `${lojaColumnWidth}%` }} />
            ))}
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell isHeader className="!px-1.5 !py-2">Descricao completa</TableCell>
              <TableCell isHeader className="!px-1.5 !py-2">Grade</TableCell>
              <TableCell isHeader align="right" className="!px-1.5 !py-2">Dias sem giro</TableCell>
              <TableCell isHeader align="right" className="!px-1.5 !py-2">Qtd</TableCell>
              <TableCell isHeader align="right" className="!px-1.5 !py-2">Valor</TableCell>
              <TableCell isHeader align="center" colSpan={Math.max(lojasTabela.length, 1)} className="bg-blue-50 text-blue-800 !px-1.5 !py-2">
                Distribuicao por loja (pc)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell isHeader className="bg-gray-50 !px-1.5 !py-2" />
              <TableCell isHeader className="bg-gray-50 !px-1.5 !py-2" />
              <TableCell isHeader className="bg-gray-50 !px-1.5 !py-2" />
              <TableCell isHeader className="bg-gray-50 !px-1.5 !py-2" />
              <TableCell isHeader className="bg-gray-50 !px-1.5 !py-2" />
              {lojasTabela.length === 0 ? (
                <TableCell isHeader align="center" className="bg-blue-50 text-blue-800 !px-1 !py-2">-</TableCell>
              ) : lojasTabela.map((loja) => (
                <TableCell key={loja.branch_code} isHeader align="center" className="bg-blue-50 text-blue-800 !px-0.5 !py-2 whitespace-nowrap" title={loja.branch_name}>
                  {shortLojaName(loja.branch_name, loja.branch_code)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={totalColunasTabela} align="center" className="py-10 text-gray-500">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : data?.top_skus.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColunasTabela} align="center" className="py-10 text-gray-500">
                  Nenhum SKU encontrado para os filtros selecionados
                </TableCell>
              </TableRow>
            ) : data?.top_skus.map((item) => {
              const lojaMap = new Map(item.lojas.map((loja) => [loja.branch_code, loja.quantidade]));
              return (
                <TableRow key={item.sku}>
                  <TableCell className="!px-1.5 !py-2 align-top">
                    <p className="font-medium text-gray-900 truncate max-w-full" title={item.descricao}>{item.descricao}</p>
                    <p className="text-[9px] text-gray-500 truncate">
                      Ref. {item.referencia}{item.colecao ? ` - Colecao ${item.colecao}` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="!px-1.5 !py-2 text-gray-700 truncate" title={item.grade || '-'}>{item.grade || '-'}</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-semibold text-red-600 whitespace-normal leading-tight">{formatDiasSemGiro(item.dias_sem_giro, item.ultima_venda, item.lojas_sem_venda, item.lojas_total)}</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2">{formatNumber(item.quantidade)}</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-semibold whitespace-normal leading-tight">{formatMoney(item.valor)}</TableCell>
                  {lojasTabela.length === 0 ? (
                    <TableCell align="center" className="!px-1 !py-2">-</TableCell>
                  ) : lojasTabela.map((loja) => (
                    <TableCell key={`${item.sku}-${loja.branch_code}`} align="center" className="!px-1 !py-2">
                      {formatNumber(lojaMap.get(loja.branch_code) || 0)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {!isLoading && data && data.top_skus.length > 0 && top10Totais && (
              <>
                <TableRow isHighlighted>
                  <TableCell colSpan={2} align="right" className="!px-1.5 !py-2 font-bold">{totalizadorLabel}</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">-</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">{formatNumber(top10Totais.quantidade)}</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold whitespace-normal leading-tight">{formatMoney(top10Totais.valor)}</TableCell>
                  {lojasTabela.length === 0 ? (
                    <TableCell align="center" className="!px-1 !py-2">-</TableCell>
                  ) : lojasTabela.map((loja) => (
                    <TableCell key={`top10-${loja.branch_code}`} align="center" className="!px-1 !py-2 font-bold">
                      {formatNumber(top10Totais.lojas.get(loja.branch_code) || 0)}
                    </TableCell>
                  ))}
                </TableRow>
                {adicionais && adicionais.sku_count > 0 && (
                  <TableRow>
                    <TableCell colSpan={2} align="right" className="!px-1.5 !py-2 text-gray-500">
                      + {formatNumber(adicionais.sku_count)} SKUs adicionais:
                    </TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2 text-gray-500">-</TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2 text-gray-600">{formatNumber(adicionais.quantidade)}</TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2 text-gray-600 whitespace-normal leading-tight">{formatMoney(adicionais.valor)}</TableCell>
                    <TableCell align="center" colSpan={Math.max(lojasTabela.length, 1)} className="!px-1.5 !py-2 text-gray-500">
                      distribuicao similar
                    </TableCell>
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </Card>

      {data && data.resumo_lojas?.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 mb-3">
            Resumo por loja - estoque parado em {faixaDiasLabel(diasSelecionado).toLowerCase()}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {data.resumo_lojas.slice(0, 8).map((loja) => {
              const destaque = loja.branch_code === lojaDestaque;
              return (
                <Card key={loja.branch_code} className={cn(destaque && 'border-red-200 bg-red-50')}>
                  <p className={cn('text-sm text-gray-500', destaque && 'font-semibold text-red-800')}>
                    {loja.branch_name}
                  </p>
                  <p className={cn('text-2xl font-bold text-gray-900 mt-1', destaque && 'text-red-700')}>
                    {formatNumber(loja.quantidade)} pc
                  </p>
                  <p className="text-sm text-gray-600">
                    {formatMoney(loja.valor)} - {loja.pct_quantidade.toFixed(1)}%
                  </p>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

