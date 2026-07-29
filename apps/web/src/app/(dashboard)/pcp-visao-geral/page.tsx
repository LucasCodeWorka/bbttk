'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPIMetaCard } from '@/components/dashboard/KPIMetaCard';
import { KPICard } from '@/components/dashboard/KPICard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { visaoGeralApi, VisaoGeralResponse, PcpMatrizCanal } from '@/lib/pcpApi';
import { pcpConfigApi, PcpMetaVisaoGeral } from '@/lib/api';
import { RELATORIO_BASE_BRANCH_ORDER } from '@/lib/pcpBranches';
import { formatMoney } from '@/lib/utils';

const DIMENSAO_OPTIONS = [
  { value: 'linha', label: 'Por linha (Básico/Coleção)' },
  { value: 'categoria', label: 'Por categoria' },
  { value: 'genero', label: 'Por gênero' },
];

function MatrizTable({ matriz }: { matriz: PcpMatrizCanal }) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell isHeader>Linha</TableCell>
          <TableCell isHeader align="right">Varejo</TableCell>
          <TableCell isHeader align="right">Atacado</TableCell>
          <TableCell isHeader align="right">Total</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {matriz.linhas.map((linha) => {
          const celula = matriz.matriz[linha];
          const isTotal = linha === 'Total';
          return (
            <TableRow key={linha} isHighlighted={isTotal}>
              <TableCell>{linha}</TableCell>
              <TableCell align="right">{celula.varejo.cobertura === null ? '—' : `${celula.varejo.cobertura.toFixed(1)}m`}</TableCell>
              <TableCell align="right">{celula.atacado.cobertura === null ? '—' : `${celula.atacado.cobertura.toFixed(1)}m`}</TableCell>
              <TableCell align="right">{celula.total.cobertura === null ? '—' : `${celula.total.cobertura.toFixed(1)}m`}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default function PcpVisaoGeralPage() {
  const { token, user } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<VisaoGeralResponse | null>(null);
  const [dimensao, setDimensao] = useState<'linha' | 'categoria' | 'genero'>('linha');
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);

  const [metaModalAberto, setMetaModalAberto] = useState(false);
  const [meta, setMeta] = useState<PcpMetaVisaoGeral | null>(null);
  const [salvandoMeta, setSalvandoMeta] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await visaoGeralApi.getVisaoGeral(token, {
        branches: filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined,
      });
      setData(response);
    } catch (error) {
      showToast('Erro ao carregar Visão Geral', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filiaisSelecionadas]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  async function abrirEdicaoMetas() {
    if (!token) return;
    try {
      const res = await pcpConfigApi.getMetaVisaoGeral(token);
      setMeta(res.meta);
      setMetaModalAberto(true);
    } catch (error) {
      showToast('Erro ao carregar metas', 'error');
      console.error(error);
    }
  }

  async function salvarMetas() {
    if (!token || !meta) return;
    setSalvandoMeta(true);
    try {
      await pcpConfigApi.updateMetaVisaoGeral(token, meta);
      showToast('Metas salvas!', 'success');
      setMetaModalAberto(false);
      carregarDados();
    } catch (error) {
      showToast('Erro ao salvar metas', 'error');
      console.error(error);
    } finally {
      setSalvandoMeta(false);
    }
  }

  const matrizAtual =
    dimensao === 'linha' ? data?.coberturaPorLinhaCanal : dimensao === 'categoria' ? data?.coberturaPorCategoriaCanal : data?.coberturaPorGeneroCanal;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
          <h1 className="text-2xl font-bold text-gray-900">Visão Geral</h1>
          <p className="text-gray-500 text-sm mt-1">
            Visão executiva de estoque - cobertura, giro e valor em estoque da rede
            {data ? ` · cobertura calculada em ${data.config.coberturaMeses} meses` : ''}
          </p>
        </div>
        {user?.role === 'admin' && (
          <Button variant="secondary" size="sm" onClick={abrirEdicaoMetas}>
            Editar metas
          </Button>
        )}
      </div>

      <Card className="border-l-4 border-l-[var(--bbtk-yellow)] bg-yellow-50/60">
        <p className="text-sm font-medium text-gray-800">Painel em fase de teste</p>
        <p className="text-xs text-gray-600 mt-1">
          Cobertura reaproveita a mesma janela configurável do Relatório Base. Sem histórico mensal ainda - mostra
          apenas o valor atual, não uma série ao longo do tempo.
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <FilialMultiSelect
          selected={filiaisSelecionadas}
          onChange={setFiliaisSelecionadas}
          options={RELATORIO_BASE_BRANCH_ORDER.map((b) => ({ value: b.branchCode, label: b.label }))}
          label="Loja"
          className="w-52"
        />
        <Button onClick={carregarDados} isLoading={isLoading}>Atualizar</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KPIMetaCard
          title="Cobertura geral"
          value={isLoading || !data ? '—' : `${data.kpis.coberturaGeral.valor.toFixed(1)} meses`}
          meta={`${data?.kpis.coberturaGeral.meta.toFixed(1) ?? '—'} meses`}
          gap={data?.kpis.coberturaGeral.gap ?? 0}
          invertido
          isLoading={isLoading}
        />
        <KPIMetaCard
          title="Giro anualizado"
          value={isLoading || !data ? '—' : `${data.kpis.giroAnualizado.valor.toFixed(1)}x`}
          meta={`${data?.kpis.giroAnualizado.meta.toFixed(1) ?? '—'}x`}
          gap={data?.kpis.giroAnualizado.gap ?? 0}
          isLoading={isLoading}
        />
        <KPICard
          title="Valor em estoque"
          value={isLoading || !data ? '—' : formatMoney(data.kpis.valorEstoque)}
          color="blue"
          valueSize="md"
          isLoading={isLoading}
        />
        <KPIMetaCard
          title="Estoque morto"
          value={isLoading || !data ? '—' : `${data.kpis.estoqueMortoPercent.valor.toFixed(1)}%`}
          meta={`${data?.kpis.estoqueMortoPercent.meta.toFixed(1) ?? '—'}%`}
          gap={data?.kpis.estoqueMortoPercent.gap ?? 0}
          invertido
          subtitle={data ? `${formatMoney(data.kpis.estoqueMortoValor)} parados` : undefined}
          isLoading={isLoading}
        />
        <KPIMetaCard
          title="Cobertura Básico"
          value={isLoading || !data ? '—' : `${data.kpis.coberturaBasico.valor.toFixed(1)} meses`}
          meta={`${data?.kpis.coberturaBasico.meta.toFixed(1) ?? '—'} meses`}
          gap={data?.kpis.coberturaBasico.gap ?? 0}
          invertido
          isLoading={isLoading}
        />
        <KPIMetaCard
          title="Cobertura Coleção"
          value={isLoading || !data ? '—' : `${data.kpis.coberturaColecao.valor.toFixed(1)} meses`}
          meta={`${data?.kpis.coberturaColecao.meta.toFixed(1) ?? '—'} meses`}
          gap={data?.kpis.coberturaColecao.gap ?? 0}
          invertido
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cobertura por linha × canal (meses)</CardTitle>
          <Select
            value={dimensao}
            onChange={(e) => setDimensao(e.target.value as 'linha' | 'categoria' | 'genero')}
            options={DIMENSAO_OPTIONS}
            className="w-64"
          />
        </CardHeader>
        {isLoading || !matrizAtual ? (
          <p className="text-sm text-gray-500 py-8 text-center">Carregando...</p>
        ) : (
          <MatrizTable matriz={matrizAtual} />
        )}
      </Card>

      <Modal isOpen={metaModalAberto} onClose={() => setMetaModalAberto(false)} title="Editar metas da Visão Geral" size="md">
        {meta && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Meta cobertura geral (meses)"
                type="number"
                step="0.1"
                value={meta.metaCoberturaGeralMeses}
                onChange={(e) => setMeta({ ...meta, metaCoberturaGeralMeses: Number(e.target.value) })}
              />
              <Input
                label="Meta giro anualizado (x)"
                type="number"
                step="0.1"
                value={meta.metaGiroAnualizado}
                onChange={(e) => setMeta({ ...meta, metaGiroAnualizado: Number(e.target.value) })}
              />
              <Input
                label="Meta estoque morto (%)"
                type="number"
                step="0.1"
                value={meta.metaEstoqueMortoPercent}
                onChange={(e) => setMeta({ ...meta, metaEstoqueMortoPercent: Number(e.target.value) })}
              />
              <Input
                label="Dias p/ considerar estoque morto"
                type="number"
                step="1"
                value={meta.estoqueMortoDias}
                onChange={(e) => setMeta({ ...meta, estoqueMortoDias: Number(e.target.value) })}
              />
              <Input
                label="Meta cobertura Básico (meses)"
                type="number"
                step="0.1"
                value={meta.metaCoberturaBasicoMeses}
                onChange={(e) => setMeta({ ...meta, metaCoberturaBasicoMeses: Number(e.target.value) })}
              />
              <Input
                label="Meta cobertura Coleção (meses)"
                type="number"
                step="0.1"
                value={meta.metaCoberturaColecaoMeses}
                onChange={(e) => setMeta({ ...meta, metaCoberturaColecaoMeses: Number(e.target.value) })}
              />
            </div>
            <div className="flex justify-end pt-2 border-t">
              <Button onClick={salvarMetas} isLoading={salvandoMeta}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
