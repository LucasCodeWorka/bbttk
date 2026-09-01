'use client';

import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { raioXApi, RaioXFiltro, RaioXProduto, RaioXProdutoSearch, RaioXResponse } from '@/lib/pcpApi';
import { cn } from '@/lib/utils';

const GRADES = ['UN', 'P', 'M', 'G', 'GG', '2', '4', '6', '8', '10'];
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

type Props = { token: string | null };
type RaioXTotais = RaioXProduto['totalGeral'];
type CampoSoma = 'estoqueInicial' | 'transferencias' | 'vendasVarejo' | 'vendasAtacado' | 'estoqueFinal' | 'pecasEmProducao';

const CAMPOS_SOMA: CampoSoma[] = ['estoqueInicial', 'transferencias', 'vendasVarejo', 'vendasAtacado', 'estoqueFinal', 'pecasEmProducao'];
const METRICAS_RESUMO: Array<{ campo: CampoSoma; rotulo: string; destaque?: 'movimento' | 'venda' | 'estoque' | 'producao' }> = [
  { campo: 'estoqueInicial', rotulo: 'EST. INICIAL' },
  { campo: 'transferencias', rotulo: 'MOV. ESTOQUE', destaque: 'movimento' },
  { campo: 'vendasVarejo', rotulo: 'V. VAREJO', destaque: 'venda' },
  { campo: 'vendasAtacado', rotulo: 'V. ATACADO', destaque: 'venda' },
  { campo: 'estoqueFinal', rotulo: 'EST. FINAL', destaque: 'estoque' },
  { campo: 'pecasEmProducao', rotulo: 'EM PRODUCAO', destaque: 'producao' },
];

function tamanhoNormalizado(tamanho: string) {
  const valor = tamanho.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (valor === 'UNICO' || valor === 'U') return 'UN';
  return valor;
}

function Cobertura({ value, config }: { value: number; config: RaioXResponse['config'] }) {
  if (value >= 999) return <>INF</>;
  const cor = value <= config.coberturaLimiteVerde ? 'text-green-700' : value >= config.coberturaLimiteVermelho ? 'text-red-700' : '';
  return <span className={cor}>{value.toFixed(1)}</span>;
}

function criarTotais(): RaioXTotais {
  return {
    estoqueInicial: 0,
    transferencias: 0,
    vendasVarejo: 0,
    vendasAtacado: 0,
    estoqueFinal: 0,
    pecasEmProducao: 0,
    cobertura: 999,
  };
}

function calcularCobertura(totais: RaioXTotais, dataInicio: string, dataFim: string) {
  const venda = totais.vendasVarejo + totais.vendasAtacado;
  if (!venda) return 999;
  const dias = Math.max(1, Math.floor((Date.parse(`${dataFim}T00:00:00Z`) - Date.parse(`${dataInicio}T00:00:00Z`)) / 86400000) + 1);
  return totais.estoqueFinal / ((venda / dias) * 30);
}

function somarTotais(destino: RaioXTotais, origem: RaioXTotais) {
  for (const campo of CAMPOS_SOMA) destino[campo] += origem[campo];
}

function MetricasLinha({ totais }: { totais: RaioXTotais }) {
  return <>
    {METRICAS_RESUMO.map(({ campo, rotulo, destaque }) => (
      <span
        key={campo}
        className={cn(
          'rounded-lg border border-gray-100 bg-white/85 px-3 py-2 text-right shadow-sm transition-colors',
          destaque === 'movimento' && 'bg-yellow-50/80 text-yellow-900',
          destaque === 'venda' && 'bg-blue-50/70 text-blue-900',
          destaque === 'estoque' && 'bg-green-50/70 text-green-900',
          destaque === 'producao' && 'bg-purple-50/70 text-purple-900'
        )}
      >
        <span className="block whitespace-nowrap text-[10px] font-bold uppercase tracking-wide text-gray-500">{rotulo}</span>
        <span className="block text-sm font-semibold text-gray-950">{numero.format(totais[campo])}</span>
      </span>
    ))}
  </>;
}

export default function RaioXCompacto({ token }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);
  const primeiroDia = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [filtro, setFiltro] = useState<RaioXFiltro>({ dataInicio: primeiroDia, dataFim: hoje, canal: 'todos' });
  const [texto, setTexto] = useState('');
  const [resultadosBusca, setResultadosBusca] = useState<RaioXProdutoSearch[]>([]);
  const [selecionados, setSelecionados] = useState<RaioXProdutoSearch[]>([]);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<RaioXResponse | null>(null);
  const [referenciasAbertas, setReferenciasAbertas] = useState<Set<string>>(new Set());
  const [coresAbertas, setCoresAbertas] = useState<Set<string>>(new Set());
  const [lojasAbertas, setLojasAbertas] = useState<Set<string>>(new Set());
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);

  const buscarProdutos = async (valor: string) => {
    if (!token) return;
    try {
      const encontrados = await raioXApi.buscarProdutos(token, valor, 20);
      setResultadosBusca(encontrados);
      setAberto(true);
    } catch { setResultadosBusca([]); }
  };

  const alterarBusca = (valor: string) => {
    setTexto(valor);
    if (timeout.current) clearTimeout(timeout.current);
    if (valor.trim().length < 2) { setResultadosBusca([]); setAberto(false); return; }
    timeout.current = setTimeout(() => buscarProdutos(valor), 300);
  };

  const carregar = async () => {
    if (!token || !selecionados.length) return;
    setCarregando(true); setErro(null);
    try {
      setDados(await raioXApi.getRaioX(token, { ...filtro, referencias: selecionados.map(item => item.reference_code) }));
      setReferenciasAbertas(new Set()); setCoresAbertas(new Set()); setLojasAbertas(new Set());
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível carregar o relatório.'); }
    finally { setCarregando(false); }
  };

  const porReferencia = useMemo(() => {
    const mapa = new Map<string, RaioXProduto[]>();
    for (const produto of dados?.produtos || []) {
      const lista = mapa.get(produto.referenceCode) || [];
      lista.push(produto); mapa.set(produto.referenceCode, lista);
    }
    return [...mapa.entries()].filter(() => false);
  }, [dados]);
  const referenciasExibidas = useMemo(() => {
    const mapa = new Map<string, RaioXProduto[]>();
    for (const produto of dados?.produtos || []) {
      const lista = mapa.get(produto.referenceCode) || [];
      lista.push(produto);
      mapa.set(produto.referenceCode, lista);
    }
    return [...mapa.entries()];
  }, [dados]);
  const configCobertura = dados?.config || { coberturaLimiteVerde: 4, coberturaLimiteVermelho: 4.01 };

  const totaisPorCor = useMemo(() => (dados?.produtos || []).map((produto) => ({
    referenceCode: produto.referenceCode,
    referenceName: produto.referenceName,
    cor: produto.cor || 'SEM COR',
    ...produto.totalGeral,
  })).filter(() => false), [dados]);

  const lojaPossuiDados = (loja: RaioXProduto['lojas'][number]) => {
    const total = loja.totais;
    return total.estoqueInicial !== 0 || total.transferencias !== 0 ||
      total.vendasVarejo !== 0 || total.vendasAtacado !== 0 ||
      total.estoqueFinal !== 0 || total.pecasEmProducao !== 0;
  };

  const resumo = useMemo(() => {
    const mapa = new Map<number, { branchCode: number; branchName: string; estoqueInicial: number; transferencias: number; vendasVarejo: number; vendasAtacado: number; estoqueFinal: number; pecasEmProducao: number; cobertura: number }>();
    for (const produto of dados?.produtos || []) for (const loja of produto.lojas) {
      const atual = mapa.get(loja.branchCode) || { branchCode: loja.branchCode, branchName: loja.branchName, estoqueInicial: 0, transferencias: 0, vendasVarejo: 0, vendasAtacado: 0, estoqueFinal: 0, pecasEmProducao: 0, cobertura: 999 };
      atual.estoqueInicial += loja.totais.estoqueInicial; atual.transferencias += loja.totais.transferencias;
      atual.vendasVarejo += loja.totais.vendasVarejo; atual.vendasAtacado += loja.totais.vendasAtacado;
      atual.estoqueFinal += loja.totais.estoqueFinal; atual.pecasEmProducao += loja.totais.pecasEmProducao;
      const venda = atual.vendasVarejo + atual.vendasAtacado;
      const dias = Math.max(1, Math.floor((Date.parse(`${filtro.dataFim}T00:00:00Z`) - Date.parse(`${filtro.dataInicio}T00:00:00Z`)) / 86400000) + 1);
      atual.cobertura = venda ? atual.estoqueFinal / ((venda / dias) * 30) : 999;
      mapa.set(loja.branchCode, atual);
    }
    return [...mapa.values()].filter(() => false);
  }, [dados, filtro.dataInicio, filtro.dataFim]);

  const toggle = (set: Dispatch<SetStateAction<Set<string>>>, chave: string) => set(anterior => {
    const proximo = new Set(anterior);
    if (proximo.has(chave)) proximo.delete(chave);
    else proximo.add(chave);
    return proximo;
  });

  const totalizarReferencia = (cores: RaioXProduto[]) => {
    const totais = criarTotais();
    for (const cor of cores) somarTotais(totais, cor.totalGeral);
    totais.cobertura = calcularCobertura(totais, filtro.dataInicio, filtro.dataFim);
    return totais;
  };

  return <div className="p-6 space-y-5">
    <div><h1 className="text-2xl font-bold text-gray-900">Raio X do Produto</h1><p className="text-sm text-gray-600 mt-1">Selecione as referencias e abra apenas o nivel que deseja conferir: referencia, cor, empresa e grade.</p></div>
    <Card>
      <div className="grid gap-4 md:grid-cols-4">
        <label className="text-sm font-medium text-gray-700">Data inicio<input type="date" value={filtro.dataInicio} onChange={e => setFiltro({ ...filtro, dataInicio: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-gray-700">Data fim<input type="date" value={filtro.dataFim} onChange={e => setFiltro({ ...filtro, dataFim: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-gray-700">Canal<select value={filtro.canal} onChange={e => setFiltro({ ...filtro, canal: e.target.value as RaioXFiltro['canal'] })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="todos">Todos</option><option value="varejo">Varejo</option><option value="atacado">Atacado</option></select></label>
        <div className="relative"><label className="text-sm font-medium text-gray-700">Referencias<input value={texto} onChange={e => alterarBusca(e.target.value)} placeholder="Codigo ou nome" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          {aberto && resultadosBusca.length > 0 && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">{resultadosBusca.map(item => <button type="button" key={item.reference_code} onClick={() => { if (!selecionados.some(s => s.reference_code === item.reference_code)) setSelecionados([...selecionados, item]); setTexto(''); setAberto(false); }} className="block w-full border-b px-3 py-2 text-left text-sm hover:bg-gray-50"><strong>{item.reference_code}</strong><br /><span className="text-xs text-gray-600">{item.reference_name}</span></button>)}</div>}</div>
      </div>
      {selecionados.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selecionados.map(item => <button type="button" key={item.reference_code} onClick={() => setSelecionados(selecionados.filter(s => s.reference_code !== item.reference_code))} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-red-50">{item.reference_code} ×</button>)}</div>}
      <div className="mt-4 flex items-center gap-3"><button type="button" disabled={!selecionados.length || carregando} onClick={carregar} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{carregando ? 'Carregando...' : 'Atualizar relatorio'}</button>{!selecionados.length && <span className="text-sm text-gray-500">Selecione ao menos uma referencia.</span>}</div>
    </Card>
    {erro && <Card className="border-red-200 bg-red-50 text-sm text-red-800">{erro}</Card>}
    {referenciasExibidas.map(([referencia, cores]) => {
      const primeira = cores[0];
      const referenciaAberta = referenciasAbertas.has(referencia);
      const totaisReferencia = totalizarReferencia(cores);
      return <Card key={referencia} className="overflow-hidden border-gray-200 p-0 shadow-sm ring-1 ring-gray-50">
        <button
          type="button"
          onClick={() => toggle(setReferenciasAbertas, referencia)}
          className="grid w-full grid-cols-[minmax(18rem,1fr)_repeat(6,minmax(5rem,auto))_2rem] items-center gap-x-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 via-white to-white px-5 py-4 text-left text-xs transition-colors hover:from-red-50/70 hover:to-white"
        >
          <span className="flex min-w-0 items-center gap-3 text-base">
            <span className="h-9 w-1 rounded-full bg-[var(--bbtk-red)]" />
            <span className="min-w-0">
              <span className="font-bold text-gray-950">{referencia}</span>
              <span className="mx-2 text-gray-300">-</span>
              <span className="text-gray-800">{primeira.referenceName}</span>
              {primeira.emPromocao && <small className="ml-3 rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-800">PROMOCAO</small>}
            </span>
          </span>
          <MetricasLinha totais={totaisReferencia} />
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-base font-semibold text-gray-700 shadow-sm">{referenciaAberta ? '-' : '+'}</span>
        </button>
        {referenciaAberta && <div className="space-y-3 bg-gray-50/70 p-3">
          {cores.map(cor => {
            const chave = `${referencia}|${cor.cor}`;
            const corAberta = coresAbertas.has(chave);
            const lojas = cor.lojas.filter(lojaPossuiDados);
            return <div key={chave} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => toggle(setCoresAbertas, chave)}
                className="grid w-full grid-cols-[minmax(14rem,1fr)_repeat(6,minmax(5rem,auto))_2rem] items-center gap-x-3 px-4 py-3 text-left text-xs transition-colors hover:bg-yellow-50/60"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900">
                  <span className="rounded-full bg-[var(--bbtk-yellow)]/25 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-yellow-800">Cor</span>
                  <span className="truncate">{cor.cor}</span>
                </span>
                <MetricasLinha totais={cor.totalGeral} />
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-base font-semibold text-gray-700">{corAberta ? '-' : '+'}</span>
              </button>
              {corAberta && <div className="space-y-2 border-t border-gray-100 bg-gray-50/80 p-3">
                {lojas.length === 0 && <p className="text-sm text-gray-500">Nenhuma loja possui dados para esta cor.</p>}
                {lojas.map(loja => {
                  const chaveLoja = `${referencia}|${cor.cor}|${loja.branchCode}`;
                  const lojaAberta = lojasAbertas.has(chaveLoja);
                  const grades = new Map(loja.grades.map(grade => [tamanhoNormalizado(grade.tamanho), grade]));
                  const linhas = [
                    ['ESTOQUE INICIAL', 'estoqueInicial'],
                    ['MOV. ESTOQUE', 'transferencias'],
                    ['V. VAREJO', 'vendasVarejo'],
                    ['V. ATACADO', 'vendasAtacado'],
                    ['ESTOQUE FINAL', 'estoqueFinal'],
                    ['EM PRODUCAO', 'pecasEmProducao'],
                  ] as const;
                  return <div key={loja.branchCode} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => toggle(setLojasAbertas, chaveLoja)}
                      className="grid w-full grid-cols-[minmax(14rem,1fr)_repeat(6,minmax(5rem,auto))_2rem] items-center gap-x-3 px-4 py-3 text-left text-xs transition-colors hover:bg-purple-50/50"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900">
                        <span className="rounded-full bg-purple-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--bbtk-purple)]">Loja</span>
                        <span className="truncate">{loja.branchName}</span>
                      </span>
                      <MetricasLinha totais={loja.totais} />
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-base font-semibold text-gray-700">{lojaAberta ? '-' : '+'}</span>
                    </button>
                    {lojaAberta && <div className="border-t border-gray-100 bg-white p-3">
                      <Table className="rounded-lg border border-gray-200" tableClassName="min-w-[720px]">
                        <TableHead className="bg-gray-100"><TableRow><TableCell isHeader className="text-gray-700">METRICA</TableCell>{GRADES.map(grade => <TableCell isHeader align="right" key={grade} className="text-gray-700">{grade}</TableCell>)}<TableCell isHeader align="right" className="text-gray-900">TOTAL</TableCell></TableRow></TableHead>
                        <TableBody>
                          {linhas.map(([rotulo, campo]) => <TableRow key={campo}><TableCell className="font-medium text-gray-700">{rotulo}</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}>{numero.format(grades.get(grade)?.[campo] || 0)}</TableCell>)}<TableCell align="right" className="bg-gray-50 font-semibold text-gray-950">{numero.format(loja.totais[campo])}</TableCell></TableRow>)}
                          <TableRow><TableCell className="font-semibold text-gray-700">COBERTURA</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}><Cobertura value={grades.get(grade)?.cobertura || 999} config={configCobertura} /></TableCell>)}<TableCell align="right" className="bg-gray-50 font-semibold"><Cobertura value={loja.totais.cobertura} config={configCobertura} /></TableCell></TableRow>
                        </TableBody>
                      </Table>
                    </div>}
                  </div>;
                })}
              </div>}
            </div>;
          })}
        </div>}
      </Card>;
    })}
    {dados && totaisPorCor.length > 0 && <Card><h2 className="mb-1 text-base font-bold">Totais por cor</h2><p className="mb-3 text-xs text-gray-500">Soma de todas as lojas selecionadas. Quando houver agrupamento cadastrado, o nome do grupo substitui as cores originais.</p><div className="overflow-x-auto"><Table><TableHead><TableRow><TableCell isHeader>REFERÃŠNCIA</TableCell><TableCell isHeader>COR / GRUPO</TableCell><TableCell isHeader align="right">EST. INICIAL</TableCell><TableCell isHeader align="right">MOV. ESTOQUE</TableCell><TableCell isHeader align="right">V. VAREJO</TableCell><TableCell isHeader align="right">V. ATACADO</TableCell><TableCell isHeader align="right">EST. FINAL</TableCell><TableCell isHeader align="right">COB.</TableCell><TableCell isHeader align="right">EM PRODUÃ‡ÃƒO</TableCell></TableRow></TableHead><TableBody>{totaisPorCor.map((cor) => <TableRow key={`${cor.referenceCode}|${cor.cor}`}><TableCell><strong>{cor.referenceCode}</strong><br /><span className="text-xs text-gray-500">{cor.referenceName}</span></TableCell><TableCell className="font-medium">{cor.cor}</TableCell><TableCell align="right">{numero.format(cor.estoqueInicial)}</TableCell><TableCell align="right">{numero.format(cor.transferencias)}</TableCell><TableCell align="right">{numero.format(cor.vendasVarejo)}</TableCell><TableCell align="right">{numero.format(cor.vendasAtacado)}</TableCell><TableCell align="right">{numero.format(cor.estoqueFinal)}</TableCell><TableCell align="right"><Cobertura value={cor.cobertura} config={configCobertura} /></TableCell><TableCell align="right">{numero.format(cor.pecasEmProducao)}</TableCell></TableRow>)}</TableBody></Table></div></Card>}
    {dados && resumo.length > 0 && <Card><h2 className="mb-3 text-base font-bold">Resumo por loja</h2><Table><TableHead><TableRow><TableCell isHeader>LOJA</TableCell><TableCell isHeader align="right">EST. INICIAL</TableCell><TableCell isHeader align="right">MOV. ESTOQUE</TableCell><TableCell isHeader align="right">V. VAREJO</TableCell><TableCell isHeader align="right">V. ATACADO</TableCell><TableCell isHeader align="right">EST. FINAL</TableCell><TableCell isHeader align="right">COB.</TableCell><TableCell isHeader align="right">EM PRODUÇÃO</TableCell></TableRow></TableHead><TableBody>{resumo.map(loja => <TableRow key={loja.branchCode}><TableCell className="font-medium">{loja.branchName}</TableCell><TableCell align="right">{numero.format(loja.estoqueInicial)}</TableCell><TableCell align="right">{numero.format(loja.transferencias)}</TableCell><TableCell align="right">{numero.format(loja.vendasVarejo)}</TableCell><TableCell align="right">{numero.format(loja.vendasAtacado)}</TableCell><TableCell align="right">{numero.format(loja.estoqueFinal)}</TableCell><TableCell align="right"><Cobertura value={loja.cobertura} config={configCobertura} /></TableCell><TableCell align="right">{numero.format(loja.pecasEmProducao)}</TableCell></TableRow>)}</TableBody></Table></Card>}
    {porReferencia.map(([referencia, cores]) => { const primeira = cores[0]; const refAberta = referenciasAbertas.has(referencia); return <Card key={referencia} className="p-0 overflow-hidden"><button type="button" onClick={() => toggle(setReferenciasAbertas, referencia)} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50"><span><strong>{referencia}</strong> — {primeira.referenceName} {primeira.emPromocao && <small className="ml-2 rounded bg-red-100 px-2 py-1 text-red-800">PROMOÇÃO</small>}</span><span>{refAberta ? '−' : '+'}</span></button>{refAberta && <div className="border-t bg-gray-50 p-3 space-y-2">{cores.map(cor => { const chave = `${referencia}|${cor.cor}`; const corAberta = coresAbertas.has(chave); return <div key={chave} className="rounded border bg-white"><button type="button" onClick={() => toggle(setCoresAbertas, chave)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold hover:bg-gray-50">COR: {cor.cor}<span>{corAberta ? '−' : '+'}</span></button>{corAberta && <div className="overflow-x-auto border-t p-3 space-y-4">{cor.lojas.map(loja => { const grades = new Map(loja.grades.map(grade => [tamanhoNormalizado(grade.tamanho), grade])); const linhas = [['ESTOQUE INICIAL', 'estoqueInicial'], ['MOV. ESTOQUE', 'transferencias'], ['V. VAREJO', 'vendasVarejo'], ['V. ATACADO', 'vendasAtacado'], ['ESTOQUE FINAL', 'estoqueFinal'], ['PEÇAS EM PRODUÇÃO', 'pecasEmProducao']] as const; return <div key={loja.branchCode}><h3 className="mb-1 text-sm font-bold">{loja.branchName}</h3><Table><TableHead><TableRow><TableCell isHeader>MÉTRICA</TableCell>{GRADES.map(grade => <TableCell isHeader align="right" key={grade}>{grade}</TableCell>)}<TableCell isHeader align="right">TOTAL</TableCell></TableRow></TableHead><TableBody>{linhas.map(([rotulo, campo]) => <TableRow key={campo}><TableCell>{rotulo}</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}>{numero.format(grades.get(grade)?.[campo] || 0)}</TableCell>)}<TableCell align="right" className="font-semibold">{numero.format(loja.totais[campo])}</TableCell></TableRow>)}<TableRow><TableCell className="font-semibold">COBERTURA</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}><Cobertura value={grades.get(grade)?.cobertura || 999} config={configCobertura} /></TableCell>)}<TableCell align="right" className="font-semibold"><Cobertura value={loja.totais.cobertura} config={configCobertura} /></TableCell></TableRow></TableBody></Table></div>; })}</div>}</div>; })}</div>}</Card>; })}
    {dados && !dados.produtos.length && <Card className="text-center text-sm text-gray-600">Nenhum produto encontrado para as referências selecionadas.</Card>}
  </div>;
}
