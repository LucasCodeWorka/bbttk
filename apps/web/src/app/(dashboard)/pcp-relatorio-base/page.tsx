'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  PcpClassificacaoDimensao,
  RelatorioBaseFiltro,
  RelatorioBaseResponse,
  RelatorioBaseCorRow,
  RelatorioBaseReferenciaRow,
  RelatorioBaseMatrizLinha,
  VisaoGeralExtrasResponse,
  relatorioBaseApi,
  visaoGeralApi,
} from '@/lib/pcpApi';
import { pcpConfigApi, PcpMetaVisaoGeral } from '@/lib/api';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { exportToCsv } from '@/lib/exportCsv';
import { exportToExcel, ExcelColumn } from '@/lib/exportExcel';

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
function giroSobreEstoque(giro: number | undefined, estoque: number | undefined): string {
  if (!estoque || estoque <= 0) return 'Venda/estoque: —';
  return `Venda/estoque: ${formatNumber(((giro || 0) / estoque) * 100, 1)}%`;
}
function formatMeses(value: number | null | undefined, decimals: number): string {
  return value === null || value === undefined ? '—' : `${formatNumber(value, decimals)} meses`;
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
const COR_WIDTH = 140;
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
  { key: 'markupVar', label: 'MKUP', width: 70, align: 'right', render: (r) => (r.markupVar === null ? '—' : formatNumber(r.markupVar)) },
  { key: 'pdvRealAta', label: 'PDV REAL (ATA)', width: 100, align: 'right', render: (r) => (r.pdvRealAta === null ? '—' : formatMoney(r.pdvRealAta)) },
  { key: 'markupAta', label: 'MKUP', width: 70, align: 'right', render: (r) => (r.markupAta === null ? '—' : formatNumber(r.markupAta)) },
  { key: 'estTt', label: 'EST. TT', width: 80, align: 'right', render: (r) => formatNumber(r.estTt) },
  { key: 'estDisponivel', label: 'EST. DISP', width: 80, align: 'right', render: () => '—' },
  { key: 'emProducao', label: 'EM PROD.', width: 80, align: 'right', render: (r) => formatNumber(r.emProducao) },
  { key: 'estPrevisto', label: 'EST. PREV', width: 80, align: 'right', render: () => '—' },
  { key: 'giroTt1', label: 'GIRO TT 1', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt1) },
  { key: 'giroTt3', label: 'GIRO TT 3', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt3) },
  { key: 'giroTt6', label: 'GIRO TT 6', width: 80, align: 'right', render: (r) => formatNumber(r.giroTt6) },
];

// Colunas do drill-down por COR (abre ao clicar na referencia). Antes era por SKU
// (cor x tamanho), mas o detalhamento por SKU foi tirado do payload por consumo de
// memoria - por cor e ~1 ordem de grandeza mais leve e, com o Agrupamento de Cores
// ligado, fica menor ainda. Quem precisa da grade por tamanho usa a Analise de Grade.
const COLUNAS_COR_DETALHE: ColunaFixa<RelatorioBaseCorRow>[] = [
  {
    key: 'cor',
    label: 'COR',
    width: COR_WIDTH,
    sticky: 'sku',
    render: (r) => (
      <span className="block">
        <span className="font-medium block">{r.cor}</span>
        <span className="text-[9px] text-gray-400">
          {r.totalSkus} {r.totalSkus === 1 ? 'SKU' : 'SKUs'}
          {r.coresOriginais > 1 ? ` · ${r.coresOriginais} cores agrupadas` : ''}
        </span>
      </span>
    ),
  },
  {
    key: 'descricao',
    label: 'DESCRIÇÃO',
    width: DESCRICAO_WIDTH,
    sticky: 'descricao',
    render: () => <span className="text-gray-400">—</span>,
  },
  { key: 'status', label: 'STATUS', width: 90, render: () => '—' },
  { key: 'codigo', label: 'CÓDIGO', width: 80, align: 'right', render: () => '—' },
  { key: 'categoria', label: 'CATEGORIA', width: 110, render: () => '—' },
  { key: 'linha', label: 'LINHA', width: 100, render: () => '—' },
  { key: 'genero', label: 'GÊNERO', width: 90, render: () => '—' },
  { key: 'modelo', label: 'MODELO', width: 100, render: () => '—' },
  { key: 'lancamento', label: 'LANÇ', width: 70, align: 'center', render: () => '—' },
  { key: 'ultimaEntrada', label: 'ÚLT. ENTRADA', width: 100, align: 'center', render: () => '—' },
  { key: 'custo', label: 'CUSTO', width: 80, align: 'right', render: (r) => (r.custo === null ? '—' : formatMoney(r.custo)) },
  { key: 'pdvAtual', label: 'PDV ATUAL', width: 90, align: 'right', render: (r) => (r.pdvRealVar === null ? '—' : formatMoney(r.pdvRealVar)) },
  { key: 'pdvRealVar', label: 'PDV REAL (VAR)', width: 100, align: 'right', render: (r) => (r.pdvRealVar === null ? '—' : formatMoney(r.pdvRealVar)) },
  {
    key: 'markupVar',
    label: 'MKUP',
    width: 70,
    align: 'right',
    render: (r) => (
      <span title="Custo da última compra vs. PDV atual/real no varejo">
        {r.markupVar === null ? '—' : formatNumber(r.markupVar)}
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
        {r.markupAta === null ? '—' : formatNumber(r.markupAta)}
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

function stickyStyleFor(sticky?: 'sku' | 'descricao', primeiraColunaWidth = SKU_WIDTH) {
  if (sticky === 'sku') return { left: 0 };
  if (sticky === 'descricao') return { left: primeiraColunaWidth };
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
  // Busca com debounce: "search" e o valor APLICADO (dispara a consulta) e
  // "searchInput" e o que o usuario esta digitando. Sem isso, cada tecla disparava um
  // relatorio completo (18-26s) e a fila do pcp-api processa um por vez - digitar uma
  // referencia inteira enfileirava mais de dez consultas.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dataPosicao, setDataPosicao] = useState('');
  const [pagina, setPagina] = useState(1);
  const [verPorLoja, setVerPorLoja] = useState(false);
  const [exportando, setExportando] = useState(false);
  // Granularidade da tabela principal. "referencia" = 1 linha por referencia (o
  // detalhe por cor abre clicando na linha); "cor"/"cor-agrupada" = a tabela em si
  // passa a ter 1 linha por referencia+cor. Antes isso era so um checkbox que mudava
  // exclusivamente o detalhe expandido - a tabela principal ficava identica, e por
  // isso parecia que o agrupamento "nao funcionava".
  const [visaoLinha, setVisaoLinha] = useState<'referencia' | 'cor' | 'cor-agrupada'>('referencia');
  // Derivado: so o modo "cor-agrupada" pede o agrupamento ao backend. Trocar entre
  // "referencia" e "cor" usa a MESMA resposta (muda so a renderizacao), evitando um
  // recarregamento de 18-26s pra algo que o cliente ja tem em maos.
  const agruparPorCorSalva = visaoLinha === 'cor-agrupada';
  const porCor = visaoLinha !== 'referencia';
  const requisicaoAtual = useRef(0);

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

  // Refs e estado para scroll sincronizado
  const tabelaScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  const carregarDados = useCallback(async (forcarRecarregar = false) => {
    if (!token) return;
    const requisicao = ++requisicaoAtual.current;
    setErro(null);

    const filtro: RelatorioBaseFiltro = {
      categoria: produtoFiltro.categoria,
      linha: produtoFiltro.linha,
      genero: produtoFiltro.genero,
      status: produtoFiltro.status,
      branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
      search: search.trim() || undefined,
      dataPosicao: dataPosicao || undefined,
      page: pagina,
      pageSize: PAGE_SIZE,
      agruparPorCorSalva,
    };

    // Gerar chave de cache baseada nos filtros (o agruparPorCorSalva entra aqui junto,
    // senao o modo agrupado reaproveitaria a resposta do modo normal)
    const cacheKey = `visao-geral-${JSON.stringify(filtro)}`;

    // Tentar carregar do cache se não for forçar recarregar
    if (!forcarRecarregar) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const { data: cachedData, timestamp } = JSON.parse(cached);
          // Cache válido por 5 minutos
          if (Date.now() - timestamp < 5 * 60 * 1000) {
            setData(cachedData);
            setIsLoading(false);
            return;
          }
        }
      } catch (e) {
        // Ignorar erros de cache
      }
    }

    setIsLoading(true);
    setErro(null);
    try {
      const response = await relatorioBaseApi.getRelatorioBase(token, filtro);
      if (requisicao !== requisicaoAtual.current) return;
      setData(response);

      // Salvar no cache
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: response,
          timestamp: Date.now()
        }));
      } catch (e) {
        // Ignorar erros ao salvar cache (ex: quota excedida)
      }
    } catch (error) {
      if (requisicao !== requisicaoAtual.current) return;
      setData(null);
      setErro(error instanceof Error ? error.message : 'Erro ao carregar o Relatorio Base');
      console.error(error);
    } finally {
      if (requisicao === requisicaoAtual.current) setIsLoading(false);
    }
  }, [token, produtoFiltro, filiaisSelecionadas, search, dataPosicao, pagina, agruparPorCorSalva]);

  // Qualquer mudanca de filtro invalida a paginacao atual - volta pra pagina 1 em vez
  // de ficar preso numa pagina que pode nem existir mais no novo resultado filtrado.
  useEffect(() => {
    setPagina(1);
  }, [produtoFiltro, filiaisSelecionadas, search, dataPosicao]);

  const carregarExtras = useCallback(async (forcarRecarregar = false) => {
    if (!token) return;

    const filtro = {
      categoria: produtoFiltro.categoria,
      linha: produtoFiltro.linha,
      genero: produtoFiltro.genero,
      status: produtoFiltro.status,
      branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
    };

    // Gerar chave de cache baseada nos filtros
    const cacheKey = `visao-geral-extras-${JSON.stringify(filtro)}`;

    // Tentar carregar do cache se não for forçar recarregar
    if (!forcarRecarregar) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const { data: cachedData, timestamp } = JSON.parse(cached);
          // Cache válido por 5 minutos
          if (Date.now() - timestamp < 5 * 60 * 1000) {
            setExtras(cachedData);
            setIsLoadingExtras(false);
            return;
          }
        }
      } catch (e) {
        // Ignorar erros de cache
      }
    }

    setIsLoadingExtras(true);
    try {
      const response = await visaoGeralApi.getVisaoGeralExtras(token, filtro);
      setExtras(response);

      // Salvar no cache
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          data: response,
          timestamp: Date.now()
        }));
      } catch (e) {
        // Ignorar erros ao salvar cache
      }
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

  // Aplica a busca so depois de meio segundo sem digitacao (ver comentario em
  // searchInput) - o setState fica dentro do timeout, nao no corpo do effect.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  useEffect(() => {
    // Espera o Relatorio Base terminar antes de acionar os indicadores extras. Antes,
    // os dois endpoints montavam relatorios grandes ao mesmo tempo no PCP API.
    if (!data || isLoading) return;
    carregarExtras();
  }, [data, isLoading, carregarExtras]);

  // Sincronizar scroll horizontal
  useEffect(() => {
    const tabela = tabelaScrollRef.current;
    const topo = topScrollRef.current;
    if (!tabela || !topo) return;

    let frame = 0;
    const atualizarLargura = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setScrollWidth(tabela.scrollWidth);
        topo.scrollLeft = tabela.scrollLeft;
      });
    };

    const sincronizarTopo = () => {
      topo.scrollLeft = tabela.scrollLeft;
    };

    tabela.addEventListener('scroll', sincronizarTopo, { passive: true });
    atualizarLargura();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(atualizarLargura) : null;
    resizeObserver?.observe(tabela);
    const tableElement = tabela.querySelector('table');
    if (tableElement) resizeObserver?.observe(tableElement);
    window.addEventListener('resize', atualizarLargura);

    return () => {
      cancelAnimationFrame(frame);
      tabela.removeEventListener('scroll', sincronizarTopo);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', atualizarLargura);
    };
  }, [data?.rows.length, isLoading, verPorLoja]);

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

  function sincronizarScrollPeloTopo() {
    const topo = topScrollRef.current;
    const tabela = tabelaScrollRef.current;
    if (!topo || !tabela) return;
    tabela.scrollLeft = topo.scrollLeft;
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

  // Nos modos por cor, achata cada referencia nas suas linhas de cor. A linha achatada
  // tem o MESMO shape da linha de referencia (identidade herdada da referencia,
  // metricas e colunas por filial vindas da cor), entao COLUNAS_REFERENCIA,
  // getSortValue e a renderizacao da tabela continuam valendo sem duplicacao - mesmo
  // principio do ItemCurva na Curva ABC e da heranca que o export Excel ja fazia.
  const linhasBase = useMemo<RelatorioBaseReferenciaRow[]>(() => {
    const refs = data?.rows || [];
    if (!porCor) return refs;

    return refs.flatMap((ref) =>
      ref.cores.map((cor) => ({
        ...ref,
        referenceCode: cor.coresOriginais > 1 ? `${cor.refCor} (${cor.coresOriginais} cores)` : cor.refCor,
        totalSkus: cor.totalSkus,
        custo: cor.custo,
        pdvAtual: cor.pdvRealVar,
        pdvRealVar: cor.pdvRealVar,
        markupVar: cor.markupVar,
        pdvRealAta: cor.pdvRealAta,
        markupAta: cor.markupAta,
        emProducao: cor.emProducao,
        estTt: cor.estTt,
        giroTt1: cor.giroTt1,
        giroTt3: cor.giroTt3,
        giroTt6: cor.giroTt6,
        branches: cor.branches,
        // Ja estamos no grao de cor: nao existe mais detalhe pra expandir nesta linha.
        cores: [],
      }))
    );
  }, [data, porCor]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return linhasBase;
    const rows = [...linhasBase];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhasBase, sortKey, sortDir]);
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
        dataPosicao: dataPosicao || undefined,
        page: 1,
        pageSize: 100000,
        agruparPorCorSalva,
      });
      const colunasExport = completo.colunas;

      // Exporta no grao referencia+cor (o detalhamento por SKU nao existe mais no
      // payload). A identidade da referencia e repetida em cada linha de cor pra
      // planilha ficar filtravel/pivotavel sem depender de celula mesclada.
      const colunas: ExcelColumn[] = [
        { key: 'referenceCode', header: 'REFERÊNCIA', width: 18, type: 'text' },
        { key: 'cor', header: 'COR', width: 18, type: 'text' },
        { key: 'coresOriginais', header: 'CORES AGRUPADAS', width: 16, type: 'number' },
        { key: 'totalSkus', header: 'SKUS', width: 8, type: 'number' },
        { key: 'descricao', header: 'DESCRIÇÃO', width: 35, type: 'text' },
        { key: 'status', header: 'STATUS', width: 12, type: 'text' },
        { key: 'categoria', header: 'CATEGORIA', width: 15, type: 'text' },
        { key: 'linha', header: 'LINHA', width: 12, type: 'text' },
        { key: 'genero', header: 'GÊNERO', width: 12, type: 'text' },
        { key: 'modelo', header: 'MODELO', width: 12, type: 'text' },
        { key: 'lancamento', header: 'LANÇ', width: 10, type: 'text' },
        { key: 'ultimaEntrada', header: 'ÚLT. ENTRADA', width: 14, type: 'text' },
        { key: 'custo', header: 'CUSTO', width: 12, type: 'number' },
        { key: 'pdvRealVar', header: 'PDV REAL VAR', width: 14, type: 'number' },
        { key: 'markupVar', header: 'MKUP VAR', width: 12, type: 'number' },
        { key: 'pdvRealAta', header: 'PDV REAL ATA', width: 14, type: 'number' },
        { key: 'markupAta', header: 'MKUP ATA', width: 12, type: 'number' },
        { key: 'estTt', header: 'EST. TT', width: 10, type: 'number' },
        { key: 'emProducao', header: 'EM PROD.', width: 10, type: 'number' },
        { key: 'giroTt1', header: 'GIRO TT 1', width: 10, type: 'number' },
        { key: 'giroTt3', header: 'GIRO TT 3', width: 10, type: 'number' },
        { key: 'giroTt6', header: 'GIRO TT 6', width: 10, type: 'number' },
      ];

      // Adicionar colunas por filial
      for (const c of colunasExport) {
        colunas.push(
          { key: `giro_${c.branchCode}`, header: `${c.label} GIRO`, width: 10, type: 'number' },
          { key: `est_${c.branchCode}`, header: `${c.label} EST`, width: 10, type: 'number' },
          { key: `cob_${c.branchCode}`, header: `${c.label} COB`, width: 10, type: 'number' },
        );
      }

      // Montar dados
      const dados = completo.rows.flatMap((ref) =>
        ref.cores.map((cor) => {
          const row: Record<string, unknown> = {
            referenceCode: ref.referenceCode,
            cor: cor.cor,
            coresOriginais: cor.coresOriginais,
            totalSkus: cor.totalSkus,
            descricao: ref.descricao,
            status: ref.status || '',
            categoria: ref.categoria || '',
            linha: ref.linha || '',
            genero: ref.genero || '',
            modelo: ref.modelo || '',
            lancamento: ref.lancamento || '',
            ultimaEntrada: ref.ultimaEntrada ? formatDate(ref.ultimaEntrada) : '',
            custo: cor.custo ?? '',
            pdvRealVar: cor.pdvRealVar ?? '',
            markupVar: cor.markupVar ?? '',
            pdvRealAta: cor.pdvRealAta ?? '',
            markupAta: cor.markupAta ?? '',
            estTt: cor.estTt,
            emProducao: cor.emProducao,
            giroTt1: cor.giroTt1,
            giroTt3: cor.giroTt3,
            giroTt6: cor.giroTt6,
          };

          for (const c of colunasExport) {
            const dadosFilial = cor.branches[c.branchCode];
            row[`giro_${c.branchCode}`] = dadosFilial?.giro ?? 0;
            row[`est_${c.branchCode}`] = dadosFilial?.est ?? 0;
            row[`cob_${c.branchCode}`] = dadosFilial?.cob ?? '';
          }

          return row;
        })
      );

      const dataHoje = new Date().toISOString().split('T')[0];
      exportToExcel({
        filename: `RelatorioBase_${dataHoje}`,
        sheetName: 'Relatório Base',
        title: `Relatório Base PCP - Estoque e Giro por Referência/Cor${agruparPorCorSalva ? ' (com Agrupamento de Cores)' : ''}`,
        columns: colunas,
        data: dados,
      });
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
          label="Buscar referência/SKU/descrição"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-52"
          placeholder="Ex: 7800..."
        />
        <Input
          label="Data"
          type="date"
          value={dataPosicao}
          onChange={(e) => setDataPosicao(e.target.value)}
          className="w-40"
        />
        {/* Granularidade da tabela. POR COR AGRUPADA é o único modo que recarrega
            (pede o agrupamento ao backend); POR REFERÊNCIA ↔ POR COR usam a mesma
            resposta e trocam na hora. */}
        <div className="pb-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Detalhar</label>
          <div className="inline-grid grid-cols-3 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
            {([
              { value: 'referencia', label: 'POR REFERÊNCIA', title: 'Uma linha por referência (clique na linha para ver as cores)' },
              { value: 'cor', label: 'POR COR', title: 'Uma linha por referência + cor original do TOTVS' },
              { value: 'cor-agrupada', label: 'POR COR AGRUPADA', title: 'Uma linha por referência + cor, juntando as cores unificadas no Agrupamento de Cores' },
            ] as const).map((opcao) => (
              <button
                key={opcao.value}
                type="button"
                title={opcao.title}
                disabled={isLoading}
                onClick={() => setVisaoLinha(opcao.value)}
                className={cn(
                  'min-w-32 px-3 py-2 text-xs font-bold',
                  opcao.value === visaoLinha
                    ? 'bg-[var(--bbtk-red)] text-white'
                    : 'text-gray-600 hover:bg-gray-50',
                  isLoading && 'cursor-not-allowed opacity-60'
                )}
              >
                {opcao.label}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={() => { carregarDados(true); }} isLoading={isLoading || isLoadingExtras}>Atualizar</Button>
        <Button variant="secondary" onClick={exportarExcel} isLoading={exportando} disabled={isLoading || !data || data.rows.length === 0}>
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
          value={isLoading || !data ? '—' : formatMeses(data.kpisExtra.coberturaGeral, 2)}
          meta={formatMeses(extras?.meta.metaCoberturaGeralMeses, 1)}
          gap={gapDe(data?.kpisExtra.coberturaGeral ?? null, extras?.meta.metaCoberturaGeralMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
        <KPIMetaCard
          title="Giro anualizado"
          value={isLoading || !data ? '—' : `${data.kpisExtra.giroAnualizado.toFixed(2)}x`}
          meta={`${extras?.meta.metaGiroAnualizado.toFixed(1) ?? '—'}x`}
          gap={gapDe(data?.kpisExtra.giroAnualizado ?? null, extras?.meta.metaGiroAnualizado ?? 0)}
          isLoading={isLoading || isLoadingExtras}
        />
        <KPICard
          title="Valor em Estoque"
          value={isLoading || !data ? '—' : formatMoney(data.kpisExtra.valorEstoqueTotal)}
          variation={data?.kpisExtra.valorEstoqueVariacaoPercent ?? undefined}
          subtitle={data ? `Custo | AA: ${formatMoney(data.kpisExtra.valorEstoqueAnoAnterior)}` : undefined}
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
          subtitle={data ? `${formatNumber(data.kpisExtra.estoqueMortoQtd)} peças | ${formatMoney(data.kpisExtra.estoqueMortoValor)}` : undefined}
          isLoading={isLoading || isLoadingExtras}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KPICard
          title="Fora de Linha em Promoção"
          value={isLoading || !data ? '—' : `${data.kpisExtra.estoquePromocaoPercent.toFixed(1)}%`}
          subtitle={
            data
              ? `${formatNumber(data.kpisExtra.estoquePromocaoQtd)} peças | ${formatMoney(data.kpisExtra.estoquePromocaoValor)}`
              : undefined
          }
          color="yellow"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPIMetaCard
          title="Cobertura Básico"
          value={isLoading || !data ? '—' : formatMeses(data.kpisExtra.coberturaBasico, 1)}
          meta={formatMeses(extras?.meta.metaCoberturaBasicoMeses, 1)}
          gap={gapDe(data?.kpisExtra.coberturaBasico ?? null, extras?.meta.metaCoberturaBasicoMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
        <KPIMetaCard
          title="Cobertura Básico Renovável"
          value={isLoading || !data ? '—' : formatMeses(data.kpisExtra.coberturaBasicoRenovavel, 1)}
          meta={formatMeses(extras?.meta.metaCoberturaBasicoMeses, 1)}
          gap={gapDe(data?.kpisExtra.coberturaBasicoRenovavel ?? null, extras?.meta.metaCoberturaBasicoMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
        <KPIMetaCard
          title="Cobertura Coleção"
          value={isLoading || !data ? '—' : formatMeses(data.kpisExtra.coberturaColecao, 1)}
          meta={formatMeses(extras?.meta.metaCoberturaColecaoMeses, 1)}
          gap={gapDe(data?.kpisExtra.coberturaColecao ?? null, extras?.meta.metaCoberturaColecaoMeses ?? 0)}
          invertido
          isLoading={isLoading || isLoadingExtras}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICard title="SKUs" value={formatNumber(data?.kpis.skuCount || 0)} color="red" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Estoque Total" value={formatNumber(data?.kpis.estTt || 0)} color="blue" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Referências com Estoque" value={formatNumber(data?.kpisExtra.referenciasComEstoque || 0)} color="purple" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 30 dias" value={formatNumber(data?.kpis.giroTt30 || 0)} subtitle={giroSobreEstoque(data?.kpis.giroTt30, data?.kpis.estTt)} color="green" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 60 dias" value={formatNumber(data?.kpis.giroTt60 || 0)} subtitle={giroSobreEstoque(data?.kpis.giroTt60, data?.kpis.estTt)} color="yellow" valueSize="sm" isLoading={isLoading} />
        <KPICard title="Giro TT 90 dias" value={formatNumber(data?.kpis.giroTt90 || 0)} subtitle={giroSobreEstoque(data?.kpis.giroTt90, data?.kpis.estTt)} color="purple" valueSize="sm" isLoading={isLoading} />
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

      <LoadingOverlay active={isLoading}>
      <Card>
        <CardHeader>
          <CardTitle>{porCor ? 'Referência + Cor x Loja' : 'SKU x Loja'}</CardTitle>
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
                  {porCor && ` · ${formatNumber(sortedRows.length)} linhas de cor nesta página`}
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

        <div
          ref={topScrollRef}
          onScroll={sincronizarScrollPeloTopo}
          className="mb-2 overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: scrollWidth || '100%', height: 1 }} />
        </div>

        <div ref={tabelaScrollRef} className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
            {/* Primeiro load (sem nada na tela) avisa no corpo; recarregamento fica
                sob o LoadingOverlay, preservando a linha expandida na tela. */}
            {isLoading && sortedRows.length === 0 ? (
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
                // Nos modos por cor a tabela ja esta no grao de cor: nao ha detalhe
                // pra abrir, entao a linha nao e clicavel nem mostra a seta.
                const expandida = !porCor && referenciaExpandida === row.referenceCode;
                return (
                  <Fragment key={row.referenceCode}>
                    <TableRow
                      className={porCor ? undefined : 'cursor-pointer hover:bg-gray-50'}
                      onClick={porCor ? undefined : () => setReferenciaExpandida(expandida ? null : row.referenceCode)}
                    >
                      {COLUNAS_REFERENCIA.map((c, idx) => (
                        <TableCell
                          key={c.key}
                          align={c.align}
                          className={cn('!px-2.5 !py-2', zonaBg(c.key) || (c.sticky ? 'bg-white' : ''), c.sticky && 'sticky z-10')}
                          style={stickyStyleFor(c.sticky)}
                        >
                          {idx === 0 && !porCor && <span className="mr-1 text-gray-400">{expandida ? '▼' : '▶'}</span>}
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
                                {COLUNAS_COR_DETALHE.map((c) => (
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
                                  {COLUNAS_COR_DETALHE.map((c) => (
                                    <TableCell
                                      key={c.key}
                                      isHeader
                                      align={c.align}
                                      className={cn('!px-2.5 !py-2 whitespace-nowrap', zonaBg(c.key) || 'bg-gray-100', c.sticky && 'sticky z-20')}
                                      style={stickyStyleFor(c.sticky, COR_WIDTH)}
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
                                {row.cores.map((cor) => (
                                  <TableRow key={cor.cor}>
                                    {COLUNAS_COR_DETALHE.map((c) => (
                                      <TableCell
                                        key={c.key}
                                        align={c.align}
                                        className={cn('!px-2.5 !py-2', zonaBg(c.key) || (c.sticky ? 'bg-white' : ''), c.sticky && 'sticky z-10')}
                                        style={stickyStyleFor(c.sticky, COR_WIDTH)}
                                      >
                                        {c.render(cor)}
                                      </TableCell>
                                    ))}
                                    {colunas.map((c) => {
                                      const dados = cor.branches[c.branchCode];
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
        </div>
      </Card>
      </LoadingOverlay>

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
