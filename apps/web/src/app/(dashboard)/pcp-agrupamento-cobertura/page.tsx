'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { KPICard } from '@/components/dashboard/KPICard';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { AgrupamentoCoberturaResponse, agrupamentoCoberturaApi } from '@/lib/pcpApi';
import { cn, formatNumber } from '@/lib/utils';

interface LinhaExibida {
  referenceCode: string;
  descricao: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  colecao: string | null;
  cor: string;
  qtdSkus: number;
  coresUnificadas: number;
}

type SortKey = keyof Omit<LinhaExibida, 'coresUnificadas'> | 'coresUnificadas';

const COLUNAS: Array<{ key: SortKey; label: string; align?: 'right'; width: number }> = [
  { key: 'referenceCode', label: 'REFERENCIA', width: 16 },
  { key: 'descricao', label: 'DESCRICAO', width: 32 },
  { key: 'categoria', label: 'CATEGORIA', width: 16 },
  { key: 'linha', label: 'LINHA', width: 16 },
  { key: 'genero', label: 'GENERO', width: 12 },
  { key: 'colecao', label: 'COLECAO', width: 16 },
  { key: 'cor', label: 'COR', width: 16 },
  { key: 'qtdSkus', label: 'QTD SKUS', align: 'right', width: 10 },
];

function ThSortAgrupamento({
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
      className="cursor-pointer select-none whitespace-nowrap bg-gray-50 hover:bg-gray-100 !px-2 !py-2"
    >
      <span className={cn('flex items-center gap-1.5', coluna.align === 'right' && 'justify-end')}>
        <span>{coluna.label}</span>
        <span className={active ? 'text-[var(--bbtk-purple)]' : 'text-gray-300'}>{active && sortDir === 'desc' ? 'v' : '^'}</span>
      </span>
    </TableCell>
  );
}

export default function PcpAgrupamentoCoberturaPage() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<AgrupamentoCoberturaResponse | null>(null);
  const [comAgrupamento, setComAgrupamento] = useState(false);
  // Busca com debounce: o filtro + ordenacao roda sobre milhares de linhas de forma
  // sincrona no render, entao aplicar a cada tecla congelava o input.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('referenceCode');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // isLoading ja comeca true: nao precisa (nem deve) chamar setIsLoading(true) aqui -
  // setState sincrono dentro de effect dispara render em cascata.
  useEffect(() => {
    if (!token) return;
    agrupamentoCoberturaApi
      .getCobertura(token)
      .then(setData)
      .catch((error) => {
        showToast(error instanceof Error ? error.message : 'Erro ao carregar cobertura do agrupamento', 'error');
        console.error(error);
      })
      .finally(() => setIsLoading(false));
  }, [token, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // "Sem agrupamento": 1 linha por (referencia, cor original) - exatamente como veio da
  // API. "Com agrupamento": colapsa pelo nome do grupo, somando qtdSkus e contando
  // quantas cores originais diferentes viraram esse grupo naquela referencia - a mesma
  // logica de "somar aditivo, nunca duplicar" usada no drill-down da Performance
  // Colecao, so que aqui o colapso acontece no cliente (dataset unico, sem 2a chamada).
  const linhasBase = useMemo<LinhaExibida[]>(() => {
    const linhas = data?.linhas ?? [];
    if (!comAgrupamento) {
      return linhas.map((row) => ({
        referenceCode: row.referenceCode,
        descricao: row.descricao,
        categoria: row.categoria,
        linha: row.linha,
        genero: row.genero,
        colecao: row.colecao,
        cor: row.corOriginal,
        qtdSkus: row.qtdSkus,
        coresUnificadas: 1,
      }));
    }

    const mapa = new Map<string, LinhaExibida>();
    for (const row of linhas) {
      const chave = `${row.referenceCode}|${row.corAgrupada}`;
      const existente = mapa.get(chave);
      if (existente) {
        existente.qtdSkus += row.qtdSkus;
        existente.coresUnificadas += 1;
      } else {
        mapa.set(chave, {
          referenceCode: row.referenceCode,
          descricao: row.descricao,
          categoria: row.categoria,
          linha: row.linha,
          genero: row.genero,
          colecao: row.colecao,
          cor: row.corAgrupada,
          qtdSkus: row.qtdSkus,
          coresUnificadas: 1,
        });
      }
    }
    return [...mapa.values()];
  }, [data, comAgrupamento]);

  const linhasFiltradas = useMemo(() => {
    const termo = search.trim().toLowerCase();
    const base = !termo
      ? linhasBase
      : linhasBase.filter((row) =>
          [row.referenceCode, row.descricao, row.categoria, row.linha, row.colecao, row.cor]
            .filter(Boolean)
            .some((campo) => campo!.toLowerCase().includes(termo))
        );

    return [...base].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR', { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [linhasBase, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Cobertura do Agrupamento de Cores</h1>
        <p className="text-gray-500 text-sm mt-1">
          Quantas cores e referências já foram organizadas pelo Agrupamento de Cores, e como isso muda o cadastro dos produtos.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard title="Grupos criados" value={formatNumber(data?.stats.totalGrupos || 0)} color="purple" isLoading={isLoading} />
        <KPICard title="Cores agrupadas" value={formatNumber(data?.stats.totalCoresAgrupadas || 0)} subtitle="cores originais organizadas em grupos" color="blue" isLoading={isLoading} />
        <KPICard title="Referências atingidas" value={formatNumber(data?.stats.totalReferenciasAtingidas || 0)} color="green" isLoading={isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Produtos: antes e depois do agrupamento</CardTitle>
          <p className="text-xs text-gray-500">
            {comAgrupamento
              ? 'Mostrando com o agrupamento aplicado: cores originais diferentes que caem no mesmo grupo aparecem numa linha só.'
              : 'Mostrando sem agrupamento: cada cor original do cadastro TOTVS numa linha, exatamente como está hoje.'}
          </p>
        </CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Buscar referencia, descricao ou cor" className="sm:max-w-xs" />
          <div className="inline-grid grid-cols-2 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
            {([
              { value: false, label: 'SEM AGRUPAMENTO' },
              { value: true, label: 'COM AGRUPAMENTO' },
            ] as const).map((opcao) => (
              <button
                key={String(opcao.value)}
                type="button"
                onClick={() => setComAgrupamento(opcao.value)}
                className={cn(
                  'min-w-36 px-3 py-2 text-xs font-bold',
                  opcao.value === comAgrupamento
                    ? 'bg-[var(--bbtk-red)] text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {opcao.label}
              </button>
            ))}
          </div>
        </div>

        <Table className="max-h-[700px] overflow-auto" tableClassName="text-xs min-w-[1100px]">
          <TableHead className="sticky top-0 z-10">
            <TableRow>
              {COLUNAS.map((coluna) => (
                <ThSortAgrupamento key={coluna.key} coluna={coluna} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">Carregando...</TableCell>
              </TableRow>
            ) : linhasFiltradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUNAS.length} align="center" className="py-10 text-gray-500">Nenhum produto agrupado encontrado</TableCell>
              </TableRow>
            ) : (
              linhasFiltradas.map((row, index) => (
                <TableRow key={`${row.referenceCode}|${row.cor}|${index}`}>
                  <TableCell className="whitespace-nowrap !px-2 !py-2">{row.referenceCode}</TableCell>
                  <TableCell className="!px-2 !py-2">
                    <span className="block max-w-[280px] truncate" title={row.descricao}>{row.descricao}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap !px-2 !py-2">{row.categoria || '-'}</TableCell>
                  <TableCell className="whitespace-nowrap !px-2 !py-2">{row.linha || '-'}</TableCell>
                  <TableCell className="whitespace-nowrap !px-2 !py-2">{row.genero || '-'}</TableCell>
                  <TableCell className="whitespace-nowrap !px-2 !py-2">{row.colecao || '-'}</TableCell>
                  <TableCell className="whitespace-nowrap !px-2 !py-2">
                    {row.cor}
                    {comAgrupamento && row.coresUnificadas > 1 && (
                      <span className="ml-1.5 text-[10px] text-gray-400">({row.coresUnificadas} cores)</span>
                    )}
                  </TableCell>
                  <TableCell align="right" className="whitespace-nowrap !px-2 !py-2">{formatNumber(row.qtdSkus)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
