'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  metasApi,
  vendasApi,
  MetaNivel,
  HistoricoLoja,
  VendedorPorFilial,
  ComissaoOverrideData,
  SalvarDistribuicaoLoja,
  SalvarDistribuicaoVendedor,
} from '@/lib/api';
import { FILIAIS, MESES, VOLANTE_BRANCH_CODE, formatMoney, distribuirValor } from '@/lib/utils';

type TipoDistribuicao = 'igual' | 'historico' | 'manual';
type Aba = 'lojas' | 'volante';

interface LojaState {
  branchCode: number;
  branchName: string;
  historico3m: number;
  selecionada: boolean;
  valor: number;
  editadaManualmente: boolean;
  comissaoAtiva: boolean;
  comissaoOverride: ComissaoOverrideData;
}

interface VendedorState {
  sellerCode: number;
  sellerName: string;
  historico3m: number;
  valor: number;
  editadaManualmente: boolean;
  comissaoAtiva: boolean;
  comissaoOverride: ComissaoOverrideData;
  isGerente: boolean;
}

const TIPO_OPTIONS = [
  { value: 'igual', label: 'Igualmente' },
  { value: 'historico', label: 'Pelo histórico de vendas' },
  { value: 'manual', label: 'Manualmente' },
];

const COMISSAO_VAZIA: ComissaoOverrideData = { nivel1: null, nivel2: null, nivel3: null, nivel4: null, nivel5: null };

function comissaoVazia(o: ComissaoOverrideData): boolean {
  return !o.nivel1 && !o.nivel2 && !o.nivel3 && !o.nivel4 && !o.nivel5;
}

function pesoLoja(loja: LojaState, tipo: TipoDistribuicao): number {
  return tipo === 'historico' ? loja.historico3m : 1;
}

function pesoVendedor(v: VendedorState, tipo: TipoDistribuicao): number {
  return tipo === 'historico' ? v.historico3m : 1;
}

interface CadastroMetaModalProps {
  isOpen: boolean;
  onClose: () => void;
  ano: number;
  mes: number;
  niveis: MetaNivel[];
  onSaved: () => void;
}

export function CadastroMetaModal({ isOpen, onClose, ano, mes, niveis, onSaved }: CadastroMetaModalProps) {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [aba, setAba] = useState<Aba>('lojas');
  const [carregandoHistorico, setCarregandoHistorico] = useState(true);
  const [totalValueStr, setTotalValueStr] = useState('');
  const [tipoLojas, setTipoLojas] = useState<TipoDistribuicao>('historico');
  const [lojas, setLojas] = useState<LojaState[]>([]);

  const [lojaExpandida, setLojaExpandida] = useState<number | null>(null);
  const [tipoVendedoresPorLoja, setTipoVendedoresPorLoja] = useState<Record<number, TipoDistribuicao>>({});
  const [vendedoresPorLoja, setVendedoresPorLoja] = useState<Record<number, VendedorState[]>>({});
  const [carregandoVendedoresLoja, setCarregandoVendedoresLoja] = useState<number | null>(null);
  // Como a meta da gerente e calculada: 'cheio' = valor cheio da loja (padrao atual,
  // some das demais vendedoras); 'restante' = so o que sobrar depois de distribuir a
  // meta entre as demais vendedoras (ex: cadastrou manualmente 3 metas e sobrou valor).
  const [modoGerentePorLoja, setModoGerentePorLoja] = useState<Record<number, 'cheio' | 'restante'>>({});

  // Volante: vendedoras sem loja fixa - a meta delas considera o faturamento somado de
  // TODAS as lojas onde vendem no mes, em vez da meta de uma loja especifica.
  const [volanteTotalValueStr, setVolanteTotalValueStr] = useState('');
  const [volanteTipo, setVolanteTipo] = useState<TipoDistribuicao>('igual');
  const [volanteVendedoras, setVolanteVendedoras] = useState<VendedorState[]>([]);
  const [volanteCandidatosBase, setVolanteCandidatosBase] = useState<{ sellerCode: number; sellerName: string; historico3m: number }[]>([]);
  const [vendedoresComMetaExistente, setVendedoresComMetaExistente] = useState<Set<number>>(new Set());

  const [salvando, setSalvando] = useState(false);

  const [mostrarNiveisPadrao, setMostrarNiveisPadrao] = useState(false);
  const [niveisPadrao, setNiveisPadrao] = useState<MetaNivel[]>(niveis);
  const [salvandoNiveisPadrao, setSalvandoNiveisPadrao] = useState(false);

  useEffect(() => {
    setNiveisPadrao(niveis);
  }, [niveis]);

  const totalValue = parseFloat(totalValueStr) || 0;
  const volanteTotalValue = parseFloat(volanteTotalValueStr) || 0;

  // Carrega o historico de faturamento de lojas e vendedores assim que o modal abre - e a
  // base pra "distribuir pelo historico de vendas" e pro campo "Media 3 meses", tanto pra
  // lojas quanto pra vendedoras volante. Tambem busca as metas ja cadastradas no periodo
  // pra saber quais vendedoras ja tem meta (essas ficam fora da lista de candidatas a
  // volante, pra nao cadastrar meta duplicada/conflitante pra mesma pessoa no mes).
  useEffect(() => {
    if (!isOpen) return;
    setCarregandoHistorico(true);
    Promise.all([
      vendasApi.getHistoricoLojas(ano, mes),
      vendasApi.getVendedoresLista(true),
      vendasApi.getHistoricoVendedores(ano, mes),
      metasApi.getMetas(ano, mes),
    ])
      .then(([lojasRes, vendedoresRes, historicoVendRes, metasRes]) => {
        const historicoMap = new Map(lojasRes.lojas.map((l) => [l.branch_code, l]));
        const iniciais: LojaState[] = Object.entries(FILIAIS).map(([codeStr, name]) => {
          const code = Number(codeStr);
          const h: HistoricoLoja | undefined = historicoMap.get(code);
          return {
            branchCode: code,
            branchName: name,
            historico3m: h?.faturamento_3m || 0,
            selecionada: false,
            valor: 0,
            editadaManualmente: false,
            comissaoAtiva: false,
            comissaoOverride: { ...COMISSAO_VAZIA },
          };
        });
        setLojas(iniciais);

        const historicoVendMap = new Map(historicoVendRes.vendedores.map((v) => [v.seller_code, v.faturamento_3m]));
        setVolanteCandidatosBase(
          vendedoresRes.vendedores.map((v) => ({
            sellerCode: v.code,
            sellerName: v.name,
            historico3m: historicoVendMap.get(v.code) || 0,
          }))
        );
        setVendedoresComMetaExistente(
          new Set(metasRes.metas.filter((m) => m.seller_code !== null).map((m) => m.seller_code as number))
        );
        setVolanteVendedoras([]);
        setVolanteTotalValueStr('');

        // Reseta o resto do estado que nao depende do historico carregado acima -
        // sem isso o modal reabre "em cache" da sessao anterior (valor total, tipo de
        // distribuicao, loja expandida e a lista de vendedores/gerente/comissao dela).
        setTotalValueStr('');
        setTipoLojas('historico');
        setLojaExpandida(null);
        setTipoVendedoresPorLoja({});
        setVendedoresPorLoja({});
        setModoGerentePorLoja({});
        setAba('lojas');
      })
      .catch((error) => {
        showToast('Erro ao carregar histórico de vendas', 'error');
        console.error(error);
      })
      .finally(() => setCarregandoHistorico(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ano, mes]);

  // Recalcula automaticamente as lojas SELECIONADAS que ainda nao foram editadas a mao -
  // dispara quando o valor total muda, quando a selecao de lojas muda, ou quando o tipo
  // de distribuicao muda (nesse caso ja vem com editadasManualmente limpo, ver
  // trocarTipoLojas). So roda de verdade quando nao ha nenhuma edicao manual pendente -
  // com edicao manual em curso, quem decide recalcular é o usuario (botoes de acao rapida).
  useEffect(() => {
    setLojas((prev) => {
      const selecionadas = prev.filter((l) => l.selecionada);
      if (selecionadas.length === 0) return prev;
      if (selecionadas.some((l) => l.editadaManualmente)) return prev;
      if (tipoLojas === 'manual') return prev;

      const pesos = selecionadas.map((l) => pesoLoja(l, tipoLojas));
      const valores = distribuirValor(totalValue, pesos);
      const valorPorCodigo = new Map(selecionadas.map((l, i) => [l.branchCode, valores[i]]));

      return prev.map((l) => (valorPorCodigo.has(l.branchCode) ? { ...l, valor: valorPorCodigo.get(l.branchCode)! } : l));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalValue, tipoLojas, lojas.map((l) => l.selecionada).join(',')]);

  // Mesmo mecanismo acima, so que pro pool de vendedoras volante (sem conceito de loja).
  useEffect(() => {
    setVolanteVendedoras((prev) => {
      if (prev.length === 0) return prev;
      if (prev.some((v) => v.editadaManualmente)) return prev;
      if (volanteTipo === 'manual') return prev;

      const pesos = prev.map((v) => pesoVendedor(v, volanteTipo));
      const valores = distribuirValor(volanteTotalValue, pesos);
      return prev.map((v, i) => ({ ...v, valor: valores[i] }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volanteTotalValue, volanteTipo, volanteVendedoras.length]);

  function trocarTipoLojas(novoTipo: TipoDistribuicao) {
    const temEdicaoManual = lojas.some((l) => l.selecionada && l.editadaManualmente);
    if (temEdicaoManual && novoTipo !== 'manual') {
      const ok = confirm('Existem valores ajustados manualmente. Ao trocar o tipo de distribuição, esses valores serão substituídos. Deseja continuar?');
      if (!ok) return;
    }
    setTipoLojas(novoTipo);
    if (novoTipo !== 'manual') {
      setLojas((prev) => prev.map((l) => ({ ...l, editadaManualmente: false })));
    }
  }

  function toggleLojaSelecionada(branchCode: number) {
    setLojas((prev) => prev.map((l) => (l.branchCode === branchCode ? { ...l, selecionada: !l.selecionada, editadaManualmente: false, valor: l.selecionada ? 0 : l.valor } : l)));
  }

  function selecionarTodasLojas() {
    setLojas((prev) => {
      const todasSelecionadas = prev.every((l) => l.selecionada);
      return prev.map((l) => ({ ...l, selecionada: !todasSelecionadas, editadaManualmente: false }));
    });
  }

  function editarValorLoja(branchCode: number, valorStr: string) {
    const valor = parseFloat(valorStr) || 0;
    setLojas((prev) => prev.map((l) => (l.branchCode === branchCode ? { ...l, valor, editadaManualmente: true } : l)));
  }

  function restaurarCalculoAutomaticoLojas() {
    setLojas((prev) => {
      const selecionadas = prev.filter((l) => l.selecionada);
      if (selecionadas.length === 0 || tipoLojas === 'manual') return prev.map((l) => ({ ...l, editadaManualmente: false }));

      const pesos = selecionadas.map((l) => pesoLoja(l, tipoLojas));
      const valores = distribuirValor(totalValue, pesos);
      const valorPorCodigo = new Map(selecionadas.map((l, i) => [l.branchCode, valores[i]]));

      return prev.map((l) => (valorPorCodigo.has(l.branchCode) ? { ...l, valor: valorPorCodigo.get(l.branchCode)!, editadaManualmente: false } : l));
    });
  }

  function redistribuirRestanteLojas() {
    setLojas((prev) => {
      const selecionadas = prev.filter((l) => l.selecionada);
      const editadas = selecionadas.filter((l) => l.editadaManualmente);
      const naoEditadas = selecionadas.filter((l) => !l.editadaManualmente);
      if (naoEditadas.length === 0) return prev;

      const somaEditadas = editadas.reduce((s, l) => s + l.valor, 0);
      const restante = totalValue - somaEditadas;
      const pesos = naoEditadas.map((l) => pesoLoja(l, tipoLojas === 'manual' ? 'igual' : tipoLojas));
      const valores = distribuirValor(Math.max(restante, 0), pesos);
      const valorPorCodigo = new Map(naoEditadas.map((l, i) => [l.branchCode, valores[i]]));

      return prev.map((l) => (valorPorCodigo.has(l.branchCode) ? { ...l, valor: valorPorCodigo.get(l.branchCode)! } : l));
    });
  }

  function toggleComissaoLoja(branchCode: number) {
    setLojas((prev) => prev.map((l) => (l.branchCode === branchCode ? { ...l, comissaoAtiva: !l.comissaoAtiva } : l)));
  }

  function editarComissaoLoja(branchCode: number, nivel: keyof ComissaoOverrideData, valorStr: string) {
    setLojas((prev) =>
      prev.map((l) =>
        l.branchCode === branchCode
          ? { ...l, comissaoOverride: { ...l.comissaoOverride, [nivel]: valorStr === '' ? null : parseFloat(valorStr) } }
          : l
      )
    );
  }

  // Expande/carrega vendedores de uma loja sob demanda - so busca na API na primeira vez.
  async function toggleLojaExpandida(branchCode: number) {
    if (lojaExpandida === branchCode) {
      setLojaExpandida(null);
      return;
    }

    if (!vendedoresPorLoja[branchCode] && token) {
      setCarregandoVendedoresLoja(branchCode);
      try {
        const res = await vendasApi.getVendedoresPorFilial(branchCode, ano, mes);
        const loja = lojas.find((l) => l.branchCode === branchCode);
        const tipo = tipoVendedoresPorLoja[branchCode] || 'historico';

        const vendedoresBase: VendedorState[] = res.vendedores.map((v: VendedorPorFilial) => ({
          sellerCode: v.seller_code,
          sellerName: v.seller_name,
          historico3m: v.faturamento,
          valor: 0,
          editadaManualmente: false,
          comissaoAtiva: false,
          comissaoOverride: { ...COMISSAO_VAZIA },
          isGerente: false,
        }));

        if (vendedoresBase.length > 0 && loja) {
          const pesos = vendedoresBase.map((v) => pesoVendedor(v, tipo));
          const valores = distribuirValor(loja.valor, pesos);
          vendedoresBase.forEach((v, i) => (v.valor = valores[i]));
        }

        setTipoVendedoresPorLoja((prev) => ({ ...prev, [branchCode]: tipo }));
        setVendedoresPorLoja((prev) => ({ ...prev, [branchCode]: vendedoresBase }));
      } catch (error) {
        showToast('Erro ao buscar vendedores da loja', 'error');
        console.error(error);
      } finally {
        setCarregandoVendedoresLoja(null);
      }
    }

    setLojaExpandida(branchCode);
  }

  function trocarTipoVendedores(branchCode: number, novoTipo: TipoDistribuicao) {
    const vendedores = vendedoresPorLoja[branchCode] || [];
    const temEdicaoManual = vendedores.some((v) => !v.isGerente && v.editadaManualmente);
    if (temEdicaoManual && novoTipo !== 'manual') {
      const ok = confirm('Existem valores ajustados manualmente. Ao trocar o tipo de distribuição, esses valores serão substituídos. Deseja continuar?');
      if (!ok) return;
    }

    setTipoVendedoresPorLoja((prev) => ({ ...prev, [branchCode]: novoTipo }));

    if (novoTipo === 'manual') {
      setVendedoresPorLoja((prev) => ({
        ...prev,
        [branchCode]: (prev[branchCode] || []).map((v) => (v.isGerente ? v : { ...v, editadaManualmente: false })),
      }));
      return;
    }

    const loja = lojas.find((l) => l.branchCode === branchCode);
    if (!loja) return;
    setVendedoresPorLoja((prev) => {
      const atuais = prev[branchCode] || [];
      const regulares = atuais.filter((v) => !v.isGerente);
      if (regulares.length === 0) return prev;
      const pesos = regulares.map((v) => pesoVendedor(v, novoTipo));
      const valores = distribuirValor(loja.valor, pesos);
      const valorPorCodigo = new Map(regulares.map((v, i) => [v.sellerCode, valores[i]]));
      return {
        ...prev,
        [branchCode]: atuais.map((v) => (v.isGerente ? v : { ...v, valor: valorPorCodigo.get(v.sellerCode) ?? v.valor, editadaManualmente: false })),
      };
    });
  }

  function editarValorVendedor(branchCode: number, sellerCode: number, valorStr: string) {
    const valor = parseFloat(valorStr) || 0;
    setVendedoresPorLoja((prev) => ({
      ...prev,
      [branchCode]: (prev[branchCode] || []).map((v) => (v.sellerCode === sellerCode ? { ...v, valor, editadaManualmente: true } : v)),
    }));
  }

  function toggleComissaoVendedor(branchCode: number, sellerCode: number) {
    setVendedoresPorLoja((prev) => ({
      ...prev,
      [branchCode]: (prev[branchCode] || []).map((v) => (v.sellerCode === sellerCode ? { ...v, comissaoAtiva: !v.comissaoAtiva } : v)),
    }));
  }

  function editarComissaoVendedor(branchCode: number, sellerCode: number, nivel: keyof ComissaoOverrideData, valorStr: string) {
    setVendedoresPorLoja((prev) => ({
      ...prev,
      [branchCode]: (prev[branchCode] || []).map((v) =>
        v.sellerCode === sellerCode
          ? { ...v, comissaoOverride: { ...v.comissaoOverride, [nivel]: valorStr === '' ? null : parseFloat(valorStr) } }
          : v
      ),
    }));
  }

  // So uma gerente por loja: marcar uma desmarca qualquer outra. A meta da gerente vira o
  // valor CHEIO da loja (ela sai da divisao entre vendedoras) - as demais vendedoras da
  // loja sao redistribuidas de novo pra continuarem somando o valor total da loja entre
  // elas, como se a gerente nao estivesse no pool.
  function toggleGerente(branchCode: number, sellerCode: number) {
    const loja = lojas.find((l) => l.branchCode === branchCode);
    if (!loja) return;
    const tipo = tipoVendedoresPorLoja[branchCode] || 'historico';

    setVendedoresPorLoja((prev) => {
      const atuais = prev[branchCode] || [];
      const alvo = atuais.find((v) => v.sellerCode === sellerCode);
      if (!alvo) return prev;
      const vaiVirarGerente = !alvo.isGerente;

      const atualizados = atuais.map((v) => ({
        ...v,
        isGerente: v.sellerCode === sellerCode ? vaiVirarGerente : false,
      }));

      const regulares = atualizados.filter((v) => !v.isGerente);
      if (regulares.length === 0) return { ...prev, [branchCode]: atualizados };

      const pesos = regulares.map((v) => pesoVendedor(v, tipo));
      const valores = distribuirValor(loja.valor, pesos);
      const valorPorCodigo = new Map(regulares.map((v, i) => [v.sellerCode, valores[i]]));

      return {
        ...prev,
        [branchCode]: atualizados.map((v) =>
          v.isGerente ? v : { ...v, valor: valorPorCodigo.get(v.sellerCode) ?? v.valor, editadaManualmente: false }
        ),
      };
    });
  }

  // Desconsidera uma vendedora regular da distribuicao da loja (ex: ferias, afastamento).
  // Ela some da lista pro resto dessa sessao do modal (reaparece se o modal for reaberto -
  // ver reset em [isOpen, ano, mes]) e o valor da loja e redistribuido de novo entre as
  // que sobraram, igual acontece ao marcar/desmarcar gerente.
  function removerVendedorLoja(branchCode: number, sellerCode: number) {
    const loja = lojas.find((l) => l.branchCode === branchCode);
    if (!loja) return;
    const tipo = tipoVendedoresPorLoja[branchCode] || 'historico';

    setVendedoresPorLoja((prev) => {
      const atuais = (prev[branchCode] || []).filter((v) => v.sellerCode !== sellerCode);
      const regulares = atuais.filter((v) => !v.isGerente);
      if (regulares.length === 0 || tipo === 'manual') return { ...prev, [branchCode]: atuais };

      const pesos = regulares.map((v) => pesoVendedor(v, tipo));
      const valores = distribuirValor(loja.valor, pesos);
      const valorPorCodigo = new Map(regulares.map((v, i) => [v.sellerCode, valores[i]]));

      return {
        ...prev,
        [branchCode]: atuais.map((v) =>
          v.isGerente ? v : { ...v, valor: valorPorCodigo.get(v.sellerCode) ?? v.valor, editadaManualmente: false }
        ),
      };
    });
  }

  function trocarModoGerente(branchCode: number, modo: 'cheio' | 'restante') {
    setModoGerentePorLoja((prev) => ({ ...prev, [branchCode]: modo }));
  }

  function expandirTodas() {
    const selecionadas = lojas.filter((l) => l.selecionada);
    selecionadas.forEach((l) => {
      if (!vendedoresPorLoja[l.branchCode]) toggleLojaExpandida(l.branchCode);
    });
  }

  // Candidatas a volante: lista geral de vendedores, menos quem ja tem meta cadastrada
  // nesse periodo (numa loja ou ja como volante) e menos quem ja esta selecionado em
  // alguma loja NESSA sessao do modal (evita a mesma pessoa ganhar duas metas conflitantes
  // de uma vez so).
  const volanteCandidatosDisponiveis = useMemo(() => {
    const jaEmLoja = new Set(Object.values(vendedoresPorLoja).flat().map((v) => v.sellerCode));
    const jaVolante = new Set(volanteVendedoras.map((v) => v.sellerCode));
    return volanteCandidatosBase.filter(
      (c) => !vendedoresComMetaExistente.has(c.sellerCode) && !jaEmLoja.has(c.sellerCode) && !jaVolante.has(c.sellerCode)
    );
  }, [volanteCandidatosBase, vendedoresComMetaExistente, vendedoresPorLoja, volanteVendedoras]);

  function onChangeVolanteSelecionadas(codigosStr: string[]) {
    const codigos = new Set(codigosStr.map(Number));
    setVolanteVendedoras((prev) => {
      const mantidos = prev.filter((v) => codigos.has(v.sellerCode));
      const codigosAtuais = new Set(mantidos.map((v) => v.sellerCode));
      const adicionados: VendedorState[] = volanteCandidatosBase
        .filter((c) => codigos.has(c.sellerCode) && !codigosAtuais.has(c.sellerCode))
        .map((c) => ({
          sellerCode: c.sellerCode,
          sellerName: c.sellerName,
          historico3m: c.historico3m,
          valor: 0,
          editadaManualmente: false,
          comissaoAtiva: false,
          comissaoOverride: { ...COMISSAO_VAZIA },
          isGerente: false,
        }));
      return [...mantidos, ...adicionados];
    });
  }

  function trocarTipoVolante(novoTipo: TipoDistribuicao) {
    const temEdicaoManual = volanteVendedoras.some((v) => v.editadaManualmente);
    if (temEdicaoManual && novoTipo !== 'manual') {
      const ok = confirm('Existem valores ajustados manualmente. Ao trocar o tipo de distribuição, esses valores serão substituídos. Deseja continuar?');
      if (!ok) return;
    }
    setVolanteTipo(novoTipo);
    if (novoTipo !== 'manual') {
      setVolanteVendedoras((prev) => prev.map((v) => ({ ...v, editadaManualmente: false })));
    }
  }

  function editarValorVolante(sellerCode: number, valorStr: string) {
    const valor = parseFloat(valorStr) || 0;
    setVolanteVendedoras((prev) => prev.map((v) => (v.sellerCode === sellerCode ? { ...v, valor, editadaManualmente: true } : v)));
  }

  function restaurarCalculoAutomaticoVolante() {
    setVolanteVendedoras((prev) => {
      if (prev.length === 0 || volanteTipo === 'manual') return prev.map((v) => ({ ...v, editadaManualmente: false }));
      const pesos = prev.map((v) => pesoVendedor(v, volanteTipo));
      const valores = distribuirValor(volanteTotalValue, pesos);
      return prev.map((v, i) => ({ ...v, valor: valores[i], editadaManualmente: false }));
    });
  }

  function toggleComissaoVolante(sellerCode: number) {
    setVolanteVendedoras((prev) => prev.map((v) => (v.sellerCode === sellerCode ? { ...v, comissaoAtiva: !v.comissaoAtiva } : v)));
  }

  function editarComissaoVolante(sellerCode: number, nivel: keyof ComissaoOverrideData, valorStr: string) {
    setVolanteVendedoras((prev) =>
      prev.map((v) =>
        v.sellerCode === sellerCode
          ? { ...v, comissaoOverride: { ...v.comissaoOverride, [nivel]: valorStr === '' ? null : parseFloat(valorStr) } }
          : v
      )
    );
  }

  function removerVolante(sellerCode: number) {
    setVolanteVendedoras((prev) => prev.filter((v) => v.sellerCode !== sellerCode));
  }

  // Resumo geral (lojas) - somas e status de cor (sempre acompanhado de texto, nunca so cor).
  const resumo = useMemo(() => {
    const selecionadas = lojas.filter((l) => l.selecionada);
    const distribuidoLojas = selecionadas.reduce((s, l) => s + l.valor, 0);
    const vendedoresCarregados = Object.values(vendedoresPorLoja).flat();
    const distribuidoVendedores = lojas.reduce((sum, l) => {
      const vs = vendedoresPorLoja[l.branchCode];
      if (!vs) return sum;
      const regularesValor = vs.filter((v) => !v.isGerente).reduce((s, v) => s + v.valor, 0);
      const temGerente = vs.some((v) => v.isGerente);
      const modo = modoGerentePorLoja[l.branchCode] || 'cheio';
      const gerenteValor = temGerente ? (modo === 'restante' ? Math.max(0, l.valor - regularesValor) : l.valor) : 0;
      return sum + regularesValor + gerenteValor;
    }, 0);
    const diferenca = totalValue - distribuidoLojas;

    let status: 'verde' | 'amarelo' | 'vermelho' | 'cinza' = 'cinza';
    let statusTexto = 'Nenhuma distribuição realizada';
    if (selecionadas.length > 0) {
      if (Math.abs(diferenca) < 0.02) {
        status = 'verde';
        statusTexto = 'Meta totalmente distribuída';
      } else if (diferenca > 0) {
        status = 'amarelo';
        statusTexto = `Faltam ${formatMoney(diferenca)} para distribuir entre as lojas`;
      } else {
        status = 'vermelho';
        statusTexto = `Valor distribuído ultrapassa a meta em ${formatMoney(-diferenca)}`;
      }
    }

    return {
      lojasSelecionadas: selecionadas.length,
      vendedoresConsiderados: vendedoresCarregados.length,
      distribuidoLojas,
      distribuidoVendedores,
      diferenca,
      status,
      statusTexto,
    };
  }, [lojas, vendedoresPorLoja, totalValue, modoGerentePorLoja]);

  // Mesmo resumo, agora pro pool de vendedoras volante.
  const resumoVolante = useMemo(() => {
    const distribuido = volanteVendedoras.reduce((s, v) => s + v.valor, 0);
    const diferenca = volanteTotalValue - distribuido;

    let status: 'verde' | 'amarelo' | 'vermelho' | 'cinza' = 'cinza';
    let statusTexto = 'Nenhuma vendedora volante selecionada';
    if (volanteVendedoras.length > 0) {
      if (Math.abs(diferenca) < 0.02) {
        status = 'verde';
        statusTexto = 'Meta volante totalmente distribuída';
      } else if (diferenca > 0) {
        status = 'amarelo';
        statusTexto = `Faltam ${formatMoney(diferenca)} para distribuir entre as vendedoras volante`;
      } else {
        status = 'vermelho';
        statusTexto = `Valor distribuído ultrapassa a meta volante em ${formatMoney(-diferenca)}`;
      }
    }

    return { vendedorasSelecionadas: volanteVendedoras.length, distribuido, diferenca, status, statusTexto };
  }, [volanteVendedoras, volanteTotalValue]);

  const usandoLojas = resumo.lojasSelecionadas > 0 || totalValueStr !== '';
  const usandoVolante = volanteVendedoras.length > 0 || volanteTotalValueStr !== '';

  const errosValidacao = useMemo(() => {
    const erros: string[] = [];

    if (!usandoLojas && !usandoVolante) {
      erros.push('Configure a distribuição por loja e/ou cadastre metas de vendedoras volante.');
    }

    if (usandoLojas) {
      const selecionadas = lojas.filter((l) => l.selecionada);
      if (!(totalValue > 0)) erros.push('Informe o valor total da meta das lojas.');
      if (selecionadas.length === 0) erros.push('Selecione ao menos uma loja.');
      if (totalValue > 0 && selecionadas.length > 0 && Math.abs(resumo.diferenca) > 0.02) {
        erros.push(
          resumo.diferenca > 0
            ? `Ainda faltam ${formatMoney(resumo.diferenca)} para distribuir entre as lojas.`
            : `O valor distribuído ultrapassa a meta total em ${formatMoney(-resumo.diferenca)}.`
        );
      }
      for (const l of selecionadas) {
        if (l.valor < 0) erros.push(`O valor da loja ${l.branchName} não pode ser negativo.`);
        const vendedores = vendedoresPorLoja[l.branchCode];
        if (vendedores && vendedores.length > 0) {
          const regulares = vendedores.filter((v) => !v.isGerente);
          const gerenteAssumeRestante = vendedores.some((v) => v.isGerente) && (modoGerentePorLoja[l.branchCode] || 'cheio') === 'restante';
          if (regulares.length > 0) {
            const somaVendedores = regulares.reduce((s, v) => s + v.valor, 0);
            const faltaLoja = l.valor - somaVendedores;
            if (gerenteAssumeRestante) {
              // Nesse modo a gerente absorve a sobra - so e erro se os regulares
              // somarem MAIS que a meta da loja (sobra negativa).
              if (faltaLoja < -0.02) {
                erros.push(`Os vendedores da loja ${l.branchName} somam ${formatMoney(-faltaLoja)} a mais que a meta da loja.`);
              }
            } else if (Math.abs(faltaLoja) > 0.02) {
              erros.push(
                faltaLoja > 0
                  ? `A loja ${l.branchName} possui ${formatMoney(faltaLoja)} ainda não distribuídos entre os vendedores.`
                  : `Os vendedores da loja ${l.branchName} somam ${formatMoney(-faltaLoja)} a mais que a meta da loja.`
              );
            }
          }
          if (regulares.some((v) => v.valor < 0)) erros.push(`Há um vendedor com valor negativo na loja ${l.branchName}.`);
        }
      }
    }

    if (usandoVolante) {
      if (!(volanteTotalValue > 0)) erros.push('Informe o valor total da meta volante.');
      if (volanteVendedoras.length === 0) erros.push('Selecione ao menos uma vendedora volante.');
      if (volanteTotalValue > 0 && volanteVendedoras.length > 0 && Math.abs(resumoVolante.diferenca) > 0.02) {
        erros.push(
          resumoVolante.diferenca > 0
            ? `Ainda faltam ${formatMoney(resumoVolante.diferenca)} para distribuir entre as vendedoras volante.`
            : `O valor distribuído ultrapassa a meta volante em ${formatMoney(-resumoVolante.diferenca)}.`
        );
      }
      if (volanteVendedoras.some((v) => v.valor < 0)) erros.push('Há uma vendedora volante com valor negativo.');
    }

    return erros;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojas, vendedoresPorLoja, totalValue, resumo.diferenca, volanteVendedoras, volanteTotalValue, resumoVolante.diferenca, usandoLojas, usandoVolante, modoGerentePorLoja]);

  async function handleSalvar() {
    if (!token || errosValidacao.length > 0) return;

    setSalvando(true);
    try {
      if (usandoLojas) {
        const lojasPayload: SalvarDistribuicaoLoja[] = lojas
          .filter((l) => l.selecionada)
          .map((l) => {
            const vendedoresLoja = vendedoresPorLoja[l.branchCode] || [];
            const somaRegulares = vendedoresLoja.filter((v) => !v.isGerente).reduce((s, v) => s + v.valor, 0);
            const modoGerente = modoGerentePorLoja[l.branchCode] || 'cheio';
            const vendedoresPayload: SalvarDistribuicaoVendedor[] = vendedoresLoja.map((v) => ({
              sellerCode: v.sellerCode,
              valor: v.isGerente ? (modoGerente === 'restante' ? Math.max(0, l.valor - somaRegulares) : l.valor) : v.valor,
              comissaoOverride: v.comissaoAtiva && !comissaoVazia(v.comissaoOverride) ? v.comissaoOverride : null,
              isGerente: v.isGerente,
            }));

            return {
              branchCode: l.branchCode,
              valor: l.valor,
              comissaoOverride: l.comissaoAtiva && !comissaoVazia(l.comissaoOverride) ? l.comissaoOverride : null,
              vendedores: vendedoresPayload,
            };
          });

        await metasApi.salvarDistribuicao(token, {
          ano,
          mes,
          totalValue,
          distributionType: tipoLojas === 'historico' ? 'proporcional' : tipoLojas === 'igual' ? 'igual' : 'manual',
          lojas: lojasPayload,
        });
      }

      if (usandoVolante) {
        const volantePayload: SalvarDistribuicaoVendedor[] = volanteVendedoras.map((v) => ({
          sellerCode: v.sellerCode,
          valor: v.valor,
          comissaoOverride: v.comissaoAtiva && !comissaoVazia(v.comissaoOverride) ? v.comissaoOverride : null,
        }));

        await metasApi.salvarDistribuicao(token, {
          ano,
          mes,
          totalValue: volanteTotalValue,
          distributionType: volanteTipo === 'historico' ? 'proporcional' : volanteTipo === 'igual' ? 'igual' : 'manual',
          lojas: [
            {
              branchCode: VOLANTE_BRANCH_CODE,
              valor: volanteTotalValue,
              comissaoOverride: null,
              vendedores: volantePayload,
            },
          ],
        });
      }

      showToast('Metas cadastradas com sucesso!', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao salvar metas', 'error');
      console.error(error);
    } finally {
      setSalvando(false);
    }
  }

  function atualizarComissaoNivelPadrao(nivelOrdem: number, valorStr: string) {
    setNiveisPadrao((prev) =>
      prev.map((n) => (n.nivel_ordem === nivelOrdem ? { ...n, comissao_percentual: parseFloat(valorStr) || 0 } : n))
    );
  }

  async function handleSalvarNiveisPadrao() {
    if (!token) return;
    setSalvandoNiveisPadrao(true);
    try {
      await metasApi.updateNiveis(token, niveisPadrao);
      showToast('Níveis padrão salvos!', 'success');
      onSaved();
    } catch (error) {
      showToast('Erro ao salvar níveis padrão', 'error');
      console.error(error);
    } finally {
      setSalvandoNiveisPadrao(false);
    }
  }

  const STATUS_ESTILO: Record<typeof resumo.status, { bg: string; texto: string; icone: string }> = {
    verde: { bg: 'bg-green-50 border-green-200', texto: 'text-green-700', icone: '✓' },
    amarelo: { bg: 'bg-yellow-50 border-yellow-200', texto: 'text-yellow-700', icone: '!' },
    vermelho: { bg: 'bg-red-50 border-red-200', texto: 'text-red-700', icone: '✕' },
    cinza: { bg: 'bg-gray-50 border-gray-200', texto: 'text-gray-500', icone: '–' },
  };
  const estiloStatus = STATUS_ESTILO[resumo.status];
  const estiloStatusVolante = STATUS_ESTILO[resumoVolante.status];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cadastrar Metas" size="full">
      <p className="bg-[var(--bbtk-yellow)] text-gray-900 px-4 py-2 rounded-lg font-semibold text-center mb-4">
        Meta para {MESES[mes]} de {ano}
      </p>

      <div className="border border-gray-200 rounded-lg mb-4">
        <button
          type="button"
          onClick={() => setMostrarNiveisPadrao((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span>Níveis e comissão padrão</span>
          <span className="text-xs text-gray-400">{mostrarNiveisPadrao ? 'Ocultar' : 'Editar'}</span>
        </button>
        {mostrarNiveisPadrao && (
          <div className="px-4 pb-4 pt-1 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-3">
              Percentual de comissão pago sobre o faturamento quando o vendedor atinge cada nível (usado no
              relatório de Comissões). Vale para todas as lojas e vendedores, a menos que &quot;Personalizar
              comissão&quot; seja usado numa linha específica.
            </p>
            <div className="flex flex-wrap gap-4">
              {niveisPadrao.map((n) => (
                <div key={n.nivel_ordem} className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: n.nivel_cor }} />
                  <span className="text-sm font-medium w-20">{n.nivel_nome}</span>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={n.comissao_percentual}
                    onChange={(e) => atualizarComissaoNivelPadrao(n.nivel_ordem, e.target.value)}
                    className="w-20"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <Button size="sm" variant="ghost" onClick={handleSalvarNiveisPadrao} isLoading={salvandoNiveisPadrao}>
                Salvar níveis padrão
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setAba('lojas')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            aba === 'lojas' ? 'border-[var(--bbtk-red)] text-[var(--bbtk-red)]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Lojas
        </button>
        <button
          type="button"
          onClick={() => setAba('volante')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            aba === 'volante' ? 'border-[var(--bbtk-red)] text-[var(--bbtk-red)]' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Volante {volanteVendedoras.length > 0 && `(${volanteVendedoras.length})`}
        </button>
      </div>

      {carregandoHistorico ? (
        <div className="py-10 text-center text-gray-500">Carregando histórico de vendas...</div>
      ) : aba === 'lojas' ? (
        <>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <Input
              label="Valor total da meta"
              type="number"
              step="0.01"
              min="0"
              value={totalValueStr}
              onChange={(e) => setTotalValueStr(e.target.value)}
              placeholder="Ex: 1000000"
              className="w-56"
            />
            <Select
              label="Distribuição entre lojas"
              value={tipoLojas}
              onChange={(e) => trocarTipoLojas(e.target.value as TipoDistribuicao)}
              options={TIPO_OPTIONS}
              className="w-64"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            <Button variant="ghost" size="sm" onClick={selecionarTodasLojas}>
              {lojas.every((l) => l.selecionada) ? 'Desmarcar todas' : 'Selecionar todas'}
            </Button>
            <Button variant="ghost" size="sm" onClick={restaurarCalculoAutomaticoLojas}>
              Restaurar cálculo automático
            </Button>
            <Button variant="ghost" size="sm" onClick={redistribuirRestanteLojas}>
              Redistribuir restante
            </Button>
            <Button variant="ghost" size="sm" onClick={expandirTodas}>
              Expandir todas
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLojaExpandida(null)}>
              Recolher todas
            </Button>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
            <div className="max-h-[52vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 w-8"></th>
                    <th className="text-left px-3 py-2">Loja</th>
                    <th className="text-right px-3 py-2">Média 3 meses</th>
                    <th className="text-right px-3 py-2">Participação</th>
                    <th className="text-right px-3 py-2 w-40">Meta calculada</th>
                    <th className="text-center px-3 py-2 w-24">Vendedores</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lojas.map((l) => {
                    const participacao = totalValue > 0 ? (l.valor / totalValue) * 100 : 0;
                    const expandida = lojaExpandida === l.branchCode;
                    const vendedores = vendedoresPorLoja[l.branchCode];
                    const carregando = carregandoVendedoresLoja === l.branchCode;

                    return (
                      <Fragment key={l.branchCode}>
                        <tr className={l.selecionada ? '' : 'opacity-50'}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={l.selecionada}
                              onChange={() => toggleLojaSelecionada(l.branchCode)}
                              className="w-4 h-4 text-[var(--bbtk-red)] rounded"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium">{l.branchName}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{formatMoney(l.historico3m / 3)}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{l.selecionada ? `${participacao.toFixed(1)}%` : '-'}</td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={l.selecionada ? l.valor : ''}
                              onChange={(e) => editarValorLoja(l.branchCode, e.target.value)}
                              disabled={!l.selecionada}
                              className="w-full"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {l.selecionada && (
                              <button
                                type="button"
                                onClick={() => toggleLojaExpandida(l.branchCode)}
                                disabled={carregando}
                                className="text-xs text-[var(--bbtk-red)] hover:underline disabled:opacity-50"
                              >
                                {carregando ? '...' : expandida ? 'Ocultar vendedores' : 'Distribuir vendedores'}
                              </button>
                            )}
                          </td>
                        </tr>

                        {l.selecionada && (
                          <tr key={`${l.branchCode}-comissao`}>
                            <td colSpan={6} className="px-3 pb-2">
                              <button
                                type="button"
                                onClick={() => toggleComissaoLoja(l.branchCode)}
                                className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                              >
                                {l.comissaoAtiva ? 'Ocultar comissão personalizada' : 'Personalizar comissão desta loja'}
                              </button>
                              {l.comissaoAtiva && (
                                <div className="grid grid-cols-5 gap-2 mt-2">
                                  {niveis.map((n) => (
                                    <Input
                                      key={n.nivel_ordem}
                                      label={`${n.nivel_nome} %`}
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      value={l.comissaoOverride[`nivel${n.nivel_ordem}` as keyof ComissaoOverrideData] ?? ''}
                                      onChange={(e) => editarComissaoLoja(l.branchCode, `nivel${n.nivel_ordem}` as keyof ComissaoOverrideData, e.target.value)}
                                      placeholder="Padrão"
                                    />
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}

                        {expandida && (
                          <tr key={`${l.branchCode}-detalhes`}>
                            <td colSpan={6} className="bg-gray-50 px-4 py-3">
                              {carregando ? (
                                <div className="text-center text-gray-500 py-4">Carregando vendedores...</div>
                              ) : !vendedores || vendedores.length === 0 ? (
                                <div className="text-center text-gray-500 py-2 text-xs">
                                  Nenhum vendedor vinculado a esta loja no cadastro do TOTVS - a meta fica só no nível da loja.
                                </div>
                              ) : (
                                <VendedoresLoja
                                  loja={l}
                                  vendedores={vendedores}
                                  niveis={niveis}
                                  tipo={tipoVendedoresPorLoja[l.branchCode] || 'historico'}
                                  modoGerente={modoGerentePorLoja[l.branchCode] || 'cheio'}
                                  onTrocarTipo={(t) => trocarTipoVendedores(l.branchCode, t)}
                                  onEditarValor={(sellerCode, valor) => editarValorVendedor(l.branchCode, sellerCode, valor)}
                                  onToggleComissao={(sellerCode) => toggleComissaoVendedor(l.branchCode, sellerCode)}
                                  onEditarComissao={(sellerCode, nivel, valor) => editarComissaoVendedor(l.branchCode, sellerCode, nivel, valor)}
                                  onToggleGerente={(sellerCode) => toggleGerente(l.branchCode, sellerCode)}
                                  onTrocarModoGerente={(modo) => trocarModoGerente(l.branchCode, modo)}
                                  onRemoverVendedor={(sellerCode) => removerVendedorLoja(l.branchCode, sellerCode)}
                                  onFechar={() => toggleLojaExpandida(l.branchCode)}
                                />
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-3">
            Vendedoras sem loja fixa - rodam entre as lojas. A meta delas é calculada sobre o faturamento
            somado em <strong>todas</strong> as lojas onde vendem no mês, em vez da meta de uma loja específica.
            Só aparecem aqui vendedoras que ainda não têm meta cadastrada nesse período.
          </p>

          <div className="flex flex-wrap items-end gap-4 mb-4">
            <Input
              label="Valor total da meta volante"
              type="number"
              step="0.01"
              min="0"
              value={volanteTotalValueStr}
              onChange={(e) => setVolanteTotalValueStr(e.target.value)}
              placeholder="Ex: 50000"
              className="w-56"
            />
            <Select
              label="Distribuição entre vendedoras"
              value={volanteTipo}
              onChange={(e) => trocarTipoVolante(e.target.value as TipoDistribuicao)}
              options={TIPO_OPTIONS}
              className="w-64"
            />
            <ClassificacaoMultiSelect
              label="Vendedoras volante"
              options={volanteCandidatosDisponiveis.map((c) => ({ value: String(c.sellerCode), label: c.sellerName }))}
              selected={volanteVendedoras.map((v) => String(v.sellerCode))}
              onChange={onChangeVolanteSelecionadas}
              className="w-64"
            />
            <Button variant="ghost" size="sm" onClick={restaurarCalculoAutomaticoVolante}>
              Restaurar cálculo automático
            </Button>
          </div>

          {volanteVendedoras.length === 0 ? (
            <div className="py-10 text-center text-gray-500 border border-gray-200 rounded-lg">
              Nenhuma vendedora volante selecionada ainda - use o campo &quot;Vendedoras volante&quot; acima.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="max-h-[52vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-3 py-2">Vendedora</th>
                      <th className="text-right px-3 py-2">Média 3 meses (todas as lojas)</th>
                      <th className="text-right px-3 py-2">Participação</th>
                      <th className="text-right px-3 py-2 w-40">Meta calculada</th>
                      <th className="text-center px-3 py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {volanteVendedoras.map((v) => {
                      const participacao = volanteTotalValue > 0 ? (v.valor / volanteTotalValue) * 100 : 0;
                      return (
                        <Fragment key={v.sellerCode}>
                          <tr>
                            <td className="px-3 py-2 font-medium">{v.sellerName}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{formatMoney(v.historico3m / 3)}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{participacao.toFixed(1)}%</td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={v.valor}
                                onChange={(e) => editarValorVolante(v.sellerCode, e.target.value)}
                                className="w-full"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removerVolante(v.sellerCode)}
                                className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={5} className="px-3 pb-2">
                              <button
                                type="button"
                                onClick={() => toggleComissaoVolante(v.sellerCode)}
                                className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                              >
                                {v.comissaoAtiva ? 'Ocultar comissão personalizada' : 'Personalizar comissão desta vendedora'}
                              </button>
                              {v.comissaoAtiva && (
                                <div className="grid grid-cols-5 gap-2 mt-2">
                                  {niveis.map((n) => (
                                    <Input
                                      key={n.nivel_ordem}
                                      label={`${n.nivel_nome} %`}
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      value={v.comissaoOverride[`nivel${n.nivel_ordem}` as keyof ComissaoOverrideData] ?? ''}
                                      onChange={(e) => editarComissaoVolante(v.sellerCode, `nivel${n.nivel_ordem}` as keyof ComissaoOverrideData, e.target.value)}
                                      placeholder="Padrão"
                                    />
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="sticky bottom-0 bg-white pt-4 border-t border-gray-200 -mx-6 px-6 -mb-6 pb-6">
        {usandoLojas && (
          <div className={`border rounded-lg p-3 mb-3 ${estiloStatus.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-bold ${estiloStatus.texto}`}>{estiloStatus.icone}</span>
              <span className={`text-sm font-semibold ${estiloStatus.texto}`}>Lojas: {resumo.statusTexto}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-gray-600">
              <div>Meta total: <strong>{formatMoney(totalValue)}</strong></div>
              <div>Lojas selecionadas: <strong>{resumo.lojasSelecionadas}</strong></div>
              <div>Vendedores considerados: <strong>{resumo.vendedoresConsiderados}</strong></div>
              <div>Distribuído nas lojas: <strong>{formatMoney(resumo.distribuidoLojas)}</strong></div>
              <div>Distribuído nos vendedores: <strong>{formatMoney(resumo.distribuidoVendedores)}</strong></div>
            </div>
          </div>
        )}

        {usandoVolante && (
          <div className={`border rounded-lg p-3 mb-3 ${estiloStatusVolante.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-bold ${estiloStatusVolante.texto}`}>{estiloStatusVolante.icone}</span>
              <span className={`text-sm font-semibold ${estiloStatusVolante.texto}`}>Volante: {resumoVolante.statusTexto}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600">
              <div>Meta volante total: <strong>{formatMoney(volanteTotalValue)}</strong></div>
              <div>Vendedoras selecionadas: <strong>{resumoVolante.vendedorasSelecionadas}</strong></div>
              <div>Distribuído: <strong>{formatMoney(resumoVolante.distribuido)}</strong></div>
            </div>
          </div>
        )}

        {errosValidacao.length > 0 && (
          <ul className="text-xs text-red-600 mb-3 space-y-0.5">
            {errosValidacao.map((erro, i) => (
              <li key={i}>• {erro}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} isLoading={salvando} disabled={errosValidacao.length > 0}>
            Salvar Metas
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const MODO_GERENTE_OPTIONS = [
  { value: 'cheio', label: 'Valor cheio da loja' },
  { value: 'restante', label: 'Assume o restante' },
];

interface VendedoresLojaProps {
  loja: LojaState;
  vendedores: VendedorState[];
  niveis: MetaNivel[];
  tipo: TipoDistribuicao;
  modoGerente: 'cheio' | 'restante';
  onTrocarTipo: (tipo: TipoDistribuicao) => void;
  onEditarValor: (sellerCode: number, valor: string) => void;
  onToggleComissao: (sellerCode: number) => void;
  onEditarComissao: (sellerCode: number, nivel: keyof ComissaoOverrideData, valor: string) => void;
  onToggleGerente: (sellerCode: number) => void;
  onTrocarModoGerente: (modo: 'cheio' | 'restante') => void;
  onRemoverVendedor: (sellerCode: number) => void;
  onFechar: () => void;
}

function VendedoresLoja({ loja, vendedores, niveis, tipo, modoGerente, onTrocarTipo, onEditarValor, onToggleComissao, onEditarComissao, onToggleGerente, onTrocarModoGerente, onRemoverVendedor, onFechar }: VendedoresLojaProps) {
  const regulares = vendedores.filter((v) => !v.isGerente);
  const distribuido = regulares.reduce((s, v) => s + v.valor, 0);
  const falta = loja.valor - distribuido;
  const valorGerente = modoGerente === 'restante' ? Math.max(0, loja.valor - distribuido) : loja.valor;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{loja.branchName} - Meta: {formatMoney(loja.valor)}</span>
        <Select
          value={tipo}
          onChange={(e) => onTrocarTipo(e.target.value as TipoDistribuicao)}
          options={TIPO_OPTIONS}
          className="w-56"
        />
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left px-3 py-1.5">Vendedor</th>
              <th className="text-right px-3 py-1.5">Média mensal (3m)</th>
              <th className="text-right px-3 py-1.5">Participação</th>
              <th className="text-right px-3 py-1.5 w-36">Meta do vendedor</th>
              <th className="text-center px-3 py-1.5 w-32">Gerente</th>
              <th className="text-center px-3 py-1.5 w-24">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendedores.map((v) => {
              const valorEfetivo = v.isGerente ? valorGerente : v.valor;
              const participacao = loja.valor > 0 ? (valorEfetivo / loja.valor) * 100 : 0;
              return (
                <Fragment key={v.sellerCode}>
                  <tr className={v.isGerente ? 'bg-purple-50' : ''}>
                    <td className="px-3 py-1.5">
                      {v.sellerName}
                      {v.isGerente && (
                        <span className="ml-2 inline-block text-[10px] font-bold uppercase text-white bg-[var(--bbtk-purple)] rounded px-1.5 py-0.5">
                          Gerente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{formatMoney(v.historico3m / 3)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{participacao.toFixed(1)}%</td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={valorEfetivo}
                        onChange={(e) => onEditarValor(v.sellerCode, e.target.value)}
                        disabled={v.isGerente}
                        className="w-full"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleGerente(v.sellerCode)}
                        className={`text-xs hover:underline ${v.isGerente ? 'text-[var(--bbtk-purple)] font-semibold' : 'text-gray-400'}`}
                      >
                        {v.isGerente ? 'Remover gerente' : 'Definir como gerente'}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {!v.isGerente && (
                        <button
                          type="button"
                          onClick={() => onRemoverVendedor(v.sellerCode)}
                          className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                        >
                          Desconsiderar
                        </button>
                      )}
                    </td>
                  </tr>
                  {v.isGerente && (
                    <tr>
                      <td colSpan={6} className="px-3 pb-1.5">
                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span>Meta da gerente:</span>
                          <Select
                            value={modoGerente}
                            onChange={(e) => onTrocarModoGerente(e.target.value as 'cheio' | 'restante')}
                            options={MODO_GERENTE_OPTIONS}
                            className="w-48"
                          />
                          <span>
                            {modoGerente === 'restante'
                              ? 'o que sobrar depois de distribuir entre as demais vendedoras.'
                              : 'valor cheio da loja (não entra na divisão entre as demais vendedoras).'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr key={`${v.sellerCode}-comissao`}>
                    <td colSpan={6} className="px-3 pb-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleComissao(v.sellerCode)}
                        className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                      >
                        {v.comissaoAtiva ? 'Ocultar comissão personalizada' : 'Personalizar comissão deste vendedor'}
                      </button>
                      {v.comissaoAtiva && (
                        <div className="grid grid-cols-5 gap-2 mt-2">
                          {niveis.map((n) => (
                            <Input
                              key={n.nivel_ordem}
                              label={`${n.nivel_nome} %`}
                              type="number"
                              step="0.1"
                              min="0"
                              value={v.comissaoOverride[`nivel${n.nivel_ordem}` as keyof ComissaoOverrideData] ?? ''}
                              onChange={(e) => onEditarComissao(v.sellerCode, `nivel${n.nivel_ordem}` as keyof ComissaoOverrideData, e.target.value)}
                              placeholder="Padrão"
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span>Distribuído entre vendedores: <strong>{formatMoney(distribuido)}</strong></span>
        {vendedores.some((v) => v.isGerente) && modoGerente === 'restante' ? (
          <span className={falta < -0.02 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
            {falta < -0.02
              ? `Vendedores ultrapassam a meta da loja em ${formatMoney(-falta)}`
              : `Gerente assume o restante: ${formatMoney(valorGerente)}`}
          </span>
        ) : (
          <span className={Math.abs(falta) < 0.02 ? 'text-green-600 font-semibold' : 'text-yellow-700 font-semibold'}>
            {Math.abs(falta) < 0.02 ? 'Meta da loja totalmente distribuída' : `Falta distribuir: ${formatMoney(falta)}`}
          </span>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onFechar}
          className="text-xs text-[var(--bbtk-red)] hover:underline"
        >
          Ocultar vendedores
        </button>
      </div>
    </div>
  );
}
