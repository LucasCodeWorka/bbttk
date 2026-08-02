'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import {
  PcpClassificacaoDimensao,
  RelatorioBaseFiltro,
  RelatorioBaseResponse,
  RelatorioBaseRow,
  relatorioBaseApi,
} from '@/lib/pcpApi';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { exportToCsv } from '@/lib/exportCsv';

function ThSortPcp({
  label,
  sortKeyName,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
  className,
  style,
  title,
}: {
  label: string;
  sortKeyName: string;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const active = sortKey === sortKeyName;
  return (
    <TableCell
      isHeader
      align={align}
      className={cn('cursor-pointer select-none hover:bg-gray-100', className)}
      style={style}
      onClick={() => onSort(sortKeyName)}
      title={title}
    >
      <span className="flex items-center gap-1.5">
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

const RANKING_OPTIONS = [
  { value: '50', label: 'Top 50 (por estoque)' },
  { value: '100', label: 'Top 100' },
  { value: '250', label: 'Top 250' },
  { value: 'all', label: 'Todos SKUs' },
];

// Largura fixa em px de cada coluna "de identidade" (nao-filial) - tabela e larga
// demais pra usar %, precisa de largura fixa + scroll horizontal.
const SKU_WIDTH = 100;
const DESCRICAO_WIDTH = 200;

interface ColunaFixa {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  sticky?: 'sku' | 'descricao';
  render: (row: RelatorioBaseRow) => React.ReactNode;
}

const COLUNAS_FIXAS: ColunaFixa[] = [
  { key: 'sku', label: 'SKU', width: SKU_WIDTH, sticky: 'sku', render: (r) => r.sku },
  {
    key: 'descricao',
    label: 'DESCRIÇÃO',
    width: DESCRICAO_WIDTH,
    sticky: 'descricao',
    render: (r) => (
      <span className="truncate block" title={r.descricaoCompleta}>
        {r.descricao}
      </span>
    ),
  },
  { key: 'status', label: 'STATUS', width: 90, render: (r) => r.status || '-' },
  { key: 'codigo', label: 'CÓDIGO', width: 80, align: 'right', render: (r) => r.codigo ?? '-' },
  { key: 'categoria', label: 'CATEGORIA', width: 110, render: (r) => r.categoria || '-' },
  { key: 'linha', label: 'LINHA', width: 100, render: (r) => r.linha || '-' },
  { key: 'genero', label: 'GÊNERO', width: 90, render: (r) => r.genero || '-' },
  { key: 'modelo', label: 'MODELO', width: 100, render: (r) => r.modelo || '-' },
  { key: 'lancamento', label: 'LANÇ', width: 70, align: 'center', render: (r) => r.lancamento || '—' },
  { key: 'ultimaEntrada', label: 'ÚLT. ENTRADA', width: 100, align: 'center', render: (r) => (r.ultimaEntrada ? formatDate(r.ultimaEntrada) : '—') },
  { key: 'custo', label: 'CUSTO', width: 80, align: 'right', render: (r) => (r.custo === null ? '—' : formatMoney(r.custo)) },
  { key: 'pdvAtual', label: 'PDV ATUAL', width: 90, align: 'right', render: () => '—' },
  { key: 'pdvRealVar', label: 'PDV REAL (VAR)', width: 100, align: 'right', render: (r) => (r.pdvRealVar === null ? '—' : formatMoney(r.pdvRealVar)) },
  {
    key: 'markupVar',
    label: 'MKUP',
    width: 70,
    align: 'right',
    render: (r) => (
      <span title="Custo da última compra vs. preço da última venda real no varejo">
        {r.markupVar === null ? '—' : `${r.markupVar.toFixed(0)}%`}
      </span>
    ),
  },
  { key: 'pdvRealAta', label: 'PDV REAL (ATA)', width: 100, align: 'right', render: (r) => (r.pdvRealAta === null ? '—' : formatMoney(r.pdvRealAta)) },
  {
    key: 'markupAta',
    label: 'MKUP',
    width: 70,
    align: 'right',
    render: (r) => (
      <span title="Custo da última compra vs. preço da última venda real no atacado">
        {r.markupAta === null ? '—' : `${r.markupAta.toFixed(0)}%`}
      </span>
    ),
  },
  { key: 'estTt', label: 'EST. TT', width: 80, align: 'right', render: (r) => formatNumber(r.estTt) },
  { key: 'estDisponivel', label: 'EST. DISP', width: 80, align: 'right', render: () => '—' },
  { key: 'transito', label: 'TRÂNSITO', width: 80, align: 'right', render: () => '—' },
  { key: 'emProducao', label: 'EM PROD.', width: 80, align: 'right', render: () => '—' },
  { key: 'estPrevisto', label: 'EST. PREV', width: 80, align: 'right', render: () => '—' },
  { key: 'giroTt1', label: 'GIRO TT 1', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt1) },
  { key: 'giroTt3', label: 'GIRO TT 3', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt3) },
  { key: 'giroTt6', label: 'GIRO TT 6', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt6) },
];

const BRANCH_SUBCOL_WIDTH = 56;

function stickyStyleFor(sticky?: 'sku' | 'descricao') {
  if (sticky === 'sku') return { left: 0 };
  if (sticky === 'descricao') return { left: SKU_WIDTH };
  return undefined;
}

export default function PcpRelatorioBasePage() {
  const { token, user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [colunasDisponiveis, setColunasDisponiveis] = useState<{ branchCode: number; label: string }[]>([]);

  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [rankingLimit, setRankingLimit] = useState<'50' | '100' | '250' | 'all'>('50');

  const [data, setData] = useState<RelatorioBaseResponse | null>(null);
  const [sortKey, setSortKey] = useState<string | null>('estTt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setErro(null);
    try {
      const filtro: RelatorioBaseFiltro = {
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
        branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
        search: search.trim() || undefined,
        limit: rankingLimit === 'all' ? 'all' : Number(rankingLimit),
      };
      const response = await relatorioBaseApi.getRelatorioBase(token, filtro);
      setData(response);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao carregar o Relatorio Base');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, produtoFiltro, filiaisSelecionadas, search, rankingLimit]);

  useEffect(() => {
    if (!token) return;
    relatorioBaseApi
      .getFiltrosRelatorioBase(token)
      .then((response) => {
        setClassificacoes(response.classificacoes);
        setColunasDisponiveis(response.colunas);
      })
      .catch((error) => console.error('Erro ao carregar filtros do Relatorio Base:', error));
  }, [token]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const filialOptions = useMemo(() => {
    return colunasDisponiveis
      .filter((c) => {
        if (user?.role === 'admin') return true;
        if (c.branchCode < 0) return true; // Atacado - sintetico, sem checagem de branchCodes
        return user?.branchCodes.includes(c.branchCode);
      })
      .map((c) => ({ value: c.branchCode, label: c.label }));
  }, [colunasDisponiveis, user]);

  function atualizarProdutoFiltro(chave: string, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function getSortValue(row: RelatorioBaseRow, key: string): string | number {
    // Fixed columns
    if (key === 'sku') return row.sku || '';
    if (key === 'descricao') return row.descricao || '';
    if (key === 'status') return row.status || '';
    if (key === 'codigo') return row.codigo ?? -1;
    if (key === 'categoria') return row.categoria || '';
    if (key === 'linha') return row.linha || '';
    if (key === 'genero') return row.genero || '';
    if (key === 'modelo') return row.modelo || '';
    if (key === 'lancamento') return row.lancamento || '';
    if (key === 'ultimaEntrada') return row.ultimaEntrada || '';
    if (key === 'custo') return row.custo ?? -1;
    if (key === 'pdvAtual') return 0;
    if (key === 'pdvRealVar') return row.pdvRealVar ?? -1;
    if (key === 'markupVar') return row.markupVar ?? -1;
    if (key === 'pdvRealAta') return row.pdvRealAta ?? -1;
    if (key === 'markupAta') return row.markupAta ?? -1;
    if (key === 'estTt') return row.estTt || 0;
    if (key === 'estDisponivel') return 0;
    if (key === 'transito') return 0;
    if (key === 'emProducao') return 0;
    if (key === 'estPrevisto') return 0;
    if (key === 'giroTt1') return row.giroTt1 || 0;
    if (key === 'giroTt3') return row.giroTt3 || 0;
    if (key === 'giroTt6') return row.giroTt6 || 0;

    // Dynamic branch columns - format: branch-{branchCode}-{field}
    if (key.startsWith('branch-')) {
      const parts = key.split('-');
      const branchCode = parseInt(parts[1]);
      const field = parts[2]; // giro, est, or cob
      const dados = row.branches[branchCode];
      if (!dados) return field === 'cob' ? '' : 0;
      if (field === 'giro') return dados.giro ?? 0;
      if (field === 'est') return dados.est ?? 0;
      if (field === 'cob') return dados.cob ?? -1;
    }

    return '';
  }

  const colunas = data?.colunas || [];

  const sortedRows = useMemo(() => {
    if (!data || !sortKey) return data?.rows || [];
    const rows = [...data.rows];

    return rows.sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      let cmp = 0;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = Number(aVal) - Number(bVal);
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);
  const totalColunas = COLUNAS_FIXAS.length + colunas.length * 3;

  function exportarExcel() {
    if (!data) return;
    const columns = [
      ...COLUNAS_FIXAS.filter((c) => c.key !== 'descricao' || true).map((c) => ({
        header: c.label,
        value: (r: RelatorioBaseRow) => {
          const rendered = c.render(r);
          return typeof rendered === 'string' || typeof rendered === 'number' ? rendered : (r as any)[c.key] ?? '-';
        },
      })),
      ...colunas.flatMap((c) => [
        { header: `${c.label} - GIRO`, value: (r: RelatorioBaseRow) => r.branches[c.branchCode]?.giro ?? 0 },
        { header: `${c.label} - EST`, value: (r: RelatorioBaseRow) => r.branches[c.branchCode]?.est ?? 0 },
        { header: `${c.label} - COB`, value: (r: RelatorioBaseRow) => r.branches[c.branchCode]?.cob ?? '' },
      ]),
    ];
    exportToCsv('relatorio-base-pcp', columns, sortedRows);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Relatório Base</h1>
          <p className="text-gray-500 text-sm mt-1">
            Estoque, giro e cobertura por SKU e loja
            {data ? ` - giro em ${data.config.giroDias} dias, cobertura em ${data.config.coberturaMeses} meses` : ''}
          </p>
        </div>
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm font-medium text-gray-800">Painel em fase de teste</p>
        <p className="text-xs text-gray-600 mt-1">
          Custo/PDV/Mkup vêm do TOTVS (Configurações &gt; Config. Relatório PCP - escolha os códigos e sincronize) e
          podem aparecer como &quot;—&quot; pra SKUs ainda não sincronizados. Trânsito, em produção, estoque previsto/disponível,
          lançamento e última entrada ainda não têm fonte de dado. Janelas de giro/cobertura e cobertura ideal por
          loja também são ajustáveis lá.
        </p>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard title="SKUs" value={formatNumber(data?.kpis.skuCount || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Estoque Total" value={formatNumber(data?.kpis.estTt || 0)} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 1 mês" value={formatNumber(data?.kpis.giroTt1 || 0)} color="green" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 3 meses" value={formatNumber(data?.kpis.giroTt3 || 0)} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 6 meses" value={formatNumber(data?.kpis.giroTt6 || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
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
        <Input
          label="Buscar SKU/descrição"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-52"
          placeholder="Ex: 7800..."
        />
        <Select
          label="Linhas"
          value={rankingLimit}
          onChange={(e) => setRankingLimit(e.target.value as '50' | '100' | '250' | 'all')}
          options={RANKING_OPTIONS}
          className="w-48"
        />
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
        <Button variant="secondary" onClick={exportarExcel} disabled={!data || data.rows.length === 0}>
          Exportar Excel
        </Button>
      </div>

      {erro && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{erro}</p>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>SKU x Loja</CardTitle>
        </CardHeader>

        <Table tableClassName="table-fixed text-[10px] sm:text-[11px]">
          <colgroup>
            {COLUNAS_FIXAS.map((c) => (
              <col key={c.key} style={{ width: `${c.width}px` }} />
            ))}
            {colunas.flatMap((c) => [
              <col key={`${c.branchCode}-giro`} style={{ width: `${BRANCH_SUBCOL_WIDTH}px` }} />,
              <col key={`${c.branchCode}-est`} style={{ width: `${BRANCH_SUBCOL_WIDTH}px` }} />,
              <col key={`${c.branchCode}-cob`} style={{ width: `${BRANCH_SUBCOL_WIDTH}px` }} />,
            ])}
          </colgroup>
          <TableHead className="sticky top-0 z-10">
            <TableRow>
              {COLUNAS_FIXAS.map((c) => (
                <ThSortPcp
                  key={c.key}
                  label={c.label}
                  sortKeyName={c.key}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  align={c.align}
                  className={cn('!px-1.5 !py-2 whitespace-nowrap', c.sticky && 'sticky z-20 bg-gray-50')}
                  style={stickyStyleFor(c.sticky)}
                />
              ))}
              {colunas.map((c) => (
                <TableCell
                  key={c.branchCode}
                  isHeader
                  colSpan={3}
                  align="center"
                  className="bg-blue-50 text-blue-800 !px-1 !py-2 whitespace-nowrap"
                  title={c.branchCode < 0 ? 'Estoque = Fábrica inteira; Giro = só canal Atacado' : undefined}
                >
                  {c.label}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              {COLUNAS_FIXAS.map((c) => (
                <TableCell
                  key={c.key}
                  isHeader
                  className={cn('bg-gray-50 !px-1.5 !py-1', c.sticky && 'sticky z-20')}
                  style={stickyStyleFor(c.sticky)}
                />
              ))}
              {colunas.map((c) => (
                <Fragment key={c.branchCode}>
                  <ThSortPcp
                    label="GIRO"
                    sortKeyName={`branch-${c.branchCode}-giro`}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="center"
                    className="bg-blue-50/60 text-blue-800 !px-1 !py-1"
                  />
                  <ThSortPcp
                    label="EST"
                    sortKeyName={`branch-${c.branchCode}-est`}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="center"
                    className="bg-blue-50/60 text-blue-800 !px-1 !py-1"
                  />
                  <ThSortPcp
                    label="COB"
                    sortKeyName={`branch-${c.branchCode}-cob`}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="center"
                    className="bg-blue-50/60 text-blue-800 !px-1 !py-1"
                  />
                </Fragment>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={totalColunas} align="center" className="py-10 text-gray-500">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColunas} align="center" className="py-10 text-gray-500">
                  Nenhum SKU encontrado para os filtros selecionados
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row) => (
                <TableRow key={row.sku}>
                  {COLUNAS_FIXAS.map((c) => (
                    <TableCell
                      key={c.key}
                      align={c.align}
                      className={cn('!px-1.5 !py-1.5', c.sticky && 'sticky z-10 bg-white')}
                      style={stickyStyleFor(c.sticky)}
                    >
                      {c.render(row)}
                    </TableCell>
                  ))}
                  {colunas.map((c) => {
                    const dados = row.branches[c.branchCode];
                    return (
                      <Fragment key={c.branchCode}>
                        <TableCell align="right" className="!px-1 !py-1.5">
                          {formatNumber(dados?.giro ?? 0)}
                        </TableCell>
                        <TableCell align="right" className="!px-1 !py-1.5">
                          {formatNumber(dados?.est ?? 0)}
                        </TableCell>
                        <TableCell align="right" className="!px-1 !py-1.5">
                          {dados?.cob === null || dados?.cob === undefined ? '-' : dados.cob.toFixed(1)}
                        </TableCell>
                      </Fragment>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
