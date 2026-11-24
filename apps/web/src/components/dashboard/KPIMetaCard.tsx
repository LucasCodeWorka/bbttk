'use client';

import { Card, CardTitle, CardValue } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface KPIMetaCardProps {
  title: string;
  value: string;
  meta: string;
  gap: number | null;
  gapFormato?: 'numero' | 'percentual';
  // Giro: acima da meta e bom, abaixo e ruim (o inverso da cobertura, onde acima da meta e excesso).
  maiorEMelhor?: boolean;
  subtitle?: string;
  footer?: React.ReactNode;
  isLoading?: boolean;
}

export function KPIMetaCard({ title, value, meta, gap, gapFormato = 'numero', maiorEMelhor = false, subtitle, footer, isLoading }: KPIMetaCardProps) {
  if (isLoading) {
    return (
      <Card className="border-l-4 border-l-gray-200">
        <CardTitle size="xs" className="animate-pulse-soft">{title}</CardTitle>
        <div className="h-8 w-24 bg-gray-200 rounded animate-pulse mt-2" />
        <div className="h-3 w-32 bg-gray-100 rounded animate-pulse mt-2" />
      </Card>
    );
  }

  const ruim = gap !== null && (maiorEMelhor ? gap < 0 : gap > 0);
  const bom = gap !== null && (maiorEMelhor ? gap > 0 : gap < 0);
  const gapCor = ruim ? 'text-red-600' : bom ? 'text-blue-600' : 'text-gray-500';
  const borderCor = ruim ? 'border-l-[var(--bbtk-red)]' : bom ? 'border-l-[var(--bbtk-blue)]' : 'border-l-gray-200';
  const gapTexto = gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${gapFormato === 'percentual' ? '%' : ''}`;

  return (
    <Card className={cn('border-l-4', borderCor)}>
      <CardTitle size="xs" className="truncate">{title}</CardTitle>
      <CardValue size="lg" className="mt-2">{value}</CardValue>
      <p className="text-xs text-gray-500 mt-1">
        Meta: {meta} · <span className={gapCor}>DESVIO {gapTexto}</span>
      </p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      {footer}
    </Card>
  );
}
