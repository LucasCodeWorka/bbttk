'use client';

import { Fragment } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { MetaNivel, ComissaoOverrideData } from '@/lib/api';
import { formatMoney } from '@/lib/utils';

// Tabela de vendedores de uma loja (gerente, comissao personalizada, desconsiderar,
// tipo de distribuicao) - compartilhada entre CadastroMetaModal (cadastro multi-loja)
// e EditarMetaLojaModal (edicao de uma loja so). As duas telas reusam a MESMA logica
// de negocio complexa (gerente, override de comissao, redistribuicao) - diferente da
// convencao usual do projeto de "cada tela com sua copia" (ex: ThSortPcp), aqui e o
// mesmo dominio (metas) e duplicar ~160 linhas de estado intrincado e risco real de
// as duas copias divergirem silenciosamente depois de um bugfix futuro.

export type TipoDistribuicao = 'igual' | 'historico' | 'manual';

export interface VendedorState {
  sellerCode: number;
  sellerName: string;
  historico3m: number;
  valor: number;
  editadaManualmente: boolean;
  comissaoAtiva: boolean;
  comissaoOverride: ComissaoOverrideData;
  isGerente: boolean;
}

// Formato minimo de loja que a tabela precisa - CadastroMetaModal passa seu LojaState
// completo (satisfaz estruturalmente), EditarMetaLojaModal passa so isso.
export interface LojaResumo {
  branchCode: number;
  branchName: string;
  valor: number;
}

export const TIPO_OPTIONS = [
  { value: 'igual', label: 'Igualmente' },
  { value: 'historico', label: 'Pelo histórico de vendas' },
  { value: 'manual', label: 'Manualmente' },
];

export const MODO_GERENTE_OPTIONS = [
  { value: 'cheio', label: 'Valor cheio da loja' },
  { value: 'restante', label: 'Assume o restante' },
];

export const COMISSAO_VAZIA: ComissaoOverrideData = { nivel1: null, nivel2: null, nivel3: null, nivel4: null, nivel5: null };

export function comissaoVazia(o: ComissaoOverrideData): boolean {
  return !o.nivel1 && !o.nivel2 && !o.nivel3 && !o.nivel4 && !o.nivel5;
}

export function pesoVendedor(v: VendedorState, tipo: TipoDistribuicao): number {
  return tipo === 'historico' ? v.historico3m : 1;
}

interface VendedoresLojaTableProps {
  loja: LojaResumo;
  vendedores: VendedorState[];
  niveis: MetaNivel[];
  tipo: TipoDistribuicao;
  modoGerente: 'cheio' | 'restante';
  onTrocarTipo: (tipo: TipoDistribuicao) => void;
  onEditarValor: (sellerCode: number, valor: string) => void;
  onToggleComissao: (sellerCode: number) => void;
  onEditarComissao: (sellerCode: number, nivel: keyof ComissaoOverrideData, valor: string) => void;
  onToggleGerente: (sellerCode: number) => void;
  onTrocarModoGerente: (modo: 'cheio' | 'restante') => void;
  onRemoverVendedor: (sellerCode: number) => void;
  onFechar?: () => void;
  vendedorTag?: (sellerCode: number) => string | null;
}

export function VendedoresLojaTable({
  loja,
  vendedores,
  niveis,
  tipo,
  modoGerente,
  onTrocarTipo,
  onEditarValor,
  onToggleComissao,
  onEditarComissao,
  onToggleGerente,
  onTrocarModoGerente,
  onRemoverVendedor,
  onFechar,
  vendedorTag,
}: VendedoresLojaTableProps) {
  const regulares = vendedores.filter((v) => !v.isGerente);
  const distribuido = regulares.reduce((s, v) => s + v.valor, 0);
  const falta = loja.valor - distribuido;
  const valorGerente = modoGerente === 'restante' ? Math.max(0, loja.valor - distribuido) : loja.valor;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{loja.branchName} - Meta: {formatMoney(loja.valor)}</span>
        <Select
          value={tipo}
          onChange={(e) => onTrocarTipo(e.target.value as TipoDistribuicao)}
          options={TIPO_OPTIONS}
          className="w-56"
        />
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left px-3 py-1.5">Vendedor</th>
              <th className="text-right px-3 py-1.5">Média mensal (3m)</th>
              <th className="text-right px-3 py-1.5">Participação</th>
              <th className="text-right px-3 py-1.5 w-36">Meta do vendedor</th>
              <th className="text-center px-3 py-1.5 w-32">Gerente</th>
              <th className="text-center px-3 py-1.5 w-24">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendedores.map((v) => {
              const valorEfetivo = v.isGerente ? valorGerente : v.valor;
              const participacao = loja.valor > 0 ? (valorEfetivo / loja.valor) * 100 : 0;
              const tag = vendedorTag?.(v.sellerCode);
              return (
                <Fragment key={v.sellerCode}>
                  <tr className={v.isGerente ? 'bg-purple-50' : ''}>
                    <td className="px-3 py-1.5">
                      {v.sellerName}
                      {v.isGerente && (
                        <span className="ml-2 inline-block text-[10px] font-bold uppercase text-white bg-[var(--bbtk-purple)] rounded px-1.5 py-0.5">
                          Gerente
                        </span>
                      )}
                      {tag && (
                        <span className="ml-2 inline-block text-[10px] font-medium uppercase text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                          {tag}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{formatMoney(v.historico3m / 3)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{participacao.toFixed(1)}%</td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={valorEfetivo}
                        onChange={(e) => onEditarValor(v.sellerCode, e.target.value)}
                        disabled={v.isGerente}
                        className="w-full"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleGerente(v.sellerCode)}
                        className={`text-xs hover:underline ${v.isGerente ? 'text-[var(--bbtk-purple)] font-semibold' : 'text-gray-400'}`}
                      >
                        {v.isGerente ? 'Remover gerente' : 'Definir como gerente'}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {!v.isGerente && (
                        <button
                          type="button"
                          onClick={() => onRemoverVendedor(v.sellerCode)}
                          className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                        >
                          Desconsiderar
                        </button>
                      )}
                    </td>
                  </tr>
                  {v.isGerente && (
                    <tr>
                      <td colSpan={6} className="px-3 pb-1.5">
                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span>Meta da gerente:</span>
                          <Select
                            value={modoGerente}
                            onChange={(e) => onTrocarModoGerente(e.target.value as 'cheio' | 'restante')}
                            options={MODO_GERENTE_OPTIONS}
                            className="w-48"
                          />
                          <span>
                            {modoGerente === 'restante'
                              ? 'o que sobrar depois de distribuir entre as demais vendedoras.'
                              : 'valor cheio da loja (não entra na divisão entre as demais vendedoras).'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr key={`${v.sellerCode}-comissao`}>
                    <td colSpan={6} className="px-3 pb-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleComissao(v.sellerCode)}
                        className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                      >
                        {v.comissaoAtiva ? 'Ocultar comissão personalizada' : 'Personalizar comissão deste vendedor'}
                      </button>
                      {v.comissaoAtiva && (
                        <div className="grid grid-cols-5 gap-2 mt-2">
                          {niveis.map((n) => (
                            <Input
                              key={n.nivel_ordem}
                              label={`${n.nivel_nome} %`}
                              type="number"
                              step="0.1"
                              min="0"
                              value={v.comissaoOverride[`nivel${n.nivel_ordem}` as keyof ComissaoOverrideData] ?? ''}
                              onChange={(e) => onEditarComissao(v.sellerCode, `nivel${n.nivel_ordem}` as keyof ComissaoOverrideData, e.target.value)}
                              placeholder="Padrão"
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span>Distribuído entre vendedores: <strong>{formatMoney(distribuido)}</strong></span>
        {vendedores.some((v) => v.isGerente) && modoGerente === 'restante' ? (
          <span className={falta < -0.02 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
            {falta < -0.02
              ? `Vendedores ultrapassam a meta da loja em ${formatMoney(-falta)}`
              : `Gerente assume o restante: ${formatMoney(valorGerente)}`}
          </span>
        ) : (
          <span className={Math.abs(falta) < 0.02 ? 'text-green-600 font-semibold' : 'text-yellow-700 font-semibold'}>
            {Math.abs(falta) < 0.02 ? 'Meta da loja totalmente distribuída' : `Falta distribuir: ${formatMoney(falta)}`}
          </span>
        )}
      </div>

      {onFechar && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="text-xs text-[var(--bbtk-red)] hover:underline"
          >
            Ocultar vendedores
          </button>
        </div>
      )}
    </div>
  );
}
