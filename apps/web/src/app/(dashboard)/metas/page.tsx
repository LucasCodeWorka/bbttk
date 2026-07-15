'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { metasApi, vendasApi, Meta, MetaNivel, DistribuicaoItem } from '@/lib/api';
import { formatMoney, formatNumber, FILIAIS, MESES } from '@/lib/utils';

export default function MetasPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [branchFilter, setBranchFilter] = useState<number | ''>('');

  // Dados
  const [metas, setMetas] = useState<Meta[]>([]);
  const [niveis, setNiveis] = useState<MetaNivel[]>([]);
  const [vendedoresLista, setVendedoresLista] = useState<{ code: number; name: string }[]>([]);

  // Modal Nova Meta
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [metaForm, setMetaForm] = useState({
    branch_code: '',
    seller_code: '',
    nivel_1: '',
    nivel_2: '',
    nivel_3: '',
    nivel_4: '',
    nivel_5: '',
  });

  // Modal Distribuição
  const [showDistModal, setShowDistModal] = useState(false);
  const [distForm, setDistForm] = useState({
    totalValue: '',
    distributionType: 'igual' as 'manual' | 'igual' | 'proporcional',
    selectedBranches: [] as number[],
  });
  const [distPreview, setDistPreview] = useState<{ branchCode: number; name: string; percentage: number; valor: number }[]>([]);

  const carregarDados = useCallback(async () => {
    setIsLoading(true);
    try {
      const [metasRes, niveisRes, vendedoresRes] = await Promise.all([
        metasApi.getMetas(ano, mes, branchFilter || undefined),
        metasApi.getNiveis(),
        vendasApi.getVendedoresLista(),
      ]);

      setMetas(metasRes.metas);
      setNiveis(niveisRes.niveis);
      setVendedoresLista(vendedoresRes.vendedores);
    } catch (error) {
      showToast('Erro ao carregar dados', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [ano, mes, branchFilter, showToast]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Options
  const anoOptions = Array.from({ length: 4 }, (_, i) => {
    const year = new Date().getFullYear() + 1 - i;
    return { value: year, label: String(year) };
  });

  const mesOptions = MESES.slice(1).map((m, i) => ({ value: i + 1, label: m }));

  const filialOptions = [
    { value: '', label: 'Todas as Lojas' },
    ...Object.entries(FILIAIS).map(([code, name]) => ({ value: code, label: name })),
  ];

  // Salvar meta individual
  async function handleSaveMeta() {
    if (!token || !metaForm.branch_code) {
      showToast('Selecione uma loja', 'error');
      return;
    }

    try {
      await metasApi.saveMeta(token, {
        ano,
        mes,
        branch_code: parseInt(metaForm.branch_code),
        seller_code: metaForm.seller_code ? parseInt(metaForm.seller_code) : null,
        nivel_1: parseFloat(metaForm.nivel_1) || 0,
        nivel_2: parseFloat(metaForm.nivel_2) || 0,
        nivel_3: parseFloat(metaForm.nivel_3) || 0,
        nivel_4: parseFloat(metaForm.nivel_4) || 0,
        nivel_5: parseFloat(metaForm.nivel_5) || 0,
      });

      showToast('Meta salva com sucesso!', 'success');
      setShowMetaModal(false);
      setMetaForm({
        branch_code: '',
        seller_code: '',
        nivel_1: '',
        nivel_2: '',
        nivel_3: '',
        nivel_4: '',
        nivel_5: '',
      });
      carregarDados();
    } catch (error) {
      showToast('Erro ao salvar meta', 'error');
      console.error(error);
    }
  }

  // Deletar meta
  async function handleDeleteMeta(id: number) {
    if (!token || !confirm('Excluir esta meta?')) return;

    try {
      await metasApi.deleteMeta(token, id);
      showToast('Meta excluida!', 'success');
      carregarDados();
    } catch (error) {
      showToast('Erro ao excluir', 'error');
      console.error(error);
    }
  }

  // Calcular preview da distribuição
  function calcularDistribuicao() {
    const total = parseFloat(distForm.totalValue) || 0;
    if (total <= 0 || distForm.selectedBranches.length === 0) {
      setDistPreview([]);
      return;
    }

    const numBranches = distForm.selectedBranches.length;
    const percentEach = 100 / numBranches;
    const valorEach = total / numBranches;

    const preview = distForm.selectedBranches.map(code => ({
      branchCode: code,
      name: FILIAIS[code] || `Loja ${code}`,
      percentage: percentEach,
      valor: valorEach,
    }));

    setDistPreview(preview);
  }

  useEffect(() => {
    if (showDistModal) {
      calcularDistribuicao();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distForm.totalValue, distForm.selectedBranches, distForm.distributionType]);

  // Aplicar distribuição
  async function handleDistribuir() {
    if (!token || distPreview.length === 0) {
      showToast('Configure a distribuicao primeiro', 'error');
      return;
    }

    const items: DistribuicaoItem[] = distPreview.map(p => ({
      branchCode: p.branchCode,
      percentage: p.percentage,
    }));

    try {
      await metasApi.distribuir(token, {
        ano,
        mes,
        totalValue: parseFloat(distForm.totalValue),
        distributionType: distForm.distributionType,
        items,
      });

      showToast('Metas distribuidas com sucesso!', 'success');
      setShowDistModal(false);
      setDistForm({
        totalValue: '',
        distributionType: 'igual',
        selectedBranches: [],
      });
      setDistPreview([]);
      carregarDados();
    } catch (error) {
      showToast('Erro ao distribuir metas', 'error');
      console.error(error);
    }
  }

  // Toggle seleção de filial na distribuição
  function toggleBranchSelection(code: number) {
    setDistForm(prev => ({
      ...prev,
      selectedBranches: prev.selectedBranches.includes(code)
        ? prev.selectedBranches.filter(c => c !== code)
        : [...prev.selectedBranches, code],
    }));
  }

  // Selecionar todas as filiais
  function selectAllBranches() {
    const allCodes = Object.keys(FILIAIS).map(Number);
    setDistForm(prev => ({
      ...prev,
      selectedBranches: prev.selectedBranches.length === allCodes.length ? [] : allCodes,
    }));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cadastro de Metas</h1>
          <p className="text-gray-500 text-sm mt-1">
            {MESES[mes]} de {ano}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Select
            value={ano}
            onChange={(e) => setAno(parseInt(e.target.value))}
            options={anoOptions}
            label="Ano"
            className="w-24"
          />
          <Select
            value={mes}
            onChange={(e) => setMes(parseInt(e.target.value))}
            options={mesOptions}
            label="Mes"
            className="w-32"
          />
          <Select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value ? parseInt(e.target.value) : '')}
            options={filialOptions}
            label="Loja"
            className="w-44"
          />
          <Button onClick={carregarDados} isLoading={isLoading}>
            Carregar
          </Button>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-3">
        <Button onClick={() => setShowMetaModal(true)}>
          + Nova Meta
        </Button>
        <Button variant="secondary" onClick={() => setShowDistModal(true)}>
          Distribuir Metas
        </Button>
      </div>

      {/* Config Níveis */}
      <Card>
        <CardHeader>
          <CardTitle>Configuracao dos Niveis</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-4">
          {niveis.map(n => (
            <div key={n.nivel_ordem} className="flex items-center gap-2">
              <span
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: n.nivel_cor }}
              />
              <span className="text-sm font-medium">{n.nivel_nome}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Tabela de Metas */}
      <Card>
        <CardHeader>
          <CardTitle>Metas Cadastradas</CardTitle>
        </CardHeader>
        {isLoading ? (
          <div className="py-10 text-center text-gray-500">Carregando...</div>
        ) : metas.length === 0 ? (
          <div className="py-10 text-center text-gray-500">
            Nenhuma meta cadastrada para este periodo
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>Loja</TableCell>
                <TableCell isHeader>Vendedor</TableCell>
                {niveis.map(n => (
                  <TableCell key={n.nivel_ordem} isHeader align="right">
                    <span
                      className="inline-block w-3 h-3 rounded-full mr-1"
                      style={{ backgroundColor: n.nivel_cor }}
                    />
                    {n.nivel_nome}
                  </TableCell>
                ))}
                <TableCell isHeader align="center">Acoes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {metas.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {FILIAIS[m.branch_code] || `Loja ${m.branch_code}`}
                  </TableCell>
                  <TableCell>
                    {m.seller_code
                      ? vendedoresLista.find(v => v.code === m.seller_code)?.name || `Vendedor ${m.seller_code}`
                      : <em className="text-gray-500">Todos</em>
                    }
                  </TableCell>
                  <TableCell align="right">{formatMoney(m.nivel_1)}</TableCell>
                  <TableCell align="right">{formatMoney(m.nivel_2)}</TableCell>
                  <TableCell align="right">{formatMoney(m.nivel_3)}</TableCell>
                  <TableCell align="right">{formatMoney(m.nivel_4)}</TableCell>
                  <TableCell align="right">{formatMoney(m.nivel_5)}</TableCell>
                  <TableCell align="center">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDeleteMeta(m.id)}
                    >
                      Excluir
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Modal Nova Meta */}
      <Modal
        isOpen={showMetaModal}
        onClose={() => setShowMetaModal(false)}
        title="Cadastrar Meta"
        size="lg"
      >
        <p className="bg-[var(--bbtk-yellow)] text-gray-900 px-4 py-2 rounded-lg font-semibold text-center mb-4">
          Meta para {MESES[mes]} de {ano}
        </p>

        <div className="space-y-4">
          <Select
            label="Loja"
            value={metaForm.branch_code}
            onChange={(e) => setMetaForm(prev => ({ ...prev, branch_code: e.target.value }))}
            options={Object.entries(FILIAIS).map(([code, name]) => ({ value: code, label: name }))}
          />

          <Select
            label="Vendedor(a)"
            value={metaForm.seller_code}
            onChange={(e) => setMetaForm(prev => ({ ...prev, seller_code: e.target.value }))}
            options={[
              { value: '', label: 'Meta da Loja (todos)' },
              ...vendedoresLista.map(v => ({ value: v.code, label: `${v.name} (${v.code})` })),
            ]}
          />

          <div className="grid grid-cols-5 gap-2">
            {niveis.map(n => (
              <Input
                key={n.nivel_ordem}
                label={n.nivel_nome}
                type="number"
                step="0.01"
                min="0"
                value={metaForm[`nivel_${n.nivel_ordem}` as keyof typeof metaForm]}
                onChange={(e) => setMetaForm(prev => ({
                  ...prev,
                  [`nivel_${n.nivel_ordem}`]: e.target.value,
                }))}
                placeholder="0,00"
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={() => setShowMetaModal(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSaveMeta}>
            Salvar
          </Button>
        </div>
      </Modal>

      {/* Modal Distribuição */}
      <Modal
        isOpen={showDistModal}
        onClose={() => setShowDistModal(false)}
        title="Distribuir Metas"
        size="xl"
      >
        <p className="bg-[var(--bbtk-green)] text-white px-4 py-2 rounded-lg font-semibold text-center mb-4">
          Distribuicao para {MESES[mes]} de {ano}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Formulário */}
          <div className="space-y-4">
            <Input
              label="Valor Total da Meta"
              type="number"
              step="0.01"
              min="0"
              value={distForm.totalValue}
              onChange={(e) => setDistForm(prev => ({ ...prev, totalValue: e.target.value }))}
              placeholder="Ex: 1000000"
            />

            <Select
              label="Tipo de Distribuicao"
              value={distForm.distributionType}
              onChange={(e) => setDistForm(prev => ({
                ...prev,
                distributionType: e.target.value as 'manual' | 'igual' | 'proporcional',
              }))}
              options={[
                { value: 'igual', label: 'Dividir Igualmente' },
                { value: 'proporcional', label: 'Proporcional ao Historico' },
              ]}
            />

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  Selecione as Lojas
                </label>
                <button
                  type="button"
                  onClick={selectAllBranches}
                  className="text-sm text-[var(--bbtk-red)] hover:underline"
                >
                  {distForm.selectedBranches.length === Object.keys(FILIAIS).length
                    ? 'Desmarcar Todas'
                    : 'Selecionar Todas'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {Object.entries(FILIAIS).map(([code, name]) => (
                  <label
                    key={code}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={distForm.selectedBranches.includes(parseInt(code))}
                      onChange={() => toggleBranchSelection(parseInt(code))}
                      className="w-4 h-4 text-[var(--bbtk-red)] rounded"
                    />
                    <span className="text-sm">{name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Preview */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">
              Preview da Distribuicao
            </h4>
            {distPreview.length === 0 ? (
              <div className="border border-dashed border-gray-300 rounded-lg p-6 text-center text-gray-500">
                Configure o valor e selecione as lojas
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Loja</th>
                        <th className="text-right px-3 py-2">%</th>
                        <th className="text-right px-3 py-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {distPreview.map(p => (
                        <tr key={p.branchCode}>
                          <td className="px-3 py-2 font-medium">{p.name}</td>
                          <td className="px-3 py-2 text-right">{p.percentage.toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right">{formatMoney(p.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right">100%</td>
                        <td className="px-3 py-2 text-right">
                          {formatMoney(parseFloat(distForm.totalValue) || 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-500 mt-2">
              Os niveis serao calculados automaticamente:
              <br />
              N1: 80% | N2: 90% | N3: 100% | N4: 110% | N5: 120%
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="ghost" onClick={() => setShowDistModal(false)}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            onClick={handleDistribuir}
            disabled={distPreview.length === 0}
          >
            Aplicar Distribuicao
          </Button>
        </div>
      </Modal>
    </div>
  );
}
