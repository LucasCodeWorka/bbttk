'use client';

import { CSSProperties, ReactNode, Ref, forwardRef, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface TableProps {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
  topScroll?: boolean;
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else ref.current = value;
}

// forwardRef no wrapper com scroll horizontal - permite que a pagina controle o scroll
// programaticamente (ex: botoes de "rolar pra esquerda/direita" em tabelas largas).
export const Table = forwardRef<HTMLDivElement, TableProps>(function Table({ children, className, tableClassName, topScroll }, ref) {
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingRef = useRef(false);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    if (!topScroll) return;

    const update = () => {
      const table = tableRef.current;
      setScrollWidth(table?.scrollWidth || 0);
    };

    update();
    if (typeof ResizeObserver === 'undefined' || !tableRef.current) return;

    const observer = new ResizeObserver(update);
    observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, [children, topScroll]);

  function syncFrom(source: 'top' | 'table') {
    if (!topScroll || syncingRef.current) return;
    const top = topScrollRef.current;
    const table = tableScrollRef.current;
    if (!top || !table) return;

    syncingRef.current = true;
    if (source === 'top') table.scrollLeft = top.scrollLeft;
    else top.scrollLeft = table.scrollLeft;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }

  if (topScroll) {
    return (
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div
          ref={topScrollRef}
          onScroll={() => syncFrom('top')}
          className="h-5 overflow-x-auto overflow-y-hidden border-b border-gray-200 bg-gray-50"
        >
          <div style={{ width: scrollWidth, height: 8 }} />
        </div>
        <div
          ref={(node) => {
            tableScrollRef.current = node;
            setRef(ref, node);
          }}
          onScroll={() => syncFrom('table')}
          className={cn('overflow-x-hidden', className, 'overflow-x-hidden')}
        >
          <table ref={tableRef} className={cn('w-full text-sm', tableClassName)}>{children}</table>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn('overflow-x-auto', className)}>
      <table ref={tableRef} className={cn('w-full text-sm', tableClassName)}>{children}</table>
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
  rowSpan?: number;
  style?: CSSProperties;
}

export function TableCell({ children, className, title, align = 'left', isHeader, onClick, colSpan, rowSpan, style }: TableCellProps) {
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
      rowSpan={rowSpan}
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
