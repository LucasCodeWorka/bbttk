'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

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
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
  isHeader?: boolean;
}

export function TableCell({ children, className, align = 'left', isHeader }: TableCellProps) {
  const alignments = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  const Tag = isHeader ? 'th' : 'td';

  return (
    <Tag
      className={cn(
        'px-4 py-3',
        alignments[align],
        isHeader && 'font-semibold text-gray-600 uppercase text-xs tracking-wider',
        className
      )}
    >
      {children}
    </Tag>
  );
}
