'use client';

import { useMemo } from 'react';
import { PcpGradeReferencia } from '@/lib/pcpApi';

interface GradeHeatmapProps {
  referencias: PcpGradeReferencia[];
  isLoading?: boolean;
}

// Paleta de status validada pela skill dataviz (references/palette.md) - fixa, nunca
// tematizada, distinta o bastante da paleta categorica da marca (que ja falha no
// validador de CVD/contraste, conforme CLAUDE.md raiz). Cor nunca carrega o sentido
// sozinha: toda celula sempre mostra o numero, e a legenda abaixo do heatmap explica
// cada estado.
const STATUS = {
  critical: { bg: '#d03b3b', label: 'Ruptura (sem estoque)' },
  serious: { bg: '#ec835a', label: 'Cobertura < 1 mês' },
  warning: { bg: '#fab219', label: 'Cobertura 1–3 meses' },
  good: { bg: '#0ca30c', label: 'Cobertura ≥ 3 meses' },
} as const;

type StatusKey = keyof typeof STATUS;

function statusDaCelula(estoque: number, cobertura: number | null): StatusKey {
  if (estoque <= 0) return 'critical';
  if (cobertura === null) return 'warning'; // tem estoque mas sem giro recente pra medir cobertura
  if (cobertura < 1) return 'serious';
  if (cobertura < 3) return 'warning';
  return 'good';
}

// Ordem de exibicao dos tamanhos: numericos crescentes primeiro, depois letras numa
// ordem conhecida de grade infantil/adulto, o resto por ordem alfabetica no final.
const ORDEM_LETRAS = ['RN', 'PP', 'P', 'M', 'G', 'GG', 'EXG', 'U'];

function compararTamanhos(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = !Number.isNaN(na);
  const bNum = !Number.isNaN(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  const ia = ORDEM_LETRAS.indexOf(a);
  const ib = ORDEM_LETRAS.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

interface HeatmapCelula {
  size: string;
  estoque: number;
  giro: number;
  cobertura: number | null;
}

function getCelulas(ref: PcpGradeReferencia): HeatmapCelula[] {
  if ('celulas' in ref && Array.isArray((ref as any).celulas)) return (ref as any).celulas;
  return ref.detalhes.map((d) => ({
    size: d.tamanho,
    estoque: d.estoque,
    giro: d.vendaMes1 + d.vendaMes2 + d.vendaMes3,
    cobertura: d.cobertura,
  }));
}

export function GradeHeatmap({ referencias, isLoading }: GradeHeatmapProps) {
  const tamanhos = useMemo(() => {
    const set = new Set<string>();
    for (const ref of referencias) {
      for (const cel of getCelulas(ref)) set.add(cel.size);
    }
    return [...set].sort(compararTamanhos);
  }, [referencias]);

  if (isLoading) {
    return <div className="py-10 text-center text-gray-500 text-sm">Carregando grade...</div>;
  }

  if (referencias.length === 0) {
    return <div className="py-10 text-center text-gray-500 text-sm">Nenhuma referência encontrada para os filtros selecionados</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="text-xs border-separate" style={{ borderSpacing: '2px' }}>
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-2 py-1 text-left font-semibold text-gray-600 whitespace-nowrap z-10">
                Referência
              </th>
              {tamanhos.map((t) => (
                <th key={t} className="px-1 py-1 font-semibold text-gray-600 text-center min-w-[52px]">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {referencias.map((ref) => {
              const porTamanho = new Map(getCelulas(ref).map((c) => [c.size, c]));
              return (
                <tr key={ref.referenceCode}>
                  <td className="sticky left-0 bg-white px-2 py-1 whitespace-nowrap z-10">
                    <div className="font-medium text-gray-800 truncate max-w-[220px]" title={ref.referenceName}>
                      {ref.referenceName}
                    </div>
                    <div className="text-gray-400">{ref.referenceCode}</div>
                  </td>
                  {tamanhos.map((t) => {
                    const cel = porTamanho.get(t);
                    if (!cel) {
                      return <td key={t} className="text-center text-gray-300 bg-gray-50 rounded">–</td>;
                    }
                    const status = STATUS[statusDaCelula(cel.estoque, cel.cobertura)];
                    return (
                      <td
                        key={t}
                        className="text-center rounded font-semibold"
                        style={{ backgroundColor: status.bg, color: '#1a1a1a' }}
                        title={`${ref.referenceName} · ${t} — Estoque: ${cel.estoque} · Giro: ${cel.giro} · Cobertura: ${cel.cobertura ?? '—'} meses`}
                      >
                        {cel.estoque}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mt-4 text-xs text-gray-600">
        {(Object.keys(STATUS) as StatusKey[]).map((key) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: STATUS[key].bg }} />
            {STATUS[key].label}
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm inline-block bg-gray-50 border border-gray-200" />
          Tamanho não existe nessa referência
        </div>
      </div>
    </div>
  );
}
