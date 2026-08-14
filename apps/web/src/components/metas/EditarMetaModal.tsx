'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { metasApi, Meta, MetaNivel } from '@/lib/api';
import { FILIAIS } from '@/lib/utils';

interface EditarMetaModalProps {
  isOpen: boolean;
  onClose: () => void;
  meta: Meta | null;
  niveis: MetaNivel[];
  vendedorNome: string | null;
  onSaved: () => void;
}

interface NivelValores {
  valor: string;
  comissao: string;
}

const NIVEIS_VAZIOS: Record<1 | 2 | 3 | 4 | 5, NivelValores> = {
  1: { valor: '', comissao: '' },
  2: { valor: '', comissao: '' },
  3: { valor: '', comissao: '' },
  4: { valor: '', comissao: '' },
  5: { valor: '', comissao: '' },
};

export function EditarMetaModal({ isOpen, onClose, meta, niveis, vendedorNome, onSaved }: EditarMetaModalProps) {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [valores, setValores] = useState(NIVEIS_VAZIOS);
  const [isSaving, setIsSaving] = useState(false);

  // Repopula o form sempre que uma meta diferente e aberta pra edicao - ano/mes/loja/
  // vendedor sao a chave de identidade (ON CONFLICT no upsert do backend), por isso
  // nao entram no form: mudar qualquer um deles criaria uma meta nova em vez de
  // editar esta.
  useEffect(() => {
    if (!meta) return;
    setValores({
      1: { valor: String(meta.nivel_1 ?? ''), comissao: meta.comissao_nivel_1 === null ? '' : String(meta.comissao_nivel_1) },
      2: { valor: String(meta.nivel_2 ?? ''), comissao: meta.comissao_nivel_2 === null ? '' : String(meta.comissao_nivel_2) },
      3: { valor: String(meta.nivel_3 ?? ''), comissao: meta.comissao_nivel_3 === null ? '' : String(meta.comissao_nivel_3) },
      4: { valor: String(meta.nivel_4 ?? ''), comissao: meta.comissao_nivel_4 === null ? '' : String(meta.comissao_nivel_4) },
      5: { valor: String(meta.nivel_5 ?? ''), comissao: meta.comissao_nivel_5 === null ? '' : String(meta.comissao_nivel_5) },
    });
  }, [meta]);

  function atualizarValor(ordem: 1 | 2 | 3 | 4 | 5, campo: keyof NivelValores, valor: string) {
    setValores((prev) => ({ ...prev, [ordem]: { ...prev[ordem], [campo]: valor } }));
  }

  async function handleSalvar() {
    if (!token || !meta) return;

    setIsSaving(true);
    try {
      await metasApi.saveMeta(token, {
        ano: meta.ano,
        mes: meta.mes,
        branch_code: meta.branch_code,
        seller_code: meta.seller_code,
        nivel_1: Number(valores[1].valor) || 0,
        nivel_2: Number(valores[2].valor) || 0,
        nivel_3: Number(valores[3].valor) || 0,
        nivel_4: Number(valores[4].valor) || 0,
        nivel_5: Number(valores[5].valor) || 0,
        comissao_nivel_1: valores[1].comissao === '' ? null : Number(valores[1].comissao),
        comissao_nivel_2: valores[2].comissao === '' ? null : Number(valores[2].comissao),
        comissao_nivel_3: valores[3].comissao === '' ? null : Number(valores[3].comissao),
        comissao_nivel_4: valores[4].comissao === '' ? null : Number(valores[4].comissao),
        comissao_nivel_5: valores[5].comissao === '' ? null : Number(valores[5].comissao),
      });
      showToast('Meta atualizada!', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast('Erro ao salvar meta', 'error');
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  }

  if (!meta) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar Meta" size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          {FILIAIS[meta.branch_code] || `Loja ${meta.branch_code}`}
          {' · '}
          {vendedorNome || 'Todos'}
        </p>

        <div className="space-y-3">
          {niveis.map((n) => {
            const ordem = n.nivel_ordem as 1 | 2 | 3 | 4 | 5;
            return (
              <div key={ordem} className="flex items-end gap-3">
                <div className="flex items-center gap-2 w-28 pb-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: n.nivel_cor }} />
                  <span className="text-sm font-medium text-gray-700">{n.nivel_nome}</span>
                </div>
                <Input
                  label="Valor (R$)"
                  type="number"
                  step="0.01"
                  value={valores[ordem].valor}
                  onChange={(e) => atualizarValor(ordem, 'valor', e.target.value)}
                />
                <Input
                  label="Comissão (%)"
                  type="number"
                  step="0.01"
                  value={valores[ordem].comissao}
                  onChange={(e) => atualizarValor(ordem, 'comissao', e.target.value)}
                  className="w-32"
                />
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} isLoading={isSaving}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
