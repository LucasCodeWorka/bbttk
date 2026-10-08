'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface DiasExcluidosPickerProps {
  // Intervalo escolhido nos campos De/Ate - o calendario nao muda o range, so permite
  // "furar" dias dentro dele (pedido do usuario: marca o range, desmarca um dia).
  dataInicio: string;
  dataFim: string;
  diasExcluidos: string[];
  onChange: (dias: string[]) => void;
  label?: string;
  className?: string;
}

const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Tudo em string 'YYYY-MM-DD' de ponta a ponta: comparar data como texto evita
// qualquer escorregao de fuso (o mesmo problema que ja mordeu no backend, onde
// `new Date('2026-09-15T00:00:00')` virava 03:00Z e mudava de dia).
function chaveDia(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

interface MesGrade {
  ano: number;
  mes: number;
  // Posicao 0..6 da primeira celula; null = celula vazia antes do dia 1.
  celulas: (number | null)[];
}

// Monta a grade de cada mes-calendario tocado pelo intervalo.
function montarMeses(dataInicio: string, dataFim: string): MesGrade[] {
  if (!dataInicio || !dataFim || dataInicio > dataFim) return [];
  const [anoI, mesI] = dataInicio.split('-').map(Number);
  const [anoF, mesF] = dataFim.split('-').map(Number);

  const meses: MesGrade[] = [];
  let ano = anoI;
  let mes = mesI - 1;
  // Trava de seguranca: intervalo muito longo viraria uma parede de calendarios.
  while (meses.length < 12 && (ano < anoF || (ano === anoF && mes <= mesF - 1))) {
    const primeiroDiaSemana = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
    const diasNoMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    const celulas: (number | null)[] = Array(primeiroDiaSemana).fill(null);
    for (let d = 1; d <= diasNoMes; d++) celulas.push(d);
    meses.push({ ano, mes, celulas });
    mes += 1;
    if (mes > 11) {
      mes = 0;
      ano += 1;
    }
  }
  return meses;
}

export function DiasExcluidosPicker({
  dataInicio,
  dataFim,
  diasExcluidos,
  onChange,
  label,
  className,
}: DiasExcluidosPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const meses = useMemo(() => montarMeses(dataInicio, dataFim), [dataInicio, dataFim]);
  const excluidosSet = useMemo(() => new Set(diasExcluidos), [diasExcluidos]);

  // Total de dias do intervalo, pra mostrar "28 de 30 dias".
  const totalDias = useMemo(() => {
    if (!dataInicio || !dataFim || dataInicio > dataFim) return 0;
    const ini = new Date(`${dataInicio}T12:00:00Z`).getTime();
    const fim = new Date(`${dataFim}T12:00:00Z`).getTime();
    return Math.round((fim - ini) / 86400000) + 1;
  }, [dataInicio, dataFim]);

  // So conta exclusao que esta de fato dentro do intervalo atual - se o usuario mudar
  // o De/Ate, dia que ficou fora nao deve aparecer no contador (nem no filtro, que o
  // BETWEEN ja descarta).
  const excluidosNoPeriodo = useMemo(
    () => diasExcluidos.filter((d) => d >= dataInicio && d <= dataFim),
    [diasExcluidos, dataInicio, dataFim]
  );
  const diasAnalisados = Math.max(totalDias - excluidosNoPeriodo.length, 0);

  function toggleDia(chave: string) {
    if (chave < dataInicio || chave > dataFim) return;
    onChange(
      excluidosSet.has(chave)
        ? diasExcluidos.filter((d) => d !== chave)
        : [...diasExcluidos, chave].sort()
    );
  }

  const resumo =
    excluidosNoPeriodo.length === 0
      ? `${totalDias} ${totalDias === 1 ? 'dia' : 'dias'}`
      : `${diasAnalisados} de ${totalDias} dias · ${excluidosNoPeriodo.length} fora`;

  return (
    <div className={className || 'w-56'} ref={containerRef}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm shadow-sm',
            excluidosNoPeriodo.length > 0
              ? 'border-[var(--bbtk-red)] text-[var(--bbtk-red)] font-medium'
              : 'border-gray-300 text-gray-700'
          )}
        >
          <span className="truncate">{resumo}</span>
          {/* Heroicons outline: calendar - SVG inline, padrao do projeto */}
          <svg className="ml-2 h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-[300px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
            <p className="mb-2 text-xs text-gray-500">
              Clique num dia pra tirá-lo da análise. Ele sai também do mesmo dia no ano anterior,
              pra comparação ficar com a mesma quantidade de dias.
            </p>

            <div className="max-h-[340px] space-y-4 overflow-y-auto">
              {meses.length === 0 && (
                <p className="py-4 text-center text-sm text-gray-400">Escolha um período válido em De/Até.</p>
              )}
              {meses.map(({ ano, mes, celulas }) => (
                <div key={`${ano}-${mes}`}>
                  <p className="mb-1 text-center text-xs font-bold uppercase tracking-wide text-gray-600">
                    {MESES[mes]} {ano}
                  </p>
                  <div className="grid grid-cols-7 gap-0.5">
                    {DIAS_SEMANA.map((d, i) => (
                      <span key={i} className="py-1 text-center text-[10px] font-medium text-gray-400">
                        {d}
                      </span>
                    ))}
                    {celulas.map((dia, i) => {
                      if (dia === null) return <span key={`v${i}`} />;
                      const chave = chaveDia(ano, mes, dia);
                      const foraDoRange = chave < dataInicio || chave > dataFim;
                      const excluido = excluidosSet.has(chave);
                      return (
                        <button
                          key={chave}
                          type="button"
                          disabled={foraDoRange}
                          onClick={() => toggleDia(chave)}
                          title={
                            foraDoRange
                              ? 'Fora do período selecionado'
                              : excluido
                                ? 'Fora da análise - clique para incluir de volta'
                                : 'Clique para tirar da análise'
                          }
                          className={cn(
                            'rounded py-1.5 text-xs tabular-nums transition-colors',
                            foraDoRange && 'cursor-not-allowed text-gray-300',
                            !foraDoRange && !excluido && 'bg-[var(--bbtk-red)]/10 font-medium text-gray-800 hover:bg-[var(--bbtk-red)]/25',
                            excluido && 'bg-gray-100 text-gray-400 line-through hover:bg-gray-200'
                          )}
                        >
                          {dia}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {excluidosNoPeriodo.length > 0 && (
              <button
                type="button"
                onClick={() => onChange(diasExcluidos.filter((d) => d < dataInicio || d > dataFim))}
                className="mt-3 w-full rounded border border-gray-300 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Incluir todos os dias de volta
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
