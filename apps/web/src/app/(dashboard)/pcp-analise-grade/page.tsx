'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ClassificacaoMultiSelect } from '@/components/ui/ClassificacaoMultiSelect';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { GradeHeatmap } from '@/components/pcp/GradeHeatmap';
import { CurvaAbcTable } from '@/components/pcp/CurvaAbcTable';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  analiseGradeApi,
  relatorioBaseApi,
  AnaliseGradeResponse,
  CurvaAbcTamanhoResponse,
  PcpClassificacaoDimensao,
} from '@/lib/pcpApi';
import { RELATORIO_BASE_BRANCH_ORDER } from '@/lib/pcpBranches';
import { formatNumber } from '@/lib/utils';

export default function PcpAnaliseGradePage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<AnaliseGradeResponse | null>(null);
  const [curvaTamanho, setCurvaTamanho] = useState<CurvaAbcTamanhoResponse | null>(null);

  const [classificacoes, setClassificacoes] = useState<PcpClassificacaoDimensao[]>([]);
  const [produtoFiltro, setProdutoFiltro] = useState<Record<string, string[] | undefined>>({});
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [referenciaBusca, setReferenciaBusca] = useState('');

  useEffect(() => {
    if (!token) return;
    relatorioBaseApi
      .getFiltrosRelatorioBase(token)
      .then((res) => setClassificacoes(res.classificacoes.filter((d) => d.chave !== 'status')))
      .catch((error) => console.error('Erro ao carregar filtros:', error));
  }, [token]);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const filtro = {
        referencia: referenciaBusca.trim() || undefined,
        categoria: produtoFiltro.categoria,
        linha: produtoFiltro.linha,
        genero: produtoFiltro.genero,
        branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
      };
      const [gradeRes, curvaRes] = await Promise.all([
        analiseGradeApi.getGrade(token, filtro),
        analiseGradeApi.getCurvaAbcTamanho(token, filtro),
      ]);
      setData(gradeRes);
      setCurvaTamanho(curvaRes);
    } catch (error) {
      showToast('Erro ao carregar Análise de Grade', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, produtoFiltro, filiaisSelecionadas, referenciaBusca]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  function atualizarProdutoFiltro(chave: string, valores: string[]) {
    setProdutoFiltro((prev) => ({ ...prev, [chave]: valores.length > 0 ? valores : undefined }));
  }

  // Mostra so as 30 referencias com mais estoque de cada vez - a grade completa (todas
  // as referencias) fica ilegivel numa tela so, mesmo padrao "Top N" do resto do PCP.
  const referenciasExibidas = (data?.referencias || []).slice(0, 30);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Análise de Grade</h1>
        <p className="text-gray-500 text-sm mt-1">Estoque por referência × tamanho, ruptura e curva ABC de tamanhos</p>
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm font-medium text-gray-800">Painel em fase de teste</p>
        <p className="text-xs text-gray-600 mt-1">
          Mostra as 30 referências com mais estoque. Filtro por cor ainda não está na tela (a API já aceita, falta
          UI). Completude da grade = % dos tamanhos da própria referência com estoque &gt; 0.
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        {classificacoes.map((dim) => (
          <ClassificacaoMultiSelect
            key={dim.chave}
            label={dim.label}
            options={dim.opcoes.map((option) => ({ value: option.valor, label: option.valor }))}
            selected={produtoFiltro[dim.chave] || []}
            onChange={(valores) => atualizarProdutoFiltro(dim.chave, valores)}
            className="w-44"
          />
        ))}
        <FilialMultiSelect
          selected={filiaisSelecionadas}
          onChange={setFiliaisSelecionadas}
          options={RELATORIO_BASE_BRANCH_ORDER.map((b) => ({ value: b.branchCode, label: b.label }))}
          label="Loja"
          className="w-52"
        />
        <Input
          label="Buscar referência"
          value={referenciaBusca}
          onChange={(e) => setReferenciaBusca(e.target.value)}
          className="w-48"
          placeholder="Código da referência"
        />
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="SKUs em ruptura total"
          value={isLoading || !data ? '—' : `${data.indicadores.skusEmRupturaTotal} de ${data.indicadores.totalCelulas}`}
          color="red"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPICard
          title="Células com cobertura < 1 mês"
          value={isLoading || !data ? '—' : formatNumber(data.indicadores.celulasComCoberturaBaixa)}
          color="yellow"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPICard
          title="Completude média da grade"
          value={isLoading || !data ? '—' : `${data.indicadores.completudeMediaPercent.toFixed(1)}%`}
          color="green"
          valueSize="md"
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Heatmap de estoque por referência × tamanho</CardTitle>
        </CardHeader>
        <GradeHeatmap referencias={referenciasExibidas} isLoading={isLoading} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Curva ABC de tamanhos ({curvaTamanho?.meses ?? 6} meses)</CardTitle>
        </CardHeader>
        <CurvaAbcTable
          isLoading={isLoading}
          rowKey={(r) => r.size}
          linhas={curvaTamanho?.linhas || []}
          colunas={[
            { key: 'size', label: 'Tamanho', render: (r) => r.size },
            { key: 'giro', label: 'Giro (peças)', align: 'right', render: (r) => formatNumber(r.giro) },
            { key: 'percentVendas', label: '% vendas', align: 'right', render: (r) => `${r.percentVendas.toFixed(1)}%` },
            { key: 'percentAcumulado', label: '% acumulado', align: 'right', render: (r) => `${r.percentAcumulado.toFixed(1)}%` },
          ]}
        />
      </Card>
    </div>
  );
}
