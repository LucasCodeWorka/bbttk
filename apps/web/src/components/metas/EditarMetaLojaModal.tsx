'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  metasApi,
  vendasApi,
  MetaNivel,
  ComissaoOverrideData,
  SalvarDistribuicaoVendedor,
} from '@/lib/api';
import { formatMoney, distribuirValor } from '@/lib/utils';
import {
  VendedoresLojaTable,
  VendedorState,
  TipoDistribuicao,
  COMISSAO_VAZIA,
  comissaoVazia,
  pesoVendedor,
} from './VendedoresLojaTable';

interface EditarMetaLojaModalProps {
  isOpen: boolean;
  onClose: () => void;
  ano: number;
  mes: number;
  branchCode: number;
  branchName: string;
  niveis: MetaNivel[];
  vendedoresLista: { code: number; name: string }[];
  onSaved: () => void;
}

function overrideDeMeta(meta: { comissao_nivel_1: number | null; comissao_nivel_2: number | null; comissao_nivel_3: number | null; comissao_nivel_4: number | null; comissao_nivel_5: number | null } | undefined): ComissaoOverrideData {
  if (!meta) return { ...COMISSAO_VAZIA };
  return {
    nivel1: meta.comissao_nivel_1,
    nivel2: meta.comissao_nivel_2,
    nivel3: meta.comissao_nivel_3,
    nivel4: meta.comissao_nivel_4,
    nivel5: meta.comissao_nivel_5,
  };
}

export function EditarMetaLojaModal({ isOpen, onClose, ano, mes, branchCode, branchName, niveis, vendedoresLista, onSaved }: EditarMetaLojaModalProps) {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [carregando, setCarregando] = useState(true);
  const [lojaValorStr, setLojaValorStr] = useState('');
  const [lojaComissaoAtiva, setLojaComissaoAtiva] = useState(false);
  const [lojaComissaoOverride, setLojaComissaoOverride] = useState<ComissaoOverrideData>({ ...COMISSAO_VAZIA });
  const [tipo, setTipo] = useState<TipoDistribuicao>('manual');
  const [modoGerente, setModoGerente] = useState<'cheio' | 'restante'>('cheio');
  const [vendedores, setVendedores] = useState<VendedorState[]>([]);
  const [orfaos, setOrfaos] = useState<Set<number>>(new Set());
  const [salvando, setSalvando] = useState(false);

  const lojaValor = parseFloat(lojaValorStr) || 0;

  // Carrega a meta ja salva dessa loja/periodo + quem esta vinculado a ela HOJE no
  // TOTVS (mesma fonte que o Cadastro usa - pega vendedora nova automaticamente).
  // Vendedora com meta salva mas que nao esta mais vinculada (saiu) tambem aparece,
  // marcada como "orfa", pra poder ser desconsiderada explicitamente em vez de ficar
  // invisivel e presa no banco.
  useEffect(() => {
    if (!isOpen || !branchCode) return;
    setCarregando(true);
    Promise.all([
      metasApi.getMetas(ano, mes, branchCode),
      vendasApi.getVendedoresPorFilial(branchCode, ano, mes),
    ])
      .then(([metasRes, vendedoresRes]) => {
        const lojaMeta = metasRes.metas.find((m) => m.seller_code === null);
        const metasPorVendedor = new Map(metasRes.metas.filter((m) => m.seller_code !== null).map((m) => [m.seller_code as number, m]));
        const vinculadosCodes = new Set(vendedoresRes.vendedores.map((v) => v.seller_code));
        const orfaosCodes = new Set([...metasPorVendedor.keys()].filter((code) => !vinculadosCodes.has(code)));

        const estadoVinculados: VendedorState[] = vendedoresRes.vendedores.map((v) => {
          const metaExistente = metasPorVendedor.get(v.seller_code);
          return {
            sellerCode: v.seller_code,
            sellerName: v.seller_name,
            historico3m: v.faturamento,
            valor: metaExistente ? metaExistente.nivel_3 : 0,
            editadaManualmente: !!metaExistente,
            comissaoAtiva: !comissaoVazia(overrideDeMeta(metaExistente)),
            comissaoOverride: overrideDeMeta(metaExistente),
            isGerente: false,
          };
        });

        const estadoOrfaos: VendedorState[] = [...orfaosCodes].map((code) => {
          const metaExistente = metasPorVendedor.get(code)!;
          return {
            sellerCode: code,
            sellerName: vendedoresLista.find((v) => v.code === code)?.name || `Vendedor ${code}`,
            historico3m: 0,
            valor: metaExistente.nivel_3,
            editadaManualmente: true,
            comissaoAtiva: !comissaoVazia(overrideDeMeta(metaExistente)),
            comissaoOverride: overrideDeMeta(metaExistente),
            isGerente: false,
          };
        });

        setVendedores([...estadoVinculados, ...estadoOrfaos]);
        setOrfaos(orfaosCodes);
        setLojaValorStr(lojaMeta ? String(lojaMeta.nivel_3) : '');
        setLojaComissaoOverride(overrideDeMeta(lojaMeta));
        setLojaComissaoAtiva(!comissaoVazia(overrideDeMeta(lojaMeta)));
        setTipo('manual');
        setModoGerente('cheio');
      })
      .catch((error) => {
        showToast('Erro ao carregar meta da loja', 'error');
        console.error(error);
      })
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, branchCode, ano, mes]);

  function trocarTipo(novoTipo: TipoDistribuicao) {
    const temEdicaoManual = vendedores.some((v) => !v.isGerente && v.editadaManualmente);
    if (temEdicaoManual && novoTipo !== 'manual') {
      const ok = confirm('Existem valores ajustados manualmente. Ao trocar o tipo de distribuição, esses valores serão substituídos. Deseja continuar?');
      if (!ok) return;
    }
    setTipo(novoTipo);
  }

  function restaurarCalculoAutomatico() {
    setVendedores((prev) => {
      const regulares = prev.filter((v) => !v.isGerente);
      if (regulares.length === 0 || tipo === 'manual') return prev.map((v) => (v.isGerente ? v : { ...v, editadaManualmente: false }));
      const pesos = regulares.map((v) => pesoVendedor(v, tipo));
      const valores = distribuirValor(lojaValor, pesos);
      const valorPorCodigo = new Map(regulares.map((v, i) => [v.sellerCode, valores[i]]));
      return prev.map((v) => (v.isGerente ? v : { ...v, valor: valorPorCodigo.get(v.sellerCode) ?? v.valor, editadaManualmente: false }));
    });
  }

  function redistribuirRestante() {
    setVendedores((prev) => {
      const regulares = prev.filter((v) => !v.isGerente);
      const editadas = regulares.filter((v) => v.editadaManualmente);
      const naoEditadas = regulares.filter((v) => !v.editadaManualmente);
      if (naoEditadas.length === 0) return prev;
      const somaEditadas = editadas.reduce((s, v) => s + v.valor, 0);
      const restante = lojaValor - somaEditadas;
      const pesos = naoEditadas.map((v) => pesoVendedor(v, tipo === 'manual' ? 'igual' : tipo));
      const valores = distribuirValor(Math.max(restante, 0), pesos);
      const valorPorCodigo = new Map(naoEditadas.map((v, i) => [v.sellerCode, valores[i]]));
      return prev.map((v) => (valorPorCodigo.has(v.sellerCode) ? { ...v, valor: valorPorCodigo.get(v.sellerCode)! } : v));
    });
  }

  function editarValorVendedor(sellerCode: number, valorStr: string) {
    const valor = parseFloat(valorStr) || 0;
    setVendedores((prev) => prev.map((v) => (v.sellerCode === sellerCode ? { ...v, valor, editadaManualmente: true } : v)));
  }

  function toggleComissaoVendedor(sellerCode: number) {
    setVendedores((prev) => prev.map((v) => (v.sellerCode === sellerCode ? { ...v, comissaoAtiva: !v.comissaoAtiva } : v)));
  }

  function editarComissaoVendedor(sellerCode: number, nivel: keyof ComissaoOverrideData, valorStr: string) {
    setVendedores((prev) =>
      prev.map((v) => (v.sellerCode === sellerCode ? { ...v, comissaoOverride: { ...v.comissaoOverride, [nivel]: valorStr === '' ? null : parseFloat(valorStr) } } : v))
    );
  }

  // So uma gerente: marcar uma desmarca qualquer outra e redistribui as regulares
  // restantes (mesmo padrao do CadastroMetaModal).
  function toggleGerente(sellerCode: number) {
    setVendedores((prev) => {
      const alvo = prev.find((v) => v.sellerCode === sellerCode);
      if (!alvo) return prev;
      const vaiVirarGerente = !alvo.isGerente;
      const atualizados = prev.map((v) => ({ ...v, isGerente: v.sellerCode === sellerCode ? vaiVirarGerente : false }));
      const regulares = atualizados.filter((v) => !v.isGerente);
      if (regulares.length === 0) return atualizados;
      const pesos = regulares.map((v) => pesoVendedor(v, tipo));
      const valores = distribuirValor(lojaValor, pesos);
      const valorPorCodigo = new Map(regulares.map((v, i) => [v.sellerCode, valores[i]]));
      return atualizados.map((v) => (v.isGerente ? v : { ...v, valor: valorPorCodigo.get(v.sellerCode) ?? v.valor, editadaManualmente: false }));
    });
  }

  function removerVendedor(sellerCode: number) {
    setVendedores((prev) => {
      const atuais = prev.filter((v) => v.sellerCode !== sellerCode);
      const regulares = atuais.filter((v) => !v.isGerente);
      if (regulares.length === 0 || tipo === 'manual') return atuais;
      const pesos = regulares.map((v) => pesoVendedor(v, tipo));
      const valores = distribuirValor(lojaValor, pesos);
      const valorPorCodigo = new Map(regulares.map((v, i) => [v.sellerCode, valores[i]]));
      return atuais.map((v) => (v.isGerente ? v : { ...v, valor: valorPorCodigo.get(v.sellerCode) ?? v.valor, editadaManualmente: false }));
    });
  }

  function editarComissaoLoja(nivel: keyof ComissaoOverrideData, valorStr: string) {
    setLojaComissaoOverride((prev) => ({ ...prev, [nivel]: valorStr === '' ? null : parseFloat(valorStr) }));
  }

  const regulares = vendedores.filter((v) => !v.isGerente);
  const temGerente = vendedores.some((v) => v.isGerente);
  const somaRegulares = regulares.reduce((s, v) => s + v.valor, 0);

  const erros = useMemo(() => {
    const lista: string[] = [];
    if (!(lojaValor > 0)) lista.push('Informe o valor total da meta da loja.');
    if (lojaValor < 0) lista.push('O valor da loja não pode ser negativo.');
    if (regulares.length > 0) {
      const diferenca = somaRegulares - lojaValor;
      const excedeuComGerente = temGerente && modoGerente === 'restante' && diferenca > 0.02;
      const naoBateuSemGerenteRestante = (!temGerente || modoGerente !== 'restante') && Math.abs(diferenca) > 0.02;
      if (excedeuComGerente) lista.push(`Os vendedores somam ${formatMoney(diferenca)} a mais que a meta da loja.`);
      else if (naoBateuSemGerenteRestante) {
        lista.push(
          diferenca < 0
            ? `Ainda faltam ${formatMoney(-diferenca)} para distribuir entre os vendedores.`
            : `Os vendedores somam ${formatMoney(diferenca)} a mais que a meta da loja.`
        );
      }
      if (regulares.some((v) => v.valor < 0)) lista.push('Há um vendedor com valor negativo.');
    }
    return lista;
  }, [lojaValor, regulares, somaRegulares, temGerente, modoGerente]);

  async function handleSalvar() {
    if (!token || erros.length > 0) return;
    setSalvando(true);
    try {
      const vendedoresPayload: SalvarDistribuicaoVendedor[] = vendedores.map((v) => ({
        sellerCode: v.sellerCode,
        valor: v.isGerente ? (modoGerente === 'restante' ? Math.max(0, lojaValor - somaRegulares) : lojaValor) : v.valor,
        comissaoOverride: v.comissaoAtiva && !comissaoVazia(v.comissaoOverride) ? v.comissaoOverride : null,
        isGerente: v.isGerente,
      }));

      await metasApi.salvarDistribuicao(token, {
        ano,
        mes,
        totalValue: lojaValor,
        distributionType: tipo === 'historico' ? 'proporcional' : tipo === 'igual' ? 'igual' : 'manual',
        lojas: [
          {
            branchCode,
            valor: lojaValor,
            comissaoOverride: lojaComissaoAtiva && !comissaoVazia(lojaComissaoOverride) ? lojaComissaoOverride : null,
            vendedores: vendedoresPayload,
            sincronizarVendedores: true,
          },
        ],
      });

      showToast('Meta da loja atualizada!', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao salvar meta', 'error');
      console.error(error);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Editar Meta - ${branchName}`} size="lg">
      {carregando ? (
        <div className="py-10 text-center text-gray-500">Carregando meta da loja...</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <Input
              label="Valor total da meta da loja"
              type="number"
              step="0.01"
              min="0"
              value={lojaValorStr}
              onChange={(e) => setLojaValorStr(e.target.value)}
              className="w-56"
            />
            <Button variant="ghost" size="sm" onClick={restaurarCalculoAutomatico}>
              Restaurar cálculo automático
            </Button>
            <Button variant="ghost" size="sm" onClick={redistribuirRestante}>
              Redistribuir restante
            </Button>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setLojaComissaoAtiva((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              {lojaComissaoAtiva ? 'Ocultar comissão personalizada da loja' : 'Personalizar comissão desta loja'}
            </button>
            {lojaComissaoAtiva && (
              <div className="grid grid-cols-5 gap-2 mt-2">
                {niveis.map((n) => (
                  <Input
                    key={n.nivel_ordem}
                    label={`${n.nivel_nome} %`}
                    type="number"
                    step="0.1"
                    min="0"
                    value={lojaComissaoOverride[`nivel${n.nivel_ordem}` as keyof ComissaoOverrideData] ?? ''}
                    onChange={(e) => editarComissaoLoja(`nivel${n.nivel_ordem}` as keyof ComissaoOverrideData, e.target.value)}
                    placeholder="Padrão"
                  />
                ))}
              </div>
            )}
          </div>

          {vendedores.length === 0 ? (
            <div className="py-6 text-center text-gray-500 text-sm border border-gray-200 rounded-lg">
              Nenhum vendedor vinculado a esta loja no cadastro do TOTVS - a meta fica só no nível da loja.
            </div>
          ) : (
            <VendedoresLojaTable
              loja={{ branchCode, branchName, valor: lojaValor }}
              vendedores={vendedores}
              niveis={niveis}
              tipo={tipo}
              modoGerente={modoGerente}
              onTrocarTipo={trocarTipo}
              onEditarValor={editarValorVendedor}
              onToggleComissao={toggleComissaoVendedor}
              onEditarComissao={editarComissaoVendedor}
              onToggleGerente={toggleGerente}
              onTrocarModoGerente={setModoGerente}
              onRemoverVendedor={removerVendedor}
              vendedorTag={(sellerCode) => (orfaos.has(sellerCode) ? 'não vinculada mais' : null)}
            />
          )}

          {erros.length > 0 && (
            <ul className="text-xs text-red-600 space-y-0.5">
              {erros.map((erro, i) => (
                <li key={i}>• {erro}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSalvar} isLoading={salvando} disabled={erros.length > 0}>Salvar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
