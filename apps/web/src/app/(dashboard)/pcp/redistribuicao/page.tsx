'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useRedistribuicaoJob } from '@/contexts/RedistribuicaoJobContext';
import { Badge } from '@/components/ui/Badge';
import {
  redistribuicaoApi,
  RedistribuicaoDadosBase,
  RedistribuicaoSugestao,
} from '@/lib/pcpApi';
import { exportToExcel, ExcelColumn } from '@/lib/exportExcel';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';

// Componente de cabecalho ordenavel
function ThSort({
  children,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode;
  sortKey: string;
  currentSort: string;
  currentDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
}) {
  const isActive = currentSort === sortKey;
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap sticky top-0 bg-gray-50 z-10 border-b border-gray-200 ${alignClass} ${isActive ? 'text-[#6B5B95]' : 'text-gray-500'} hover:text-[#6B5B95] hover:bg-gray-100 ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {isActive && (
          <span className="text-[#6B5B95]">{currentDir === 'asc' ? '▲' : '▼'}</span>
        )}
      </span>
    </th>
  );
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatCobertura(meses: number | null | undefined): string {
  if (meses === null || meses === undefined) return '-';
  if (meses >= 99) return '99+';
  return meses.toFixed(1) + 'm';
}

export default function RedistribuicaoPage() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const { activeJob, isPolling, iniciarJob, limparJob } = useRedistribuicaoJob();

  const [dadosBase, setDadosBase] = useState<RedistribuicaoDadosBase | null>(null);
  const [isLoadingBase, setIsLoadingBase] = useState(false);

  // Filtros de resultado (depois do calculo)
  const [filtroResultadoReferencia, setFiltroResultadoReferencia] = useState('');
  const [filtroResultadoCor, setFiltroResultadoCor] = useState('');
  const [filtroResultadoTamanho, setFiltroResultadoTamanho] = useState('');
  const [filtroResultadoCurva, setFiltroResultadoCurva] = useState('');
  const [filtroResultadoOrigem, setFiltroResultadoOrigem] = useState('');
  const [filtroResultadoDestino, setFiltroResultadoDestino] = useState('');

  // Ordenacao da tabela de sugestoes
  const [sortKey, setSortKey] = useState<string>('scorePrioridade');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Carregar dados base
  useEffect(() => {
    async function loadDadosBase() {
      if (!token) return;
      setIsLoadingBase(true);
      try {
        const resultado = await redistribuicaoApi.getDadosBase(token);
        setDadosBase(resultado);
      } catch (error) {
        console.error('Erro ao carregar dados base:', error);
        showToast('Erro ao carregar dados', 'error');
      } finally {
        setIsLoadingBase(false);
      }
    }
    loadDadosBase();
  }, [token, showToast]);

  // Iniciar calculo
  async function handleIniciarCalculo() {
    try {
      await iniciarJob({});
      showToast('Calculo iniciado! Voce pode navegar para outras paginas enquanto processa.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      showToast(message, 'error');
    }
  }

  // Opcoes unicas para os selects de filtro
  const opcoesUnicas = useMemo(() => {
    if (!activeJob?.resultado?.sugestoes) return { curvas: [], origens: [], destinos: [], tamanhos: [] };

    const curvas = new Set<string>();
    const origens = new Set<string>();
    const destinos = new Set<string>();
    const tamanhos = new Set<string>();

    for (const s of activeJob.resultado.sugestoes) {
      if (s.curva) curvas.add(s.curva);
      origens.add(s.origem.branchName);
      destinos.add(s.destino.branchName);
      if (s.tamanho) tamanhos.add(s.tamanho);
    }

    return {
      curvas: Array.from(curvas).sort(),
      origens: Array.from(origens).sort(),
      destinos: Array.from(destinos).sort(),
      tamanhos: Array.from(tamanhos).sort(),
    };
  }, [activeJob?.resultado?.sugestoes]);

  // Funcao para extrair valor de ordenacao
  function getSortValue(s: RedistribuicaoSugestao, key: string): number | string {
    switch (key) {
      case 'referenceCode': return s.referenceCode;
      case 'cor': return s.cor || '';
      case 'tamanho': return s.tamanho || '';
      case 'curva': return s.curva || 'Z';
      case 'origem': return s.origem.branchName;
      case 'primeiraEntrada': return s.origem.primeiraEntrada || '';
      case 'origemEstoque': return s.origem.estoqueAtual;
      case 'origemGiro': return s.origem.giro3m;
      case 'origemCobertura': return s.origem.coberturaMeses ?? 9999;
      case 'destino': return s.destino.branchName;
      case 'destinoEstoque': return s.destino.estoqueAtual;
      case 'destinoGiro': return s.destino.giro3m;
      case 'destinoCobertura': return s.destino.coberturaMeses ?? 9999;
      case 'quantidadeSugerida': return s.quantidadeSugerida;
      case 'scorePrioridade': return s.scorePrioridade;
      default: return s.scorePrioridade;
    }
  }

  // Sugestoes filtradas e ordenadas
  const sugestoesOrdenadas = useMemo(() => {
    if (!activeJob?.resultado?.sugestoes) return [];

    // Aplicar filtros
    let filtradas = activeJob.resultado.sugestoes;

    if (filtroResultadoReferencia) {
      const termo = filtroResultadoReferencia.toLowerCase();
      filtradas = filtradas.filter(
        (s) =>
          s.referenceCode.toLowerCase().includes(termo) ||
          s.referenceName.toLowerCase().includes(termo)
      );
    }

    if (filtroResultadoCor) {
      const termo = filtroResultadoCor.toLowerCase();
      filtradas = filtradas.filter((s) => (s.cor || '').toLowerCase().includes(termo));
    }

    if (filtroResultadoTamanho) {
      filtradas = filtradas.filter((s) => s.tamanho === filtroResultadoTamanho);
    }

    if (filtroResultadoCurva) {
      filtradas = filtradas.filter((s) => s.curva === filtroResultadoCurva);
    }

    if (filtroResultadoOrigem) {
      filtradas = filtradas.filter((s) => s.origem.branchName === filtroResultadoOrigem);
    }

    if (filtroResultadoDestino) {
      filtradas = filtradas.filter((s) => s.destino.branchName === filtroResultadoDestino);
    }

    // Ordenar
    const sorted = [...filtradas];
    sorted.sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);

      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal as string);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc' ? aVal - (bVal as number) : (bVal as number) - aVal;
    });

    return sorted;
  }, [
    activeJob?.resultado?.sugestoes,
    sortKey,
    sortDir,
    filtroResultadoReferencia,
    filtroResultadoCor,
    filtroResultadoTamanho,
    filtroResultadoCurva,
    filtroResultadoOrigem,
    filtroResultadoDestino,
  ]);

  // Toggle ordenacao
  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  // Exportar Excel
  function handleExportarExcel() {
    if (!activeJob?.resultado?.sugestoes) return;

    const colunas: ExcelColumn[] = [
      { key: 'referenceCode', header: 'Referencia', width: 15, type: 'text' },
      { key: 'referenceName', header: 'Descricao', width: 30, type: 'text' },
      { key: 'cor', header: 'Cor', width: 15, type: 'text' },
      { key: 'tamanho', header: 'Tamanho', width: 10, type: 'text' },
      { key: 'curva', header: 'Curva', width: 8, type: 'text' },
      { key: 'origemLoja', header: 'Origem', width: 15, type: 'text' },
      { key: 'origemPrimeiraEntrada', header: '1a Entrada Origem', width: 14, type: 'text' },
      { key: 'origemEstoque', header: 'Est. Origem', width: 12, type: 'number' },
      { key: 'origemVenda3m', header: 'Vda 3m Origem', width: 14, type: 'number' },
      { key: 'origemCobertura', header: 'Cob. Origem', width: 12, type: 'number' },
      { key: 'destinoLoja', header: 'Destino', width: 15, type: 'text' },
      { key: 'destinoEstoque', header: 'Est. Destino', width: 12, type: 'number' },
      { key: 'destinoVenda3m', header: 'Vda 3m Destino', width: 14, type: 'number' },
      { key: 'destinoCobertura', header: 'Cob. Destino', width: 12, type: 'number' },
      { key: 'quantidadeSugerida', header: 'Qtd Sugerida', width: 12, type: 'number' },
      { key: 'scorePrioridade', header: 'Score', width: 10, type: 'number' },
      { key: 'motivoScore', header: 'Motivo', width: 40, type: 'text' },
    ];

    const dados = activeJob.resultado.sugestoes.map((s) => ({
      referenceCode: s.referenceCode,
      referenceName: s.referenceName,
      cor: s.cor || '',
      tamanho: s.tamanho,
      curva: s.curva || '',
      origemLoja: s.origem.branchName,
      origemEstoque: s.origem.estoqueAtual,
      origemVenda3m: s.origem.giro3m,
      origemCobertura: s.origem.coberturaMeses,
      origemPrimeiraEntrada: s.origem.primeiraEntrada
        ? new Date(s.origem.primeiraEntrada).toLocaleDateString('pt-BR')
        : '',
      destinoLoja: s.destino.branchName,
      destinoEstoque: s.destino.estoqueAtual,
      destinoVenda3m: s.destino.giro3m,
      destinoCobertura: s.destino.coberturaMeses,
      quantidadeSugerida: s.quantidadeSugerida,
      scorePrioridade: s.scorePrioridade,
      motivoScore: s.motivoScore,
    }));

    exportToExcel({
      filename: `redistribuicao_${new Date().toISOString().slice(0, 10)}`,
      columns: colunas,
      data: dados,
    });
    showToast('Excel exportado com sucesso!', 'success');
  }

  const isJobEmAndamento = activeJob?.status === 'pending' || activeJob?.status === 'running';
  const temResultado = activeJob?.status === 'completed' && activeJob.resultado;

  return (
    <div className="space-y-6">
      {/* Cabecalho */}
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Sugestao de Redistribuicao</h1>
          <p className="text-gray-500 text-sm mt-1">
            Identifique oportunidades de redistribuir estoque entre lojas para otimizar cobertura.
          </p>
        </div>
        <a
          href="/pcp/configuracoes"
          className="text-sm text-[#6B5B95] hover:underline flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Configuracoes
        </a>
      </div>

      {/* Legenda da Sugestao */}
      <Card>
        <CardHeader>
          <CardTitle>Como funciona a sugestao</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <span className="inline-block w-5 h-5 bg-[#6B5B95]/20 border border-[#6B5B95] rounded shrink-0 mt-0.5"></span>
            <div>
              <p className="font-medium text-gray-900 text-sm">Loja Origem (Excesso)</p>
              <p className="text-xs text-gray-600 mt-1">
                Cobertura acima do ideal e produto ja passou do periodo de maturacao. Pode transferir para outra loja sem risco de ruptura.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <span className="inline-block w-5 h-5 bg-[#CC222E]/20 border border-[#CC222E] rounded shrink-0 mt-0.5"></span>
            <div>
              <p className="font-medium text-gray-900 text-sm">Loja Destino (Ruptura)</p>
              <p className="text-xs text-gray-600 mt-1">
                Cobertura abaixo do ideal. Esta loja ja vendeu este SKU antes e tem demanda historica comprovada.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <span className="inline-block w-5 h-5 bg-green-100 border border-green-500 rounded shrink-0 mt-0.5"></span>
            <div>
              <p className="font-medium text-gray-900 text-sm">Score de Prioridade</p>
              <p className="text-xs text-gray-600 mt-1">
                Considera: curva ABC (A=mais importante), diferenca de cobertura entre lojas, e giro historico no destino.
              </p>
            </div>
          </div>
        </div>
        {dadosBase && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              <strong>Cobertura ideal atual:</strong> {dadosBase.config.coberturaIdealMeses} meses &nbsp;|&nbsp;
              <strong>Periodo de maturacao:</strong> {dadosBase.config.maturacaoDias} dias &nbsp;|&nbsp;
              <strong>Lojas remetentes:</strong> {dadosBase.config.lojasRemetentes?.length || 0 > 0 ? dadosBase.config.lojasRemetentes?.length + ' selecionadas' : 'Todas'} &nbsp;|&nbsp;
              <strong>Lojas destinatarias:</strong> {dadosBase.config.lojasDestinatarias?.length || 0 > 0 ? dadosBase.config.lojasDestinatarias?.length + ' selecionadas' : 'Todas'}
            </p>
          </div>
        )}
      </Card>

      {/* Status do Job */}
      {activeJob && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Status do Calculo
              {isPolling && <span className="animate-pulse text-yellow-600 text-sm">(atualizando...)</span>}
            </CardTitle>
          </CardHeader>
          <div className="p-4">
            <div className="flex items-center gap-4">
              <Badge
                variant={
                  activeJob.status === 'completed'
                    ? 'success'
                    : activeJob.status === 'failed' || activeJob.status === 'timeout'
                      ? 'danger'
                      : 'warning'
                }
              >
                {activeJob.status === 'pending' && 'Aguardando...'}
                {activeJob.status === 'running' && 'Processando...'}
                {activeJob.status === 'completed' && 'Concluido'}
                {activeJob.status === 'failed' && 'Erro'}
                {activeJob.status === 'timeout' && 'Timeout'}
              </Badge>

              {activeJob.startedAt && (
                <span className="text-sm text-gray-500">
                  Iniciado: {new Date(activeJob.startedAt).toLocaleTimeString('pt-BR')}
                </span>
              )}

              {activeJob.completedAt && (
                <span className="text-sm text-gray-500">
                  Concluido: {new Date(activeJob.completedAt).toLocaleTimeString('pt-BR')}
                </span>
              )}

              <Button variant="outline" size="sm" onClick={limparJob} className="ml-auto">
                Limpar
              </Button>
            </div>

            {activeJob.errorMessage && (
              <p className="mt-2 text-sm text-red-600">{activeJob.errorMessage}</p>
            )}

            {temResultado && activeJob.resultado && (
              <div className="mt-4 grid grid-cols-4 gap-4">
                <div className="bg-gray-50 p-3 rounded">
                  <p className="text-xs text-gray-500">SKUs Analisados</p>
                  <p className="text-lg font-bold">{formatNumber(activeJob.resultado.kpis.skusAnalisados)}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <p className="text-xs text-gray-500">SKUs Elegiveis</p>
                  <p className="text-lg font-bold">{formatNumber(activeJob.resultado.kpis.skusElegiveis)}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <p className="text-xs text-gray-500">Sugestoes Criadas</p>
                  <p className="text-lg font-bold">{formatNumber(activeJob.resultado.kpis.sugestoesCriadas)}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <p className="text-xs text-gray-500">Pecas a Sugerir</p>
                  <p className="text-lg font-bold">{formatNumber(activeJob.resultado.kpis.pecasASugerir)}</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Botao de Iniciar Calculo */}
      {!isJobEmAndamento && !temResultado && (
        <div className="flex justify-center">
          <Button onClick={handleIniciarCalculo} disabled={isPolling} size="lg">
            {isPolling ? 'Calculando...' : 'Calcular Sugestoes'}
          </Button>
        </div>
      )}

      {/* Resumo por Loja */}
      {dadosBase && !temResultado && (
        <Card>
          <CardHeader>
            <CardTitle>Distribuicao por Loja</CardTitle>
          </CardHeader>
          <LoadingOverlay active={isLoadingBase}>
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell isHeader>Loja</TableCell>
                    <TableCell isHeader align="right">SKUs Excesso</TableCell>
                    <TableCell isHeader align="right">SKUs Ruptura</TableCell>
                    <TableCell isHeader align="right">Estoque Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dadosBase.distribuicaoPorLoja.map((loja) => (
                    <TableRow key={loja.branchCode}>
                      <TableCell className="font-medium">{loja.branchName}</TableCell>
                      <TableCell align="right">
                        <span className="text-blue-600">{formatNumber(loja.skusExcesso)}</span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="text-red-600">{formatNumber(loja.skusRuptura)}</span>
                      </TableCell>
                      <TableCell align="right">{formatNumber(loja.estoqueTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </LoadingOverlay>
        </Card>
      )}

      {/* Tabela de Sugestoes */}
      {temResultado && activeJob?.resultado?.sugestoes && activeJob.resultado.sugestoes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Sugestoes de Redistribuicao
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({sugestoesOrdenadas.length}
                {sugestoesOrdenadas.length !== activeJob.resultado.sugestoes.length &&
                  ` de ${activeJob.resultado.sugestoes.length}`}
                )
              </span>
            </CardTitle>
            <Button variant="secondary" size="sm" onClick={handleExportarExcel}>
              Exportar Excel
            </Button>
          </CardHeader>

          {/* Legenda do Score */}
          <div className="px-4 pb-3 flex flex-wrap items-center gap-4 text-xs text-gray-600 border-b border-gray-100">
            <span className="font-medium text-gray-700">Score:</span>
            <span className="flex items-center gap-1">
              <Badge variant="success">70+</Badge>
              <span>Alta prioridade</span>
            </span>
            <span className="flex items-center gap-1">
              <Badge variant="warning">40-69</Badge>
              <span>Media prioridade</span>
            </span>
            <span className="flex items-center gap-1">
              <Badge variant="default">&lt;40</Badge>
              <span>Baixa prioridade</span>
            </span>
            <span className="text-gray-400 ml-2">|</span>
            <span className="text-gray-500">
              Considera: curva ABC (40%), diferenca de cobertura (30%), giro no destino (30%)
            </span>
          </div>

          {/* Filtros de resultado */}
          <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 bg-gray-50">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Referencia</label>
              <input
                type="text"
                value={filtroResultadoReferencia}
                onChange={(e) => setFiltroResultadoReferencia(e.target.value)}
                placeholder="Buscar..."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-[#6B5B95] focus:border-[#6B5B95]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Cor</label>
              <input
                type="text"
                value={filtroResultadoCor}
                onChange={(e) => setFiltroResultadoCor(e.target.value)}
                placeholder="Buscar..."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-[#6B5B95] focus:border-[#6B5B95]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tamanho</label>
              <select
                value={filtroResultadoTamanho}
                onChange={(e) => setFiltroResultadoTamanho(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-[#6B5B95] focus:border-[#6B5B95]"
              >
                <option value="">Todos</option>
                {opcoesUnicas.tamanhos.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Curva</label>
              <select
                value={filtroResultadoCurva}
                onChange={(e) => setFiltroResultadoCurva(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-[#6B5B95] focus:border-[#6B5B95]"
              >
                <option value="">Todas</option>
                {opcoesUnicas.curvas.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Loja Origem</label>
              <select
                value={filtroResultadoOrigem}
                onChange={(e) => setFiltroResultadoOrigem(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-[#6B5B95] focus:border-[#6B5B95]"
              >
                <option value="">Todas</option>
                {opcoesUnicas.origens.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Loja Destino</label>
              <select
                value={filtroResultadoDestino}
                onChange={(e) => setFiltroResultadoDestino(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-[#6B5B95] focus:border-[#6B5B95]"
              >
                <option value="">Todas</option>
                {opcoesUnicas.destinos.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tabela com cabecalho fixo */}
          <div className="max-h-[600px] overflow-auto border-t border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {/* Grupo: Produto */}
                  <ThSort sortKey="referenceCode" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    Referencia
                  </ThSort>
                  <ThSort sortKey="cor" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    Cor
                  </ThSort>
                  <ThSort sortKey="tamanho" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    Tam
                  </ThSort>
                  <ThSort sortKey="curva" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="center" className="border-r-2 border-gray-300">
                    Curva
                  </ThSort>
                  {/* Grupo: Origem */}
                  <ThSort sortKey="origem" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    Origem
                  </ThSort>
                  <ThSort sortKey="primeiraEntrada" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right">
                    1a Ent.
                  </ThSort>
                  <ThSort sortKey="origemEstoque" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right">
                    Est.
                  </ThSort>
                  <ThSort sortKey="origemGiro" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right">
                    Vda 3m
                  </ThSort>
                  <ThSort sortKey="origemCobertura" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" className="border-r-2 border-gray-300">
                    Cob.
                  </ThSort>
                  {/* Grupo: Destino */}
                  <ThSort sortKey="destino" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    Destino
                  </ThSort>
                  <ThSort sortKey="destinoEstoque" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right">
                    Est.
                  </ThSort>
                  <ThSort sortKey="destinoGiro" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right">
                    Vda 3m
                  </ThSort>
                  <ThSort sortKey="destinoCobertura" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right">
                    Cob.
                  </ThSort>
                  <ThSort sortKey="quantidadeSugerida" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right">
                    Qtd
                  </ThSort>
                  <ThSort sortKey="scorePrioridade" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="center">
                    Score
                  </ThSort>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sugestoesOrdenadas.slice(0, 500).map((s, idx) => (
                  <tr
                    key={`${s.sku}-${s.origem.branchCode}-${s.destino.branchCode}-${idx}`}
                    className="hover:bg-gray-50"
                  >
                    {/* Grupo: Produto */}
                    <td className="px-2 py-2">
                      <div className="font-medium text-gray-900">{s.referenceCode}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[180px]" title={s.referenceName}>
                        {s.referenceName}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-gray-700">{s.cor || '-'}</td>
                    <td className="px-2 py-2 text-gray-700">{s.tamanho}</td>
                    <td className="px-2 py-2 text-center border-r-2 border-gray-200">
                      <Badge variant={s.curva === 'A' ? 'success' : s.curva === 'B' ? 'warning' : 'default'}>
                        {s.curva || '-'}
                      </Badge>
                    </td>
                    {/* Grupo: Origem */}
                    <td className="px-2 py-2 text-gray-700">{s.origem.branchName}</td>
                    <td className="px-2 py-2 text-right text-xs text-gray-500">
                      {s.origem.primeiraEntrada
                        ? new Date(s.origem.primeiraEntrada).toLocaleDateString('pt-BR')
                        : '-'}
                    </td>
                    <td className="px-2 py-2 text-right text-blue-600 font-medium">
                      {formatNumber(s.origem.estoqueAtual)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-gray-500">
                      {formatNumber(s.origem.giro3m)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-gray-500 border-r-2 border-gray-200">
                      {formatCobertura(s.origem.coberturaMeses)}
                    </td>
                    {/* Grupo: Destino */}
                    <td className="px-2 py-2 text-gray-700">{s.destino.branchName}</td>
                    <td className="px-2 py-2 text-right text-red-600 font-medium">
                      {formatNumber(s.destino.estoqueAtual)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-gray-500">
                      {formatNumber(s.destino.giro3m)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-gray-500">
                      {formatCobertura(s.destino.coberturaMeses)}
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-green-700">
                      {formatNumber(s.quantidadeSugerida)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Badge variant={s.scorePrioridade >= 70 ? 'success' : s.scorePrioridade >= 40 ? 'warning' : 'default'}>
                        {s.scorePrioridade}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sugestoesOrdenadas.length > 500 && (
            <div className="p-4 text-center text-sm text-gray-500 border-t border-gray-200">
              Mostrando 500 de {sugestoesOrdenadas.length} sugestoes. Exporte para Excel para ver todas.
            </div>
          )}
        </Card>
      )}

      {temResultado && activeJob?.resultado?.sugestoes?.length === 0 && (
        <Card>
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg">Nenhuma sugestao de redistribuicao encontrada</p>
            <p className="text-sm mt-2">
              Isso pode significar que o estoque ja esta bem distribuido entre as lojas.
            </p>
          </div>
        </Card>
      )}

      {temResultado && sugestoesOrdenadas.length === 0 && activeJob?.resultado?.sugestoes && activeJob.resultado.sugestoes.length > 0 && (
        <Card>
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg">Nenhuma sugestao corresponde aos filtros selecionados</p>
            <p className="text-sm mt-2">
              Total de sugestoes: {activeJob.resultado.sugestoes.length}. Ajuste os filtros para ver os resultados.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
