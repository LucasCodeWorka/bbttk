'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-green-100 text-green-700',
    warning: 'bg-yellow-100 text-yellow-700',
    danger: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}

interface VariationBadgeProps {
  value: number;
  className?: string;
}

export function VariationBadge({ value, className }: VariationBadgeProps) {
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <Badge
      variant={isPositive ? 'success' : isNegative ? 'danger' : 'default'}
      className={className}
    >
      {isPositive && '+'}
      {value.toFixed(1)}%
    </Badge>
  );
}
