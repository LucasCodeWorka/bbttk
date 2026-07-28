'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { metasApi, ComissoesResponse, VendedorComissao, ComissaoCelula } from '@/lib/api';
import { formatMoney, FILIAIS, MESES } from '@/lib/utils';
import { exportToCsv } from '@/lib/exportCsv';
import { useAuth } from '@/contexts/AuthContext';

function nomeFilialComissao(code: number, fallback?: string) {
  if (code === 2) return 'ATACADO';
  return fallback || FILIAIS[code] || `Filial ${code}`;
}

export default function ComissoesPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [diaInicio, setDiaInicio] = useState(1);
  const [diaFim, setDiaFim] = useState(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [vendedoresSelecionados, setVendedoresSelecionados] = useState<string[]>([]);
  const [dados, setDados] = useState<ComissoesResponse | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const comissoesScrollRef = useRef<HTMLDivElement>(null);
  const comissoesTopScrollRef = useRef<HTMLDivElement>(null);
  const [comissoesScrollWidth, setComissoesScrollWidth] = useState(0);

  const carregarDados = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchCodes = filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined;
      const res = await metasApi.getComissoes(ano, mes, branchCodes, diaInicio, diaFim);
      setDados(res);
    } catch (error) {
      console.error('Erro ao carregar comissoes:', error);
    } finally {
      setIsLoading(false);
    }
  }, [ano, mes, diaInicio, diaFim, filiaisSelecionadas]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const filiaisDisponiveis = Object.entries(FILIAIS)
    .filter(([code]) => {
      if (user?.role === 'admin') return true;
      return user?.branchCodes.includes(parseInt(code));
    })
    .map(([code, name]) => ({ value: parseInt(code), label: nomeFilialComissao(parseInt(code), name) }));

  const anoOptions = Array.from({ length: 4 }, (_, i) => {
    const year = new Date().getFullYear() + 1 - i;
    return { value: year, label: String(year) };
  });
  const mesOptions = MESES.slice(1).map((m, i) => ({ value: i + 1, label: m }));
  const ultimoDiaMesSelecionado = useMemo(() => new Date(ano, mes, 0).getDate(), [ano, mes]);
  const diaOptions = useMemo(() => Array.from({ length: ultimoDiaMesSelecionado }, (_, i) => ({ value: i + 1, label: String(i + 1) })), [ultimoDiaMesSelecionado]);

  useEffect(() => {
    setDiaInicio((prev) => Math.min(prev, ultimoDiaMesSelecionado));
    setDiaFim((prev) => Math.min(Math.max(prev, diaInicio), ultimoDiaMesSelecionado));
  }, [ultimoDiaMesSelecionado, diaInicio]);

  const niveis = dados?.niveis || [];

  const filiaisMatriz = useMemo(() => {
    const codes = new Set<number>();
    (dados?.vendedores || []).forEach((v) => v.filiais.forEach((c) => codes.add(c)));
    return Array.from(codes).sort((a, b) => nomeFilialComissao(a).localeCompare(nomeFilialComissao(b)));
  }, [dados]);

  const vendedorOptions = useMemo(() => {
    return (dados?.vendedores || [])
      .map((v) => ({ value: String(v.seller_code), label: v.seller_name || `Vendedor ${v.seller_code}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [dados]);

  // Filtro de vendedor e so de exibicao (client-side) - os dados ja vem carregados
  // com todos os vendedores do periodo/filial, entao nao precisa recarregar da API.
  const vendedoresFiltrados = useMemo(() => {
    const base = dados?.vendedores || [];
    if (vendedoresSelecionados.length === 0) return base;
    const selecionadosNum = new Set(vendedoresSelecionados.map(Number));
    return base.filter((v) => selecionadosNum.has(v.seller_code));
  }, [dados, vendedoresSelecionados]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function getSortValue(v: VendedorComissao, key: string): number | string {
    if (key === 'seller_name') return v.seller_name;
    if (key.startsWith('nivel_')) return (v[key as keyof VendedorComissao] as number) ?? 0;
    return (v[key as keyof VendedorComissao] as number) ?? 0;
  }

  const vendedoresOrdenados = useMemo(() => {
    const base = vendedoresFiltrados;
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
  }, [vendedoresFiltrados, sortKey, sortDir]);

  // Uma linha por combinacao (vendedor, loja) - nao agrupa varias lojas do mesmo
  // vendedor numa linha so, porque cada loja tem meta/nivel/comissao proprios.
  type LinhaComissao = ComissaoCelula & { seller_code: number; seller_name: string };

  const linhas: LinhaComissao[] = useMemo(() => {
    return vendedoresFiltrados.flatMap((v) =>
      v.celulas.map((c) => ({ ...c, seller_code: v.seller_code, seller_name: v.seller_name }))
    );
  }, [vendedoresFiltrados]);

  function getSortValueLinha(l: LinhaComissao, key: string): number | string {
    if (key === 'seller_name') return l.seller_name;
    if (key === 'branch_name') return l.branch_code;
    return (l[key as keyof LinhaComissao] as number) ?? 0;
  }

  const linhasOrdenadas = useMemo(() => {
    if (!sortKey) return linhas;
    const arr = [...linhas];
    arr.sort((a, b) => {
      const va = getSortValueLinha(a, sortKey);
      const vb = getSortValueLinha(b, sortKey);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * (sortDir === 'asc' ? 1 : -1);
      }
      return (va - vb) * (sortDir === 'asc' ? 1 : -1);
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, sortKey, sortDir]);

  function ThSort({ label, sortKeyName, align = 'right' }: { label: React.ReactNode; sortKeyName: string; align?: 'left' | 'right' | 'center' }) {
    const active = sortKey === sortKeyName;
    return (
      <TableCell isHeader align={align} className="whitespace-nowrap" onClick={() => handleSort(sortKeyName)}>
        {label}
        {active && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </TableCell>
    );
  }


  function sincronizarComissoesPeloTopo() {
    const topo = comissoesTopScrollRef.current;
    const tabela = comissoesScrollRef.current;
    if (!topo || !tabela) return;
    tabela.scrollLeft = topo.scrollLeft;
  }

  useEffect(() => {
    const tabela = comissoesScrollRef.current;
    const topo = comissoesTopScrollRef.current;
    if (!tabela || !topo) return;

    let frame = 0;
    const atualizarLargura = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setComissoesScrollWidth(tabela.scrollWidth);
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
  }, [linhasOrdenadas.length, niveis.length, isLoading]);

  function exportarExcel() {
    if (!dados) return;
    exportToCsv(
      `comissoes-${ano}-${String(mes).padStart(2, '0')}`,
      [
        { header: 'Vendedor', value: (l: LinhaComissao) => l.seller_name },
        { header: 'Loja', value: (l: LinhaComissao) => nomeFilialComissao(l.branch_code, l.branch_name) },
        { header: 'Faturamento', value: (l: LinhaComissao) => l.faturamento },
        ...niveis.map((n) => ({
          header: n.nivel_nome,
          value: (l: LinhaComissao) => (l[`nivel_${n.nivel_ordem}` as keyof LinhaComissao] as number) ?? 0,
        })),
        { header: 'Nivel Atingido', value: (l: LinhaComissao) => niveis.find((n) => n.nivel_ordem === l.nivel_atingido)?.nivel_nome ?? '-' },
        { header: 'Resultado %', value: (l: LinhaComissao) => l.resultado_pct },
        { header: '% Comissao', value: (l: LinhaComissao) => l.comissao_pct },
        { header: 'Comissao', value: (l: LinhaComissao) => l.comissao_valor },
      ],
      linhasOrdenadas
    );
  }

  function exportarPdf() {
    window.print();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comissoes</h1>
          <p className="text-gray-500 text-sm mt-1">
            {MESES[mes]} de {ano} - dias {diaInicio} a {diaFim}
          </p>
        </div>

        <div className="print:hidden flex flex-wrap items-end gap-3">
          <Select
            value={ano}
            onChange={(e) => setAno(parseInt(e.target.value))}
            options={anoOptions}
            label="Ano"
            className="w-24"
          />
          <Select
            value={mes}
            onChange={(e) => setMes(parseInt(e.target.value))}
            options={mesOptions}
            label="Mes"
            className="w-32"
          />
          <Select
            value={diaInicio}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              setDiaInicio(value);
              setDiaFim((prev) => Math.max(prev, value));
            }}
            options={diaOptions}
            label="Dia inicio"
            className="w-28"
          />
          <Select
            value={diaFim}
            onChange={(e) => setDiaFim(Math.max(parseInt(e.target.value), diaInicio))}
            options={diaOptions}
            label="Dia fim"
            className="w-24"
          />
          <FilialMultiSelect
            selected={filiaisSelecionadas}
            onChange={setFiliaisSelecionadas}
            options={filiaisDisponiveis}
            label="Filial"
            className="w-52"
          />
          <ClassificacaoMultiSelect
            selected={vendedoresSelecionados}
            onChange={setVendedoresSelecionados}
            options={vendedorOptions}
            label="Vendedor"
            className="w-52"
          />
          <Button onClick={carregarDados} isLoading={isLoading}>
            Atualizar
          </Button>
        </div>
      </div>

      {/* Realizado vs Meta + Canal + Top3 */}
      <LoadingOverlay active={isLoading} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-[var(--bbtk-red)]">
          <CardTitle>Realizado vs Meta</CardTitle>
          <div className="mt-2">
            <p className="text-2xl font-bold text-gray-900">
              {formatMoney(dados?.resumo.realizado || 0)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Meta: {formatMoney(dados?.resumo.meta || 0)}
            </p>
            <div className="mt-2">
              <Badge variant={(dados?.resumo.resultado_pct || 0) >= 100 ? 'success' : 'warning'}>
                Resultado: {(dados?.resumo.resultado_pct || 0).toFixed(1)}%
              </Badge>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Canal</CardTitle>
          <div className="mt-2 space-y-2">
            {(dados?.canal || []).map((c) => (
              <div key={c.canal} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                <span className="font-medium text-gray-700">{c.nome}</span>
                <div className="text-right">
                  <p className="font-semibold">{formatMoney(c.faturamento)}</p>
                  <p className="text-xs text-gray-500">{c.pct_meta.toFixed(1)}% da meta</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Faturamento Top3</CardTitle>
          <div className="mt-2 space-y-2">
            {(dados?.top3 || []).map((v, i) => (
              <div key={v.seller_code} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                <span className="flex items-center gap-2">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white ${
                    i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                  }`}>
                    {i + 1}
                  </span>
                  <span className="truncate max-w-[140px]" title={v.seller_name}>{v.seller_name}</span>
                </span>
                <span className="font-semibold">{formatMoney(v.faturamento)}</span>
              </div>
            ))}
            {(!dados || dados.top3.length === 0) && (
              <p className="text-sm text-gray-400">Sem dados</p>
            )}
          </div>
        </Card>
      </LoadingOverlay>

      {/* Tabela de vendedores */}
      <Card>
        <CardHeader>
          <CardTitle>Analise Geral (Realizado vs Meta por Vendedor)</CardTitle>
          <div className="print:hidden flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportarExcel}>
              Exportar Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportarPdf}>
              Exportar PDF
            </Button>
          </div>
        </CardHeader>
        {!isLoading && (!dados || vendedoresFiltrados.length === 0) ? (
          <div className="py-10 text-center text-gray-500">Nenhum vendedor com vendas nesse periodo</div>
        ) : (
          <LoadingOverlay active={isLoading}>
          <div
            ref={comissoesTopScrollRef}
            onScroll={sincronizarComissoesPeloTopo}
            className="print:hidden overflow-x-auto overflow-y-hidden h-4 mb-1"
          >
            <div style={{ width: comissoesScrollWidth, height: 1 }} />
          </div>
          <Table ref={comissoesScrollRef} className="[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <TableHead>
              <TableRow>
                <TableCell isHeader>#</TableCell>
                <ThSort label="Vendedor" sortKeyName="seller_name" align="left" />
                <ThSort label="Loja" sortKeyName="branch_name" align="left" />
                <ThSort label="Faturamento" sortKeyName="faturamento" />
                {niveis.map((n) => (
                  <ThSort
                    key={n.nivel_ordem}
                    sortKeyName={`nivel_${n.nivel_ordem}`}
                    label={
                      <>
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-1"
                          style={{ backgroundColor: n.nivel_cor }}
                        />
                        {n.nivel_nome}
                      </>
                    }
                  />
                ))}
                <ThSort label="Resultado" sortKeyName="resultado_pct" align="center" />
                <ThSort label="% Comissao" sortKeyName="comissao_pct" align="center" />
                <ThSort label="Comissao" sortKeyName="comissao_valor" />
              </TableRow>
            </TableHead>
            <TableBody>
              {linhasOrdenadas.map((l, i) => {
                const nivelInfo = niveis.find((n) => n.nivel_ordem === l.nivel_atingido);
                return (
                  <TableRow key={`${l.seller_code}-${l.branch_code}`}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{l.seller_name}</TableCell>
                    <TableCell className="whitespace-nowrap">{nomeFilialComissao(l.branch_code, l.branch_name)}</TableCell>
                    <TableCell align="right" className="whitespace-nowrap">{formatMoney(l.faturamento)}</TableCell>
                    {niveis.map((n) => {
                      const alvo = l[`nivel_${n.nivel_ordem}` as keyof typeof l] as number;
                      const atingiu = l.nivel_atingido >= n.nivel_ordem && alvo > 0;
                      return (
                        <TableCell
                          key={n.nivel_ordem}
                          align="right"
                          className={`whitespace-nowrap ${atingiu ? 'font-semibold' : 'text-gray-400'}`}
                        >
                          {alvo > 0 ? formatMoney(alvo) : '-'}
                        </TableCell>
                      );
                    })}
                    <TableCell align="center" className="whitespace-nowrap">
                      {nivelInfo ? (
                        <Badge
                          className="text-white"
                          style={{ backgroundColor: nivelInfo.nivel_cor }}
                          variant="default"
                        >
                          {nivelInfo.nivel_nome} ({l.resultado_pct.toFixed(1)}%)
                        </Badge>
                      ) : (
                        <span className="text-gray-400 text-sm">{l.resultado_pct.toFixed(1)}%</span>
                      )}
                    </TableCell>
                    <TableCell align="center" className="whitespace-nowrap">{l.comissao_pct.toFixed(1)}%</TableCell>
                    <TableCell align="right" className="whitespace-nowrap font-semibold">
                      {formatMoney(l.comissao_valor)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {vendedoresFiltrados.length > 0 && (
              <tfoot>
                <TableRow isHighlighted>
                  <TableCell className="font-bold" colSpan={3}>TOTAL</TableCell>
                  <TableCell align="right" className="font-bold whitespace-nowrap">
                    {formatMoney(vendedoresFiltrados.reduce((s, v) => s + v.faturamento, 0))}
                  </TableCell>
                  {niveis.map((n) => (
                    <TableCell key={n.nivel_ordem} />
                  ))}
                  <TableCell align="center">-</TableCell>
                  <TableCell align="center">-</TableCell>
                  <TableCell align="right" className="font-bold whitespace-nowrap">
                    {formatMoney(vendedoresFiltrados.reduce((s, v) => s + v.comissao_valor, 0))}
                  </TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
          </LoadingOverlay>
        )}
      </Card>

      {/* Matriz Vendedor x Loja */}
      <Card>
        <CardHeader>
          <CardTitle>Matriz Vendedor x Loja</CardTitle>
        </CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-2">
          Faturamento de cada vendedor por loja no periodo - deixa claro em qual(is) loja(s)
          cada vendedor vendeu e qual comissao se aplica em cada uma.
        </p>
        {!isLoading && (!dados || vendedoresFiltrados.length === 0 || filiaisMatriz.length === 0) ? (
          <div className="py-10 text-center text-gray-500">Nenhum dado para montar a matriz</div>
        ) : (
          <LoadingOverlay active={isLoading} className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell isHeader align="left">Vendedor</TableCell>
                  {filiaisMatriz.map((code) => (
                    <TableCell key={code} isHeader align="right" className="whitespace-nowrap">
                      {nomeFilialComissao(code)}
                    </TableCell>
                  ))}
                  <TableCell isHeader align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vendedoresOrdenados.map((v) => {
                  const celulaPorFilial = new Map(v.celulas.map((c) => [c.branch_code, c]));
                  return (
                    <TableRow key={v.seller_code}>
                      <TableCell className="font-medium whitespace-nowrap">{v.seller_name}</TableCell>
                      {filiaisMatriz.map((code) => {
                        const celula = celulaPorFilial.get(code);
                        return (
                          <TableCell key={code} align="right" className="whitespace-nowrap">
                            {celula ? (
                              <div>
                                {formatMoney(celula.faturamento)}
                                <div className="text-xs text-gray-400">
                                  {celula.comissao_pct.toFixed(1)}% = {formatMoney(celula.comissao_valor)}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell align="right" className="font-semibold whitespace-nowrap">
                        {formatMoney(v.faturamento)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </LoadingOverlay>
        )}
      </Card>
    </div>
  );
}
