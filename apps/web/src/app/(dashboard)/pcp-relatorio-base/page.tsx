'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { KPIMetaCard } from '@/components/dashboard/KPIMetaCard';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  PcpClassificacaoDimensao,
  RelatorioBaseFiltro,
  RelatorioBaseResponse,
  RelatorioBaseRow,
  RelatorioBaseReferenciaRow,
  RelatorioBaseMatrizLinha,
  VisaoGeralExtrasResponse,
  relatorioBaseApi,
  visaoGeralApi,
} from '@/lib/pcpApi';
import { pcpConfigApi, PcpMetaVisaoGeral } from '@/lib/api';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { exportToCsv } from '@/lib/exportCsv';

const DIMENSAO_OPTIONS = [
  { value: 'linha', label: 'Por linha (Básico/Coleção)' },
  { value: 'categoria', label: 'Por categoria' },
  { value: 'genero', label: 'Por gênero' },
];

function gapDe(valor: number | null, meta: number): number {
  return valor === null ? 0 : round1(valor - meta);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function MatrizTable({ linhas }: { linhas: RelatorioBaseMatrizLinha[] }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell isHeader>Linha</TableCell>
          <TableCell isHeader align="right">Est. Varejo</TableCell>
          <TableCell isHeader align="right">Est. Atacado</TableCell>
          <TableCell isHeader align="right">Est. Total</TableCell>
          <TableCell isHeader align="right">Valor em Estoque</TableCell>
          <TableCell isHeader align="right">Cob. Varejo</TableCell>
          <TableCell isHeader align="right">Cob. Atacado</TableCell>
          <TableCell isHeader align="right">Cob. Geral</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {linhas.map((linha) => (
          <TableRow key={linha.label} isHighlighted={linha.label === 'Total'}>
            <TableCell>{linha.label}</TableCell>
            <TableCell align="right">{formatNumber(linha.estoqueVarejo)}</TableCell>
            <TableCell align="right">{formatNumber(linha.estoqueAtacado)}</TableCell>
            <TableCell align="right">{formatNumber(linha.estoqueTotal)}</TableCell>
            <TableCell align="right">{formatMoney(linha.valorEstoque)}</TableCell>
            <TableCell align="right">{linha.coberturaVarejo === null ? '—' : `${linha.coberturaVarejo.toFixed(1)}m`}</TableCell>
            <TableCell align="right">{linha.coberturaAtacado === null ? '—' : `${linha.coberturaAtacado.toFixed(1)}m`}</TableCell>
            <TableCell align="right">{linha.coberturaGeral === null ? '—' : `${linha.coberturaGeral.toFixed(1)}m`}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

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

const PAGE_SIZE = 15;

// Largura fixa em px de cada coluna "de identidade" (nao-filial) - tabela e larga
// demais pra usar %, precisa de largura fixa + scroll horizontal.
const SKU_WIDTH = 100;
const DESCRICAO_WIDTH = 200;

interface ColunaFixa<T> {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  sticky?: 'sku' | 'descricao';
  render: (row: T) => React.ReactNode;
}

// Colunas da tabela PRINCIPAL - 1 linha por REFERENCIA (agregando cores/tamanhos).
// Custo/PDV/Markup mostram um valor real quando TODOS os SKUs da referencia concordam
// (comum - preco/custo e por referencia, nao por cor/tamanho) - fica "—" so quando
// diverge entre os SKUs (ver drill-down). Codigo sempre "—" (cada SKU tem o seu).
const COLUNAS_REFERENCIA: ColunaFixa<RelatorioBaseReferenciaRow>[] = [
  { key: 'sku', label: 'REFERÊNCIA', width: SKU_WIDTH, sticky: 'sku', render: (r) => r.referenceCode },
  {
    key: 'descricao',
    label: 'DESCRIÇÃO',
    width: DESCRICAO_WIDTH,
    sticky: 'descricao',
    render: (r) => (
      <span className="block" title={r.descricaoCompleta}>
        <span className="truncate block">{r.descricao}</span>
        <span className="text-[9px] text-gray-400">{r.totalSkus} SKU{r.totalSkus === 1 ? '' : 's'}</span>
      </span>
    ),
  },
  { key: 'status', label: 'STATUS', width: 90, render: (r) => r.status || '-' },
  { key: 'codigo', label: 'CÓDIGO', width: 80, align: 'right', render: () => '—' },
  { key: 'categoria', label: 'CATEGORIA', width: 110, render: (r) => r.categoria || '-' },
  { key: 'linha', label: 'LINHA', width: 100, render: (r) => r.linha || '-' },
  { key: 'genero', label: 'GÊNERO', width: 90, render: (r) => r.genero || '-' },
  { key: 'modelo', label: 'MODELO', width: 100, render: (r) => r.modelo || '-' },
  { key: 'lancamento', label: 'LANÇ', width: 70, align: 'center', render: (r) => r.lancamento || '—' },
  { key: 'ultimaEntrada', label: 'ÚLT. ENTRADA', width: 100, align: 'center', render: (r) => (r.ultimaEntrada ? formatDate(r.ultimaEntrada) : '—') },
  { key: 'custo', label: 'CUSTO', width: 80, align: 'right', render: (r) => (r.custo === null ? '—' : formatMoney(r.custo)) },
  { key: 'pdvAtual', label: 'PDV ATUAL', width: 90, align: 'right', render: (r) => (r.pdvAtual === null ? '—' : formatMoney(r.pdvAtual)) },
  { key: 'pdvRealVar', label: 'PDV REAL (VAR)', width: 100, align: 'right', render: (r) => (r.pdvRealVar === null ? '—' : formatMoney(r.pdvRealVar)) },
  { key: 'markupVar', label: 'MKUP', width: 70, align: 'right', render: (r) => (r.markupVar === null ? '—' : `${r.markupVar.toFixed(0)}%`) },
  { key: 'pdvRealAta', label: 'PDV REAL (ATA)', width: 100, align: 'right', render: (r) => (r.pdvRealAta === null ? '—' : formatMoney(r.pdvRealAta)) },
  { key: 'markupAta', label: 'MKUP', width: 70, align: 'right', render: (r) => (r.markupAta === null ? '—' : `${r.markupAta.toFixed(0)}%`) },
  { key: 'estTt', label: 'EST. TT', width: 80, align: 'right', render: (r) => formatNumber(r.estTt) },
  { key: 'estDisponivel', label: 'EST. DISP', width: 80, align: 'right', render: () => '—' },
  { key: 'emProducao', label: 'EM PROD.', width: 80, align: 'right', render: (r) => formatNumber(r.emProducao) },
  { key: 'estPrevisto', label: 'EST. PREV', width: 80, align: 'right', render: () => '—' },
  { key: 'giroTt1', label: 'GIRO TT 1', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt1) },
  { key: 'giroTt3', label: 'GIRO TT 3', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt3) },
  { key: 'giroTt6', label: 'GIRO TT 6', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt6) },
];

// Colunas do drill-down por SKU (abre ao clicar na referencia) - a identidade em
// destaque aqui e Cor/Tamanho, nao o codigo do SKU (que fica pequeno/secundario
// embaixo) - pedido explicito do usuario, mesmo padrao ja usado na Curva ABC "por SKU".
const COLUNAS_SKU_DETALHE: ColunaFixa<RelatorioBaseRow>[] = [
  {
    key: 'sku',
    label: 'COR / TAMANHO',
    width: SKU_WIDTH + 40,
    sticky: 'sku',
    render: (r) => (
      <span className="block">
        <span className="font-medium block">{r.cor} - {r.tamanho}</span>
        <span className="text-[9px] text-gray-400">{r.sku}</span>
      </span>
    ),
  },
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
  { key: 'pdvAtual', label: 'PDV ATUAL', width: 90, align: 'right', render: (r) => (r.pdvAtual === null ? '—' : formatMoney(r.pdvAtual)) },
  { key: 'pdvRealVar', label: 'PDV REAL (VAR)', width: 100, align: 'right', render: (r) => (r.pdvRealVar === null ? '—' : formatMoney(r.pdvRealVar)) },
  {
    key: 'markupVar',
    label: 'MKUP',
    width: 70,
    align: 'right',
    render: (r) => (
      <span title="Custo da última compra vs. PDV atual/real no varejo">
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
      <span title="Custo da última compra vs. PDV atual/real no atacado">
        {r.markupAta === null ? '—' : `${r.markupAta.toFixed(0)}%`}
      </span>
    ),
  },
  { key: 'estTt', label: 'EST. TT', width: 80, align: 'right', render: (r) => formatNumber(r.estTt) },
  { key: 'estDisponivel', label: 'EST. DISP', width: 80, align: 'right', render: () => '—' },
  { key: 'emProducao', label: 'EM PROD.', width: 80, align: 'right', render: (r) => formatNumber(r.emProducao) },
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

// Faixas de fundo pra separar visualmente os grupos de coluna, pedido do usuario:
// identidade/classificacao (ate LANÇ) em azul clarinho, precificacao (ate os dois MKUP)
// em verde clarinho - mesmo par de cores ja usado nos badges do resto do app.
const ZONA_AZUL_KEYS = new Set(['sku', 'descricao', 'status', 'codigo', 'categoria', 'linha', 'genero', 'modelo', 'lancamento']);
const ZONA_VERDE_KEYS = new Set(['ultimaEntrada', 'custo', 'pdvAtual', 'pdvRealVar', 'markupVar', 'pdvRealAta', 'markupAta']);

function zonaBg(key: string): string {
  if (ZONA_AZUL_KEYS.has(key)) return 'bg-blue-50';
  if (ZONA_VERDE_KEYS.has(key)) return 'bg-green-50';
  return '';
}

export default function PcpRelatorioBasePage() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [colunasDisponiveis, setColunasDisponiveis] = useState<{ branchCode: number; label: string }[]>([]);

  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [pagina, setPagina] = useState(1);
  const [verPorLoja, setVerPorLoja] = useState(false);
  const [exportando, setExportando] = useState(false);

  const [data, setData] = useState<RelatorioBaseResponse | null>(null);
  const [sortKey, setSortKey] = useState<string | null>('giroTt3');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [referenciaExpandida, setReferenciaExpandida] = useState<string | null>(null);

  // Indicadores extra (Analise de Grade/Estoque Sem Giro/Curva ABC) - carregados em
  // paralelo com a tabela, loading proprio pra um nao travar o outro.
  const [extras, setExtras] = useState<VisaoGeralExtrasResponse | null>(null);
  const [isLoadingExtras, setIsLoadingExtras] = useState(true);
  const [dimensao, setDimensao] = useState<'linha' | 'categoria' | 'genero'>('linha');

  const [metaModalAberto, setMetaModalAberto] = useState(false);
  const [meta, setMeta] = useState<PcpMetaVisaoGeral | null>(null);
  const [salvandoMeta, setSalvandoMeta] = useState(false);

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
        page: pagina,
        pageSize: PAGE_SIZE,
      };
      const response = await relatorioBaseApi.getRelatorioBase(token, filtro);
      setData(response);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao carregar o Relatorio Base');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, produtoFiltro, filiaisSelecionadas, search, pagina]);

  // Qualquer mudanca de filtro invalida a paginacao atual - volta pra pagina 1 em vez
  // de ficar preso numa pagina que pode nem existir mais no novo resultado filtrado.
  useEffect(() => {
    setPagina(1);
  }, [produtoFiltro, filiaisSelecionadas, search]);

  const carregarExtras = useCallback(async () => {
    if (!token) return;
    setIsLoadingExtras(true);
    try {
      const response = await visaoGeralApi.getVisaoGeralExtras(token, {
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
        branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
      });
      setExtras(response);
    } catch (error) {
      console.error('Erro ao carregar indicadores extra da Visao Geral:', error);
    } finally {
      setIsLoadingExtras(false);
    }
  }, [token, produtoFiltro, filiaisSelecionadas]);

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

  useEffect(() => {
    carregarExtras();
  }, [carregarExtras]);

  async function abrirEdicaoMetas() {
    if (!token) return;
    try {
      const res = await pcpConfigApi.getMetaVisaoGeral(token);
      setMeta(res.meta);
      setMetaModalAberto(true);
    } catch (error) {
      showToast('Erro ao carregar metas', 'error');
      console.error(error);
    }
  }

  async function salvarMetas() {
    if (!token || !meta) return;
    setSalvandoMeta(true);
    try {
      await pcpConfigApi.updateMetaVisaoGeral(token, meta);
      showToast('Metas salvas!', 'success');
      setMetaModalAberto(false);
      carregarExtras();
    } catch (error) {
      showToast('Erro ao salvar metas', 'error');
      console.error(error);
    } finally {
      setSalvandoMeta(false);
    }
  }

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

  function getSortValue(row: RelatorioBaseReferenciaRow, key: string): string | number {
    // Fixed columns
    if (key === 'sku') return row.referenceCode || '';
    if (key === 'descricao') return row.descricao || '';
    if (key === 'status') return row.status || '';
    if (key === 'codigo') return -1;
    if (key === 'categoria') return row.categoria || '';
    if (key === 'linha') return row.linha || '';
    if (key === 'genero') return row.genero || '';
    if (key === 'modelo') return row.modelo || '';
    if (key === 'lancamento') return row.lancamento || '';
    if (key === 'ultimaEntrada') return row.ultimaEntrada || '';
    if (key === 'custo') return row.custo ?? -1;
    if (key === 'pdvAtual') return row.pdvAtual ?? -1;
    if (key === 'pdvRealVar') return row.pdvRealVar ?? -1;
    if (key === 'markupVar') return row.markupVar ?? -1;
    if (key === 'pdvRealAta') return row.pdvRealAta ?? -1;
    if (key === 'markupAta') return row.markupAta ?? -1;
    if (key === 'estTt') return row.estTt || 0;
    if (key === 'estDisponivel') return 0;
    if (key === 'emProducao') return row.emProducao || 0;
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

  // "Ver por loja" e opcional (padrao desligado, pedido do usuario) - quando desligado
  // as colunas de filial nem entram no colgroup/header/corpo da tabela.
  const colunas = verPorLoja ? data?.colunas || [] : [];

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
  const totalColunas = COLUNAS_REFERENCIA.length + colunas.length * 3;

  // Cobertura fora da faixa saudavel (mesmos limites configurados no Configurador,
  // ja usados no Raio-X) pinta a celula - verde = cobertura baixa (gira rapido),
  // vermelho = cobertura alta (estoque parado). Giro zerado com estoque positivo
  // tambem entra em vermelho (nao girou nada naquela loja apesar de ter peca).
  function corCobertura(cobertura: number | null | undefined): string {
    if (cobertura === null || cobertura === undefined || !data) return '';
    if (cobertura <= data.config.coberturaLimiteVerde) return 'bg-green-50 text-green-700';
    if (cobertura >= data.config.coberturaLimiteVermelho) return 'bg-red-50 text-red-700';
    return '';
  }
  function corGiro(giro: number | undefined, est: number | undefined): string {
    if ((giro ?? 0) === 0 && (est ?? 0) > 0) return 'text-red-600 font-semibold';
    return '';
  }

  // Exportar sempre traz o universo INTEIRO filtrado (nao so a pagina atual na tela) -
  // busca dedicada com pageSize bem grande, independente da paginacao visual.
  async function exportarExcel() {
    if (!token) return;
    setExportando(true);
    try {
      const completo = await relatorioBaseApi.getRelatorioBase(token, {
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
        branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
        search: search.trim() || undefined,
        page: 1,
        pageSize: 100000,
      });
      const colunasExport = completo.colunas;
      const skuRows = completo.rows.flatMap((r) => r.skus);
      const columns = [
        ...COLUNAS_SKU_DETALHE.map((c) => ({
          header: c.label,
          value: (r: RelatorioBaseRow) => {
            const rendered = c.render(r);
            return typeof rendered === 'string' || typeof rendered === 'number' ? rendered : (r as any)[c.key] ?? '-';
          },
        })),
        ...colunasExport.flatMap((c) => [
          { header: `${c.label} - GIRO`, value: (r: RelatorioBaseRow) => r.branches[c.branchCode]?.giro ?? 0 },
          { header: `${c.label} - EST`, value: (r: RelatorioBaseRow) => r.branches[c.branchCode]?.est ?? 0 },
          { header: `${c.label} - COB`, value: (r: RelatorioBaseRow) => r.branches[c.branchCode]?.cob ?? '' },
        ]),
      ];
      exportToCsv('relatorio-base-pcp', columns, skuRows);
    } catch (error) {
      showToast('Erro ao exportar Excel', 'error');
      console.error(error);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Visão Geral</h1>
          <p className="text-gray-500 text-sm mt-1">
            Estoque, giro, cobertura e indicadores executivos da rede
            {data ? ` - giro em ${data.config.giroDias} dias, cobertura em ${data.config.coberturaMeses} meses` : ''}
          </p>
        </div>
        {user?.role === 'admin' && (
          <Button variant="secondary" size="sm" onClick={abrirEdicaoMetas}>
            Editar metas
          </Button>
        )}
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm font-medium text-gray-800">Painel em fase de teste</p>
        <p className="text-xs text-gray-600 mt-1">
          Custo/PDV/Mkup vêm do TOTVS (Configurações &gt; Config. Relatório PCP - escolha os códigos e sincronize) e
          podem aparecer como &quot;—&quot; pra SKUs ainda não sincronizados. &quot;PDV Atual&quot; usa o mesmo valor
          do PDV Real (Varejo). &quot;Em Produção&quot; também precisa ser sincronizado lá (Ordens de Produção
          abertas no TOTVS). Estoque previsto/disponível, lançamento e última entrada ainda não têm fonte de dado.
          Janelas de giro/cobertura e cobertura ideal por loja também são ajustáveis lá. &quot;Estoque morto&quot; usa
          o status do TOTVS (qualquer variante de &quot;FORA DE LINHA&quot;), não dias sem venda. Sem histórico
          mensal ainda - os cards mostram só o valor atual, não uma série ao longo do tempo.
        </p>
      </Card>

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
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
        <Button variant="secondary" onClick={exportarExcel} isLoading={exportando} disabled={!data || data.rows.length === 0}>
          Exportar Excel
        </Button>
      </div>

      {erro && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{erro}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KPIMetaCard
          title="Cobertura geral"
          value={isLoading || !data ? '—' : `${data.kpisExtra.coberturaGeral?.toFixed(1) ?? '—'} meses`}
          meta={`${extras?.meta.metaCoberturaGeralMeses.toFixed(1) ?? '—'} meses`}
          gap={gapDe(data?.kpisExtra.coberturaGeral ?? null, extras?.meta.metaCoberturaGeralMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
        <KPIMetaCard
          title="Giro anualizado"
          value={isLoading || !data ? '—' : `${data.kpisExtra.giroAnualizado.toFixed(1)}x`}
          meta={`${extras?.meta.metaGiroAnualizado.toFixed(1) ?? '—'}x`}
          gap={gapDe(data?.kpisExtra.giroAnualizado ?? null, extras?.meta.metaGiroAnualizado ?? 0)}
          isLoading={isLoading || isLoadingExtras}
        />
        <KPICard
          title="Valor em Estoque"
          value={isLoading || !data ? '—' : formatMoney(data.kpisExtra.valorEstoqueTotal)}
          color="blue"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPIMetaCard
          title="Estoque morto (Fora de Linha)"
          value={isLoading || !data ? '—' : `${data.kpisExtra.estoqueMortoPercent.toFixed(1)}%`}
          meta={`${extras?.meta.metaEstoqueMortoPercent.toFixed(1) ?? '—'}%`}
          gap={gapDe(data?.kpisExtra.estoqueMortoPercent ?? null, extras?.meta.metaEstoqueMortoPercent ?? 0)}
          invertido
          subtitle={data ? `${formatMoney(data.kpisExtra.estoqueMortoValor)} parados` : undefined}
          isLoading={isLoading || isLoadingExtras}
        />
        <KPIMetaCard
          title="Cobertura Básico"
          value={isLoading || !data ? '—' : `${data.kpisExtra.coberturaBasico?.toFixed(1) ?? '—'} meses`}
          meta={`${extras?.meta.metaCoberturaBasicoMeses.toFixed(1) ?? '—'} meses`}
          gap={gapDe(data?.kpisExtra.coberturaBasico ?? null, extras?.meta.metaCoberturaBasicoMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
        <KPIMetaCard
          title="Cobertura Básico Renovável"
          value={isLoading || !data ? '—' : `${data.kpisExtra.coberturaBasicoRenovavel?.toFixed(1) ?? '—'} meses`}
          meta={`${extras?.meta.metaCoberturaBasicoMeses.toFixed(1) ?? '—'} meses`}
          gap={gapDe(data?.kpisExtra.coberturaBasicoRenovavel ?? null, extras?.meta.metaCoberturaBasicoMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
        <KPIMetaCard
          title="Cobertura Coleção"
          value={isLoading || !data ? '—' : `${data.kpisExtra.coberturaColecao?.toFixed(1) ?? '—'} meses`}
          meta={`${extras?.meta.metaCoberturaColecaoMeses.toFixed(1) ?? '—'} meses`}
          gap={gapDe(data?.kpisExtra.coberturaColecao ?? null, extras?.meta.metaCoberturaColecaoMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
        <KPICard
          title="Referências com Estoque"
          value={formatNumber(data?.kpisExtra.referenciasComEstoque || 0)}
          color="purple"
          valueSize="md"
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard title="SKUs" value={formatNumber(data?.kpis.skuCount || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Estoque Total" value={formatNumber(data?.kpis.estTt || 0)} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 1 mês" value={formatNumber(data?.kpis.giroTt1 || 0)} color="green" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 3 meses" value={formatNumber(data?.kpis.giroTt3 || 0)} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 6 meses" value={formatNumber(data?.kpis.giroTt6 || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard
          title={`SKUs em risco${extras ? ` (${extras.skusEmRisco.skusEmRiscoTotal}/${extras.skusEmRisco.totalSkus})` : ''}`}
          value={isLoadingExtras || !extras ? '—' : `${extras.skusEmRisco.percent.toFixed(1)}%`}
          color="yellow"
          valueSize="md"
          isLoading={isLoadingExtras}
        />
        <KPICard
          title="Referências críticas"
          value={formatNumber(extras?.skusEmRisco.referenciasCriticas || 0)}
          color="red"
          valueSize="md"
          isLoading={isLoadingExtras}
        />
        <KPICard
          title={`Estoque sem giro 90+ dias${extras ? ` (${formatNumber(extras.estoqueSemGiro.find((r) => r.dias === 91)?.sku_count || 0)} SKUs)` : ''}`}
          value={
            isLoadingExtras || !extras
              ? '—'
              : formatMoney(extras.estoqueSemGiro.find((r) => r.dias === 91)?.valor || 0)
          }
          color="purple"
          valueSize="md"
          isLoading={isLoadingExtras}
        />
        <KPICard
          title="Curva A (% do valor vendido)"
          value={
            isLoadingExtras || !extras
              ? '—'
              : `${extras.curvaAbc.find((c) => c.curva === 'A')?.percentDoTotal.toFixed(1) ?? 0}%`
          }
          color="green"
          valueSize="md"
          isLoading={isLoadingExtras}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cobertura por linha/categoria/gênero × canal</CardTitle>
          <Select
            value={dimensao}
            onChange={(e) => setDimensao(e.target.value as 'linha' | 'categoria' | 'genero')}
            options={DIMENSAO_OPTIONS}
            className="w-64"
          />
        </CardHeader>
        {isLoading || !data ? (
          <p className="text-sm text-gray-500 py-8 text-center">Carregando...</p>
        ) : (
          <MatrizTable linhas={data.matriz[dimensao]} />
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SKU x Loja</CardTitle>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={verPorLoja}
                onChange={(e) => setVerPorLoja(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[var(--bbtk-purple)] focus:ring-[var(--bbtk-purple)]"
              />
              Ver por loja
            </label>
            {data && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={isLoading || data.pagination.page <= 1}
                >
                  ‹ Anterior
                </Button>
                <span className="whitespace-nowrap">
                  Página {data.pagination.page} de {data.pagination.totalPages} · {formatNumber(data.pagination.totalReferencias)} referências
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagina((p) => Math.min(data.pagination.totalPages, p + 1))}
                  disabled={isLoading || data.pagination.page >= data.pagination.totalPages}
                >
                  Próxima ›
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <Table tableClassName="table-fixed text-xs">
          <colgroup>
            {COLUNAS_REFERENCIA.map((c) => (
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
              {COLUNAS_REFERENCIA.map((c) => (
                <ThSortPcp
                  key={c.key}
                  label={c.label}
                  sortKeyName={c.key}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  align={c.align}
                  className={cn('!px-2.5 !py-2.5 whitespace-nowrap', zonaBg(c.key) || (c.sticky ? 'bg-gray-50' : ''), c.sticky && 'sticky z-20')}
                  style={stickyStyleFor(c.sticky)}
                />
              ))}
              {colunas.map((c) => (
                <TableCell
                  key={c.branchCode}
                  isHeader
                  colSpan={3}
                  align="center"
                  className="bg-blue-50 text-blue-800 !px-1.5 !py-2.5 whitespace-nowrap"
                  title={c.branchCode < 0 ? 'Estoque = Fábrica inteira; Giro = só canal Atacado' : undefined}
                >
                  {c.label}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              {COLUNAS_REFERENCIA.map((c) => (
                <TableCell
                  key={c.key}
                  isHeader
                  className={cn(zonaBg(c.key) || 'bg-gray-50', '!px-2.5 !py-1.5', c.sticky && 'sticky z-20')}
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
                    className="bg-blue-50/60 text-blue-800 !px-1.5 !py-1.5"
                  />
                  <ThSortPcp
                    label="EST"
                    sortKeyName={`branch-${c.branchCode}-est`}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="center"
                    className="bg-blue-50/60 text-blue-800 !px-1.5 !py-1.5"
                  />
                  <ThSortPcp
                    label="COB"
                    sortKeyName={`branch-${c.branchCode}-cob`}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    align="center"
                    className="bg-blue-50/60 text-blue-800 !px-1.5 !py-1.5"
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
              sortedRows.map((row) => {
                const expandida = referenciaExpandida === row.referenceCode;
                return (
                  <Fragment key={row.referenceCode}>
                    <TableRow
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setReferenciaExpandida(expandida ? null : row.referenceCode)}
                    >
                      {COLUNAS_REFERENCIA.map((c, idx) => (
                        <TableCell
                          key={c.key}
                          align={c.align}
                          className={cn('!px-2.5 !py-2', zonaBg(c.key) || (c.sticky ? 'bg-white' : ''), c.sticky && 'sticky z-10')}
                          style={stickyStyleFor(c.sticky)}
                        >
                          {idx === 0 && <span className="mr-1 text-gray-400">{expandida ? '▼' : '▶'}</span>}
                          {c.render(row)}
                        </TableCell>
                      ))}
                      {colunas.map((c) => {
                        const dados = row.branches[c.branchCode];
                        return (
                          <Fragment key={c.branchCode}>
                            <TableCell align="right" className={cn('!px-1.5 !py-2', corGiro(dados?.giro, dados?.est))}>
                              {formatNumber(dados?.giro ?? 0)}
                            </TableCell>
                            <TableCell align="right" className="!px-1.5 !py-2">
                              {formatNumber(dados?.est ?? 0)}
                            </TableCell>
                            <TableCell align="right" className={cn('!px-1.5 !py-2', corCobertura(dados?.cob))}>
                              {dados?.cob === null || dados?.cob === undefined ? '-' : dados.cob.toFixed(1)}
                            </TableCell>
                          </Fragment>
                        );
                      })}
                    </TableRow>
                    {expandida && (
                      <TableRow>
                        <TableCell colSpan={totalColunas} className="!p-0 bg-gray-50/60">
                          <div className="p-2">
                            <Table tableClassName="table-fixed text-xs">
                              <colgroup>
                                {COLUNAS_SKU_DETALHE.map((c) => (
                                  <col key={c.key} style={{ width: `${c.width}px` }} />
                                ))}
                                {colunas.flatMap((c) => [
                                  <col key={`${c.branchCode}-giro`} style={{ width: `${BRANCH_SUBCOL_WIDTH}px` }} />,
                                  <col key={`${c.branchCode}-est`} style={{ width: `${BRANCH_SUBCOL_WIDTH}px` }} />,
                                  <col key={`${c.branchCode}-cob`} style={{ width: `${BRANCH_SUBCOL_WIDTH}px` }} />,
                                ])}
                              </colgroup>
                              <TableHead>
                                <TableRow>
                                  {COLUNAS_SKU_DETALHE.map((c) => (
                                    <TableCell
                                      key={c.key}
                                      isHeader
                                      align={c.align}
                                      className={cn('!px-2.5 !py-2 whitespace-nowrap', zonaBg(c.key) || 'bg-gray-100', c.sticky && 'sticky z-20')}
                                      style={stickyStyleFor(c.sticky)}
                                    >
                                      {c.label}
                                    </TableCell>
                                  ))}
                                  {colunas.map((c) => (
                                    <TableCell
                                      key={c.branchCode}
                                      isHeader
                                      colSpan={3}
                                      align="center"
                                      className="bg-blue-50 text-blue-800 !px-1.5 !py-2 whitespace-nowrap"
                                    >
                                      {c.label}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {row.skus.map((sku) => (
                                  <TableRow key={sku.sku}>
                                    {COLUNAS_SKU_DETALHE.map((c) => (
                                      <TableCell
                                        key={c.key}
                                        align={c.align}
                                        className={cn('!px-2.5 !py-2', zonaBg(c.key) || (c.sticky ? 'bg-white' : ''), c.sticky && 'sticky z-10')}
                                        style={stickyStyleFor(c.sticky)}
                                      >
                                        {c.render(sku)}
                                      </TableCell>
                                    ))}
                                    {colunas.map((c) => {
                                      const dados = sku.branches[c.branchCode];
                                      return (
                                        <Fragment key={c.branchCode}>
                                          <TableCell align="right" className={cn('!px-1.5 !py-2', corGiro(dados?.giro, dados?.est))}>
                                            {formatNumber(dados?.giro ?? 0)}
                                          </TableCell>
                                          <TableCell align="right" className="!px-1.5 !py-2">
                                            {formatNumber(dados?.est ?? 0)}
                                          </TableCell>
                                          <TableCell align="right" className={cn('!px-1.5 !py-2', corCobertura(dados?.cob))}>
                                            {dados?.cob === null || dados?.cob === undefined ? '-' : dados.cob.toFixed(1)}
                                          </TableCell>
                                        </Fragment>
                                      );
                                    })}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <Modal isOpen={metaModalAberto} onClose={() => setMetaModalAberto(false)} title="Editar metas da Visão Geral" size="md">
        {meta && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Meta cobertura geral (meses)"
                type="number"
                step="0.1"
                value={meta.metaCoberturaGeralMeses}
                onChange={(e) => setMeta({ ...meta, metaCoberturaGeralMeses: Number(e.target.value) })}
              />
              <Input
                label="Meta giro anualizado (x)"
                type="number"
                step="0.1"
                value={meta.metaGiroAnualizado}
                onChange={(e) => setMeta({ ...meta, metaGiroAnualizado: Number(e.target.value) })}
              />
              <Input
                label="Meta estoque morto (%)"
                type="number"
                step="0.1"
                value={meta.metaEstoqueMortoPercent}
                onChange={(e) => setMeta({ ...meta, metaEstoqueMortoPercent: Number(e.target.value) })}
              />
              <Input
                label="Meta cobertura Básico/Renovável (meses)"
                type="number"
                step="0.1"
                value={meta.metaCoberturaBasicoMeses}
                onChange={(e) => setMeta({ ...meta, metaCoberturaBasicoMeses: Number(e.target.value) })}
              />
              <Input
                label="Meta cobertura Coleção (meses)"
                type="number"
                step="0.1"
                value={meta.metaCoberturaColecaoMeses}
                onChange={(e) => setMeta({ ...meta, metaCoberturaColecaoMeses: Number(e.target.value) })}
              />
            </div>
            <p className="text-xs text-gray-400">
              &quot;Meta cobertura Básico/Renovável&quot; vale pros dois cards (Básico e Básico Renovável) - ainda não
              tem meta independente por linha.
            </p>
            <div className="flex justify-end pt-2 border-t">
              <Button onClick={salvarMetas} isLoading={salvandoMeta}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
