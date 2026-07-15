'use client';

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { formatMoney } from '@/lib/utils';

interface DataPoint {
  name: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: DataPoint[];
  color?: string;
  showGrid?: boolean;
  horizontal?: boolean;
  formatValue?: (value: number) => string;
}

export function BarChart({
  data,
  color = 'var(--bbtk-green)',
  showGrid = false,
  horizontal = false,
  formatValue = formatMoney,
}: BarChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Sem dados para exibir
      </div>
    );
  }

  // Cores gradiente para as barras
  const colors = [
    'var(--bbtk-red)',
    'var(--bbtk-green)',
    'var(--bbtk-purple)',
    'var(--bbtk-orange)',
    'var(--bbtk-turquoise)',
    'var(--bbtk-yellow)',
    'var(--bbtk-pink)',
    'var(--bbtk-blue)',
  ];

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 10, right: 30, left: horizontal ? 100 : 0, bottom: 0 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
        {horizontal ? (
          <>
            <XAxis
              type="number"
              tickFormatter={(value) => {
                if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                return value.toString();
              }}
              tick={{ fontSize: 11, fill: '#666' }}
              tickLine={false}
              axisLine={{ stroke: '#e0e0e0' }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: '#333' }}
              tickLine={false}
              axisLine={false}
              width={90}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: '#666' }}
              tickLine={false}
              axisLine={{ stroke: '#e0e0e0' }}
              interval={0}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tickFormatter={(value) => {
                if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                return value.toString();
              }}
              tick={{ fontSize: 11, fill: '#666' }}
              tickLine={false}
              axisLine={false}
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          formatter={(value: number) => [formatValue(value), 'Valor']}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color || colors[index % colors.length]} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
