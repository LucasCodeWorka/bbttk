'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { pcpConfigApi, PcpCoberturaIdealItem, PcpCodigosDisponiveis, PcpCurvaAbcConfig } from '@/lib/api';
import { RELATORIO_BASE_BRANCH_ORDER } from '@/lib/pcpBranches';

const RELATORIO = 'relatorio_base';

const ATACADO_COBERTURA_OPTIONS = [
  { value: 'fabrica_total', label: 'Venda total da Fabrica (todos os canais)' },
  { value: 'atacado_only', label: 'So venda do canal Atacado' },
];

const FILIAIS_REAIS = RELATORIO_BASE_BRANCH_ORDER.filter((b) => b.branchCode > 0);

export default function RelatorioBaseConfigPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
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

  // Cobertura ideal por loja - mapa branchCode -> valor em meses (string pra edicao livre no input)
  const [coberturaIdeal, setCoberturaIdeal] = useState<Record<number, string>>({});
  const [salvandoCobertura, setSalvandoCobertura] = useState(false);
  const [curvaConfig, setCurvaConfig] = useState<PcpCurvaAbcConfig | null>(null);
  const [salvandoCurva, setSalvandoCurva] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const [configRes, coberturaRes, curvaRes] = await Promise.all([
        pcpConfigApi.getConfig(token, RELATORIO),
        pcpConfigApi.getCoberturaIdeal(token, RELATORIO),
        pcpConfigApi.getCurvaAbcConfig(token),
      ]);

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

      pcpConfigApi
        .getCodigosDisponiveis(token)
        .then((codigosRes) => setCodigos(codigosRes))
        .catch((error) => {
          setCodigos({ custos: [], precos: [] });
          console.warn('Codigos de custo/preco ainda nao sincronizados:', error);
        });
    } catch (error) {
      showToast('Erro ao carregar configuracao do PCP', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

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
        relatorio: RELATORIO,
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
      await pcpConfigApi.updateCoberturaIdeal(token, RELATORIO, items);
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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Configuracao do Relatorio Base</h1>
        <p className="text-gray-500 text-sm mt-1">
          Define as janelas de calculo (giro/cobertura) e a meta de cobertura ideal por loja - usado pelo
          Relatorio Base e futuros relatorios PCP.
        </p>
      </div>

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
          <CardTitle>Custo e Preço</CardTitle>
          <Button variant="secondary" size="sm" onClick={handleSincronizar} isLoading={sincronizando}>
            Sincronizar com o TOTVS
          </Button>
        </CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-4">
          O TOTVS tem vários tipos de custo e preço cadastrados por produto (ex: &quot;MÉDIO S/ IMPOSTO&quot;,
          &quot;ÚLTIMA COMPRA&quot; para custo; &quot;VAREJO&quot;, &quot;ATACADO&quot; para preço) - escolha qual usar em cada
          coluna do Relatório Base. {codigos.custos.length === 0 && 'Sincronize pelo menos uma vez para liberar apenas estes selects.'}
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
            label="Loja de referência"
            options={FILIAIS_REAIS.map((b) => ({ value: b.branchCode, label: b.label }))}
            value={precoCustoBranchCode}
            onChange={(e) => setPrecoCustoBranchCode(e.target.value)}
            className="w-48"
            disabled={isLoading}
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Custo/preço são por loja no TOTVS, mas o Relatório Base mostra 1 valor só por SKU - &quot;Loja de referência&quot;
          define de qual loja vem esse valor.
        </p>
        <div className="flex justify-end mt-4 pt-4 border-t">
          <Button onClick={handleSalvarConfig} isLoading={salvandoConfig} size="sm" disabled={isLoading}>
            Salvar
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cobertura ideal por loja</CardTitle>
        </CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-4">
          Quantos meses de estoque cada loja deveria ter, em condicoes ideais - usado pra sinalizar cobertura
          baixa/alta no Relatorio Base.
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
                onChange={(e) =>
                  setCoberturaIdeal((prev) => ({ ...prev, [b.branchCode]: e.target.value }))
                }
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
          Classificacao por representatividade acumulada da media mensal de valor dos ultimos meses fechados
          (janela configuravel abaixo). As referencias sao ordenadas por essa media; A, B e C usam os limites
          acumulados abaixo, e D e o restante.
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
            <p className="text-xs text-gray-400 mt-2">
              Exemplo: 80 / 95 / 99 classifica A ate 80% do valor acumulado, B ate 95%, C ate 99% e D acima disso.
              &quot;Meses fechados&quot; e a janela de calculo (meses completos anteriores ao atual, nunca o mes
              corrente parcial) - o padrao e 3, mas pode usar 4, 6 etc. se precisar de uma media mais estavel.
            </p>
            <div className="flex justify-end mt-4 pt-4 border-t">
              <Button onClick={handleSalvarCurvaAbc} isLoading={salvandoCurva} size="sm" disabled={isLoading}>
                Salvar
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
