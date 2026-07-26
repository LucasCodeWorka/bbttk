'use client';

import { Card, CardTitle, CardValue } from '@/components/ui/Card';
import { VariationBadge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: string;
  variation?: number;
  icon?: React.ReactNode;
  color?: 'red' | 'green' | 'yellow' | 'purple' | 'blue';
  isLoading?: boolean;
  valueSize?: 'xs' | 'sm' | 'md' | 'lg';
}

export function KPICard({ title, value, variation, icon, color = 'red', isLoading, valueSize = 'lg' }: KPICardProps) {
  const colors = {
    red: 'border-l-4 border-l-[var(--bbtk-red)]',
    green: 'border-l-4 border-l-[var(--bbtk-green)]',
    yellow: 'border-l-4 border-l-[var(--bbtk-yellow)]',
    purple: 'border-l-4 border-l-[var(--bbtk-purple)]',
    blue: 'border-l-4 border-l-[var(--bbtk-blue)]',
  };

  if (isLoading) {
    return (
      <Card className={cn(colors[color])}>
        <CardTitle className="animate-pulse-soft">{title}</CardTitle>
        <div className="h-8 w-32 bg-gray-200 rounded animate-pulse mt-2" />
      </Card>
    );
  }

  return (
    <Card className={cn(colors[color])}>
      <CardTitle icon={icon}>{title}</CardTitle>
      <div className="flex items-end justify-between mt-2 gap-2">
        <CardValue size={valueSize} className="truncate">{value}</CardValue>
        {variation !== undefined && <VariationBadge value={variation} />}
      </div>
    </Card>
  );
}
