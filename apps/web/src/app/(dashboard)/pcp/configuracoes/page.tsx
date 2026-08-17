'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  pcpConfigApi,
  PcpCoberturaIdealItem,
  PcpCodigosDisponiveis,
  PcpCurvaAbcConfig,
  PcpCustoPrecoSyncJob,
  PcpCorteMinimoSkuItem,
} from '@/lib/api';
import { RELATORIO_BASE_BRANCH_ORDER } from '@/lib/pcpBranches';

const RELATORIO_BASE = 'relatorio_base';
const RELATORIO_ESTOQUE_SEM_GIRO = 'estoque_sem_giro';
const RELATORIO_TRANSFERENCIA = 'gestao_transferencia';
const RELATORIO_REDISTRIBUICAO = 'redistribuicao';
const RELATORIO_SUGESTAO_PRODUCAO = 'sugestao_producao';

const ATACADO_COBERTURA_OPTIONS = [
  { value: 'fabrica_total', label: 'Venda total da Fabrica (todos os canais)' },
  { value: 'atacado_only', label: 'So venda do canal Atacado' },
];

const FILIAIS_REAIS = RELATORIO_BASE_BRANCH_ORDER.filter((b) => b.branchCode > 0);

type SecaoAtiva = 'relatorio-base' | 'estoque-sem-giro' | 'transferencia' | 'redistribuicao' | 'sugestao-producao';

export default function ConfiguracoesPcpPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [secaoAtiva, setSecaoAtiva] = useState<SecaoAtiva>('relatorio-base');
  const [isLoading, setIsLoading] = useState(true);

  // === RELATORIO BASE ===
  const [giroDias, setGiroDias] = useState('30');
  const [coberturaMeses, setCoberturaMeses] = useState('3');
  const [riscoCoberturaMeses, setRiscoCoberturaMeses] = useState('1');
  const [atacadoCoberturaBase, setAtacadoCoberturaBase] = useState('fabrica_total');
  const [custoCode, setCustoCode] = useState('3');
  const [pdvVarejoCode, setPdvVarejoCode] = useState('1');
  const [pdvAtacadoCode, setPdvAtacadoCode] = useState('3');
  const [precoCustoBranchCode, setPrecoCustoBranchCode] = useState('1');
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [codigos, setCodigos] = useState<PcpCodigosDisponiveis>({ custos: [], precos: [] });
  const [sincronizando, setSincronizando] = useState(false);
  const [syncJob, setSyncJob] = useState<PcpCustoPrecoSyncJob | null>(null);
  const [sincronizandoProducao, setSincronizandoProducao] = useState(false);
  const [coberturaIdeal, setCoberturaIdeal] = useState<Record<number, string>>({});
  const [salvandoCobertura, setSalvandoCobertura] = useState(false);
  const [curvaConfig, setCurvaConfig] = useState<PcpCurvaAbcConfig | null>(null);
  const [salvandoCurva, setSalvandoCurva] = useState(false);

  // === ESTOQUE SEM GIRO ===
  const [maturacaoDias, setMaturacaoDias] = useState('15');
  const [coberturaLimiteVerde, setCoberturaLimiteVerde] = useState('4.00');
  const [coberturaLimiteVermelho, setCoberturaLimiteVermelho] = useState('4.01');
  const [salvandoEstoqueSemGiro, setSalvandoEstoqueSemGiro] = useState(false);

  // === TRANSFERENCIA ===
  const [diasAnaliseVendas, setDiasAnaliseVendas] = useState('30');
  const [transferenciaLimiteVerde, setTransferenciaLimiteVerde] = useState('75');
  const [transferenciaLimiteAmarelo, setTransferenciaLimiteAmarelo] = useState('120');
  const [salvandoTransferencia, setSalvandoTransferencia] = useState(false);

  // === REDISTRIBUICAO ===
  const [redistribuicaoCoberturaIdeal, setRedistribuicaoCoberturaIdeal] = useState('4');
  const [redistribuicaoMaturacao, setRedistribuicaoMaturacao] = useState('30');
  const [redistribuicaoEstoqueMinimo, setRedistribuicaoEstoqueMinimo] = useState('1');
  const [redistribuicaoLojasRemetentes, setRedistribuicaoLojasRemetentes] = useState<number[]>([]);
  const [redistribuicaoLojasDestinatarias, setRedistribuicaoLojasDestinatarias] = useState<number[]>([]);
  const [salvandoRedistribuicao, setSalvandoRedistribuicao] = useState(false);

  // === SUGESTAO DE PRODUCAO ===
  const [sugestaoGiroDias, setSugestaoGiroDias] = useState('30');
  const [sugestaoCoberturaMeses, setSugestaoCoberturaMeses] = useState('3');
  const [coberturaAlvoMeses, setCoberturaAlvoMeses] = useState('1');
  const [corteMinimoDefault, setCorteMinimoDefault] = useState('1');
  const [salvandoSugestaoProducao, setSalvandoSugestaoProducao] = useState(false);
  const [corteMinimoSkus, setCorteMinimoSkus] = useState<PcpCorteMinimoSkuItem[]>([]);
  const [novoSkuCorte, setNovoSkuCorte] = useState('');
  const [novoValorCorte, setNovoValorCorte] = useState('');
  const [salvandoNovoCorte, setSalvandoNovoCorte] = useState(false);
  const [uploadingCorteMinimoCsv, setUploadingCorteMinimoCsv] = useState(false);

  // Carregar todos os dados
  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const [configRes, coberturaRes, curvaRes, estoqueRes, transferenciaRes, redistribuicaoRes, sugestaoRes, corteMinimoRes] = await Promise.all([
        pcpConfigApi.getConfig(token, RELATORIO_BASE),
        pcpConfigApi.getCoberturaIdeal(token, RELATORIO_BASE),
        pcpConfigApi.getCurvaAbcConfig(token),
        pcpConfigApi.getEstoqueSemGiroConfig(token, RELATORIO_ESTOQUE_SEM_GIRO),
        pcpConfigApi.getTransferenciaConfig(token, RELATORIO_TRANSFERENCIA),
        pcpConfigApi.getRedistribuicaoConfig(token, RELATORIO_REDISTRIBUICAO),
        pcpConfigApi.getSugestaoProducaoConfig(token, RELATORIO_SUGESTAO_PRODUCAO),
        pcpConfigApi.getCorteMinimoSkus(token, RELATORIO_SUGESTAO_PRODUCAO),
      ]);

      // Relatorio Base
      setGiroDias(String(configRes.config.giroDias));
      setCoberturaMeses(String(configRes.config.coberturaMeses));
      setRiscoCoberturaMeses(String(configRes.config.riscoCoberturaMeses ?? 1));
      setAtacadoCoberturaBase(configRes.config.atacadoCoberturaBase);
      setCustoCode(String(configRes.config.custoCode));
      setPdvVarejoCode(String(configRes.config.pdvVarejoCode));
      setPdvAtacadoCode(String(configRes.config.pdvAtacadoCode));
      setPrecoCustoBranchCode(String(configRes.config.precoCustoBranchCode));
      setCurvaConfig(curvaRes.config);

      const overrides = new Map(coberturaRes.items.map((i) => [i.branchCode, i.coberturaIdealMeses]));
      const mapa: Record<number, string> = {};
      for (const b of RELATORIO_BASE_BRANCH_ORDER) {
        mapa[b.branchCode] = String(overrides.get(b.branchCode) ?? configRes.config.coberturaMeses);
      }
      setCoberturaIdeal(mapa);

      // Estoque Sem Giro
      setMaturacaoDias(String(estoqueRes.config.maturacaoDias));
      setCoberturaLimiteVerde(String(estoqueRes.config.coberturaLimiteVerde));
      setCoberturaLimiteVermelho(String(estoqueRes.config.coberturaLimiteVermelho));

      // Transferencia
      setDiasAnaliseVendas(String(transferenciaRes.config.diasAnaliseVendas));
      setTransferenciaLimiteVerde(String(transferenciaRes.config.transferenciaCoberturaDiasVerde));
      setTransferenciaLimiteAmarelo(String(transferenciaRes.config.transferenciaCoberturaDiasAmarelo));

      // Redistribuicao
      setRedistribuicaoCoberturaIdeal(String(redistribuicaoRes.config.coberturaIdealMeses));
      setRedistribuicaoMaturacao(String(redistribuicaoRes.config.maturacaoDias));
      setRedistribuicaoEstoqueMinimo(String(redistribuicaoRes.config.estoqueMinimoPecas ?? 1));
      setRedistribuicaoLojasRemetentes(redistribuicaoRes.config.lojasRemetentes || []);
      setRedistribuicaoLojasDestinatarias(redistribuicaoRes.config.lojasDestinatarias || []);

      // Sugestao de Producao
      setSugestaoGiroDias(String(sugestaoRes.config.giroDias));
      setSugestaoCoberturaMeses(String(sugestaoRes.config.coberturaMeses));
      setCoberturaAlvoMeses(String(sugestaoRes.config.coberturaAlvoMeses));
      setCorteMinimoDefault(String(sugestaoRes.config.corteMinimoDefault));
      setCorteMinimoSkus(corteMinimoRes.items);

      // Codigos de custo/preco
      pcpConfigApi
        .getCodigosDisponiveis(token)
        .then((codigosRes) => setCodigos(codigosRes))
        .catch(() => setCodigos({ custos: [], precos: [] }));
    } catch (error) {
      showToast('Erro ao carregar configuracoes do PCP', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // === HANDLERS RELATORIO BASE ===
  async function handleSalvarConfig() {
    if (!token) return;
    const giroDiasNum = parseInt(giroDias, 10);
    const coberturaMesesNum = parseInt(coberturaMeses, 10);
    const riscoCoberturaMesesNum = parseFloat(riscoCoberturaMeses);

    if (!giroDiasNum || giroDiasNum <= 0) {
      showToast('Dias de giro precisa ser um numero positivo', 'error');
      return;
    }
    if (!coberturaMesesNum || coberturaMesesNum <= 0) {
      showToast('Meses de cobertura precisa ser um numero positivo', 'error');
      return;
    }
    if (!riscoCoberturaMesesNum || riscoCoberturaMesesNum <= 0) {
      showToast('Risco de ruptura precisa ser um numero positivo', 'error');
      return;
    }

    setSalvandoConfig(true);
    try {
      await pcpConfigApi.updateConfig(token, {
        relatorio: RELATORIO_BASE,
        giroDias: giroDiasNum,
        coberturaMeses: coberturaMesesNum,
        riscoCoberturaMeses: riscoCoberturaMesesNum,
        atacadoCoberturaBase,
        custoCode: parseInt(custoCode, 10),
        pdvVarejoCode: parseInt(pdvVarejoCode, 10),
        pdvAtacadoCode: parseInt(pdvAtacadoCode, 10),
        precoCustoBranchCode: parseInt(precoCustoBranchCode, 10),
      });
      showToast('Configuracao salva!', 'success');
    } catch (error) {
      showToast('Erro ao salvar configuracao', 'error');
      console.error(error);
    } finally {
      setSalvandoConfig(false);
    }
  }

  // A sincronizacao roda em background no servidor (pode levar minutos - ~130+ paginas
  // pro TOTVS) - o POST so dispara e volta na hora, aqui a gente acompanha via polling
  // pra nao travar o navegador esperando 1 request gigante (era isso que crashava/
  // travava antes: request sincrono estourando o timeout do proxy do Render).
  const pollSincronizacao = useCallback(
    (tokenAtual: string) => {
      const interval = setInterval(async () => {
        try {
          const { job } = await pcpConfigApi.getStatusSincronizacaoCustosPrecos(tokenAtual);
          setSyncJob(job);
          if (!job || job.status === 'running') return;

          clearInterval(interval);
          setSincronizando(false);
          if (job.status === 'done' && job.resultado) {
            showToast(
              `Sincronizado! ${job.resultado.custos.linhas} custos e ${job.resultado.precos.linhas} precos (${job.resultado.custos.produtos} produtos)`,
              'success'
            );
            const codigosRes = await pcpConfigApi.getCodigosDisponiveis(tokenAtual);
            setCodigos(codigosRes);
          } else if (job.status === 'error') {
            showToast(`Erro ao sincronizar: ${job.erro || 'erro desconhecido'}`, 'error');
          }
        } catch (error) {
          clearInterval(interval);
          setSincronizando(false);
          showToast('Erro ao consultar status da sincronizacao', 'error');
          console.error(error);
        }
      }, 3000);
    },
    [showToast]
  );

  // Se a tela for recarregada com uma sincronizacao ja rodando (processo pode levar
  // minutos), retoma o acompanhamento em vez de deixar o botao "esquecer" que ha um
  // job em andamento.
  useEffect(() => {
    if (!token) return;
    pcpConfigApi
      .getStatusSincronizacaoCustosPrecos(token)
      .then(({ job }) => {
        setSyncJob(job);
        if (job?.status === 'running') {
          setSincronizando(true);
          pollSincronizacao(token);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSincronizar() {
    if (!token) return;
    setSincronizando(true);
    setSyncJob(null);
    try {
      const { jaEmAndamento } = await pcpConfigApi.sincronizarCustosPrecos(token);
      if (jaEmAndamento) {
        showToast('Ja tem uma sincronizacao rodando - acompanhando o progresso...', 'info');
      }
      pollSincronizacao(token);
    } catch (error) {
      showToast('Erro ao iniciar sincronizacao com o TOTVS', 'error');
      console.error(error);
      setSincronizando(false);
    }
  }

  async function handleSincronizarEmProducao() {
    if (!token) return;
    setSincronizandoProducao(true);
    try {
      const resultado = await pcpConfigApi.sincronizarEmProducao(token);
      showToast(`Sincronizado! ${resultado.linhas} itens em ${resultado.ordens} ordens de producao abertas`, 'success');
    } catch (error) {
      showToast('Erro ao sincronizar Ordens de Producao com o TOTVS', 'error');
      console.error(error);
    } finally {
      setSincronizandoProducao(false);
    }
  }

  async function handleSalvarCoberturaIdeal() {
    if (!token) return;

    const items: PcpCoberturaIdealItem[] = [];
    for (const b of RELATORIO_BASE_BRANCH_ORDER) {
      const valor = parseFloat(coberturaIdeal[b.branchCode]);
      if (!valor || valor <= 0) {
        showToast(`Cobertura ideal de ${b.label} precisa ser um numero positivo`, 'error');
        return;
      }
      items.push({ branchCode: b.branchCode, coberturaIdealMeses: valor });
    }

    setSalvandoCobertura(true);
    try {
      await pcpConfigApi.updateCoberturaIdeal(token, RELATORIO_BASE, items);
      showToast('Cobertura ideal salva!', 'success');
    } catch (error) {
      showToast('Erro ao salvar cobertura ideal', 'error');
      console.error(error);
    } finally {
      setSalvandoCobertura(false);
    }
  }

  async function handleSalvarCurvaAbc() {
    if (!token || !curvaConfig) return;
    if (!Number.isInteger(curvaConfig.giroDias) || curvaConfig.giroDias <= 0) {
      showToast('Meses fechados da Curva ABC precisa ser um numero inteiro positivo', 'error');
      return;
    }
    if (!(curvaConfig.curvaALimitePercent < curvaConfig.curvaBLimitePercent)) {
      showToast('Os limites precisam estar em ordem crescente: A < B', 'error');
      return;
    }

    setSalvandoCurva(true);
    try {
      // Curva C é sempre 100% (não existe mais curva D)
      await pcpConfigApi.updateCurvaAbcConfig(token, { ...curvaConfig, curvaCLimitePercent: 100 });
      showToast('Regras da Curva ABC salvas!', 'success');
    } catch (error) {
      showToast('Erro ao salvar Curva ABC', 'error');
      console.error(error);
    } finally {
      setSalvandoCurva(false);
    }
  }

  // === HANDLER ESTOQUE SEM GIRO ===
  async function handleSalvarEstoqueSemGiro() {
    if (!token) return;

    const maturacaoDiasNum = parseInt(maturacaoDias, 10);
    const coberturaLimiteVerdeNum = parseFloat(coberturaLimiteVerde);
    const coberturaLimiteVermelhoNum = parseFloat(coberturaLimiteVermelho);

    if (!Number.isInteger(maturacaoDiasNum) || maturacaoDiasNum < 0) {
      showToast('Periodo de maturacao precisa ser um numero inteiro nao-negativo', 'error');
      return;
    }
    if (!Number.isFinite(coberturaLimiteVerdeNum) || coberturaLimiteVerdeNum < 0) {
      showToast('Limite verde precisa ser um numero nao-negativo', 'error');
      return;
    }
    if (!Number.isFinite(coberturaLimiteVermelhoNum) || coberturaLimiteVermelhoNum < 0) {
      showToast('Limite vermelho precisa ser um numero nao-negativo', 'error');
      return;
    }

    setSalvandoEstoqueSemGiro(true);
    try {
      await pcpConfigApi.updateEstoqueSemGiroConfig(token, {
        relatorio: RELATORIO_ESTOQUE_SEM_GIRO,
        maturacaoDias: maturacaoDiasNum,
        coberturaLimiteVerde: coberturaLimiteVerdeNum,
        coberturaLimiteVermelho: coberturaLimiteVermelhoNum,
      });
      showToast('Configuracao salva!', 'success');
    } catch (error) {
      showToast('Erro ao salvar configuracao', 'error');
      console.error(error);
    } finally {
      setSalvandoEstoqueSemGiro(false);
    }
  }

  // === HANDLER TRANSFERENCIA ===
  async function handleSalvarTransferencia() {
    if (!token) return;

    const diasAnaliseVendasNum = parseInt(diasAnaliseVendas, 10);
    const limiteVerdeNum = parseInt(transferenciaLimiteVerde, 10);
    const limiteAmareloNum = parseInt(transferenciaLimiteAmarelo, 10);

    if (!Number.isInteger(diasAnaliseVendasNum) || diasAnaliseVendasNum <= 0) {
      showToast('Periodo de analise precisa ser um numero inteiro positivo', 'error');
      return;
    }
    if (!Number.isInteger(limiteVerdeNum) || limiteVerdeNum <= 0) {
      showToast('Limite Verde precisa ser um numero inteiro positivo', 'error');
      return;
    }
    if (!Number.isInteger(limiteAmareloNum) || limiteAmareloNum <= 0) {
      showToast('Limite Amarelo precisa ser um numero inteiro positivo', 'error');
      return;
    }
    if (limiteVerdeNum >= limiteAmareloNum) {
      showToast('Limite Verde deve ser menor que Limite Amarelo', 'error');
      return;
    }

    setSalvandoTransferencia(true);
    try {
      await pcpConfigApi.updateTransferenciaConfig(token, {
        relatorio: RELATORIO_TRANSFERENCIA,
        diasAnaliseVendas: diasAnaliseVendasNum,
        transferenciaCoberturaDiasVerde: limiteVerdeNum,
        transferenciaCoberturaDiasAmarelo: limiteAmareloNum,
      });
      showToast('Configuracao salva!', 'success');
    } catch (error) {
      showToast('Erro ao salvar configuracao', 'error');
      console.error(error);
    } finally {
      setSalvandoTransferencia(false);
    }
  }

  // === HANDLER REDISTRIBUICAO ===
  function toggleLojaRemetente(branchCode: number) {
    setRedistribuicaoLojasRemetentes((prev) =>
      prev.includes(branchCode) ? prev.filter((bc) => bc !== branchCode) : [...prev, branchCode]
    );
  }

  function toggleLojaDestinataria(branchCode: number) {
    setRedistribuicaoLojasDestinatarias((prev) =>
      prev.includes(branchCode) ? prev.filter((bc) => bc !== branchCode) : [...prev, branchCode]
    );
  }

  function selecionarTodasRemetentes() {
    if (redistribuicaoLojasRemetentes.length === FILIAIS_REAIS.length) {
      setRedistribuicaoLojasRemetentes([]);
    } else {
      setRedistribuicaoLojasRemetentes(FILIAIS_REAIS.map((b) => b.branchCode));
    }
  }

  function selecionarTodasDestinatarias() {
    if (redistribuicaoLojasDestinatarias.length === FILIAIS_REAIS.length) {
      setRedistribuicaoLojasDestinatarias([]);
    } else {
      setRedistribuicaoLojasDestinatarias(FILIAIS_REAIS.map((b) => b.branchCode));
    }
  }

  async function handleSalvarRedistribuicao() {
    if (!token) return;

    const coberturaIdealNum = parseFloat(redistribuicaoCoberturaIdeal);
    const maturacaoNum = parseInt(redistribuicaoMaturacao, 10);
    const estoqueMinNum = parseInt(redistribuicaoEstoqueMinimo, 10);

    if (!Number.isFinite(coberturaIdealNum) || coberturaIdealNum <= 0) {
      showToast('Cobertura ideal precisa ser um numero positivo', 'error');
      return;
    }
    if (!Number.isInteger(maturacaoNum) || maturacaoNum < 0) {
      showToast('Periodo de maturacao precisa ser um numero inteiro nao-negativo', 'error');
      return;
    }
    if (!Number.isInteger(estoqueMinNum) || estoqueMinNum < 0) {
      showToast('Estoque minimo precisa ser um numero inteiro nao-negativo', 'error');
      return;
    }

    setSalvandoRedistribuicao(true);
    try {
      await pcpConfigApi.updateRedistribuicaoConfig(token, {
        relatorio: RELATORIO_REDISTRIBUICAO,
        coberturaIdealMeses: coberturaIdealNum,
        maturacaoDias: maturacaoNum,
        estoqueMinimoPecas: estoqueMinNum,
        lojasRemetentes: redistribuicaoLojasRemetentes,
        lojasDestinatarias: redistribuicaoLojasDestinatarias,
      });
      showToast('Configuracao salva!', 'success');
    } catch (error) {
      showToast('Erro ao salvar configuracao', 'error');
      console.error(error);
    } finally {
      setSalvandoRedistribuicao(false);
    }
  }

  // === HANDLERS SUGESTAO DE PRODUCAO ===
  async function handleSalvarSugestaoProducao() {
    if (!token) return;

    const giroDiasNum = parseInt(sugestaoGiroDias, 10);
    const coberturaMesesNum = parseInt(sugestaoCoberturaMeses, 10);
    const coberturaAlvoMesesNum = parseFloat(coberturaAlvoMeses);
    const corteMinimoDefaultNum = parseFloat(corteMinimoDefault);

    if (!Number.isInteger(giroDiasNum) || giroDiasNum <= 0) {
      showToast('Tamanho do periodo de venda precisa ser um numero inteiro positivo', 'error');
      return;
    }
    if (!Number.isInteger(coberturaMesesNum) || coberturaMesesNum <= 0) {
      showToast('Janela da venda media precisa ser um numero inteiro positivo (meses)', 'error');
      return;
    }
    if (!Number.isFinite(coberturaAlvoMesesNum) || coberturaAlvoMesesNum <= 0) {
      showToast('Cobertura alvo precisa ser um numero positivo', 'error');
      return;
    }
    if (!Number.isFinite(corteMinimoDefaultNum) || corteMinimoDefaultNum <= 0) {
      showToast('Corte minimo padrao precisa ser um numero positivo', 'error');
      return;
    }

    setSalvandoSugestaoProducao(true);
    try {
      await pcpConfigApi.updateSugestaoProducaoConfig(token, {
        relatorio: RELATORIO_SUGESTAO_PRODUCAO,
        giroDias: giroDiasNum,
        coberturaMeses: coberturaMesesNum,
        coberturaAlvoMeses: coberturaAlvoMesesNum,
        corteMinimoDefault: corteMinimoDefaultNum,
      });
      showToast('Configuracao salva!', 'success');
    } catch (error) {
      showToast('Erro ao salvar configuracao', 'error');
      console.error(error);
    } finally {
      setSalvandoSugestaoProducao(false);
    }
  }

  async function handleAdicionarCorteMinimo() {
    if (!token) return;
    const sku = novoSkuCorte.trim();
    const valor = parseFloat(novoValorCorte.replace(',', '.'));
    if (!sku) {
      showToast('Informe o SKU', 'error');
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      showToast('Informe um corte minimo valido', 'error');
      return;
    }

    setSalvandoNovoCorte(true);
    try {
      const { items } = await pcpConfigApi.updateCorteMinimoSkus(token, RELATORIO_SUGESTAO_PRODUCAO, [{ sku, corteMinimo: valor }]);
      const salvo = items[0];
      setCorteMinimoSkus((prev) => [...prev.filter((i) => i.sku !== salvo.sku), salvo].sort((a, b) => a.sku.localeCompare(b.sku)));
      setNovoSkuCorte('');
      setNovoValorCorte('');
      showToast('Corte minimo salvo!', 'success');
    } catch (error) {
      showToast('Erro ao salvar corte minimo', 'error');
      console.error(error);
    } finally {
      setSalvandoNovoCorte(false);
    }
  }

  async function handleRemoverCorteMinimo(sku: string) {
    if (!token) return;
    try {
      await pcpConfigApi.deleteCorteMinimoSku(token, sku, RELATORIO_SUGESTAO_PRODUCAO);
      setCorteMinimoSkus((prev) => prev.filter((i) => i.sku !== sku));
    } catch (error) {
      showToast('Erro ao remover corte minimo', 'error');
      console.error(error);
    }
  }

  async function handleUploadCorteMinimoCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setUploadingCorteMinimoCsv(true);
    try {
      const res = await pcpConfigApi.uploadCorteMinimoCsv(token, file, RELATORIO_SUGESTAO_PRODUCAO);
      const porSku = new Map(res.items.map((i) => [i.sku, i]));
      setCorteMinimoSkus((prev) => {
        const semAtualizados = prev.filter((i) => !porSku.has(i.sku));
        return [...semAtualizados, ...res.items].sort((a, b) => a.sku.localeCompare(b.sku));
      });
      showToast(
        `${res.total_salvos} SKU(s) salvos${res.linhas_invalidas > 0 ? ` (${res.linhas_invalidas} linha(s) invalida(s) ignorada(s))` : ''}`,
        'success'
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao processar CSV', 'error');
      console.error(error);
    } finally {
      setUploadingCorteMinimoCsv(false);
      e.target.value = '';
    }
  }

  const secoes = [
    { id: 'relatorio-base' as const, label: 'Relatorio Base' },
    { id: 'estoque-sem-giro' as const, label: 'Estoque Sem Giro' },
    { id: 'transferencia' as const, label: 'Transferencia' },
    { id: 'redistribuicao' as const, label: 'Redistribuicao' },
    { id: 'sugestao-producao' as const, label: 'Sugestao de Producao' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Configuracoes</h1>
        <p className="text-gray-500 text-sm mt-1">
          Gerencie todas as configuracoes dos relatorios PCP em um unico lugar.
        </p>
      </div>

      {/* Tabs de navegacao */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          {secoes.map((secao) => (
            <button
              key={secao.id}
              onClick={() => setSecaoAtiva(secao.id)}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                secaoAtiva === secao.id
                  ? 'border-[#6B5B95] text-[#6B5B95]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {secao.label}
            </button>
          ))}
        </nav>
      </div>

      {/* === SECAO RELATORIO BASE === */}
      {secaoAtiva === 'relatorio-base' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Janelas de calculo</CardTitle>
            </CardHeader>
            <div className="flex flex-wrap gap-4 items-end">
              <Input
                label="Giro - dias"
                type="number"
                min="1"
                value={giroDias}
                onChange={(e) => setGiroDias(e.target.value)}
                className="w-32"
                disabled={isLoading}
              />
              <Input
                label="Cobertura - meses"
                type="number"
                min="1"
                value={coberturaMeses}
                onChange={(e) => setCoberturaMeses(e.target.value)}
                className="w-32"
                disabled={isLoading}
              />
              <Input
                label="Risco ruptura abaixo de"
                type="number"
                step="0.1"
                min="0.1"
                value={riscoCoberturaMeses}
                onChange={(e) => setRiscoCoberturaMeses(e.target.value)}
                className="w-44"
                disabled={isLoading}
              />
              <Select
                label="Base da cobertura do Atacado"
                options={ATACADO_COBERTURA_OPTIONS}
                value={atacadoCoberturaBase}
                onChange={(e) => setAtacadoCoberturaBase(e.target.value)}
                className="w-80"
                disabled={isLoading}
              />
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t">
              <Button onClick={handleSalvarConfig} isLoading={salvandoConfig} size="sm" disabled={isLoading}>
                Salvar
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custo e Preco</CardTitle>
              <Button variant="secondary" size="sm" onClick={handleSincronizar} isLoading={sincronizando}>
                Sincronizar com o TOTVS
              </Button>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-2">
              O TOTVS tem varios tipos de custo e preco cadastrados por produto - escolha qual usar em cada coluna do Relatorio Base.
              {codigos.custos.length === 0 && ' Sincronize pelo menos uma vez para liberar os selects.'}
            </p>
            {sincronizando && (
              <p className="text-xs text-gray-400 mb-4">
                Sincronizando em segundo plano (pode levar alguns minutos) -{' '}
                {syncJob
                  ? `custos: ${syncJob.progress.custo.linhasTotal} linhas (lote ${syncJob.progress.custo.chunkIndex}/${syncJob.progress.custo.totalChunks || 1}, pagina ${syncJob.progress.custo.page}) - precos: ${syncJob.progress.preco.linhasTotal} linhas (lote ${syncJob.progress.preco.chunkIndex}/${syncJob.progress.preco.totalChunks || 1}, pagina ${syncJob.progress.preco.page})`
                  : 'iniciando...'}
              </p>
            )}
            <div className="flex flex-wrap gap-4 items-end">
              <Select
                label="Custo"
                options={codigos.custos.map((c) => ({ value: c.code, label: c.name }))}
                value={custoCode}
                onChange={(e) => setCustoCode(e.target.value)}
                className="w-56"
                disabled={isLoading || codigos.custos.length === 0}
              />
              <Select
                label="PDV Real (Varejo)"
                options={codigos.precos.map((c) => ({ value: c.code, label: c.name }))}
                value={pdvVarejoCode}
                onChange={(e) => setPdvVarejoCode(e.target.value)}
                className="w-56"
                disabled={isLoading || codigos.precos.length === 0}
              />
              <Select
                label="PDV Real (Atacado)"
                options={codigos.precos.map((c) => ({ value: c.code, label: c.name }))}
                value={pdvAtacadoCode}
                onChange={(e) => setPdvAtacadoCode(e.target.value)}
                className="w-56"
                disabled={isLoading || codigos.precos.length === 0}
              />
              <Select
                label="Loja de referencia"
                options={FILIAIS_REAIS.map((b) => ({ value: b.branchCode, label: b.label }))}
                value={precoCustoBranchCode}
                onChange={(e) => setPrecoCustoBranchCode(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t">
              <Button onClick={handleSalvarConfig} isLoading={salvandoConfig} size="sm" disabled={isLoading}>
                Salvar
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Em Producao</CardTitle>
              <Button variant="secondary" size="sm" onClick={handleSincronizarEmProducao} isLoading={sincronizandoProducao}>
                Sincronizar com o TOTVS
              </Button>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2">
              Alimenta a coluna &quot;Em Producao&quot; do Relatorio Base com a quantidade pendente das Ordens de Producao do TOTVS ainda abertas.
            </p>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cobertura ideal por loja</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Quantos meses de estoque cada loja deveria ter, em condicoes ideais.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {RELATORIO_BASE_BRANCH_ORDER.map((b) => (
                <div key={b.branchCode} className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700 w-28 truncate" title={b.label}>
                    {b.label}
                  </span>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={coberturaIdeal[b.branchCode] ?? ''}
                    onChange={(e) => setCoberturaIdeal((prev) => ({ ...prev, [b.branchCode]: e.target.value }))}
                    className="w-20"
                    disabled={isLoading}
                  />
                  <span className="text-xs text-gray-500">meses</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t">
              <Button onClick={handleSalvarCoberturaIdeal} isLoading={salvandoCobertura} size="sm" disabled={isLoading}>
                Salvar
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Curva ABC</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Classificacao por representatividade acumulada da media mensal de valor dos ultimos meses fechados. Curva C vai ate 100%.
            </p>
            {curvaConfig && (
              <>
                <div className="flex flex-wrap gap-4 items-end">
                  <Input
                    label="Meses fechados"
                    type="number"
                    step="1"
                    min="1"
                    max="24"
                    value={Math.round(curvaConfig.giroDias / 30)}
                    onChange={(e) => setCurvaConfig({ ...curvaConfig, giroDias: Math.max(1, Number(e.target.value) || 1) * 30 })}
                    className="w-36"
                    disabled={isLoading}
                  />
                  <Input
                    label="Curva A ate (%)"
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={curvaConfig.curvaALimitePercent}
                    onChange={(e) => setCurvaConfig({ ...curvaConfig, curvaALimitePercent: Number(e.target.value) })}
                    className="w-36"
                    disabled={isLoading}
                  />
                  <Input
                    label="Curva B ate (%)"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={curvaConfig.curvaBLimitePercent}
                    onChange={(e) => setCurvaConfig({ ...curvaConfig, curvaBLimitePercent: Number(e.target.value) })}
                    className="w-36"
                    disabled={isLoading}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">Curva C = restante ate 100% (nao existe mais curva D).</p>
                <div className="flex justify-end mt-4 pt-4 border-t">
                  <Button onClick={handleSalvarCurvaAbc} isLoading={salvandoCurva} size="sm" disabled={isLoading}>
                    Salvar
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* === SECAO ESTOQUE SEM GIRO === */}
      {secaoAtiva === 'estoque-sem-giro' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Periodo de Maturacao</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Produtos que chegaram nas lojas ha menos tempo que este periodo nao serao sinalizados como &quot;sem giro&quot;.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <Input
                label="Periodo de maturacao (dias)"
                type="number"
                min="0"
                value={maturacaoDias}
                onChange={(e) => setMaturacaoDias(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Recomendado: 15 a 30 dias. Use 0 para desabilitar o filtro de maturacao.
            </p>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Limiares de Cobertura</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Define os limiares de cobertura em meses para sinalizar produtos com estoque baixo (verde) ou alto (vermelho).
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <Input
                label="Limite verde (ate X meses)"
                type="number"
                step="0.01"
                min="0"
                value={coberturaLimiteVerde}
                onChange={(e) => setCoberturaLimiteVerde(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
              <Input
                label="Limite vermelho (acima de X meses)"
                type="number"
                step="0.01"
                min="0"
                value={coberturaLimiteVermelho}
                onChange={(e) => setCoberturaLimiteVermelho(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
            </div>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSalvarEstoqueSemGiro} isLoading={salvandoEstoqueSemGiro} disabled={isLoading}>
              Salvar Configuracoes
            </Button>
          </div>
        </div>
      )}

      {/* === SECAO TRANSFERENCIA === */}
      {secaoAtiva === 'transferencia' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Periodo de Analise de Vendas</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Define quantos dias de historico de vendas serao utilizados para calcular a cobertura de estoque.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <Input
                label="Periodo de analise (dias)"
                type="number"
                min="1"
                value={diasAnaliseVendas}
                onChange={(e) => setDiasAnaliseVendas(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Recomendado: 30 a 60 dias. Periodos mais curtos refletem tendencias recentes.
            </p>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Legenda de Cobertura</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Define os limites de dias de cobertura para coloracao da tabela de transferencias.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <Input
                label="Limite Verde (dias)"
                type="number"
                min="1"
                value={transferenciaLimiteVerde}
                onChange={(e) => setTransferenciaLimiteVerde(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
              <Input
                label="Limite Amarelo (dias)"
                type="number"
                min="1"
                value={transferenciaLimiteAmarelo}
                onChange={(e) => setTransferenciaLimiteAmarelo(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
            </div>
            <div className="mt-3 space-y-1 text-xs">
              <p className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 bg-[#CC222E]/20 border border-[#CC222E] rounded"></span>
                <span className="text-gray-600">Ruptura: cobertura &lt; {transferenciaLimiteVerde} dias (pode receber transferencia)</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 bg-[#F5A623]/20 border border-[#F5A623] rounded"></span>
                <span className="text-gray-600">Equilibrio: cobertura entre {transferenciaLimiteVerde} e {transferenciaLimiteAmarelo} dias</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 bg-[#6B5B95]/20 border border-[#6B5B95] rounded"></span>
                <span className="text-gray-600">Excesso: cobertura &gt; {transferenciaLimiteAmarelo} dias (pode enviar transferencia)</span>
              </p>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSalvarTransferencia} isLoading={salvandoTransferencia} disabled={isLoading}>
              Salvar Configuracoes
            </Button>
          </div>
        </div>
      )}

      {/* === SECAO REDISTRIBUICAO === */}
      {secaoAtiva === 'redistribuicao' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Parametros de Sugestao</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Configura os criterios usados pelo algoritmo de sugestao de redistribuicao.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <Input
                label="Cobertura ideal (meses)"
                type="number"
                step="0.5"
                min="0.5"
                value={redistribuicaoCoberturaIdeal}
                onChange={(e) => setRedistribuicaoCoberturaIdeal(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
              <Input
                label="Maturacao (dias)"
                type="number"
                min="0"
                value={redistribuicaoMaturacao}
                onChange={(e) => setRedistribuicaoMaturacao(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
              <Input
                label="Estoque minimo (pecas)"
                type="number"
                min="0"
                value={redistribuicaoEstoqueMinimo}
                onChange={(e) => setRedistribuicaoEstoqueMinimo(e.target.value)}
                className="w-48"
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              <strong>Cobertura ideal:</strong> SKUs com cobertura acima desse valor em uma loja serao considerados para envio.
              <br />
              <strong>Maturacao:</strong> Produtos que chegaram na loja ha menos tempo que esse periodo nao serao sugeridos para redistribuicao. Use 0 para desabilitar.
              <br />
              <strong>Estoque minimo:</strong> Quantidade minima de pecas que deve permanecer na loja origem apos a redistribuicao. Use 0 para permitir enviar todo o estoque.
            </p>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lojas Remetentes</CardTitle>
              <Button variant="secondary" size="sm" onClick={selecionarTodasRemetentes}>
                {redistribuicaoLojasRemetentes.length === FILIAIS_REAIS.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </Button>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Quais lojas podem <strong>enviar</strong> estoque na sugestao de redistribuicao. Se nenhuma for selecionada, considera todas.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {FILIAIS_REAIS.map((b) => (
                <label key={b.branchCode} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={redistribuicaoLojasRemetentes.includes(b.branchCode)}
                    onChange={() => toggleLojaRemetente(b.branchCode)}
                    disabled={isLoading}
                    className="w-4 h-4 text-[#6B5B95] border-gray-300 rounded focus:ring-[#6B5B95]"
                  />
                  <span className="text-sm text-gray-700">{b.label}</span>
                </label>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lojas Destinatarias</CardTitle>
              <Button variant="secondary" size="sm" onClick={selecionarTodasDestinatarias}>
                {redistribuicaoLojasDestinatarias.length === FILIAIS_REAIS.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </Button>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Quais lojas podem <strong>receber</strong> estoque na sugestao de redistribuicao. Se nenhuma for selecionada, considera todas.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {FILIAIS_REAIS.map((b) => (
                <label key={b.branchCode} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={redistribuicaoLojasDestinatarias.includes(b.branchCode)}
                    onChange={() => toggleLojaDestinataria(b.branchCode)}
                    disabled={isLoading}
                    className="w-4 h-4 text-[#6B5B95] border-gray-300 rounded focus:ring-[#6B5B95]"
                  />
                  <span className="text-sm text-gray-700">{b.label}</span>
                </label>
              ))}
            </div>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSalvarRedistribuicao} isLoading={salvandoRedistribuicao} disabled={isLoading}>
              Salvar Configuracoes
            </Button>
          </div>
        </div>
      )}

      {/* === SECAO SUGESTAO DE PRODUCAO === */}
      {secaoAtiva === 'sugestao-producao' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Venda Media e Cobertura Alvo</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              O estoque minimo (rede toda) usado na sugestao de producao e a venda media mensal multiplicada pela cobertura alvo.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <Input
                label="Tamanho de cada periodo comparado (dias)"
                type="number"
                min="1"
                value={sugestaoGiroDias}
                onChange={(e) => setSugestaoGiroDias(e.target.value)}
                className="w-64"
                disabled={isLoading}
              />
              <Input
                label="Janela da venda media (meses)"
                type="number"
                min="1"
                value={sugestaoCoberturaMeses}
                onChange={(e) => setSugestaoCoberturaMeses(e.target.value)}
                className="w-56"
                disabled={isLoading}
              />
              <Input
                label="Cobertura alvo (x venda media)"
                type="number"
                step="0.1"
                min="0.1"
                value={coberturaAlvoMeses}
                onChange={(e) => setCoberturaAlvoMeses(e.target.value)}
                className="w-56"
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Ex.: cobertura alvo 1 = estoque minimo igual a 1 mes de venda media. 2 = 2 meses de venda media guardados.
            </p>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Corte Minimo Padrao</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Usado pra arredondar a sugestao de producao de qualquer SKU sem um corte minimo especifico cadastrado abaixo.
            </p>
            <Input
              label="Corte minimo padrao (pecas)"
              type="number"
              step="1"
              min="1"
              value={corteMinimoDefault}
              onChange={(e) => setCorteMinimoDefault(e.target.value)}
              className="w-56"
              disabled={isLoading}
            />
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSalvarSugestaoProducao} isLoading={salvandoSugestaoProducao} disabled={isLoading}>
              Salvar Configuracoes
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Corte Minimo por SKU</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Overrides especificos por SKU (product_sku) - tem prioridade sobre o corte minimo padrao acima.
            </p>

            <div className="flex flex-wrap gap-2 items-end mb-4">
              <Input label="SKU" value={novoSkuCorte} onChange={(e) => setNovoSkuCorte(e.target.value)} className="w-48" />
              <Input
                label="Corte minimo"
                type="number"
                step="1"
                min="1"
                value={novoValorCorte}
                onChange={(e) => setNovoValorCorte(e.target.value)}
                className="w-40"
              />
              <Button onClick={handleAdicionarCorteMinimo} isLoading={salvandoNovoCorte} variant="secondary">
                Adicionar
              </Button>
            </div>

            <div className="pt-3 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ou envie um CSV com SKU;VALOR (uma linha por SKU)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleUploadCorteMinimoCsv}
                  disabled={uploadingCorteMinimoCsv}
                  className="text-sm"
                />
                {uploadingCorteMinimoCsv && <span className="text-xs text-gray-500">Processando...</span>}
              </div>
            </div>

            {corteMinimoSkus.length > 0 && (
              <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5">SKU</th>
                      <th className="text-right px-3 py-1.5">Corte Minimo</th>
                      <th className="text-center px-3 py-1.5 w-24">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {corteMinimoSkus.map((item) => (
                      <tr key={item.sku}>
                        <td className="px-3 py-1.5">{item.sku}</td>
                        <td className="px-3 py-1.5 text-right">{Number(item.corteMinimo)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoverCorteMinimo(item.sku)}
                            className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
