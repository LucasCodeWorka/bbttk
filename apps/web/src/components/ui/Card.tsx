'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className, hover }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-xl shadow-sm border border-gray-100 p-5',
        hover && 'hover:shadow-md transition-shadow cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export function CardHeader({ children, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      {children}
    </div>
  );
}

interface CardTitleProps {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  size?: 'xs' | 'sm';
}

export function CardTitle({ children, className, icon, size = 'sm' }: CardTitleProps) {
  const sizes = {
    xs: 'text-xs',
    sm: 'text-sm',
  };

  return (
    <h3 className={cn(sizes[size], 'font-semibold text-gray-600 flex items-center gap-2', className)}>
      {icon}
      {children}
    </h3>
  );
}

interface CardValueProps {
  children: ReactNode;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export function CardValue({ children, className, size = 'lg' }: CardValueProps) {
  const sizes = {
    xs: 'text-base',
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  };

  return (
    <p className={cn('font-bold text-gray-900', sizes[size], className)}>
      {children}
    </p>
  );
}
