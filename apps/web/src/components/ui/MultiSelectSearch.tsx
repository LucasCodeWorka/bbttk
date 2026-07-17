'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  meta?: string;
}

interface MultiSelectSearchProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
}

export function MultiSelectSearch({
  options,
  selected,
  onChange,
  placeholder = 'Buscar...',
  emptyLabel = 'Nenhum item encontrado',
}: MultiSelectSearchProps) {
  const [busca, setBusca] = useState('');

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return options;
    return options.filter((o) => o.label.toLowerCase().includes(termo));
  }, [busca, options]);

  const selectedOptions = useMemo(
    () => options.filter((o) => selected.includes(o.value)),
    [options, selected]
  );

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    );
  }

  function remove(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  return (
    <div className="space-y-3">
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedOptions.map((o) => (
            <Badge key={o.value} variant="info" className="pr-1">
              <span>{o.label}</span>
              <button
                type="button"
                onClick={() => remove(o.value)}
                className="ml-1.5 hover:text-red-600"
                aria-label={`Remover ${o.label}`}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={placeholder}
      />

      <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        {filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">{emptyLabel}</p>
        ) : (
          filtrados.map((o) => {
            const isSelected = selected.includes(o.value);
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => toggle(o.value)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors',
                  isSelected && 'bg-[var(--bbtk-yellow)]/20'
                )}
              >
                <span>
                  {o.label}
                  {o.meta && <span className="text-gray-400 ml-2 text-xs">{o.meta}</span>}
                </span>
                {isSelected && <span className="text-[var(--bbtk-red)] font-bold">✓</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
