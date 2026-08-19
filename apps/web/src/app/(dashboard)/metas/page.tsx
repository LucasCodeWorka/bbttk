'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { CadastroMetaModal } from '@/components/metas/CadastroMetaModal';
import { EditarMetaLojaModal } from '@/components/metas/EditarMetaLojaModal';
import { metasApi, vendasApi, Meta, MetaNivel } from '@/lib/api';
import { formatMoney, FILIAIS, MESES } from '@/lib/utils';

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

  const [showCadastroModal, setShowCadastroModal] = useState(false);
  const [editingBranchCode, setEditingBranchCode] = useState<number | null>(null);

  const [deletingMetaId, setDeletingMetaId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingSelecionadas, setDeletingSelecionadas] = useState(false);

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
      setSelectedIds(new Set());
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

  // Deletar meta
  async function handleDeleteMeta(id: number) {
    if (!token || !confirm('Excluir esta meta?')) return;

    setDeletingMetaId(id);
    try {
      await metasApi.deleteMeta(token, id);
      showToast('Meta excluida!', 'success');
      carregarDados();
    } catch (error) {
      showToast('Erro ao excluir', 'error');
      console.error(error);
    } finally {
      setDeletingMetaId(null);
    }
  }

  function toggleSelecionada(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelecionarTodas() {
    setSelectedIds((prev) => (prev.size === metas.length ? new Set() : new Set(metas.map((m) => m.id))));
  }

  // Deletar metas selecionadas
  async function handleDeleteSelecionadas() {
    if (!token || selectedIds.size === 0) return;
    if (!confirm(`Excluir ${selectedIds.size} meta(s) selecionada(s)?`)) return;

    setDeletingSelecionadas(true);
    try {
      await Promise.all([...selectedIds].map((id) => metasApi.deleteMeta(token, id)));
      showToast('Metas excluidas!', 'success');
      carregarDados();
    } catch (error) {
      showToast('Erro ao excluir metas selecionadas', 'error');
      console.error(error);
    } finally {
      setDeletingSelecionadas(false);
    }
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
        <Button onClick={() => setShowCadastroModal(true)}>
          Cadastrar Metas
        </Button>
        {selectedIds.size > 0 && (
          <Button variant="danger" onClick={handleDeleteSelecionadas} isLoading={deletingSelecionadas}>
            Excluir selecionadas ({selectedIds.size})
          </Button>
        )}
      </div>

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
                <TableCell isHeader align="center" className="w-8">
                  <input
                    type="checkbox"
                    checked={metas.length > 0 && selectedIds.size === metas.length}
                    onChange={toggleSelecionarTodas}
                    className="w-4 h-4 text-[var(--bbtk-red)] rounded"
                  />
                </TableCell>
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
                  <TableCell align="center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleSelecionada(m.id)}
                      className="w-4 h-4 text-[var(--bbtk-red)] rounded"
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {FILIAIS[m.branch_code] || `Loja ${m.branch_code}`}
                  </TableCell>
                  <TableCell>
                    {m.seller_code
                      ? vendedoresLista.find(v => v.code === m.seller_code)?.name || `Vendedor ${m.seller_code}`
                      : <em className="text-gray-500">Todos</em>
                    }
                  </TableCell>
                  {([1, 2, 3, 4, 5] as const).map(ordem => {
                    const valor = m[`nivel_${ordem}` as keyof Meta] as number;
                    const comissao = m[`comissao_nivel_${ordem}` as keyof Meta] as number | null;
                    return (
                      <TableCell key={ordem} align="right">
                        {formatMoney(valor)}
                        {comissao !== null && (
                          <div className="text-xs text-gray-400">{comissao}%</div>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell align="center">
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditingBranchCode(m.branch_code)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteMeta(m.id)}
                        isLoading={deletingMetaId === m.id}
                      >
                        Excluir
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <CadastroMetaModal
        isOpen={showCadastroModal}
        onClose={() => setShowCadastroModal(false)}
        ano={ano}
        mes={mes}
        niveis={niveis}
        onSaved={carregarDados}
      />

      <EditarMetaLojaModal
        isOpen={editingBranchCode !== null}
        onClose={() => setEditingBranchCode(null)}
        ano={ano}
        mes={mes}
        branchCode={editingBranchCode ?? 0}
        branchName={editingBranchCode !== null ? FILIAIS[editingBranchCode] || `Loja ${editingBranchCode}` : ''}
        niveis={niveis}
        vendedoresLista={vendedoresLista}
        onSaved={carregarDados}
      />
    </div>
  );
}
