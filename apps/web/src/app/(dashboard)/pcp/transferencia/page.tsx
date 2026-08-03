'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { transferenciaApi, TransferenciaResponse, TransferenciaGrupo } from '@/lib/pcpApi';
import { pcpConfigApi } from '@/lib/api';
import { FILIAIS } from '@/lib/utils';

const RELATORIO = 'gestao_transferencia';

// Cores da paleta BBTK para o dashboard
const STATUS_COLORS = {
  ruptura: { bg: 'bg-[#CC222E]/10', text: 'text-[#CC222E]', bar: 'bg-[#CC222E]', label: 'Ruptura' },
  ok: { bg: 'bg-[#F5A623]/10', text: 'text-[#F5A623]', bar: 'bg-[#F5A623]', label: 'Equilibrio' },
  excesso: { bg: 'bg-[#6B5B95]/10', text: 'text-[#6B5B95]', bar: 'bg-[#6B5B95]', label: 'Excesso' },
};

export default function TransferenciaPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [referencia, setReferencia] = useState('');
  const [agruparPorCor, setAgruparPorCor] = useState(true);
  const [dados, setDados] = useState<TransferenciaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Filtros
  const [coresSelecionadas, setCoresSelecionadas] = useState<string[]>([]);
  const [lojasSelecionadas, setLojasSelecionadas] = useState<number[]>([]);
  const [statusSelecionados, setStatusSelecionados] = useState<string[]>(['ruptura', 'excesso']);

  // Thresholds de cobertura e configuracao
  const [limiteVerde, setLimiteVerde] = useState(75);
  const [limiteAmarelo, setLimiteAmarelo] = useState(120);
  const [diasAnalise, setDiasAnalise] = useState(30);

  // Estado de expansao
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  // Estado de ordenacao
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Opcoes para os filtros
  const coresOptions = useMemo(() => {
    if (!dados) return [];
    const cores = new Set<string>();
    dados.grupos.forEach(g => { if (g.cor) cores.add(g.cor); });
    return Array.from(cores).sort().map(c => ({ value: c, label: c }));
  }, [dados]);

  const lojasOptions = useMemo(() => {
    if (!dados) return [];
    const lojas = new Map<number, string>();
    dados.grupos.forEach(g => {
      g.lojas.forEach(l => {
        if (!lojas.has(l.branchCode)) {
          lojas.set(l.branchCode, FILIAIS[l.branchCode] || l.branchName);
        }
      });
    });
    return Array.from(lojas.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([code, name]) => ({ value: code, label: name }));
  }, [dados]);

  const statusOptions = [
    { value: 'ruptura', label: 'Ruptura (< ' + limiteVerde + 'd)' },
    { value: 'ok', label: 'Equilibrio (' + limiteVerde + '-' + limiteAmarelo + 'd)' },
    { value: 'excesso', label: 'Excesso (> ' + limiteAmarelo + 'd)' },
  ];

  // Carregar configuracao e dados iniciais
  useEffect(() => {
    async function loadConfigAndData() {
      if (!token) return;
      try {
        const configRes = await pcpConfigApi.getTransferenciaConfig(token, RELATORIO);
        setLimiteVerde(configRes.config.transferenciaCoberturaDiasVerde);
        setLimiteAmarelo(configRes.config.transferenciaCoberturaDiasAmarelo);
        setDiasAnalise(configRes.config.diasAnaliseVendas);

        setIsLoading(true);
        const resultado = await transferenciaApi.getTransferencia(token, '', agruparPorCor);
        setDados(resultado);
      } catch (error) {
        console.error('Erro ao carregar dados iniciais:', error);
        showToast('Erro ao carregar dados', 'error');
      } finally {
        setIsLoading(false);
      }
    }
    loadConfigAndData();
  }, [token, agruparPorCor, showToast]);

  const buscar = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const resultado = await transferenciaApi.getTransferencia(token, referencia.trim(), agruparPorCor);
      setDados(resultado);
      if (resultado.grupos.length === 0) {
        showToast('Nenhum estoque encontrado', 'info');
      }
    } catch (error) {
      showToast('Erro ao buscar dados', 'error');
      console.error(error);
      setDados(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, referencia, agruparPorCor, showToast]);

  function getStatus(cobertura: number): 'ruptura' | 'ok' | 'excesso' | null {
    if (!cobertura || cobertura === 0 || !Number.isFinite(cobertura)) return null;
    if (cobertura >= 9999) return 'excesso';
    if (cobertura < limiteVerde) return 'ruptura';
    if (cobertura < limiteAmarelo) return 'ok';
    return 'excesso';
  }

  function getBgClass(status: 'ruptura' | 'ok' | 'excesso' | null): string {
    if (!status) return '';
    if (status === 'ruptura') return 'bg-[#CC222E]/10';
    if (status === 'ok') return 'bg-[#F5A623]/10';
    return 'bg-[#6B5B95]/10';
  }

  function toNumber(value: unknown): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function lojaTemEstoque(loja: TransferenciaGrupo['lojas'][number]): boolean {
    return Object.values(loja.estoquePorTamanho).some((qtd) => toNumber(qtd) > 0);
  }

  function getEstoqueTotalGrupo(grupo: TransferenciaGrupo): number {
    return grupo.lojas.reduce((total, loja) => {
      return total + Object.values(loja.estoquePorTamanho).reduce((t, qtd) => t + toNumber(qtd), 0);
    }, 0);
  }

  // Funcao de filtro memoizada para reagir a mudancas nos filtros
  const grupoDeveMostrar = useCallback((grupo: TransferenciaGrupo): boolean => {
    if (getEstoqueTotalGrupo(grupo) <= 0) return false;

    // Filtro de COR
    if (coresSelecionadas.length > 0) {
      if (!grupo.cor || !coresSelecionadas.includes(grupo.cor)) return false;
    }

    // Filtro de LOJA
    if (lojasSelecionadas.length > 0) {
      const temLoja = grupo.lojas.some(l => lojasSelecionadas.includes(l.branchCode) && l.estoqueTotal > 0);
      if (!temLoja) return false;
    }

    // Filtro de STATUS - se nenhum selecionado, nao mostra nada
    if (statusSelecionados.length === 0) return false;
    // Se todos os 3 selecionados, mostra tudo que passou nos outros filtros
    if (statusSelecionados.length === 3) return true;

    // Verifica se o grupo tem pelo menos um SKU com um dos status selecionados
    for (const loja of grupo.lojas) {
      if (lojasSelecionadas.length > 0 && !lojasSelecionadas.includes(loja.branchCode)) continue;
      for (const tamanho of grupo.tamanhos) {
        const cobertura = loja.coberturaPorTamanho[tamanho];
        if (cobertura === undefined || cobertura === null) continue;
        const status = getStatus(cobertura);
        if (status && statusSelecionados.includes(status)) return true;
      }
    }
    return false;
  }, [coresSelecionadas, lojasSelecionadas, statusSelecionados, limiteVerde, limiteAmarelo]);

  // Lista de grupos filtrados - reage a mudancas nos filtros em tempo real
  const gruposFiltrados = useMemo(() => {
    if (!dados) return [];
    return dados.grupos.filter(grupoDeveMostrar);
  }, [dados, grupoDeveMostrar]);

  function getLojasFiltradasDoGrupo(grupo: TransferenciaGrupo): TransferenciaGrupo['lojas'] {
    let lojas = grupo.lojas.filter(lojaTemEstoque);
    if (lojasSelecionadas.length > 0) {
      lojas = lojas.filter(l => lojasSelecionadas.includes(l.branchCode));
    }
    return lojas.sort((a, b) => a.branchCode - b.branchCode);
  }

  // Dashboard: contagem de SKUs por status e loja
  const dashboardData = useMemo(() => {
    if (!dados) return null;

    const lojasParaDash = lojasSelecionadas.length > 0
      ? lojasOptions.filter(l => lojasSelecionadas.includes(l.value as number))
      : lojasOptions;

    const porLoja: Record<number, { ruptura: number; ok: number; excesso: number }> = {};
    const totais = { ruptura: 0, ok: 0, excesso: 0 };

    lojasParaDash.forEach(l => {
      porLoja[l.value as number] = { ruptura: 0, ok: 0, excesso: 0 };
    });

    // Determina quais status mostrar no dashboard
    const statusParaMostrar = statusSelecionados.length === 0 ? [] :
      statusSelecionados.length === 3 ? ['ruptura', 'ok', 'excesso'] : statusSelecionados;

    dados.grupos.forEach(grupo => {
      // Aplicar filtro de cor
      if (coresSelecionadas.length > 0 && (!grupo.cor || !coresSelecionadas.includes(grupo.cor))) return;

      grupo.lojas.forEach(loja => {
        if (!porLoja[loja.branchCode]) return;

        grupo.tamanhos.forEach(tamanho => {
          const estoque = toNumber(loja.estoquePorTamanho[tamanho]);
          if (estoque <= 0) return;

          const cobertura = toNumber(loja.coberturaPorTamanho[tamanho]);
          const status = getStatus(cobertura);
          // So conta se o status esta no filtro
          if (status && statusParaMostrar.includes(status)) {
            porLoja[loja.branchCode][status]++;
            totais[status]++;
          }
        });
      });
    });

    const maxTotal = Math.max(...Object.values(porLoja).map(v => v.ruptura + v.ok + v.excesso), 1);

    return { porLoja, totais, maxTotal, lojasParaDash, statusParaMostrar };
  }, [dados, coresSelecionadas, lojasSelecionadas, lojasOptions, statusSelecionados, limiteVerde, limiteAmarelo]);

  function toggleGrupo(grupoKey: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(grupoKey)) next.delete(grupoKey);
      else next.add(grupoKey);
      return next;
    });
  }

  function expandirTodos() {
    const keys = gruposFiltrados.map(g => agruparPorCor && g.cor ? `${g.referencia}|${g.cor}` : g.referencia);
    setExpandidos(new Set(keys));
  }

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function getSortValue(grupo: TransferenciaGrupo, key: string): string | number {
    if (key === 'referencia') return grupo.referencia;
    if (key === 'cor') return grupo.cor || '';
    return grupo.lojas.reduce((acc, l) => acc + toNumber(l.estoquePorTamanho[key]), 0);
  }

  function ThSort({ label, sortKey: key, align = 'left', className = '' }: { label: string; sortKey: string; align?: 'left' | 'center' | 'right'; className?: string }) {
    const isActive = sortKey === key;
    return (
      <TableCell isHeader align={align} className={`cursor-pointer select-none ${className} ${isActive ? 'bg-[#6B5B95]/10' : 'hover:bg-gray-50'}`} onClick={() => handleSort(key)}>
        <span className={isActive ? 'text-[#6B5B95] font-semibold' : 'text-gray-700'}>
          {label}
          {isActive && <span className="ml-1 text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>}
        </span>
      </TableCell>
    );
  }

  function renderDashboard() {
    if (!dashboardData || dashboardData.lojasParaDash.length === 0) return null;

    const { porLoja, totais, maxTotal, lojasParaDash, statusParaMostrar } = dashboardData;

    // Filtra apenas os status selecionados para os cards
    const statusAtivos = (['ruptura', 'ok', 'excesso'] as const).filter(s => statusParaMostrar.includes(s));
    if (statusAtivos.length === 0) return null;

    // Grid dinamico baseado na quantidade de status selecionados
    const gridCols = statusAtivos.length === 1 ? 'grid-cols-1 max-w-xs' :
                     statusAtivos.length === 2 ? 'grid-cols-2 max-w-lg' : 'grid-cols-3';

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distribuicao de SKUs por Status</CardTitle>
        </CardHeader>

        {/* Totais gerais - apenas status selecionados */}
        <div className={`grid ${gridCols} gap-4 mb-6`}>
          {statusAtivos.map(status => (
            <div key={status} className={`rounded-lg p-4 ${STATUS_COLORS[status].bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[status].bar}`}></div>
                <span className={`text-sm font-medium ${STATUS_COLORS[status].text}`}>{STATUS_COLORS[status].label}</span>
              </div>
              <div className={`text-2xl font-bold ${STATUS_COLORS[status].text}`}>{totais[status]}</div>
              <div className="text-xs text-gray-500">SKUs</div>
            </div>
          ))}
        </div>

        {/* Barras por loja - apenas status selecionados */}
        <div className="space-y-3">
          {lojasParaDash.map(loja => {
            const counts = porLoja[loja.value as number];
            const total = statusAtivos.reduce((acc, s) => acc + counts[s], 0);
            if (total === 0) return null;

            return (
              <div key={loja.value} className="flex items-center gap-3">
                <div className="w-24 text-sm text-gray-700 font-medium truncate">{loja.label}</div>
                <div className="flex-1 flex h-6 rounded overflow-hidden bg-gray-100">
                  {statusAtivos.map(status => {
                    if (counts[status] <= 0) return null;
                    const pct = (counts[status] / maxTotal) * 100;
                    return (
                      <div key={status} className={`${STATUS_COLORS[status].bar} flex items-center justify-center`} style={{ width: `${pct}%` }}>
                        <span className="text-xs text-white font-medium">{counts[status]}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="w-12 text-right text-sm text-gray-500">{total}</div>
              </div>
            );
          })}
        </div>

        {/* Legenda - apenas status selecionados */}
        <div className="flex justify-center gap-6 mt-4 pt-4 border-t">
          {statusAtivos.map(status => (
            <div key={status} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[status].bar}`}></div>
              <span className="text-xs text-gray-600">{STATUS_COLORS[status].label}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // Grupos ordenados para renderizacao
  const gruposOrdenados = useMemo(() => {
    if (!sortKey) return gruposFiltrados;
    return [...gruposFiltrados].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal as string) : Number(aVal) - Number(bVal);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [gruposFiltrados, sortKey, sortDir]);

  function renderMatriz() {
    if (!dados || dados.grupos.length === 0) return null;
    if (gruposOrdenados.length === 0) return null;

    const todosOsTamanhos = new Set<string>();
    gruposOrdenados.forEach(g => {
      g.tamanhos.forEach(t => todosOsTamanhos.add(t));
      g.lojas.forEach(l => Object.entries(l.estoquePorTamanho).forEach(([t, q]) => { if (toNumber(q) > 0) todosOsTamanhos.add(t); }));
    });

    const tamanhosOrdenados = Array.from(todosOsTamanhos).sort((a, b) => {
      const ordem = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'EG'];
      const aIdx = ordem.indexOf(a.toUpperCase());
      const bIdx = ordem.indexOf(b.toUpperCase());
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      const aNum = parseInt(a, 10), bNum = parseInt(b, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    });

    return (
      <Card>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-gray-500">{gruposOrdenados.length} referencias</span>
          <div className="flex gap-2">
            <Button onClick={expandirTodos} variant="secondary" size="sm">Expandir Todos</Button>
            <Button onClick={() => setExpandidos(new Set())} variant="secondary" size="sm">Recolher</Button>
          </div>
        </div>
        {/* Container com altura maxima e scroll vertical/horizontal */}
        <div className="overflow-auto max-h-[600px] border border-gray-200 rounded-lg">
          <Table className="overflow-visible" tableClassName="text-xs">
            <TableHead className="sticky top-0 z-20 bg-white shadow-sm">
              <TableRow>
                <TableCell isHeader className="sticky left-0 bg-white z-30 w-10"></TableCell>
                <ThSort label="REF" sortKey="referencia" className="sticky left-10 bg-white z-30 min-w-[100px]" />
                <ThSort label="COR" sortKey="cor" className="sticky left-[140px] bg-white z-30 min-w-[80px]" />
                <TableCell isHeader className="sticky left-[220px] bg-white z-30 min-w-[100px]">LOJA</TableCell>
                {tamanhosOrdenados.map(t => <ThSort key={t} label={t} sortKey={t} align="center" className="min-w-[50px]" />)}
              </TableRow>
            </TableHead>
            <TableBody>
              {gruposOrdenados.map(grupo => {
                const grupoKey = agruparPorCor && grupo.cor ? `${grupo.referencia}|${grupo.cor}` : grupo.referencia;
                const expandido = expandidos.has(grupoKey);
                const totais: Record<string, number> = {};
                grupo.lojas.forEach(l => Object.entries(l.estoquePorTamanho).forEach(([t, q]) => { totais[t] = (totais[t] || 0) + toNumber(q); }));

                return (
                  <React.Fragment key={grupoKey}>
                    <TableRow className="bg-gray-50 font-medium">
                      <TableCell className="sticky left-0 bg-gray-50 z-10">
                        <button onClick={() => toggleGrupo(grupoKey)} className="text-gray-500 hover:text-[#6B5B95] font-bold w-6 h-6 flex items-center justify-center">
                          {expandido ? '−' : '+'}
                        </button>
                      </TableCell>
                      <TableCell className="sticky left-10 bg-gray-50 z-10">{grupo.referencia}</TableCell>
                      <TableCell className="sticky left-[140px] bg-gray-50 z-10 text-gray-600">{grupo.cor || '-'}</TableCell>
                      <TableCell className="sticky left-[220px] bg-gray-50 z-10 text-gray-500 text-xs">TOTAL</TableCell>
                      {tamanhosOrdenados.map(t => <TableCell key={t} align="center" className="bg-gray-50">{toNumber(totais[t]) > 0 ? totais[t] : '-'}</TableCell>)}
                    </TableRow>
                    {expandido && getLojasFiltradasDoGrupo(grupo).map(loja => (
                      <TableRow key={`${grupoKey}-${loja.branchCode}`}>
                        <TableCell className="sticky left-0 bg-white z-10"></TableCell>
                        <TableCell className="sticky left-10 bg-white z-10"></TableCell>
                        <TableCell className="sticky left-[140px] bg-white z-10"></TableCell>
                        <TableCell className="sticky left-[220px] bg-white z-10 pl-4 text-gray-700">{FILIAIS[loja.branchCode] || loja.branchName}</TableCell>
                        {tamanhosOrdenados.map(t => {
                          const qtd = toNumber(loja.estoquePorTamanho[t]);
                          const cobertura = toNumber(loja.coberturaPorTamanho[t]);
                          const status = getStatus(cobertura);
                          // So aplica cor se o status estiver selecionado no filtro
                          const statusFiltrado = status && (statusSelecionados.length === 3 || statusSelecionados.includes(status));
                          return (
                            <TableCell key={t} align="center" className={`${statusFiltrado ? getBgClass(status) : ''} ${qtd === 0 ? 'text-gray-300' : ''}`}>
                              {qtd > 0 ? qtd : '-'}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Gestao de Transferencia</h1>
        <p className="text-gray-500 text-sm mt-1">Visualize a distribuicao de estoque por loja e tamanho para facilitar transferencias entre filiais.</p>
      </div>

      {/* Filtros */}
      <Card>
        <div className="flex flex-wrap gap-4 items-end">
          <Input
            label="Referencia"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') buscar(); }}
            placeholder="Buscar referencia..."
            className="w-48"
          />
          <MultiSelect
            label="Loja"
            options={lojasOptions}
            selected={lojasSelecionadas}
            onChange={(v) => setLojasSelecionadas(v as number[])}
            allLabel="Todas as Lojas"
            className="w-48"
          />
          {agruparPorCor && coresOptions.length > 0 && (
            <MultiSelect
              label="Cor"
              options={coresOptions}
              selected={coresSelecionadas}
              onChange={(v) => setCoresSelecionadas(v as string[])}
              allLabel="Todas as Cores"
              enableSearch
              searchPlaceholder="Buscar cor..."
              className="w-48"
            />
          )}
          <MultiSelect
            label="Status"
            options={statusOptions}
            selected={statusSelecionados}
            onChange={(v) => setStatusSelecionados(v as string[])}
            allLabel="Todos"
            className="w-52"
          />
          <label className="flex items-center gap-2 cursor-pointer pb-2">
            <input type="checkbox" checked={agruparPorCor} onChange={(e) => setAgruparPorCor(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-[#6B5B95] focus:ring-[#6B5B95]" />
            <span className="text-sm text-gray-700">Separar por cor</span>
          </label>
          <Button onClick={buscar} isLoading={isLoading}>Atualizar</Button>
        </div>
      </Card>

      {isLoading && (
        <Card>
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-[#6B5B95]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-sm text-gray-600">Carregando dados...</span>
            </div>
          </div>
        </Card>
      )}

      {!isLoading && dados && dados.grupos.length > 0 && renderDashboard()}

      {!isLoading && renderMatriz()}

      {!isLoading && dados && dados.grupos.length > 0 && gruposFiltrados.length === 0 && (
        <Card className="border-[#F5A623]/30 bg-[#F5A623]/5">
          <p className="text-sm text-[#F5A623]">Nenhuma referencia encontrada com os filtros selecionados.</p>
        </Card>
      )}

      {!isLoading && dados && dados.grupos.length === 0 && (
        <Card className="border-[#F5A623]/30 bg-[#F5A623]/5">
          <p className="text-sm text-[#F5A623]">Nenhum estoque encontrado{referencia ? ` para "${referencia}"` : ''}.</p>
        </Card>
      )}

      {/* Legenda de parametros */}
      {!isLoading && dados && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
            <span className="font-medium text-gray-600">Parametros:</span>
            <span>
              <span className="font-medium">Periodo de analise:</span> {diasAnalise} dias
            </span>
            <span>
              <span className="font-medium">Cobertura:</span>{' '}
              <span className="text-[#CC222E]">Ruptura &lt; {limiteVerde}d</span>
              {' | '}
              <span className="text-[#F5A623]">Equilibrio {limiteVerde}-{limiteAmarelo}d</span>
              {' | '}
              <span className="text-[#6B5B95]">Excesso &gt; {limiteAmarelo}d</span>
            </span>
            <span>
              <span className="font-medium">Giro:</span> Estoque / (Vendas / {diasAnalise} dias)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
