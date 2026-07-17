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

// Cores da marca, em ordem fixa (identidade sempre associada a mesma posicao)
const CORES_MARCA = [
  'var(--bbtk-red)',
  'var(--bbtk-green)',
  'var(--bbtk-purple)',
  'var(--bbtk-orange)',
  'var(--bbtk-turquoise)',
  'var(--bbtk-yellow)',
  'var(--bbtk-pink)',
  'var(--bbtk-blue)',
];

function truncar(nome: string, max: number) {
  return nome.length > max ? `${nome.slice(0, max - 1)}…` : nome;
}

// Ranking horizontal em HTML/CSS puro - evita os problemas de eixo categorico
// do Recharts (largura/label sumindo) para listas de "top N" simples.
function RankedBarList({
  data,
  formatValue,
}: {
  data: DataPoint[];
  formatValue: (value: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-3.5 py-1">
      {data.map((d, i) => {
        const pct = Math.max((d.value / max) * 100, 2);
        const cor = d.color || CORES_MARCA[i % CORES_MARCA.length];
        return (
          <div key={d.name}>
            <div className="flex items-center justify-between text-sm mb-1 gap-3">
              <span className="font-medium text-gray-700 truncate" title={d.name}>
                {truncar(d.name, 26)}
              </span>
              <span className="text-gray-600 whitespace-nowrap text-xs font-semibold">
                {formatValue(d.value)}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: cor }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
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

  if (horizontal) {
    return <RankedBarList data={data} formatValue={formatValue} />;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
        <XAxis
          dataKey="name"
          tickFormatter={(value: string) => truncar(value, 10)}
          tick={{ fontSize: 11, fill: '#666' }}
          tickLine={false}
          axisLine={{ stroke: '#e0e0e0' }}
          interval={0}
          angle={-40}
          textAnchor="end"
          height={50}
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
          width={44}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.03)' }}
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
          formatter={(value: number) => [formatValue(value), 'Valor']}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color || CORES_MARCA[index % CORES_MARCA.length]} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
