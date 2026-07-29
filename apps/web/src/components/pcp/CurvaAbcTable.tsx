'use client';

import { ReactNode } from 'react';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';

export interface CurvaAbcColuna<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
}

interface LinhaAbcBase {
  classe: 'A' | 'B' | 'C';
}

interface CurvaAbcTableProps<T extends LinhaAbcBase> {
  colunas: CurvaAbcColuna<T>[];
  linhas: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
}

const CLASSE_BADGE: Record<'A' | 'B' | 'C', string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-yellow-100 text-yellow-700',
  C: 'bg-red-100 text-red-700',
};

export function CurvaAbcTable<T extends LinhaAbcBase>({ colunas, linhas, rowKey, isLoading, emptyMessage }: CurvaAbcTableProps<T>) {
  const totalColunas = colunas.length + 1;

  return (
    <Table>
      <TableHead>
        <TableRow>
          {colunas.map((c) => (
            <TableCell key={c.key} isHeader align={c.align}>
              {c.label}
            </TableCell>
          ))}
          <TableCell isHeader align="center">
            ABC
          </TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell colSpan={totalColunas} align="center" className="py-8 text-gray-500">
              Carregando...
            </TableCell>
          </TableRow>
        ) : linhas.length === 0 ? (
          <TableRow>
            <TableCell colSpan={totalColunas} align="center" className="py-8 text-gray-500">
              {emptyMessage || 'Nenhum dado encontrado'}
            </TableCell>
          </TableRow>
        ) : (
          linhas.map((linha) => (
            <TableRow key={rowKey(linha)}>
              {colunas.map((c) => (
                <TableCell key={c.key} align={c.align}>
                  {c.render(linha)}
                </TableCell>
              ))}
              <TableCell align="center">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${CLASSE_BADGE[linha.classe]}`}>
                  {linha.classe}
                </span>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
