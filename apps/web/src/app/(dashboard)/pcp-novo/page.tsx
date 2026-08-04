'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardValue } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import {
  EstoqueSemGiroResponse,
  EstoqueSemGiroSku,
  PcpClassificacaoDimensao,
  PcpLojaFiltro,
  pcpApi,
} from '@/lib/pcpApi';
import { cn, formatMoney, formatNumber } from '@/lib/utils';

// Estrutura agrupada por REF > Cor > Tamanho
interface GrupoRef {
  referencia: string;
  descricao: string;
  quantidade: number;
  valor: number;
  cores: GrupoCor[];
}

interface GrupoCor {
  cor: string;
  quantidade: number;
  valor: number;
  tamanhos: GrupoTamanho[];
}

interface GrupoTamanho {
  tamanho: string;
  sku: string;
  quantidade: number;
  valor: number;
  dias_sem_giro: number;
  ultima_venda: string | null;
  lojas_sem_venda: number;
  lojas_total: number;
  lojas: { branch_code: number; quantidade: number }[];
}

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

function shortLojaName(name: string, branchCode: number) {
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
    <TableCell isHeader align={align} className={className} title={title} onClick={() => onSort(sortKeyName)}>
      {label}
      {active && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </TableCell>
  );
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
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Estado de expansao para o layout hierarquico REF > Cor > Tamanho
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  const [expandedCores, setExpandedCores] = useState<Set<string>>(new Set());

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
  const totalColunasTabela = 6 + Math.max(lojasTabela.length, 1);
  const lojaColumnWidth = lojasTabela.length > 0 ? 49 / lojasTabela.length : 49;

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function getSortValue(item: EstoqueSemGiroSku, key: string): number | string {
    if (key === 'descricao') return item.descricao || '';
    if (key === 'grade') return item.grade || '';
    if (key === 'cor_de_para') return item.cor_de_para || '';
    if (key === 'dias_sem_giro') return item.dias_sem_giro;
    if (key === 'quantidade') return item.quantidade;
    if (key === 'valor') return item.valor;
    if (key.startsWith('loja-')) {
      const branchCode = Number(key.slice('loja-'.length));
      return item.lojas.find((loja) => loja.branch_code === branchCode)?.quantidade || 0;
    }
    return 0;
  }

  const skusOrdenados = useMemo(() => {
    const base = data?.top_skus || [];
    if (!sortKey) return base;
    const arr = [...base];
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * (sortDir === 'asc' ? 1 : -1);
      }
      return (va - vb) * (sortDir === 'asc' ? 1 : -1);
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sortKey, sortDir]);

  // Agrupa SKUs por REF > Cor > Tamanho
  const gruposHierarquicos = useMemo((): GrupoRef[] => {
    const skus = data?.top_skus || [];
    const refMap = new Map<string, GrupoRef>();

    for (const sku of skus) {
      // Extrair tamanho do grade (ultimo elemento geralmente)
      const tamanho = sku.grade?.split(' ').pop() || 'UNICO';
      const cor = sku.cor_de_para || 'SEM COR';

      if (!refMap.has(sku.referencia)) {
        refMap.set(sku.referencia, {
          referencia: sku.referencia,
          descricao: sku.descricao?.split(' - ')[0] || sku.referencia,
          quantidade: 0,
          valor: 0,
          cores: [],
        });
      }

      const refGrupo = refMap.get(sku.referencia)!;
      refGrupo.quantidade += sku.quantidade;
      refGrupo.valor += sku.valor;

      let corGrupo = refGrupo.cores.find(c => c.cor === cor);
      if (!corGrupo) {
        corGrupo = { cor, quantidade: 0, valor: 0, tamanhos: [] };
        refGrupo.cores.push(corGrupo);
      }
      corGrupo.quantidade += sku.quantidade;
      corGrupo.valor += sku.valor;

      corGrupo.tamanhos.push({
        tamanho,
        sku: sku.sku,
        quantidade: sku.quantidade,
        valor: sku.valor,
        dias_sem_giro: sku.dias_sem_giro,
        ultima_venda: sku.ultima_venda,
        lojas_sem_venda: sku.lojas_sem_venda,
        lojas_total: sku.lojas_total,
        lojas: sku.lojas,
      });
    }

    // Ordenar por valor decrescente
    const resultado = Array.from(refMap.values());
    resultado.sort((a, b) => b.valor - a.valor);
    resultado.forEach(ref => {
      ref.cores.sort((a, b) => b.valor - a.valor);
      ref.cores.forEach(cor => {
        cor.tamanhos.sort((a, b) => {
          // Ordenar tamanhos: PP, P, M, G, GG, XG, EG, depois numericos
          const ordem = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'EG'];
          const aIdx = ordem.indexOf(a.tamanho.toUpperCase());
          const bIdx = ordem.indexOf(b.tamanho.toUpperCase());
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
          const aNum = parseInt(a.tamanho, 10);
          const bNum = parseInt(b.tamanho, 10);
          if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
          return a.tamanho.localeCompare(b.tamanho);
        });
      });
    });

    return resultado;
  }, [data]);

  function toggleRef(ref: string) {
    setExpandedRefs(prev => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function toggleCor(refCorKey: string) {
    setExpandedCores(prev => {
      const next = new Set(prev);
      if (next.has(refCorKey)) next.delete(refCorKey);
      else next.add(refCorKey);
      return next;
    });
  }

  function expandirTodos() {
    const refs = new Set(gruposHierarquicos.map(g => g.referencia));
    const cores = new Set(gruposHierarquicos.flatMap(g => g.cores.map(c => `${g.referencia}|${c.cor}`)));
    setExpandedRefs(refs);
    setExpandedCores(cores);
  }

  function recolherTodos() {
    setExpandedRefs(new Set());
    setExpandedCores(new Set());
  }

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
  const tableNeedsScroll = (data?.top_skus.length || 0) > 10;
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

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm font-medium text-gray-800">Painel em fase de teste</p>
        <p className="text-xs text-gray-600 mt-1">
          Os dados e regras deste dashboard ainda estao em validacao. Use como apoio e sinalize divergencias encontradas.
        </p>
      </Card>

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
                {formatNumber(resumoSelecionado.quantidade)} pecas em estoque no filtro atual | {gruposHierarquicos.length} referencias
              </p>
            )}
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" onClick={expandirTodos}>Expandir</Button>
              <Button variant="secondary" size="sm" onClick={recolherTodos}>Recolher</Button>
            </div>
            <Select
              label="Ranking"
              value={rankingLimit}
              onChange={(event) => setRankingLimit(event.target.value as '10' | '25' | '50' | 'all')}
              options={RANKING_OPTIONS}
              className="w-36"
            />
          </div>
        </CardHeader>

        {/* Layout hierarquico REF > Cor > Tamanho */}
        <div className={cn('overflow-auto', tableNeedsScroll && 'max-h-[600px]')}>
          <Table tableClassName="text-xs">
            <TableHead className="sticky top-0 z-10 bg-white">
              <TableRow>
                <TableCell isHeader className="w-8 !px-2"></TableCell>
                <TableCell isHeader className="min-w-[200px] !px-2">Referencia / Cor / Tamanho</TableCell>
                <TableCell isHeader align="right" className="!px-2 w-20">Qtd</TableCell>
                <TableCell isHeader align="right" className="!px-2 w-28">Valor</TableCell>
                <TableCell isHeader align="right" className="!px-2 w-24">Sem Giro</TableCell>
                <TableCell isHeader align="center" colSpan={Math.max(lojasTabela.length, 1)} className="bg-blue-50 text-blue-800 !px-2">
                  Distribuicao por Loja
                </TableCell>
              </TableRow>
              {lojasTabela.length > 0 && (
                <TableRow>
                  <TableCell isHeader className="!px-2"></TableCell>
                  <TableCell isHeader className="!px-2"></TableCell>
                  <TableCell isHeader className="!px-2"></TableCell>
                  <TableCell isHeader className="!px-2"></TableCell>
                  <TableCell isHeader className="!px-2"></TableCell>
                  {lojasTabela.map((loja) => (
                    <TableCell key={loja.branch_code} isHeader align="center" title={loja.branch_name} className="bg-blue-50 text-blue-800 !px-1 !py-1 text-[10px]">
                      {shortLojaName(loja.branch_name, loja.branch_code)}
                    </TableCell>
                  ))}
                </TableRow>
              )}
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5 + Math.max(lojasTabela.length, 1)} align="center" className="py-10 text-gray-500">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : gruposHierarquicos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5 + Math.max(lojasTabela.length, 1)} align="center" className="py-10 text-gray-500">
                    Nenhum SKU encontrado para os filtros selecionados
                  </TableCell>
                </TableRow>
              ) : (
                gruposHierarquicos.map((refGrupo) => {
                  const refExpanded = expandedRefs.has(refGrupo.referencia);
                  return (
                    <React.Fragment key={refGrupo.referencia}>
                      {/* Linha da REFERENCIA */}
                      <TableRow className="bg-gray-100 hover:bg-gray-200 cursor-pointer" onClick={() => toggleRef(refGrupo.referencia)}>
                        <TableCell className="!px-2 !py-2">
                          <span className="font-bold text-[#6B5B95]">{refExpanded ? '−' : '+'}</span>
                        </TableCell>
                        <TableCell className="!px-2 !py-2">
                          <span className="font-bold text-gray-900">{refGrupo.referencia}</span>
                          <span className="ml-2 text-gray-500 text-[10px]">{refGrupo.cores.length} cores</span>
                        </TableCell>
                        <TableCell align="right" className="!px-2 !py-2 font-semibold">{formatNumber(refGrupo.quantidade)}</TableCell>
                        <TableCell align="right" className="!px-2 !py-2 font-semibold">{formatMoney(refGrupo.valor)}</TableCell>
                        <TableCell align="right" className="!px-2 !py-2 text-gray-400">-</TableCell>
                        {lojasTabela.length === 0 ? (
                          <TableCell align="center" className="!px-1 !py-2">-</TableCell>
                        ) : lojasTabela.map((loja) => (
                          <TableCell key={loja.branch_code} align="center" className="!px-1 !py-2 text-gray-400">-</TableCell>
                        ))}
                      </TableRow>

                      {/* Cores da referencia */}
                      {refExpanded && refGrupo.cores.map((corGrupo) => {
                        const corKey = `${refGrupo.referencia}|${corGrupo.cor}`;
                        const corExpanded = expandedCores.has(corKey);
                        return (
                          <React.Fragment key={corKey}>
                            {/* Linha da COR */}
                            <TableRow className="bg-gray-50 hover:bg-gray-100 cursor-pointer" onClick={() => toggleCor(corKey)}>
                              <TableCell className="!px-2 !py-1.5"></TableCell>
                              <TableCell className="!px-2 !py-1.5 pl-6">
                                <span className="font-medium text-[#6B5B95] mr-2">{corExpanded ? '−' : '+'}</span>
                                <span className="font-medium text-gray-700">{corGrupo.cor}</span>
                                <span className="ml-2 text-gray-400 text-[10px]">{corGrupo.tamanhos.length} tam</span>
                              </TableCell>
                              <TableCell align="right" className="!px-2 !py-1.5">{formatNumber(corGrupo.quantidade)}</TableCell>
                              <TableCell align="right" className="!px-2 !py-1.5">{formatMoney(corGrupo.valor)}</TableCell>
                              <TableCell align="right" className="!px-2 !py-1.5 text-gray-400">-</TableCell>
                              {lojasTabela.length === 0 ? (
                                <TableCell align="center" className="!px-1 !py-1.5">-</TableCell>
                              ) : lojasTabela.map((loja) => (
                                <TableCell key={loja.branch_code} align="center" className="!px-1 !py-1.5 text-gray-400">-</TableCell>
                              ))}
                            </TableRow>

                            {/* Tamanhos da cor */}
                            {corExpanded && corGrupo.tamanhos.map((tam) => {
                              const lojaMap = new Map(tam.lojas.map((l) => [l.branch_code, l.quantidade]));
                              return (
                                <TableRow key={tam.sku} className="hover:bg-blue-50/30">
                                  <TableCell className="!px-2 !py-1"></TableCell>
                                  <TableCell className="!px-2 !py-1 pl-12">
                                    <span className="text-gray-600">{tam.tamanho}</span>
                                    <span className="ml-2 text-[9px] text-gray-400">{tam.sku}</span>
                                  </TableCell>
                                  <TableCell align="right" className="!px-2 !py-1 text-gray-600">{formatNumber(tam.quantidade)}</TableCell>
                                  <TableCell align="right" className="!px-2 !py-1 text-gray-600">{formatMoney(tam.valor)}</TableCell>
                                  <TableCell align="right" className="!px-2 !py-1 font-semibold text-red-600">
                                    {formatDiasSemGiro(tam.dias_sem_giro, tam.ultima_venda, tam.lojas_sem_venda, tam.lojas_total)}
                                  </TableCell>
                                  {lojasTabela.length === 0 ? (
                                    <TableCell align="center" className="!px-1 !py-1">-</TableCell>
                                  ) : lojasTabela.map((loja) => (
                                    <TableCell key={loja.branch_code} align="center" className="!px-1 !py-1">
                                      {formatNumber(lojaMap.get(loja.branch_code) || 0)}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })
              )}
              {/* Totalizador */}
              {!isLoading && data && data.top_skus.length > 0 && top10Totais && (
                <TableRow isHighlighted className="sticky bottom-0 z-10">
                  <TableCell className="!px-2 !py-2"></TableCell>
                  <TableCell className="!px-2 !py-2 font-bold">{totalizadorLabel}</TableCell>
                  <TableCell align="right" className="!px-2 !py-2 font-bold">{formatNumber(top10Totais.quantidade)}</TableCell>
                  <TableCell align="right" className="!px-2 !py-2 font-bold">{formatMoney(top10Totais.valor)}</TableCell>
                  <TableCell align="right" className="!px-2 !py-2 font-bold">-</TableCell>
                  {lojasTabela.length === 0 ? (
                    <TableCell align="center" className="!px-1 !py-2">-</TableCell>
                  ) : lojasTabela.map((loja) => (
                    <TableCell key={`total-${loja.branch_code}`} align="center" className="!px-1 !py-2 font-bold">
                      {formatNumber(top10Totais.lojas.get(loja.branch_code) || 0)}
                    </TableCell>
                  ))}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
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


