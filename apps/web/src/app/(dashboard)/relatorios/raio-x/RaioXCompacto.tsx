'use client';

import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/Table';
import { raioXApi, RaioXFiltro, RaioXProduto, RaioXProdutoSearch, RaioXResponse } from '@/lib/pcpApi';

const GRADES = ['UN', 'P', 'M', 'G', 'GG', '2', '4', '6', '8', '10'];
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

type Props = { token: string | null };

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
      setReferenciasAbertas(new Set()); setCoresAbertas(new Set());
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
    const proximo = new Set(anterior); proximo.has(chave) ? proximo.delete(chave) : proximo.add(chave); return proximo;
  });

  return <div className="p-6 space-y-5">
    <div><h1 className="text-2xl font-bold text-gray-900">Raio X do Produto</h1><p className="text-sm text-gray-600 mt-1">Selecione as referencias e abra apenas o nivel que deseja conferir: referencia, cor e grade.</p></div>
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
      return <Card key={referencia} className="p-0 overflow-hidden">
        <div className="border-b bg-gray-50 px-5 py-4">
          <strong>{referencia}</strong><span className="mx-2">-</span>{primeira.referenceName}
          {primeira.emPromocao && <small className="ml-3 rounded bg-red-100 px-2 py-1 text-red-800">PROMOCAO</small>}
        </div>
        <div className="space-y-2 p-3">
          {cores.map(cor => {
            const chave = `${referencia}|${cor.cor}`;
            const corAberta = coresAbertas.has(chave);
            const lojas = cor.lojas.filter(lojaPossuiDados);
            return <div key={chave} className="rounded border bg-white">
              <button
                type="button"
                onClick={() => toggle(setCoresAbertas, chave)}
                className="grid w-full grid-cols-[minmax(11rem,1fr)_repeat(6,minmax(4rem,auto))_1.5rem] items-center gap-x-3 px-4 py-3 text-left text-xs hover:bg-gray-50"
              >
                <span className="text-sm font-semibold">COR: {cor.cor}</span>
                <span><b>EST. INICIAL</b><br />{numero.format(cor.totalGeral.estoqueInicial)}</span>
                <span><b>TRANSF.</b><br />{numero.format(cor.totalGeral.transferencias)}</span>
                <span><b>V. VAREJO</b><br />{numero.format(cor.totalGeral.vendasVarejo)}</span>
                <span><b>V. ATACADO</b><br />{numero.format(cor.totalGeral.vendasAtacado)}</span>
                <span><b>EST. FINAL</b><br />{numero.format(cor.totalGeral.estoqueFinal)}</span>
                <span><b>EM PRODUCAO</b><br />{numero.format(cor.totalGeral.pecasEmProducao)}</span>
                <span className="text-base">{corAberta ? '-' : '+'}</span>
              </button>
              {corAberta && <div className="border-t bg-gray-50 p-3 space-y-4">
                {lojas.length === 0 && <p className="text-sm text-gray-500">Nenhuma loja possui dados para esta cor.</p>}
                {lojas.map(loja => {
                  const grades = new Map(loja.grades.map(grade => [tamanhoNormalizado(grade.tamanho), grade]));
                  const linhas = [
                    ['ESTOQUE INICIAL', 'estoqueInicial'],
                    ['TRANSFERENCIAS', 'transferencias'],
                    ['V. VAREJO', 'vendasVarejo'],
                    ['V. ATACADO', 'vendasAtacado'],
                    ['ESTOQUE FINAL', 'estoqueFinal'],
                    ['EM PRODUCAO', 'pecasEmProducao'],
                  ] as const;
                  return <div key={loja.branchCode} className="overflow-x-auto">
                    <h3 className="mb-2 text-sm font-bold">{loja.branchName}</h3>
                    <Table>
                      <TableHead><TableRow><TableCell isHeader>METRICA</TableCell>{GRADES.map(grade => <TableCell isHeader align="right" key={grade}>{grade}</TableCell>)}<TableCell isHeader align="right">TOTAL</TableCell></TableRow></TableHead>
                      <TableBody>
                        {linhas.map(([rotulo, campo]) => <TableRow key={campo}><TableCell>{rotulo}</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}>{numero.format(grades.get(grade)?.[campo] || 0)}</TableCell>)}<TableCell align="right" className="font-semibold">{numero.format(loja.totais[campo])}</TableCell></TableRow>)}
                        <TableRow><TableCell className="font-semibold">COBERTURA</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}><Cobertura value={grades.get(grade)?.cobertura || 999} config={configCobertura} /></TableCell>)}<TableCell align="right" className="font-semibold"><Cobertura value={loja.totais.cobertura} config={configCobertura} /></TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </div>;
                })}
              </div>}
            </div>;
          })}
        </div>
      </Card>;
    })}
    {dados && totaisPorCor.length > 0 && <Card><h2 className="mb-1 text-base font-bold">Totais por cor</h2><p className="mb-3 text-xs text-gray-500">Soma de todas as lojas selecionadas. Quando houver agrupamento cadastrado, o nome do grupo substitui as cores originais.</p><div className="overflow-x-auto"><Table><TableHead><TableRow><TableCell isHeader>REFERÃŠNCIA</TableCell><TableCell isHeader>COR / GRUPO</TableCell><TableCell isHeader align="right">EST. INICIAL</TableCell><TableCell isHeader align="right">TRANSF.</TableCell><TableCell isHeader align="right">V. VAREJO</TableCell><TableCell isHeader align="right">V. ATACADO</TableCell><TableCell isHeader align="right">EST. FINAL</TableCell><TableCell isHeader align="right">COB.</TableCell><TableCell isHeader align="right">EM PRODUÃ‡ÃƒO</TableCell></TableRow></TableHead><TableBody>{totaisPorCor.map((cor) => <TableRow key={`${cor.referenceCode}|${cor.cor}`}><TableCell><strong>{cor.referenceCode}</strong><br /><span className="text-xs text-gray-500">{cor.referenceName}</span></TableCell><TableCell className="font-medium">{cor.cor}</TableCell><TableCell align="right">{numero.format(cor.estoqueInicial)}</TableCell><TableCell align="right">{numero.format(cor.transferencias)}</TableCell><TableCell align="right">{numero.format(cor.vendasVarejo)}</TableCell><TableCell align="right">{numero.format(cor.vendasAtacado)}</TableCell><TableCell align="right">{numero.format(cor.estoqueFinal)}</TableCell><TableCell align="right"><Cobertura value={cor.cobertura} config={configCobertura} /></TableCell><TableCell align="right">{numero.format(cor.pecasEmProducao)}</TableCell></TableRow>)}</TableBody></Table></div></Card>}
    {dados && resumo.length > 0 && <Card><h2 className="mb-3 text-base font-bold">Resumo por loja</h2><Table><TableHead><TableRow><TableCell isHeader>LOJA</TableCell><TableCell isHeader align="right">EST. INICIAL</TableCell><TableCell isHeader align="right">TRANSF.</TableCell><TableCell isHeader align="right">V. VAREJO</TableCell><TableCell isHeader align="right">V. ATACADO</TableCell><TableCell isHeader align="right">EST. FINAL</TableCell><TableCell isHeader align="right">COB.</TableCell><TableCell isHeader align="right">EM PRODUÇÃO</TableCell></TableRow></TableHead><TableBody>{resumo.map(loja => <TableRow key={loja.branchCode}><TableCell className="font-medium">{loja.branchName}</TableCell><TableCell align="right">{numero.format(loja.estoqueInicial)}</TableCell><TableCell align="right">{numero.format(loja.transferencias)}</TableCell><TableCell align="right">{numero.format(loja.vendasVarejo)}</TableCell><TableCell align="right">{numero.format(loja.vendasAtacado)}</TableCell><TableCell align="right">{numero.format(loja.estoqueFinal)}</TableCell><TableCell align="right"><Cobertura value={loja.cobertura} config={configCobertura} /></TableCell><TableCell align="right">{numero.format(loja.pecasEmProducao)}</TableCell></TableRow>)}</TableBody></Table></Card>}
    {porReferencia.map(([referencia, cores]) => { const primeira = cores[0]; const refAberta = referenciasAbertas.has(referencia); return <Card key={referencia} className="p-0 overflow-hidden"><button type="button" onClick={() => toggle(setReferenciasAbertas, referencia)} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50"><span><strong>{referencia}</strong> — {primeira.referenceName} {primeira.emPromocao && <small className="ml-2 rounded bg-red-100 px-2 py-1 text-red-800">PROMOÇÃO</small>}</span><span>{refAberta ? '−' : '+'}</span></button>{refAberta && <div className="border-t bg-gray-50 p-3 space-y-2">{cores.map(cor => { const chave = `${referencia}|${cor.cor}`; const corAberta = coresAbertas.has(chave); return <div key={chave} className="rounded border bg-white"><button type="button" onClick={() => toggle(setCoresAbertas, chave)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold hover:bg-gray-50">COR: {cor.cor}<span>{corAberta ? '−' : '+'}</span></button>{corAberta && <div className="overflow-x-auto border-t p-3 space-y-4">{cor.lojas.map(loja => { const grades = new Map(loja.grades.map(grade => [tamanhoNormalizado(grade.tamanho), grade])); const linhas = [['ESTOQUE INICIAL', 'estoqueInicial'], ['TRANSFERÊNCIAS', 'transferencias'], ['V. VAREJO', 'vendasVarejo'], ['V. ATACADO', 'vendasAtacado'], ['ESTOQUE FINAL', 'estoqueFinal'], ['PEÇAS EM PRODUÇÃO', 'pecasEmProducao']] as const; return <div key={loja.branchCode}><h3 className="mb-1 text-sm font-bold">{loja.branchName}</h3><Table><TableHead><TableRow><TableCell isHeader>MÉTRICA</TableCell>{GRADES.map(grade => <TableCell isHeader align="right" key={grade}>{grade}</TableCell>)}<TableCell isHeader align="right">TOTAL</TableCell></TableRow></TableHead><TableBody>{linhas.map(([rotulo, campo]) => <TableRow key={campo}><TableCell>{rotulo}</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}>{numero.format(grades.get(grade)?.[campo] || 0)}</TableCell>)}<TableCell align="right" className="font-semibold">{numero.format(loja.totais[campo])}</TableCell></TableRow>)}<TableRow><TableCell className="font-semibold">COBERTURA</TableCell>{GRADES.map(grade => <TableCell align="right" key={grade}><Cobertura value={grades.get(grade)?.cobertura || 999} config={configCobertura} /></TableCell>)}<TableCell align="right" className="font-semibold"><Cobertura value={loja.totais.cobertura} config={configCobertura} /></TableCell></TableRow></TableBody></Table></div>; })}</div>}</div>; })}</div>}</Card>; })}
    {dados && !dados.produtos.length && <Card className="text-center text-sm text-gray-600">Nenhum produto encontrado para as referências selecionadas.</Card>}
  </div>;
}
