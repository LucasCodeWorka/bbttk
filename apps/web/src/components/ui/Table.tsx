'use client';

import { CSSProperties, ReactNode, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface TableProps {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
}

// forwardRef no wrapper com scroll horizontal - permite que a pagina controle o scroll
// programaticamente (ex: botoes de "rolar pra esquerda/direita" em tabelas largas).
export const Table = forwardRef<HTMLDivElement, TableProps>(function Table({ children, className, tableClassName }, ref) {
  return (
    <div ref={ref} className={cn('overflow-x-auto', className)}>
      <table className={cn('w-full text-sm', tableClassName)}>{children}</table>
    </div>
  );
});

interface TableHeadProps {
  children: ReactNode;
  className?: string;
}

export function TableHead({ children, className }: TableHeadProps) {
  return (
    <thead className={cn('bg-gray-50 border-b border-gray-200', className)}>
      {children}
    </thead>
  );
}

interface TableBodyProps {
  children: ReactNode;
  className?: string;
}

export function TableBody({ children, className }: TableBodyProps) {
  return <tbody className={cn('divide-y divide-gray-100', className)}>{children}</tbody>;
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  isHighlighted?: boolean;
}

export function TableRow({ children, className, onClick, isHighlighted }: TableRowProps) {
  return (
    <tr
      className={cn(
        'hover:bg-gray-50 transition-colors',
        onClick && 'cursor-pointer',
        isHighlighted && 'bg-yellow-50 font-semibold',
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children?: ReactNode;
  className?: string;
  title?: string;
  align?: 'left' | 'center' | 'right';
  isHeader?: boolean;
  onClick?: () => void;
  colSpan?: number;
  style?: CSSProperties;
}

export function TableCell({ children, className, title, align = 'left', isHeader, onClick, colSpan, style }: TableCellProps) {
  const alignments = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  const Tag = isHeader ? 'th' : 'td';

  return (
    <Tag
      title={title}
      onClick={onClick}
      colSpan={colSpan}
      style={style}
      className={cn(
        'px-4 py-3',
        alignments[align],
        isHeader && 'font-semibold text-gray-600 uppercase text-xs tracking-wider',
        onClick && 'cursor-pointer select-none hover:bg-gray-100',
        className
      )}
    >
      {children}
    </Tag>
  );
}
