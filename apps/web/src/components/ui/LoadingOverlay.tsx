'use client';

import { ReactNode } from 'react';

interface LoadingOverlayProps {
  active: boolean;
  children: ReactNode;
  className?: string;
}

// Sinaliza que os dados exibidos estao sendo atualizados (ex: troca de filtro) sem
// esconder o conteudo anterior - evita a tela "piscar" em branco a cada refetch.
export function LoadingOverlay({ active, children, className }: LoadingOverlayProps) {
  return (
    <div className={className} style={{ position: 'relative' }}>
      {children}
      {active && (
        <div
          className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center rounded-xl z-10"
        >
          <svg className="animate-spin h-6 w-6 text-[var(--bbtk-red)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      )}
    </div>
  );
}
