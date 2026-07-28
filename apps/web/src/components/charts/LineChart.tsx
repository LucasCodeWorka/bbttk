'use client';

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { formatMoney, formatDateShort, formatMonthShort } from '@/lib/utils';

function formatCompacto(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return value.toFixed(0);
}

interface DataPoint {
  data: string;
  faturamento: number;
  pecas?: number;
  transacoes?: number;
}

interface LineChartProps {
  data: DataPoint[];
  dataKey?: string;
  color?: string;
  showGrid?: boolean;
  formatValue?: (value: number) => string;
  granularidade?: 'diario' | 'mensal' | 'horario';
}

export function LineChart({
  data,
  dataKey = 'faturamento',
  color = 'var(--bbtk-red)',
  showGrid = true,
  formatValue = formatMoney,
  granularidade = 'diario',
}: LineChartProps) {
  const formatEixo = granularidade === 'mensal'
    ? formatMonthShort
    : granularidade === 'horario'
      ? (value: string) => value
      : formatDateShort;
  if (!data || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Sem dados para exibir
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsLineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
        <XAxis
          dataKey="data"
          tickFormatter={formatEixo}
          tick={{ fontSize: 12, fill: '#666' }}
          tickLine={false}
          axisLine={{ stroke: '#e0e0e0' }}
        />
        <YAxis
          tickFormatter={(value) => {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value.toString();
          }}
          tick={{ fontSize: 12, fill: '#666' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          formatter={(value: number) => [formatValue(value), dataKey === 'faturamento' ? 'Faturamento' : dataKey]}
          labelFormatter={(label) => formatEixo(label)}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={{ fill: color, strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, fill: color }}
        >
          <LabelList
            dataKey={dataKey}
            position="top"
            formatter={(value: number) => formatCompacto(value)}
            style={{ fontSize: 10, fill: '#4b5563', fontWeight: 600 }}
          />
        </Line>
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
