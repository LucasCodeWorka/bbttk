'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ProdutoImagensModal } from '@/components/pcp/ProdutoImagensModal';
import { relatorioBaseApi, RelatorioBaseFiltro, RupturaItemReferencia, RupturaItensResponse } from '@/lib/pcpApi';
import { exportMultiSheetExcel } from '@/lib/exportExcel';
import { formatDate, formatNumber } from '@/lib/utils';

// Relacao dos itens em ruptura (pedido da Renata, 24/11/2026): primeiro por
// REFERENCIA, e ao clicar abre os SKUs dela juntos - a lista solta por SKU espalhava
// a mesma referencia pelo relatorio e nao dava pra atuar.

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { em: number; dados: RupturaItensResponse }>();

type Ordem = 'skusRuptura' | 'percent' | 'venda12m' | 'ultimaVenda' | 'referencia';

const LINHAS = [
  { value: '', label: 'Todas as linhas' },
  { value: 'Básico', label: 'Básico' },
  { value: 'Básico Renovável', label: 'Básico Renovável' },
];

function data(valor: string | null) {
  return valor ? formatDate(valor) : '—';
}

function Th({ label, campo, align = 'right', ordem, direcao, onOrdenar }: {
  label: string; campo?: Ordem; align?: 'left' | 'right' | 'center';
  ordem: Ordem; direcao: 'asc' | 'desc'; onOrdenar: (campo: Ordem) => void;
}) {
  const ativo = campo && ordem === campo;
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase text-gray-600 whitespace-nowrap select-none ${campo ? 'cursor-pointer hover:bg-gray-100' : ''} ${ativo ? 'bg-gray-100' : ''}`}
      style={{ textAlign: align }}
      onClick={campo ? () => onOrdenar(campo) : undefined}
      aria-sort={ativo ? (direcao === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}{ativo && <span className="ml-1 text-[var(--bbtk-purple)]">{direcao === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

export function RupturaItensModal({ isOpen, onClose, filtro }: {
  isOpen: boolean; onClose: () => void; filtro: RelatorioBaseFiltro;
}) {
  const { token } = useAuth();
  // Resultado amarrado a chave (filtros + tentativa): carregando = ainda nao chegou
  // resposta pra chave atual. Evita setState sincrono dentro do efeito.
  const [resultado, setResultado] = useState<{ chave: string; dados?: RupturaItensResponse; erro?: string } | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [busca, setBusca] = useState('');
  const [linha, setLinha] = useState('');
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [ordem, setOrdem] = useState<Ordem>('skusRuptura');
  const [direcao, setDirecao] = useState<'asc' | 'desc'>('desc');
  const [fotos, setFotos] = useState<{ referencia: string; codigo: number | null } | null>(null);
  const chave = JSON.stringify(filtro);
  const chaveResultado = `${chave}#${tentativa}`;
  const atual = resultado?.chave === chaveResultado ? resultado : null;
  const dados = atual?.dados ?? null;
  const erro = atual?.erro ?? null;
  const carregando = isOpen && !atual;

  useEffect(() => {
    if (!isOpen || !token) return;
    const controller = new AbortController();
    const emCache = cache.get(chave);
    const pedido = emCache && Date.now() - emCache.em < CACHE_MS && tentativa === 0
      ? Promise.resolve(emCache.dados)
      : relatorioBaseApi.getRupturaItens(token, JSON.parse(chave), controller.signal).then(resposta => {
        cache.set(chave, { em: Date.now(), dados: resposta });
        return resposta;
      });
    pedido
      .then(resposta => { if (!controller.signal.aborted) setResultado({ chave: `${chave}#${tentativa}`, dados: resposta }); })
      .catch(error => {
        if (!controller.signal.aborted) setResultado({
          chave: `${chave}#${tentativa}`,
          erro: error instanceof Error ? error.message : 'Não foi possível carregar os itens.',
        });
      });
    return () => controller.abort();
  }, [isOpen, token, chave, tentativa]);

  const referencias = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = (dados?.referencias ?? []).filter(r =>
      (!linha || r.linha === linha)
      && (!termo || r.referencia.toLowerCase().includes(termo) || r.nome.toLowerCase().includes(termo)));
    const valor = (r: RupturaItemReferencia) => ordem === 'referencia' ? r.referencia
      : ordem === 'ultimaVenda' ? (r.ultimaVenda ?? '') : r[ordem];
    return [...lista].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return (direcao === 'asc' ? cmp : -cmp) || b.skusRuptura - a.skusRuptura;
    });
  }, [dados, busca, linha, ordem, direcao]);

  const totais = useMemo(() => ({
    ruptura: referencias.reduce((s, r) => s + r.skusRuptura, 0),
    base: referencias.reduce((s, r) => s + r.skusBase, 0),
  }), [referencias]);

  function ordenar(campo: Ordem) {
    if (ordem === campo) setDirecao(direcao === 'asc' ? 'desc' : 'asc');
    else { setOrdem(campo); setDirecao(campo === 'referencia' ? 'asc' : 'desc'); }
  }

  function alternar(referencia: string) {
    setAbertas(atual => {
      const nova = new Set(atual);
      if (nova.has(referencia)) nova.delete(referencia); else nova.add(referencia);
      return nova;
    });
  }

  function exportar() {
    if (!dados) return;
    const sufixo = dados.dataPosicao;
    exportMultiSheetExcel(`ruptura-itens-${sufixo}`, [
      {
        sheetName: 'Referências',
        title: `Ruptura por referência - posição ${data(dados.dataPosicao)}`,
        columns: [
          { header: 'Referência', key: 'referencia', width: 18 },
          { header: 'Descrição', key: 'nome', width: 40 },
          { header: 'Linha', key: 'linha', width: 18 },
          { header: 'SKUs em ruptura', key: 'skusRuptura', width: 14 },
          { header: 'SKUs na base', key: 'skusBase', width: 12 },
          { header: '% ruptura', key: 'percent', width: 10 },
          { header: 'Venda 12 meses (peças)', key: 'venda12m', width: 14 },
          { header: 'Última venda', key: 'ultimaVenda', width: 12 },
        ],
        data: referencias.map(r => ({ ...r, ultimaVenda: data(r.ultimaVenda) })),
      },
      {
        sheetName: 'SKUs',
        title: `Ruptura por SKU - posição ${data(dados.dataPosicao)}`,
        columns: [
          { header: 'Referência', key: 'referencia', width: 18 },
          { header: 'Descrição', key: 'nome', width: 40 },
          { header: 'Linha', key: 'linha', width: 18 },
          { header: 'SKU', key: 'productSku', width: 16 },
          { header: 'Cor', key: 'cor', width: 20 },
          { header: 'Tamanho', key: 'tamanho', width: 9 },
          { header: 'Estoque', key: 'estoque', width: 9 },
          { header: 'Situação', key: 'situacao', width: 14 },
          { header: 'Venda 12 meses (peças)', key: 'venda12m', width: 14 },
          { header: 'Última venda', key: 'ultimaVenda', width: 12 },
          { header: 'Última entrada', key: 'ultimaEntrada', width: 12 },
        ],
        data: referencias.flatMap(r => r.skus.map(s => ({
          referencia: r.referencia, nome: r.nome, linha: r.linha, productSku: s.productSku, cor: s.cor,
          tamanho: s.tamanho, estoque: s.estoque, situacao: s.emRuptura ? 'Em ruptura' : 'Com estoque',
          venda12m: s.venda12m, ultimaVenda: data(s.ultimaVenda), ultimaEntrada: data(s.ultimaEntrada),
        }))),
      },
    ]);
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Itens em ruptura" size="full">
        <p className="text-xs text-gray-500">
          Básico e Básico Renovável com status ATIVO que já tiveram entrada e venderam nos últimos 12 meses,
          sem estoque (saldo zero ou negativo) nas lojas selecionadas.
          {dados && ` Posição ${data(dados.dataPosicao)}.`} Clique na referência para ver os SKUs.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-72">
            <Input placeholder="Buscar referência ou descrição" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar referência ou descrição" />
          </div>
          <div className="w-52">
            <Select options={LINHAS} value={linha} onChange={e => setLinha(e.target.value)} aria-label="Filtrar por linha" />
          </div>
          {dados && (
            <p className="text-sm text-gray-700">
              <strong>{formatNumber(referencias.length)}</strong> referências ·{' '}
              <strong>{formatNumber(totais.ruptura)}</strong> SKUs em ruptura de {formatNumber(totais.base)} nessas referências
            </p>
          )}
          <div className="ml-auto flex gap-2">
            {dados && abertas.size > 0 && <Button variant="ghost" size="sm" onClick={() => setAbertas(new Set())}>Recolher tudo</Button>}
            <Button variant="secondary" size="sm" onClick={exportar} disabled={!referencias.length}>Exportar Excel</Button>
          </div>
        </div>

        {carregando ? (
          <p role="status" className="py-16 text-center text-sm text-gray-500">Carregando itens em ruptura... (pode levar até 30 segundos)</p>
        ) : erro ? (
          <div role="alert" className="py-12 text-center">
            <p className="mb-4 text-sm text-red-600">{erro}</p>
            <Button variant="secondary" onClick={() => setTentativa(n => n + 1)}>Tentar novamente</Button>
          </div>
        ) : dados && referencias.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">Nenhuma referência em ruptura com esses filtros.</p>
        ) : dados && (
          <div className="mt-4 max-h-[65vh] overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th className="w-8" />
                  <Th ordem={ordem} direcao={direcao} onOrdenar={ordenar} label="Referência" campo="referencia" align="left" />
                  <Th ordem={ordem} direcao={direcao} onOrdenar={ordenar} label="Linha" align="left" />
                  <Th ordem={ordem} direcao={direcao} onOrdenar={ordenar} label="SKUs em ruptura" campo="skusRuptura" />
                  <Th ordem={ordem} direcao={direcao} onOrdenar={ordenar} label="SKUs na base" />
                  <Th ordem={ordem} direcao={direcao} onOrdenar={ordenar} label="% ruptura" campo="percent" />
                  <Th ordem={ordem} direcao={direcao} onOrdenar={ordenar} label="Venda 12m (pç)" campo="venda12m" />
                  <Th ordem={ordem} direcao={direcao} onOrdenar={ordenar} label="Última venda" campo="ultimaVenda" align="center" />
                </tr>
              </thead>
              <tbody>
                {referencias.map(r => {
                  const aberta = abertas.has(r.referencia);
                  return (
                    <Fragment key={r.referencia}>
                      <tr className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${aberta ? 'bg-purple-50/40' : ''}`} onClick={() => alternar(r.referencia)}>
                        <td className="px-2 text-center text-gray-400">
                          <button type="button" aria-expanded={aberta} aria-label={`${aberta ? 'Recolher' : 'Abrir'} SKUs da referência ${r.referencia}`} onClick={e => { e.stopPropagation(); alternar(r.referencia); }}>
                            <svg className={`h-4 w-4 transition-transform ${aberta ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 whitespace-nowrap">{r.referencia}</div>
                          <div className="text-xs text-gray-500">{r.nome}</div>
                          <button type="button" aria-label={`Ver fotos da referência ${r.referencia}`}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                            onClick={e => { e.stopPropagation(); setFotos({ referencia: r.referencia, codigo: r.productCode }); }}>
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                              <path d="M3 7h4l2-3h6l2 3h4v13H3V7Z" /><circle cx="12" cy="13" r="4" />
                            </svg>
                            Fotos
                          </button>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-700">{r.linha}</td>
                        <td className="px-3 py-2 text-right font-semibold text-red-600 tabular-nums">{formatNumber(r.skusRuptura)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.skusBase)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.percent, 1)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.venda12m)}</td>
                        <td className="px-3 py-2 text-center tabular-nums">{data(r.ultimaVenda)}</td>
                      </tr>
                      {aberta && (
                        <tr className="bg-gray-50/70">
                          <td />
                          <td colSpan={7} className="px-3 pb-3 pt-1">
                            <table className="w-full text-xs bg-white rounded border border-gray-200">
                              <thead className="bg-gray-100 text-gray-600 uppercase">
                                <tr>
                                  <th className="px-2 py-1.5 text-left">Cor</th>
                                  <th className="px-2 py-1.5 text-left">Tamanho</th>
                                  <th className="px-2 py-1.5 text-left">SKU</th>
                                  <th className="px-2 py-1.5 text-left">Situação</th>
                                  <th className="px-2 py-1.5 text-right">Estoque</th>
                                  <th className="px-2 py-1.5 text-right">Venda 12m (pç)</th>
                                  <th className="px-2 py-1.5 text-center">Última venda</th>
                                  <th className="px-2 py-1.5 text-center">Última entrada</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.skus.map(s => (
                                  <tr key={s.productSku} className="border-t border-gray-100">
                                    <td className="px-2 py-1">{s.cor}</td>
                                    <td className="px-2 py-1">{s.tamanho}</td>
                                    <td className="px-2 py-1 text-gray-500 tabular-nums">{s.productSku}</td>
                                    <td className={`px-2 py-1 font-medium ${s.emRuptura ? 'text-red-600' : 'text-gray-500'}`}>{s.emRuptura ? 'Em ruptura' : 'Com estoque'}</td>
                                    <td className={`px-2 py-1 text-right tabular-nums ${s.emRuptura ? 'text-red-600' : ''}`}>{formatNumber(s.estoque)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{formatNumber(s.venda12m)}</td>
                                    <td className="px-2 py-1 text-center tabular-nums">{data(s.ultimaVenda)}</td>
                                    <td className="px-2 py-1 text-center tabular-nums">{data(s.ultimaEntrada)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      {fotos && <ProdutoImagensModal {...fotos} onClose={() => setFotos(null)} />}
    </>
  );
}
