'use client';

import { Card, CardTitle, CardValue } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface KPIMetaCardProps {
  title: string;
  value: string;
  meta: string;
  gap: number;
  /** Quando true, gap negativo = bom (verde) e gap positivo = ruim (vermelho) - usado
   * pra metricas onde ficar ACIMA da meta é o problema (ex: cobertura, estoque morto).
   * Quando false (padrao), gap positivo = bom - mesma polaridade do resto do dashboard. */
  invertido?: boolean;
  subtitle?: string;
  isLoading?: boolean;
}

export function KPIMetaCard({ title, value, meta, gap, invertido, subtitle, isLoading }: KPIMetaCardProps) {
  if (isLoading) {
    return (
      <Card className="border-l-4 border-l-gray-200">
        <CardTitle size="xs" className="animate-pulse-soft">{title}</CardTitle>
        <div className="h-8 w-24 bg-gray-200 rounded animate-pulse mt-2" />
        <div className="h-3 w-32 bg-gray-100 rounded animate-pulse mt-2" />
      </Card>
    );
  }

  const bom = invertido ? gap <= 0 : gap >= 0;
  const gapCor = bom ? 'text-green-600' : 'text-red-600';
  const borderCor = bom ? 'border-l-[var(--bbtk-green)]' : 'border-l-[var(--bbtk-red)]';
  const gapTexto = `${gap > 0 ? '+' : ''}${gap.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;

  return (
    <Card className={cn('border-l-4', borderCor)}>
      <CardTitle size="xs" className="truncate">{title}</CardTitle>
      <CardValue size="lg" className="mt-2">{value}</CardValue>
      <p className="text-xs text-gray-500 mt-1">
        Meta: {meta} · <span className={gapCor}>gap {gapTexto}</span>
      </p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </Card>
  );
}
