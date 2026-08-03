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
} from '@/lib/api';
import { RELATORIO_BASE_BRANCH_ORDER } from '@/lib/pcpBranches';

const RELATORIO_BASE = 'relatorio_base';
const RELATORIO_ESTOQUE_SEM_GIRO = 'estoque_sem_giro';
const RELATORIO_TRANSFERENCIA = 'gestao_transferencia';

const ATACADO_COBERTURA_OPTIONS = [
  { value: 'fabrica_total', label: 'Venda total da Fabrica (todos os canais)' },
  { value: 'atacado_only', label: 'So venda do canal Atacado' },
];

const FILIAIS_REAIS = RELATORIO_BASE_BRANCH_ORDER.filter((b) => b.branchCode > 0);

type SecaoAtiva = 'relatorio-base' | 'estoque-sem-giro' | 'transferencia';

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

  // Carregar todos os dados
  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const [configRes, coberturaRes, curvaRes, estoqueRes, transferenciaRes] = await Promise.all([
        pcpConfigApi.getConfig(token, RELATORIO_BASE),
        pcpConfigApi.getCoberturaIdeal(token, RELATORIO_BASE),
        pcpConfigApi.getCurvaAbcConfig(token),
        pcpConfigApi.getEstoqueSemGiroConfig(token, RELATORIO_ESTOQUE_SEM_GIRO),
        pcpConfigApi.getTransferenciaConfig(token, RELATORIO_TRANSFERENCIA),
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

  async function handleSincronizar() {
    if (!token) return;
    setSincronizando(true);
    try {
      const resultado = await pcpConfigApi.sincronizarCustosPrecos(token);
      showToast(
        `Sincronizado! ${resultado.custos.linhas} custos e ${resultado.precos.linhas} precos (${resultado.custos.produtos} produtos)`,
        'success'
      );
      const codigosRes = await pcpConfigApi.getCodigosDisponiveis(token);
      setCodigos(codigosRes);
    } catch (error) {
      showToast('Erro ao sincronizar custo/preco com o TOTVS', 'error');
      console.error(error);
    } finally {
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
      showToast('Meses fechados da Curva ABCD precisa ser um numero inteiro positivo', 'error');
      return;
    }
    if (!(curvaConfig.curvaALimitePercent < curvaConfig.curvaBLimitePercent && curvaConfig.curvaBLimitePercent < curvaConfig.curvaCLimitePercent)) {
      showToast('Os limites precisam estar em ordem crescente: A < B < C', 'error');
      return;
    }

    setSalvandoCurva(true);
    try {
      await pcpConfigApi.updateCurvaAbcConfig(token, curvaConfig);
      showToast('Regras da Curva ABCD salvas!', 'success');
    } catch (error) {
      showToast('Erro ao salvar Curva ABCD', 'error');
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

  const secoes = [
    { id: 'relatorio-base' as const, label: 'Relatorio Base' },
    { id: 'estoque-sem-giro' as const, label: 'Estoque Sem Giro' },
    { id: 'transferencia' as const, label: 'Transferencia' },
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
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              O TOTVS tem varios tipos de custo e preco cadastrados por produto - escolha qual usar em cada coluna do Relatorio Base.
              {codigos.custos.length === 0 && ' Sincronize pelo menos uma vez para liberar os selects.'}
            </p>
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
              <CardTitle>Curva ABCD</CardTitle>
            </CardHeader>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              Classificacao por representatividade acumulada da media mensal de valor dos ultimos meses fechados.
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
                  <Input
                    label="Curva C ate (%)"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={curvaConfig.curvaCLimitePercent}
                    onChange={(e) => setCurvaConfig({ ...curvaConfig, curvaCLimitePercent: Number(e.target.value) })}
                    className="w-36"
                    disabled={isLoading}
                  />
                </div>
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
    </div>
  );
}
