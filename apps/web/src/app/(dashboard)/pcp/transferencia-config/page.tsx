'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { pcpConfigApi, PcpTransferenciaConfig } from '@/lib/api';

const RELATORIO = 'gestao_transferencia';

export default function TransferenciaConfigPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [diasAnaliseVendas, setDiasAnaliseVendas] = useState('30');
  const [limiteVerde, setLimiteVerde] = useState('75');
  const [limiteAmarelo, setLimiteAmarelo] = useState('120');
  const [salvando, setSalvando] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const configRes = await pcpConfigApi.getTransferenciaConfig(token, RELATORIO);
      setDiasAnaliseVendas(String(configRes.config.diasAnaliseVendas));
      setLimiteVerde(String(configRes.config.transferenciaCoberturaDiasVerde));
      setLimiteAmarelo(String(configRes.config.transferenciaCoberturaDiasAmarelo));
    } catch (error) {
      showToast('Erro ao carregar configuracao de Transferencia', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  async function handleSalvar() {
    if (!token) return;

    const diasAnaliseVendasNum = parseInt(diasAnaliseVendas, 10);
    const limiteVerdeNum = parseInt(limiteVerde, 10);
    const limiteAmareloNum = parseInt(limiteAmarelo, 10);

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

    setSalvando(true);
    try {
      await pcpConfigApi.updateTransferenciaConfig(token, {
        relatorio: RELATORIO,
        diasAnaliseVendas: diasAnaliseVendasNum,
        transferenciaCoberturaDiasVerde: limiteVerdeNum,
        transferenciaCoberturaDiasAmarelo: limiteAmareloNum,
      });
      showToast('Configuracao salva!', 'success');
    } catch (error) {
      showToast('Erro ao salvar configuracao', 'error');
      console.error(error);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Configuracao da Gestao de Transferencia</h1>
        <p className="text-gray-500 text-sm mt-1">
          Define o periodo de analise de vendas utilizado para calcular a cobertura de estoque.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Periodo de Analise de Vendas</CardTitle>
        </CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-4">
          Define quantos dias de historico de vendas serao utilizados para calcular a cobertura de estoque
          e identificar oportunidades de transferencia entre filiais.
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
          Recomendado: 30 a 60 dias. Periodos mais curtos refletem tendencias recentes, periodos mais longos suavizam variacoes sazonais.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legenda de Cobertura</CardTitle>
        </CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-4">
          Define os limites de dias de cobertura para coloracao da tabela de transferencias.
          Cobertura = estoque / (vendas no periodo / dias do periodo).
        </p>
        <div className="flex flex-wrap gap-4 items-end">
          <Input
            label="Limite Verde (dias)"
            type="number"
            min="1"
            value={limiteVerde}
            onChange={(e) => setLimiteVerde(e.target.value)}
            className="w-48"
            disabled={isLoading}
          />
          <Input
            label="Limite Amarelo (dias)"
            type="number"
            min="1"
            value={limiteAmarelo}
            onChange={(e) => setLimiteAmarelo(e.target.value)}
            className="w-48"
            disabled={isLoading}
          />
        </div>
        <div className="mt-3 space-y-1 text-xs">
          <p className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 bg-green-100 border border-green-300 rounded"></span>
            <span className="text-gray-600">Verde: cobertura &lt; {limiteVerde} dias (estoque baixo, pode receber transferencia)</span>
          </p>
          <p className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></span>
            <span className="text-gray-600">Amarelo: cobertura entre {limiteVerde} e {limiteAmarelo} dias (estoque adequado)</span>
          </p>
          <p className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 bg-red-100 border border-red-300 rounded"></span>
            <span className="text-gray-600">Vermelho: cobertura &gt; {limiteAmarelo} dias (estoque alto, pode enviar transferencia)</span>
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSalvar} isLoading={salvando} disabled={isLoading}>
          Salvar Configuracoes
        </Button>
      </div>
    </div>
  );
}
