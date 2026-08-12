'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  curvaAbcApi,
  relatorioBaseApi,
  CurvaAbcResumoResponse,
  CurvaAbcResumoSkuResponse,
  ReferenciaAbc,
  SkuAbc,
  CurvaLetra,
  CurvaGrupo,
  CurvaLinhaBucket,
  VendaEstoqueResumoLinha,
  CurvaAbcSkusResponse,
  PcpClassificacaoDimensao,
} from '@/lib/pcpApi';
import { cn, formatMoney, formatNumber, formatDate } from '@/lib/utils';
import { exportMultiSheetExcel, ExcelColumn } from '@/lib/exportExcel';

const CURVA_STYLE: Record<CurvaGrupo, { border: string; bg: string; text: string; badge: string; label: string; badgeLabel: string }> = {
  A: { border: 'border-l-green-500', bg: 'bg-green-50', text: 'text-green-700', badge: 'bg-green-100 text-green-700', label: 'A', badgeLabel: 'A' },
  B: { border: 'border-l-gray-400', bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-200 text-gray-700', label: 'B', badgeLabel: 'B' },
  C: { border: 'border-l-red-400', bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700', label: 'C', badgeLabel: 'C' },
  SEM_VENDA: { border: 'border-l-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', label: 'Sem venda', badgeLabel: 'SV' },
};

const RESUMO_GRUPO_LABEL: Record<VendaEstoqueResumoLinha['grupo'], string> = {
  A: 'Curva A',
  B: 'Curva B',
  C: 'Curva C',
  SEM_VENDA: 'Itens sem venda',
  TOTAL: 'Total',
};

const SORT_OPTIONS = [
  { value: 'rankValor', label: 'Rank Valor' },
  { value: 'valorMedioMensal', label: 'Media Valor Mensal' },
  { value: 'rankQtd', label: 'Rank Quantidade' },
  { value: 'representatividadeValor', label: 'Representatividade' },
  { value: 'mediaPorSku', label: 'Media / SKU' },
  { value: 'qtdVendida', label: 'Qtd Vendida' },
];

function TrendArrow({ tendencia }: { tendencia: 'up' | 'down' | 'flat' }) {
  if (tendencia === 'up') return <span className="text-green-600">UP</span>;
  if (tendencia === 'down') return <span className="text-red-600">DOWN</span>;
  return <span className="text-gray-400">-</span>;
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
  colSpan,
  rowSpan,
}: {
  label: string;
  sortKeyName: string;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
  title?: string;
  colSpan?: number;
  rowSpan?: number;
}) {
  const active = sortKey === sortKeyName;
  return (
    <TableCell
      isHeader
      align={align}
      className={cn('cursor-pointer select-none hover:bg-gray-100', className)}
      onClick={() => onSort(sortKeyName)}
      title={title}
      colSpan={colSpan}
      rowSpan={rowSpan}
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

// Visao "por Referencia" e visao "por SKU" (ref-cor-tam) usam a mesma regra de
// curva/rank, so que a granularidade da linha muda - normaliza os dois formatos de
// resposta do backend num shape so pra reaproveitar tabela e cards sem duplicar.
interface ItemCurva {
  key: string;
  labelPrincipal: string;
  labelSecundaria: string;
  categoria: string | null;
  linha: string | null;
  genero: string | null;
  status: string | null;
  lancamento: string | null;
  ultimaEntrada: string | null;
  curva: CurvaGrupo;
  rankValor: number;
  rankQtd: number;
  qtdVendida: number;
  mediaMensal: number;
  giro90dPercent: number | null;
  giro30dPercent: number | null;
  valorReais: number;
  valorMedioMensal: number;
  representatividadeValor: number;
  representatividadeAcumulada: number;
  totalSkus: number | null;
  mediaPorSku: number | null;
  tendenciaMediaSku: 'up' | 'down' | 'flat' | null;
  estoqueAtacado: number;
  estoqueVarejo: number;
  estoqueTotal: number;
  valorEstoqueCusto: number;
}

function referenciaParaItem(r: ReferenciaAbc): ItemCurva {
  return {
    key: r.referenceCode,
    labelPrincipal: r.referenceCode,
    labelSecundaria: r.referenceName,
    categoria: r.categoria,
    linha: r.linha,
    genero: r.genero,
    status: r.status,
    lancamento: r.lancamento,
    ultimaEntrada: r.ultimaEntrada,
    curva: r.curva,
    rankValor: r.rankValor,
    rankQtd: r.rankQtd,
    qtdVendida: r.qtdVendida,
    mediaMensal: r.mediaMensal,
    giro90dPercent: r.giro90dPercent,
    giro30dPercent: r.giro30dPercent,
    valorReais: r.valorReais,
    valorMedioMensal: r.valorMedioMensal,
    representatividadeValor: r.representatividadeValor,
    representatividadeAcumulada: r.representatividadeAcumulada,
    totalSkus: r.totalSkus,
    mediaPorSku: r.mediaPorSku,
    tendenciaMediaSku: r.tendenciaMediaSku,
    estoqueAtacado: r.estoqueAtacado,
    estoqueVarejo: r.estoqueVarejo,
    estoqueTotal: r.estoqueTotal,
    valorEstoqueCusto: r.valorEstoqueCusto,
  };
}

function skuParaItem(s: SkuAbc): ItemCurva {
  return {
    key: s.sku,
    labelPrincipal: s.refCorTam,
    labelSecundaria: s.sku,
    categoria: null,
    linha: null,
    genero: null,
    status: null,
    lancamento: null,
    ultimaEntrada: null,
    curva: s.curva,
    rankValor: s.rankValor,
    rankQtd: s.rankQtd,
    qtdVendida: s.qtdVendida,
    mediaMensal: s.mediaMensal,
    giro90dPercent: s.giro90dPercent,
    giro30dPercent: s.giro30dPercent,
    valorReais: s.valorReais,
    valorMedioMensal: s.valorMedioMensal,
    representatividadeValor: s.representatividadeValor,
    representatividadeAcumulada: s.representatividadeAcumulada,
    totalSkus: null,
    mediaPorSku: null,
    tendenciaMediaSku: null,
    estoqueAtacado: s.estoqueAtacado,
    estoqueVarejo: s.estoqueVarejo,
    estoqueTotal: s.estoqueTotal,
    valorEstoqueCusto: 0,
  };
}

interface CurvaResumoItem {
  curva: CurvaLetra;
  totalContagem: number;
  totalContagemLabel: string;
  quantidade: number;
  valorReais: number;
  totalSkus: number | null;
  mediaMensal: number;
  percentDoTotal: number;
  porLinha: CurvaLinhaBucket[];
}

function CurvaCard({ resumo }: { resumo: CurvaResumoItem }) {
  const style = CURVA_STYLE[resumo.curva];
  return (
    <Card className={cn('border-l-4', style.border, style.bg)}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={cn('font-bold', style.text)}>Curva {resumo.curva}</h3>
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', style.badge)}>{resumo.totalContagem} {resumo.totalContagemLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Valor 3 meses</p>
          <p className="font-semibold text-gray-800">{formatMoney(resumo.valorReais)}</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Quantidade</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.quantidade)}</p>
        </div>
        {resumo.totalSkus !== null && (
          <div>
            <p className="text-gray-400 uppercase tracking-wide">Total SKUs</p>
            <p className="font-semibold text-gray-800">{formatNumber(resumo.totalSkus)}</p>
          </div>
        )}
        <div>
          <p className="text-gray-400 uppercase tracking-wide">Media mensal</p>
          <p className="font-semibold text-gray-800">{formatNumber(resumo.mediaMensal)}</p>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2 pt-2 border-t">{resumo.percentDoTotal.toFixed(1)}% do valor vendido analisado</p>
    </Card>
  );
}

function LinhaStratificacaoCard({ resumo }: { resumo: CurvaResumoItem }) {
  const style = CURVA_STYLE[resumo.curva];
  return (
    <Card className={cn('border-l-4', style.border)}>
      <h3 className={cn('font-bold text-sm mb-2', style.text)}>Curva {resumo.curva} por Linha</h3>
      <div className="space-y-1.5">
        {resumo.porLinha.map((b) => (
          <div key={b.bucket} className="flex items-center justify-between text-xs gap-2">
            <span className="text-gray-600 truncate">{b.bucket}</span>
            <span className="text-gray-400 whitespace-nowrap">{formatNumber(b.quantidade)} refs</span>
            <span className="font-semibold text-gray-800 whitespace-nowrap">{b.percentDoValorCurva.toFixed(1)}% do valor</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Compara participacao de venda com participacao de estoque lado a lado, por grupo
// (A/B/C/Sem venda/Total) - pedido original da usuaria (planilha Excel): "80% da
// venda era quase 65% do estoque, a ideia e ter essas participacoes equilibradas, pra
// nao faltar peca". So existe no modo "por referencia" (SEM_VENDA e Valor Estq Custo
// nao sao calculados no modo SKU).
function VendaEstoqueResumoTable({ linhas }: { linhas: VendaEstoqueResumoLinha[] }) {
  return (
    <Table className="overflow-x-auto" tableClassName="text-xs">
      <TableHead>
        <TableRow>
          <TableCell isHeader>Curva</TableCell>
          <TableCell isHeader align="right">Ref</TableCell>
          <TableCell isHeader align="right">Part</TableCell>
          <TableCell isHeader align="right" className="bg-purple-50">Peças (venda)</TableCell>
          <TableCell isHeader align="right" className="bg-purple-50">Valor Venda</TableCell>
          <TableCell isHeader align="right" className="bg-purple-50">Part V</TableCell>
          <TableCell isHeader align="right" className="bg-blue-50">Estoq Peças</TableCell>
          <TableCell isHeader align="right" className="bg-blue-50">Valor Estoque (custo)</TableCell>
          <TableCell isHeader align="right" className="bg-blue-50">Part E</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {linhas.map((l) => {
          const isTotal = l.grupo === 'TOTAL';
          const style = l.grupo === 'TOTAL' ? null : CURVA_STYLE[l.grupo];
          return (
            <TableRow key={l.grupo} isHighlighted={isTotal}>
              <TableCell className={cn('!py-2 font-semibold', isTotal ? 'font-bold' : style?.text)}>
                {!isTotal && (
                  <span className={cn('inline-block w-2 h-2 rounded-full mr-1.5', style?.badge)} />
                )}
                {RESUMO_GRUPO_LABEL[l.grupo]}
              </TableCell>
              <TableCell align="right" className="!py-2">{formatNumber(l.totalReferencias)}</TableCell>
              <TableCell align="right" className="!py-2">{l.percentReferencias.toFixed(2)}%</TableCell>
              <TableCell align="right" className="bg-purple-50/50 !py-2">{l.grupo === 'SEM_VENDA' ? '—' : formatNumber(l.qtdVendida)}</TableCell>
              <TableCell align="right" className="bg-purple-50/50 !py-2">{l.grupo === 'SEM_VENDA' ? '—' : formatMoney(l.valorVenda)}</TableCell>
              <TableCell align="right" className="bg-purple-50/50 !py-2 font-semibold">{l.grupo === 'SEM_VENDA' ? '—' : `${l.percentValorVenda.toFixed(2)}%`}</TableCell>
              <TableCell align="right" className="bg-blue-50/50 !py-2">{formatNumber(l.estoquePecas)}</TableCell>
              <TableCell align="right" className="bg-blue-50/50 !py-2">{formatMoney(l.valorEstoqueCusto)}</TableCell>
              <TableCell align="right" className="bg-blue-50/50 !py-2 font-semibold">{l.percentValorEstoque.toFixed(2)}%</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default function PcpCurvaAbcPage() {
  const { token, user } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<CurvaAbcResumoResponse | null>(null);
  const [dataSku, setDataSku] = useState<CurvaAbcResumoSkuResponse | null>(null);
  const [visao, setVisao] = useState<'referencia' | 'sku'>('referencia');

  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});

  const [curvaSelecionada, setCurvaSelecionada] = useState<CurvaLetra | 'todas'>('todas');
  const [busca, setBusca] = useState('');
  const [ordenarPor, setOrdenarPor] = useState<'rankQtd' | 'rankValor' | 'mediaPorSku' | 'qtdVendida' | 'representatividadeValor' | 'valorMedioMensal'>('rankValor');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function handleSort(key: string) {
    const sortKey = key as typeof ordenarPor;
    if (ordenarPor === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setOrdenarPor(sortKey);
      setSortDir('asc');
    }
  }

  const [skusModal, setSkusModal] = useState<{ referencia: string; nome: string } | null>(null);
  const [skusData, setSkusData] = useState<CurvaAbcSkusResponse | null>(null);
  const [skusLoading, setSkusLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    relatorioBaseApi
      .getFiltrosRelatorioBase(token)
      .then((res) => setClassificacoes(res.classificacoes))
      .catch((error) => console.error('Erro ao carregar filtros:', error));
  }, [token]);

  // Carrega AMBAS as tabelas (REF e SKU) ao mesmo tempo para nao ter delay ao trocar visao
  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const filtro = {
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        status: produtoFiltro.status,
      };
      // Carrega ambas as visoes em paralelo
      const [refData, skuData] = await Promise.all([
        curvaAbcApi.getResumo(token, filtro),
        curvaAbcApi.getResumoPorSku(token, filtro),
      ]);
      setData(refData);
      setDataSku(skuData);
    } catch (error) {
      showToast('Erro ao carregar Curva ABC', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, produtoFiltro]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // "Media / SKU" so existe na granularidade de referencia (media entre os SKUs dela) -
  // no visao por SKU cada linha ja e um SKU so, entao a ordenacao nao se aplica.
  useEffect(() => {
    if (visao === 'sku' && ordenarPor === 'mediaPorSku') setOrdenarPor('rankValor');
  }, [visao, ordenarPor]);

  function atualizarProdutoFiltro(chave: string, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  async function abrirSkus(referenceCode: string, referenceName: string) {
    if (!token) return;
    setSkusModal({ referencia: referenceCode, nome: referenceName });
    setSkusLoading(true);
    try {
      const res = await curvaAbcApi.getSkus(token, { referencia: referenceCode, page: 1, pageSize: 200 });
      setSkusData(res);
    } catch (error) {
      showToast('Erro ao carregar SKUs da referencia', 'error');
      console.error(error);
    } finally {
      setSkusLoading(false);
    }
  }

  const curvasNormalizadas: CurvaResumoItem[] = useMemo(() => {
    if (visao === 'referencia') {
      return (data?.curvas || []).map((c) => ({
        curva: c.curva,
        totalContagem: c.totalReferencias,
        totalContagemLabel: 'refs',
        quantidade: c.quantidade,
        valorReais: c.valorReais,
        totalSkus: c.totalSkus,
        mediaMensal: c.mediaMensal,
        percentDoTotal: c.percentDoTotal,
        porLinha: c.porLinha,
      }));
    }
    return (dataSku?.curvas || []).map((c) => ({
      curva: c.curva,
      totalContagem: c.totalItens,
      totalContagemLabel: 'SKUs',
      quantidade: c.quantidade,
      valorReais: c.valorReais,
      totalSkus: null,
      mediaMensal: c.mediaMensal,
      percentDoTotal: c.percentDoTotal,
      porLinha: c.porLinha,
    }));
  }, [visao, data, dataSku]);

  const itensFiltrados = useMemo(() => {
    const base: ItemCurva[] = visao === 'referencia'
      ? (data?.referencias || []).map(referenciaParaItem)
      : (dataSku?.itens || []).map(skuParaItem);

    let lista = base;
    if (curvaSelecionada !== 'todas') lista = lista.filter((r) => r.curva === curvaSelecionada);
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase();
      lista = lista.filter((r) => r.labelPrincipal.toLowerCase().includes(termo) || r.labelSecundaria.toLowerCase().includes(termo));
    }
    return [...lista].sort((a, b) => {
      // Itens SEM_VENDA nao entram na ordenacao por venda/rank escolhida (nao tem
      // rank nenhum) - ficam sempre no final da lista, independente da coluna/direcao
      // de ordenacao ativa (pedido explicito da usuaria: "no final").
      if (a.curva === 'SEM_VENDA' && b.curva !== 'SEM_VENDA') return 1;
      if (b.curva === 'SEM_VENDA' && a.curva !== 'SEM_VENDA') return -1;
      const va = a[ordenarPor] ?? 0;
      const vb = b[ordenarPor] ?? 0;
      const cmp = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [visao, data, dataSku, curvaSelecionada, busca, ordenarPor, sortDir]);

  // Função para exportar para Excel
  const handleExportExcel = useCallback(() => {
    if (itensFiltrados.length === 0) return;

    const dataHoje = new Date().toISOString().split('T')[0];
    const modoLabel = visao === 'referencia' ? 'Referências' : 'SKUs';

    // Colunas variam conforme visao
    const colunas: ExcelColumn[] = [
      { key: 'labelPrincipal', header: visao === 'referencia' ? 'REFERÊNCIA' : 'REF-COR-TAM', width: 18, type: 'text' },
      { key: 'labelSecundaria', header: visao === 'referencia' ? 'DESCRIÇÃO' : 'SKU', width: 30, type: 'text' },
    ];

    if (visao === 'referencia') {
      colunas.push(
        { key: 'categoria', header: 'CATEGORIA', width: 14, type: 'text' },
        { key: 'linha', header: 'LINHA', width: 14, type: 'text' },
        { key: 'genero', header: 'GÊNERO', width: 12, type: 'text' },
        { key: 'status', header: 'STATUS', width: 14, type: 'text' },
        { key: 'lancamento', header: 'LANÇAMENTO', width: 12, type: 'text' },
        { key: 'ultimaEntrada', header: 'ÚLT. ENTRADA', width: 14, type: 'text' },
      );
    }

    colunas.push(
      { key: 'curva', header: 'CURVA', width: 8, type: 'text' },
      { key: 'rankValor', header: 'RANK VALOR', width: 12, type: 'number' },
      { key: 'representatividadeValor', header: '%', width: 8, type: 'number' },
      { key: 'representatividadeAcumulada', header: '% ACUM.', width: 10, type: 'number' },
      { key: 'valorMedioMensal', header: 'MÉDIA R$', width: 14, type: 'number' },
      { key: 'valorReais', header: 'VALOR 3M R$', width: 14, type: 'number' },
      { key: 'rankQtd', header: 'RANK QTD', width: 10, type: 'number' },
    );

    if (visao === 'referencia') {
      colunas.push({ key: 'totalSkus', header: 'SKUS', width: 8, type: 'number' });
      colunas.push({ key: 'mediaPorSku', header: 'MÉD/SKU', width: 10, type: 'number' });
    }

    colunas.push(
      { key: 'qtdVendida', header: 'QTD 3M', width: 10, type: 'number' },
      { key: 'mediaMensal', header: 'MÉD/MÊS', width: 10, type: 'number' },
      { key: 'giro90dPercent', header: 'GIRO 90D %', width: 12, type: 'number' },
      { key: 'giro30dPercent', header: 'GIRO 30D %', width: 12, type: 'number' },
      { key: 'estoqueTotal', header: 'EST. TOTAL', width: 12, type: 'number' },
      { key: 'estoqueVarejo', header: 'EST. VAREJO', width: 12, type: 'number' },
      { key: 'estoqueAtacado', header: 'EST. ATACADO', width: 14, type: 'number' },
    );

    const dados = itensFiltrados.map(item => ({
      labelPrincipal: item.labelPrincipal,
      labelSecundaria: item.labelSecundaria,
      categoria: item.categoria,
      linha: item.linha,
      genero: item.genero,
      status: item.status,
      lancamento: item.lancamento,
      ultimaEntrada: item.ultimaEntrada ? formatDate(item.ultimaEntrada) : '',
      curva: item.curva,
      rankValor: item.rankValor,
      representatividadeValor: item.representatividadeValor,
      representatividadeAcumulada: item.representatividadeAcumulada,
      valorMedioMensal: item.valorMedioMensal,
      valorReais: item.valorReais,
      rankQtd: item.rankQtd,
      totalSkus: item.totalSkus || 0,
      mediaPorSku: item.mediaPorSku || 0,
      qtdVendida: item.qtdVendida,
      mediaMensal: item.mediaMensal,
      giro90dPercent: item.giro90dPercent,
      giro30dPercent: item.giro30dPercent,
      estoqueTotal: item.estoqueTotal,
      estoqueVarejo: item.estoqueVarejo,
      estoqueAtacado: item.estoqueAtacado,
    }));

    // Linha de totais
    const totais: Record<string, number | string> = {
      labelPrincipal: `TOTAL (${itensFiltrados.length} itens)`,
      labelSecundaria: '',
      categoria: '',
      linha: '',
      genero: '',
      status: '',
      lancamento: '',
      ultimaEntrada: '',
      curva: '',
      rankValor: '',
      representatividadeValor: '',
      representatividadeAcumulada: '',
      valorMedioMensal: itensFiltrados.reduce((sum, r) => sum + r.valorMedioMensal, 0),
      valorReais: itensFiltrados.reduce((sum, r) => sum + r.valorReais, 0),
      rankQtd: '',
      totalSkus: itensFiltrados.reduce((sum, r) => sum + (r.totalSkus || 0), 0),
      mediaPorSku: '',
      qtdVendida: itensFiltrados.reduce((sum, r) => sum + r.qtdVendida, 0),
      mediaMensal: itensFiltrados.reduce((sum, r) => sum + r.mediaMensal, 0),
      giro90dPercent: '',
      giro30dPercent: '',
      estoqueTotal: itensFiltrados.reduce((sum, r) => sum + r.estoqueTotal, 0),
      estoqueVarejo: itensFiltrados.reduce((sum, r) => sum + r.estoqueVarejo, 0),
      estoqueAtacado: itensFiltrados.reduce((sum, r) => sum + r.estoqueAtacado, 0),
    };

    exportMultiSheetExcel(`CurvaABC_${modoLabel}_${dataHoje}`, [
      {
        sheetName: modoLabel,
        columns: colunas,
        data: dados,
        title: `Curva ABC - ${modoLabel}`,
        totals: totais,
      },
    ]);
  }, [itensFiltrados, visao]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Curva ABC</h1>
          <p className="text-gray-500 text-sm mt-1">
            {visao === 'referencia' ? 'Referencias' : 'SKUs (referencia-cor-tamanho)'} classificados pela media mensal de valor dos ultimos {(visao === 'referencia' ? data?.config.mesesFechados : dataSku?.config.mesesFechados) ?? 3} meses fechados
          </p>
        </div>
        {user?.role === 'admin' && (
          <Button variant="secondary" size="sm" onClick={() => window.location.href = '/pcp/relatorio-base-config'}>
            Configuracoes do PCP
          </Button>
        )}
      </div>

      {visao === 'referencia' && data && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Resumo Venda × Estoque por curva</h2>
          <Card>
            {isLoading ? (
              <p className="text-sm text-gray-500 py-4 text-center">Carregando...</p>
            ) : (
              <VendaEstoqueResumoTable linhas={data.resumoVendaEstoque} />
            )}
            <p className="text-xs text-gray-400 mt-2 pt-2 border-t">
              {data.totalAnalisadas} referencias com venda no periodo + {data.totalSemVenda} sem venda (mas com estoque) = {data.totalAnalisadas + data.totalSemVenda} no total.
            </p>
          </Card>
        </div>
      )}

      {(visao === 'referencia' ? data : dataSku) && (
        <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
          <p className="text-sm font-medium text-gray-800">Regras de classificacao</p>
          <ul className="text-xs text-gray-600 mt-1 space-y-0.5">
            <li><strong>Base:</strong> media mensal de valor dos ultimos {(visao === 'referencia' ? data?.config.mesesFechados : dataSku?.config.mesesFechados)} meses fechados.</li>
            <li><strong>Curva A:</strong> ate {(visao === 'referencia' ? data : dataSku)?.config.curvaALimitePercent}% do valor medio mensal acumulado.</li>
            <li><strong>Curva B:</strong> acima de {(visao === 'referencia' ? data : dataSku)?.config.curvaALimitePercent}% e ate {(visao === 'referencia' ? data : dataSku)?.config.curvaBLimitePercent}% do valor acumulado.</li>
            <li><strong>Curva C:</strong> restante, acima de {(visao === 'referencia' ? data : dataSku)?.config.curvaBLimitePercent}% do valor acumulado.</li>
            <li><strong>Sem venda:</strong> tem estoque mas nao vendeu no periodo - fica de fora do ranking A/B/C (nao faz sentido classificar por venda quem nao vendeu), aparece no final da tabela.</li>
          </ul>
          <p className="text-xs text-gray-400 mt-2">
            {visao === 'referencia' ? data?.totalAnalisadas : dataSku?.totalAnalisadas} {visao === 'referencia' ? 'referencias' : 'SKUs'} analisados (com venda no periodo).
          </p>
        </Card>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Resumo por curva</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {isLoading || curvasNormalizadas.length === 0
            ? [1, 2, 3].map((i) => <Card key={i} className="h-40 animate-pulse bg-gray-50"><span /></Card>)
            : curvasNormalizadas.map((c) => <CurvaCard key={c.curva} resumo={c} />)}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Estratificação por Linha</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {isLoading || curvasNormalizadas.length === 0
            ? [1, 2, 3].map((i) => <Card key={i} className="h-24 animate-pulse bg-gray-50"><span /></Card>)
            : curvasNormalizadas.map((c) => <LinhaStratificacaoCard key={c.curva} resumo={c} />)}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-grid grid-cols-2 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
          {([{ value: 'referencia', label: 'POR REFERENCIA' }, { value: 'sku', label: 'POR SKU' }] as const).map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setVisao(v.value)}
              className={v.value === visao
                ? 'min-w-20 bg-[var(--bbtk-red)] px-3 py-2 text-xs font-bold text-white'
                : 'min-w-20 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50'}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="inline-grid grid-cols-4 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
          {(['todas', 'A', 'B', 'C'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurvaSelecionada(c)}
              className={c === curvaSelecionada
                ? 'min-w-16 bg-[var(--bbtk-red)] px-3 py-2 text-xs font-bold text-white'
                : 'min-w-16 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50'}
            >
              {c === 'todas' ? 'TODAS' : c}
            </button>
          ))}
        </div>
        <Input label={visao === 'referencia' ? 'Buscar referencia' : 'Buscar SKU/referencia'} value={busca} onChange={(e) => setBusca(e.target.value)} className="w-52" placeholder="Codigo ou nome" />
        <Select
          label="Ordenar"
          value={ordenarPor}
          onChange={(e) => setOrdenarPor(e.target.value as typeof ordenarPor)}
          options={visao === 'sku' ? SORT_OPTIONS.filter((o) => o.value !== 'mediaPorSku') : SORT_OPTIONS}
          className="w-48"
        />
        {classificacoes
          .filter((d) => d.chave === 'categoria' || d.chave === 'linha' || d.chave === 'genero' || d.chave === 'status')
          .map((dim) => (
            <ClassificacaoMultiSelect
              key={dim.chave}
              label={dim.label}
              options={dim.opcoes.map((option) => ({ value: option.valor, label: option.valor }))}
              selected={produtoFiltro[dim.chave] || []}
              onChange={(valores) => atualizarProdutoFiltro(dim.chave, valores)}
              className="w-44"
            />
          ))}
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
        {itensFiltrados.length > 0 && (
          <button
            onClick={handleExportExcel}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Exportar Excel
          </button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{itensFiltrados.length} {visao === 'referencia' ? 'referencias' : 'SKUs'}</CardTitle>
        </CardHeader>
        <Table
          className={cn(
            'overflow-x-auto',
            itensFiltrados.length > 10 && 'max-h-[560px] overflow-y-auto'
          )}
          tableClassName="text-[10px] lg:text-xs"
        >
          <TableHead className="sticky top-0 z-10">
            <TableRow>
              <TableCell isHeader rowSpan={2} className="!px-2 !py-2">{visao === 'referencia' ? 'Referencia' : 'Referencia - Cor - Tamanho'}</TableCell>
              {visao === 'referencia' && <TableCell isHeader colSpan={6} align="center" className="bg-amber-50 border-b-0 !px-2 !py-2">Classificação</TableCell>}
              <TableCell isHeader rowSpan={2} align="center" className="!px-1 !py-2">Curva</TableCell>
              <TableCell isHeader colSpan={5} align="center" className="border-b-0 !px-2 !py-2">Valor</TableCell>
              <TableCell isHeader colSpan={visao === 'referencia' ? 3 : 1} align="center" className="border-b-0 !px-2 !py-2">Quantidade</TableCell>
              <TableCell isHeader colSpan={4} align="center" className="bg-purple-50 border-b-0 !px-2 !py-2">Giro (% estoque)</TableCell>
              <TableCell isHeader colSpan={3} align="center" className="bg-blue-50 border-b-0 !px-2 !py-2">Estoque (peças)</TableCell>
            </TableRow>
            <TableRow>
              {visao === 'referencia' && <TableCell isHeader className="bg-amber-50 !px-1.5 !py-2">Categoria</TableCell>}
              {visao === 'referencia' && <TableCell isHeader className="bg-amber-50 !px-1.5 !py-2">Linha</TableCell>}
              {visao === 'referencia' && <TableCell isHeader className="bg-amber-50 !px-1.5 !py-2">Gênero</TableCell>}
              {visao === 'referencia' && <TableCell isHeader className="bg-amber-50 !px-1.5 !py-2">Status</TableCell>}
              {visao === 'referencia' && <TableCell isHeader className="bg-amber-50 !px-1.5 !py-2">Lançamento</TableCell>}
              {visao === 'referencia' && <TableCell isHeader className="bg-amber-50 !px-1.5 !py-2">Últ. Entrada</TableCell>}
              <ThSortPcp label="Rank" sortKeyName="rankValor" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />
              <ThSortPcp label="%" sortKeyName="representatividadeValor" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />
              <ThSortPcp label="% Acum." sortKeyName="representatividadeAcumulada" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />
              <ThSortPcp label="Média" sortKeyName="valorMedioMensal" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />
              <ThSortPcp label="3 Meses" sortKeyName="valorReais" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />
              <ThSortPcp label="Rank" sortKeyName="rankQtd" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />
              {visao === 'referencia' && <ThSortPcp label="SKUs" sortKeyName="totalSkus" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />}
              {visao === 'referencia' && <ThSortPcp label="Méd/SKU" sortKeyName="mediaPorSku" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="!px-1.5 !py-2" />}
              <ThSortPcp label="3m" sortKeyName="qtdVendida" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="bg-purple-50 !px-1.5 !py-2" />
              <ThSortPcp label="méd/m" sortKeyName="mediaMensal" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="bg-purple-50 !px-1.5 !py-2" />
              <ThSortPcp label="90D %" sortKeyName="giro90dPercent" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="bg-purple-50 !px-1.5 !py-2" />
              <ThSortPcp label="30D %" sortKeyName="giro30dPercent" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="bg-purple-50 !px-1.5 !py-2" />
              <ThSortPcp label="Total" sortKeyName="estoqueTotal" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="bg-blue-50 !px-1.5 !py-2" />
              <ThSortPcp label="Varejo" sortKeyName="estoqueVarejo" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="bg-blue-50 !px-1.5 !py-2" />
              <ThSortPcp label="Atac." sortKeyName="estoqueAtacado" sortKey={ordenarPor} sortDir={sortDir} onSort={handleSort} align="right" className="bg-blue-50 !px-1.5 !py-2" />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={visao === 'referencia' ? 21 : 13} align="center" className="py-8 text-gray-500">Carregando...</TableCell>
              </TableRow>
            ) : itensFiltrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visao === 'referencia' ? 21 : 13} align="center" className="py-8 text-gray-500">Nenhum item encontrado</TableCell>
              </TableRow>
            ) : (
              <>
                {itensFiltrados.map((r) => (
                  <TableRow key={r.key} onClick={visao === 'referencia' ? () => abrirSkus(r.key, r.labelSecundaria) : undefined}>
                    <TableCell className="!px-2 !py-2">
                      <span className="font-medium text-gray-800">{r.labelPrincipal}</span>
                      <span className="block text-[9px] text-gray-400 truncate max-w-[180px]" title={r.labelSecundaria}>{r.labelSecundaria}</span>
                    </TableCell>
                    {visao === 'referencia' && <TableCell className="bg-amber-50/50 !px-1.5 !py-2">{r.categoria || '-'}</TableCell>}
                    {visao === 'referencia' && <TableCell className="bg-amber-50/50 !px-1.5 !py-2">{r.linha || '-'}</TableCell>}
                    {visao === 'referencia' && <TableCell className="bg-amber-50/50 !px-1.5 !py-2">{r.genero || '-'}</TableCell>}
                    {visao === 'referencia' && <TableCell className="bg-amber-50/50 !px-1.5 !py-2">{r.status || '-'}</TableCell>}
                    {visao === 'referencia' && <TableCell className="bg-amber-50/50 !px-1.5 !py-2">{r.lancamento || '—'}</TableCell>}
                    {visao === 'referencia' && <TableCell className="bg-amber-50/50 !px-1.5 !py-2">{r.ultimaEntrada ? formatDate(r.ultimaEntrada) : '—'}</TableCell>}
                    <TableCell align="center" className="!px-1 !py-2">
                      <span className={cn('inline-flex items-center justify-center h-5 px-1.5 rounded-full text-[9px] font-bold', CURVA_STYLE[r.curva].badge)}>
                        {CURVA_STYLE[r.curva].badgeLabel}
                      </span>
                    </TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2">{r.curva === 'SEM_VENDA' ? '—' : `#${r.rankValor}`}</TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2">{r.curva === 'SEM_VENDA' ? '—' : `${r.representatividadeValor.toFixed(2)}%`}</TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2">{r.curva === 'SEM_VENDA' ? '—' : `${r.representatividadeAcumulada.toFixed(2)}%`}</TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2">{formatMoney(r.valorMedioMensal)}</TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2">{formatMoney(r.valorReais)}</TableCell>
                    <TableCell align="right" className="!px-1.5 !py-2">{r.curva === 'SEM_VENDA' ? '—' : `#${r.rankQtd}`}</TableCell>
                    {visao === 'referencia' && <TableCell align="right" className="!px-1.5 !py-2">{formatNumber(r.totalSkus || 0)}</TableCell>}
                    {visao === 'referencia' && (
                      <TableCell align="right" className="!px-1.5 !py-2">
                        {formatNumber(r.mediaPorSku || 0)} {r.tendenciaMediaSku && <TrendArrow tendencia={r.tendenciaMediaSku} />}
                      </TableCell>
                    )}
                    <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2">{formatNumber(r.qtdVendida)}</TableCell>
                    <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2">{formatNumber(r.mediaMensal)}</TableCell>
                    <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2">{r.giro90dPercent === null ? '—' : `${r.giro90dPercent.toFixed(1)}%`}</TableCell>
                    <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2">{r.giro30dPercent === null ? '—' : `${r.giro30dPercent.toFixed(1)}%`}</TableCell>
                    <TableCell align="right" className="bg-blue-50 font-semibold !px-1.5 !py-2">{formatNumber(r.estoqueTotal)}</TableCell>
                    <TableCell align="right" className="bg-blue-50 !px-1.5 !py-2">{formatNumber(r.estoqueVarejo)}</TableCell>
                    <TableCell align="right" className="bg-blue-50 !px-1.5 !py-2">{formatNumber(r.estoqueAtacado)}</TableCell>
                  </TableRow>
                ))}
                <TableRow isHighlighted className="sticky bottom-0 z-10">
                  <TableCell colSpan={visao === 'referencia' ? 8 : 2} className="!px-2 !py-2 font-bold">TOTAL ({itensFiltrados.length} itens)</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">-</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">-</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">-</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">{formatMoney(itensFiltrados.reduce((sum, r) => sum + r.valorMedioMensal, 0))}</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">{formatMoney(itensFiltrados.reduce((sum, r) => sum + r.valorReais, 0))}</TableCell>
                  <TableCell align="right" className="!px-1.5 !py-2 font-bold">-</TableCell>
                  {visao === 'referencia' && <TableCell align="right" className="!px-1.5 !py-2 font-bold">{formatNumber(itensFiltrados.reduce((sum, r) => sum + (r.totalSkus || 0), 0))}</TableCell>}
                  {visao === 'referencia' && <TableCell align="right" className="!px-1.5 !py-2 font-bold">-</TableCell>}
                  <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2 font-bold">{formatNumber(itensFiltrados.reduce((sum, r) => sum + r.qtdVendida, 0))}</TableCell>
                  <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2 font-bold">{formatNumber(itensFiltrados.reduce((sum, r) => sum + r.mediaMensal, 0))}</TableCell>
                  <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2 font-bold">-</TableCell>
                  <TableCell align="right" className="bg-purple-50 !px-1.5 !py-2 font-bold">-</TableCell>
                  <TableCell align="right" className="bg-blue-50 font-semibold !px-1.5 !py-2">{formatNumber(itensFiltrados.reduce((sum, r) => sum + r.estoqueTotal, 0))}</TableCell>
                  <TableCell align="right" className="bg-blue-50 !px-1.5 !py-2 font-bold">{formatNumber(itensFiltrados.reduce((sum, r) => sum + r.estoqueVarejo, 0))}</TableCell>
                  <TableCell align="right" className="bg-blue-50 !px-1.5 !py-2 font-bold">{formatNumber(itensFiltrados.reduce((sum, r) => sum + r.estoqueAtacado, 0))}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>

      <Modal isOpen={!!skusModal} onClose={() => { setSkusModal(null); setSkusData(null); }} title={skusModal ? `${skusModal.referencia} - ${skusModal.nome}` : ''} size="lg">
        {skusLoading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Carregando SKUs...</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>Ref - Cor - Tam</TableCell>
                <TableCell isHeader>SKU</TableCell>
                <TableCell isHeader align="right">Qtd Vendida</TableCell>
                <TableCell isHeader align="right">Valor (R$)</TableCell>
                <TableCell isHeader align="right">Estoque Varejo</TableCell>
                <TableCell isHeader align="right">Estoque Atacado</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(skusData?.linhas || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" className="py-6 text-gray-500">Nenhum SKU com movimento</TableCell>
                </TableRow>
              ) : (
                skusData?.linhas.map((s) => (
                  <TableRow key={s.sku}>
                    <TableCell>{s.refCorTam}</TableCell>
                    <TableCell className="text-xs text-gray-400">{s.sku}</TableCell>
                    <TableCell align="right">{formatNumber(s.qtdVendida)}</TableCell>
                    <TableCell align="right">{formatMoney(s.valorReais)}</TableCell>
                    <TableCell align="right">{formatNumber(s.estoqueVarejo)}</TableCell>
                    <TableCell align="right">{formatNumber(s.estoqueAtacado)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Modal>
    </div>
  );
}
