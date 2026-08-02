'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { pcpConfigApi, PcpEstoqueSemGiroConfig } from '@/lib/api';

const RELATORIO = 'estoque_sem_giro';

export default function EstoqueSemGiroConfigPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [maturacaoDias, setMaturacaoDias] = useState('30');
  const [coberturaLimiteVerde, setCoberturaLimiteVerde] = useState('4.00');
  const [coberturaLimiteVermelho, setCoberturaLimiteVermelho] = useState('4.01');
  const [salvando, setSalvando] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const configRes = await pcpConfigApi.getEstoqueSemGiroConfig(token, RELATORIO);

      setMaturacaoDias(String(configRes.config.maturacaoDias));
      setCoberturaLimiteVerde(String(configRes.config.coberturaLimiteVerde));
      setCoberturaLimiteVermelho(String(configRes.config.coberturaLimiteVermelho));
    } catch (error) {
      showToast('Erro ao carregar configuracao do Estoque Sem Giro', 'error');
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

    setSalvando(true);
    try {
      await pcpConfigApi.updateEstoqueSemGiroConfig(token, {
        relatorio: RELATORIO,
        maturacaoDias: maturacaoDiasNum,
        coberturaLimiteVerde: coberturaLimiteVerdeNum,
        coberturaLimiteVermelho: coberturaLimiteVermelhoNum,
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
        <h1 className="text-2xl font-bold text-gray-900">Configuracao do Estoque Sem Giro</h1>
        <p className="text-gray-500 text-sm mt-1">
          Define o periodo de maturacao e os limiares de cobertura para o relatorio de Estoque Sem Giro.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Periodo de Maturacao</CardTitle>
        </CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-4">
          Produtos que chegaram nas lojas ha menos tempo que este periodo nao serao sinalizados como &quot;sem giro&quot;.
          Isso evita marcar produtos novos como problema antes que tenham tempo de giro natural.
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
          Recomendado: 30 dias ou mais. Use 0 para desabilitar o filtro de maturacao.
        </p>
        <div className="flex justify-end mt-4 pt-4 border-t">
          <Button onClick={handleSalvar} isLoading={salvando} size="sm" disabled={isLoading}>
            Salvar
          </Button>
        </div>
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
        <p className="text-xs text-gray-400 mt-2">
          Produtos com cobertura ate o limite verde serao sinalizados em verde (estoque baixo).
          Produtos com cobertura acima do limite vermelho serao sinalizados em vermelho (estoque alto).
        </p>
        <div className="flex justify-end mt-4 pt-4 border-t">
          <Button onClick={handleSalvar} isLoading={salvando} size="sm" disabled={isLoading}>
            Salvar
          </Button>
        </div>
      </Card>
    </div>
  );
}
