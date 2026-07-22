'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface ClassificacaoOption {
  value: string;
  label: string;
  meta?: string;
}

interface ClassificacaoMultiSelectProps {
  label: string;
  options: ClassificacaoOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

// Dropdown compacto de multi-selecao por string, com busca embutida pra listas
// grandes (ex: Colecao/Tecido tem centenas de valores) - mesmo padrao visual
// do FilialMultiSelect, generico o bastante pra qualquer filtro de classificacao.
export function ClassificacaoMultiSelect({ label, options, selected, onChange, className }: ClassificacaoMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return options;
    return options.filter((o) => o.label.toLowerCase().includes(termo));
  }, [busca, options]);

  // Vazio = nenhum filtro aplicado (mostra tudo), mas sem marcar as caixinhas -
  // so "todasExplicitas" (todas marcadas de verdade) conta como "todas" pro
  // toggle/checkbox, senao "Selecionar Todas" nao teria efeito visivel quando
  // nada estava marcado e não daria pra desmarcar uma especifica depois.
  const todasExplicitas = options.length > 0 && selected.length === options.length;
  const semFiltro = selected.length === 0;

  const displayText = semFiltro || todasExplicitas
    ? `Todas`
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || '1 selecionada'
      : `${selected.length} selecionadas`;

  function toggleOption(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function toggleTodas() {
    onChange(todasExplicitas ? [] : options.map((o) => o.value));
  }

  return (
    <div className={className || 'w-40'} ref={containerRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-[var(--bbtk-red)] focus:border-transparent"
        >
          <span className="truncate text-left">{displayText}</span>
          <svg
            className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
            {options.length > 8 && (
              <div className="p-2 border-b border-gray-100">
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full px-2 py-1 text-sm border border-gray-200 rounded normal-case"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto">
              <button
                type="button"
                onClick={toggleTodas}
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm font-medium text-[var(--bbtk-red)] hover:bg-gray-50 border-b border-gray-100"
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    todasExplicitas ? 'bg-[var(--bbtk-red)] border-[var(--bbtk-red)]' : 'border-gray-300'
                  }`}
                >
                  {todasExplicitas && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                Selecionar Todas
              </button>

              {filtradas.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nenhum item encontrado</p>
              ) : (
                filtradas.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleOption(option.value)}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          checked ? 'bg-[var(--bbtk-red)] border-[var(--bbtk-red)]' : 'border-gray-300'
                        }`}
                      >
                        {checked && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{option.label}</span>
                      {option.meta && <span className="text-gray-400 text-xs ml-auto shrink-0">{option.meta}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
