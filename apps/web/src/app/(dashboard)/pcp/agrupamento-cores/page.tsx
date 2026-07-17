'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { MultiSelectSearch, MultiSelectOption } from '@/components/ui/MultiSelectSearch';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  produtosApi,
  agrupamentosApi,
  CorProduto,
  ImpactoAgrupamentoItem,
  AgrupamentoGrupo,
} from '@/lib/api';

const TIPO = 'cor_produto';

function matchKeyOf(cor: { color_code: string | null; color_name: string | null }) {
  return cor.color_code || cor.color_name || '';
}

function itemKey(item: { reference_code: string; color_code: string | null; color_name: string | null }) {
  return `${item.reference_code}::${item.color_code || item.color_name}`;
}

export default function AgrupamentoCoresPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [cores, setCores] = useState<CorProduto[]>([]);
  const [grupos, setGrupos] = useState<AgrupamentoGrupo[]>([]);

  const [passo, setPasso] = useState<1 | 2>(1);
  const [nomeGrupo, setNomeGrupo] = useState('');
  const [coresSelecionadas, setCoresSelecionadas] = useState<string[]>([]);
  const [showModalCores, setShowModalCores] = useState(false);
  const [uploadingCsv, setUploadingCsv] = useState(false);

  const [impacto, setImpacto] = useState<ImpactoAgrupamentoItem[]>([]);
  const [removidosManualmente, setRemovidosManualmente] = useState<Set<string>>(new Set());
  const [carregandoImpacto, setCarregandoImpacto] = useState(false);

  const carregarDados = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const [coresRes, gruposRes] = await Promise.all([
        produtosApi.getCores(token),
        agrupamentosApi.getGrupos(token, TIPO),
      ]);
      setCores(coresRes.cores);
      setGrupos(gruposRes.grupos);
    } catch (error) {
      showToast('Erro ao carregar dados', 'error');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [token, showToast]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const coresByKey = useMemo(() => {
    const map = new Map<string, CorProduto>();
    cores.forEach((c) => map.set(matchKeyOf(c), c));
    return map;
  }, [cores]);

  const opcoesCores: MultiSelectOption[] = useMemo(
    () =>
      cores.map((c) => ({
        value: matchKeyOf(c),
        label: c.color_name || c.color_code || '(sem nome)',
        meta: `${c.color_code || '-'} · ${c.qtd_referencias} refs`,
      })),
    [cores]
  );

  async function handleUploadCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setUploadingCsv(true);
    try {
      const res = await agrupamentosApi.uploadCoresCsv(token, file);
      const novasKeys = res.cores.map(matchKeyOf);
      setCoresSelecionadas((prev) => Array.from(new Set([...prev, ...novasKeys])));
      showToast(`${res.cores.length} cor(es) encontrada(s) no CSV`, 'success');
    } catch (error) {
      showToast('Erro ao processar CSV', 'error');
      console.error(error);
    } finally {
      setUploadingCsv(false);
      e.target.value = '';
    }
  }

  async function handleProximo() {
    if (!token) return;
    if (!nomeGrupo.trim()) {
      showToast('Informe o nome do grupo', 'error');
      return;
    }
    if (coresSelecionadas.length === 0) {
      showToast('Selecione ao menos uma cor', 'error');
      return;
    }

    setCarregandoImpacto(true);
    try {
      const coresParaImpacto = coresSelecionadas.map((key) => {
        const cor = coresByKey.get(key);
        return { color_code: cor?.color_code ?? null, color_name: cor?.color_name ?? key };
      });

      const res = await produtosApi.getImpactoAgrupamento(token, TIPO, coresParaImpacto);
      setImpacto(res.impacto);
      setRemovidosManualmente(new Set());
      setPasso(2);
    } catch (error) {
      showToast('Erro ao calcular impacto', 'error');
      console.error(error);
    } finally {
      setCarregandoImpacto(false);
    }
  }

  const itensFinais = useMemo(
    () => impacto.filter((item) => !item.ja_agrupado_em && !removidosManualmente.has(itemKey(item))),
    [impacto, removidosManualmente]
  );

  async function handleConfirmar() {
    if (!token) return;

    if (itensFinais.length === 0) {
      showToast('Nenhum item restante para agrupar', 'error');
      return;
    }

    try {
      await agrupamentosApi.createGrupo(token, {
        tipo: TIPO,
        nome: nomeGrupo,
        membros: itensFinais.map((item) => ({
          referenceCode: item.reference_code,
          colorCode: item.color_code,
          colorName: item.color_name,
        })),
      });

      showToast(`Agrupamento "${nomeGrupo}" criado com sucesso!`, 'success');
      resetWizard();
      carregarDados();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao criar agrupamento', 'error');
      console.error(error);
    }
  }

  function resetWizard() {
    setPasso(1);
    setNomeGrupo('');
    setCoresSelecionadas([]);
    setImpacto([]);
    setRemovidosManualmente(new Set());
  }

  async function handleExcluirGrupo(id: number, nome: string) {
    if (!token || !confirm(`Excluir o agrupamento "${nome}"?`)) return;

    try {
      await agrupamentosApi.deleteGrupo(token, id);
      showToast('Agrupamento excluido!', 'success');
      carregarDados();
    } catch (error) {
      showToast('Erro ao excluir agrupamento', 'error');
      console.error(error);
    }
  }

  async function handleRemoverMembro(id: number) {
    if (!token) return;

    try {
      await agrupamentosApi.deleteMembro(token, id);
      showToast('Membro removido do agrupamento', 'success');
      carregarDados();
    } catch (error) {
      showToast('Erro ao remover membro', 'error');
      console.error(error);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agrupamento de Cores</h1>
        <p className="text-gray-500 text-sm mt-1">
          Junte variacoes de uma mesma cor (ex: azul claro, azul escuro, azul bebe) em um unico
          grupo para relatorios, sem alterar os dados originais do produto.
        </p>
      </div>

      {/* Wizard */}
      <Card>
        <CardHeader>
          <CardTitle>Novo Agrupamento</CardTitle>
        </CardHeader>

        <div className="flex items-center gap-2 mb-4">
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-full ${passo === 1 ? 'bg-[var(--bbtk-red)] text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            1. Definir cores
          </span>
          <span className="text-gray-300">-&gt;</span>
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-full ${passo === 2 ? 'bg-[var(--bbtk-red)] text-white' : 'bg-gray-100 text-gray-500'}`}
          >
            2. Revisar impacto
          </span>
        </div>

        {passo === 1 ? (
          <div className="space-y-4">
            <Input
              label="Nome do novo grupo"
              value={nomeGrupo}
              onChange={(e) => setNomeGrupo(e.target.value)}
              placeholder="Ex: Azul"
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cores que entram nesse grupo ({coresSelecionadas.length} selecionada
                {coresSelecionadas.length === 1 ? '' : 's'})
              </label>
              <div className="flex gap-2 flex-wrap">
                {coresSelecionadas.map((key) => {
                  const cor = coresByKey.get(key);
                  return (
                    <Badge key={key} variant="info">
                      {cor?.color_name || key}
                    </Badge>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setShowModalCores(true)}
              >
                + Adicionar Cores
              </Button>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleProximo} isLoading={carregandoImpacto}>
                Proximo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Grupo <span className="font-semibold">{nomeGrupo}</span> vai afetar{' '}
              {itensFinais.length} combinacao(oes) referencia+cor. Referencias ja pertencentes a
              outro agrupamento aparecem bloqueadas.
            </p>

            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell isHeader>Referencia</TableCell>
                    <TableCell isHeader>Cor</TableCell>
                    <TableCell isHeader align="right">SKUs</TableCell>
                    <TableCell isHeader align="center">Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {impacto.map((item) => {
                    const key = itemKey(item);
                    const bloqueado = !!item.ja_agrupado_em;
                    const removido = removidosManualmente.has(key);
                    const excluido = bloqueado || removido;

                    return (
                      <TableRow key={key} className={excluido ? 'opacity-50' : undefined}>
                        <TableCell className="font-medium">
                          {item.reference_code} {item.reference_name ? `- ${item.reference_name}` : ''}
                        </TableCell>
                        <TableCell>{item.color_name || item.color_code}</TableCell>
                        <TableCell align="right">{item.qtd_skus}</TableCell>
                        <TableCell align="center">
                          {bloqueado ? (
                            <Badge variant="danger">Ja em &quot;{item.ja_agrupado_em}&quot;</Badge>
                          ) : removido ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setRemovidosManualmente((prev) => {
                                  const next = new Set(prev);
                                  next.delete(key);
                                  return next;
                                })
                              }
                            >
                              Reincluir
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setRemovidosManualmente((prev) => new Set(prev).add(key))
                              }
                            >
                              Remover
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="ghost" onClick={() => setPasso(1)}>
                Voltar
              </Button>
              <Button onClick={handleConfirmar} disabled={itensFinais.length === 0}>
                Confirmar Agrupamento
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Modal de busca de cores */}
      <Modal
        isOpen={showModalCores}
        onClose={() => setShowModalCores(false)}
        title="Adicionar Cores ao Grupo"
        size="lg"
      >
        <div className="space-y-4">
          <MultiSelectSearch
            options={opcoesCores}
            selected={coresSelecionadas}
            onChange={setCoresSelecionadas}
            placeholder="Buscar cor por nome..."
            emptyLabel={isLoading ? 'Carregando cores...' : 'Nenhuma cor encontrada'}
          />

          <div className="pt-3 border-t">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ou envie um CSV com nomes/codigos de cor (uma por linha)
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleUploadCsv}
              disabled={uploadingCsv}
              className="text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button onClick={() => setShowModalCores(false)}>Concluido</Button>
        </div>
      </Modal>

      {/* Grupos existentes */}
      <Card>
        <CardHeader>
          <CardTitle>Agrupamentos de Cor Cadastrados</CardTitle>
        </CardHeader>
        {isLoading ? (
          <div className="py-10 text-center text-gray-500">Carregando...</div>
        ) : grupos.length === 0 ? (
          <div className="py-10 text-center text-gray-500">Nenhum agrupamento criado ainda</div>
        ) : (
          <div className="space-y-3">
            {grupos.map((grupo) => (
              <div key={grupo.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900">{grupo.nome}</span>
                  <Button variant="danger" size="sm" onClick={() => handleExcluirGrupo(grupo.id, grupo.nome)}>
                    Excluir Grupo
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {grupo.membros.map((m) => (
                    <Badge key={m.id} variant="default" className="pr-1">
                      {m.referenceCode} - {m.colorName || m.colorCode}
                      <button
                        type="button"
                        onClick={() => handleRemoverMembro(m.id)}
                        className="ml-1.5 hover:text-red-600"
                        title="Remover essa combinacao do grupo"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
