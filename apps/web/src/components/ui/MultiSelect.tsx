'use client';

import { useEffect, useRef, useState } from 'react';

interface MultiSelectOption {
  value: string | number;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: (string | number)[];
  onChange: (selected: (string | number)[]) => void;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  enableSearch?: boolean;
  allLabel?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  label,
  placeholder = 'Selecione...',
  searchPlaceholder = 'Buscar...',
  className,
  enableSearch = false,
  allLabel = 'Todos',
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && enableSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [open, enableSearch]);

  const filteredOptions = enableSearch && search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const todasExplicitas = options.length > 0 && selected.length === options.length;
  const semFiltro = selected.length === 0;

  const displayText = semFiltro || todasExplicitas
    ? allLabel
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || '1 selecionado'
      : `${selected.length} selecionados`;

  function toggleOption(value: string | number) {
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
    <div className={className || 'w-44'} ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-[var(--bbtk-purple)] focus:border-transparent"
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
          <div className="absolute z-20 mt-1 w-full min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg">
            {enableSearch && (
              <div className="p-2 border-b border-gray-100">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[var(--bbtk-purple)]"
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto">
              <button
                type="button"
                onClick={toggleTodas}
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm font-medium text-[var(--bbtk-purple)] hover:bg-gray-50 border-b border-gray-100"
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    todasExplicitas ? 'bg-[var(--bbtk-purple)] border-[var(--bbtk-purple)]' : 'border-gray-300'
                  }`}
                >
                  {todasExplicitas && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                Selecionar {allLabel}
              </button>

              {filteredOptions.map((option) => {
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
                        checked ? 'bg-[var(--bbtk-purple)] border-[var(--bbtk-purple)]' : 'border-gray-300'
                      }`}
                    >
                      {checked && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}

              {filteredOptions.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-400 text-center">
                  Nenhum resultado
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
