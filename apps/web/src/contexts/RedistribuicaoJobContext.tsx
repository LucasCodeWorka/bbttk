'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';

// ============================================================================
// TIPOS
// ============================================================================

interface RedistribuicaoConfig {
  maturacaoDias: number;
  coberturaIdealMeses: number;
  pesos: {
    cobertura: number;
    curva: number;
    giro: number;
  };
}

interface RedistribuicaoSugestao {
  sku: string;
  productCode: number;
  referenceCode: string;
  referenceName: string;
  cor: string | null;
  tamanho: string;
  curva: 'A' | 'B' | 'C' | null;
  origem: {
    branchCode: number;
    branchName: string;
    estoqueAtual: number;
    coberturaMeses: number | null;
    giro3m: number;
  };
  destino: {
    branchCode: number;
    branchName: string;
    estoqueAtual: number;
    coberturaMeses: number | null;
    giro3m: number;
    vendeu: boolean;
  };
  quantidadeSugerida: number;
  scorePrioridade: number;
  motivoScore: string;
}

interface RedistribuicaoResultado {
  calculadoEm: string;
  configSnapshot: RedistribuicaoConfig;
  kpis: {
    skusAnalisados: number;
    skusElegiveis: number;
    sugestoesCriadas: number;
    pecasASugerir: number;
  };
  sugestoes: RedistribuicaoSugestao[];
}

interface JobStatusResponse {
  jobId: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  resultado?: RedistribuicaoResultado;
  errorMessage?: string;
}

interface RedistribuicaoFiltro {
  categoria?: string[];
  linha?: string[];
  genero?: string[];
  referencia?: string;
  branches?: number[];
}

interface RedistribuicaoJobContextType {
  activeJob: JobStatusResponse | null;
  isPolling: boolean;
  iniciarJob: (filtros: RedistribuicaoFiltro) => Promise<number>;
  consultarJob: (jobId: number) => Promise<JobStatusResponse>;
  limparJob: () => void;
}

const RedistribuicaoJobContext = createContext<RedistribuicaoJobContextType | null>(null);

// ============================================================================
// API HELPERS
// ============================================================================

const PCP_API_BASE = process.env.NEXT_PUBLIC_PCP_API_URL || 'http://localhost:3002';

async function apiIniciarJob(token: string, filtros: RedistribuicaoFiltro): Promise<{ jobId: number }> {
  const res = await fetch(`${PCP_API_BASE}/api/pcp/redistribuicao/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(filtros),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(err.error || `Erro ${res.status}`);
  }

  return res.json();
}

async function apiGetJobStatus(token: string, jobId: number): Promise<JobStatusResponse> {
  const res = await fetch(`${PCP_API_BASE}/api/pcp/redistribuicao/jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(err.error || `Erro ${res.status}`);
  }

  return res.json();
}

// ============================================================================
// PROVIDER
// ============================================================================

export function RedistribuicaoJobProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [activeJob, setActiveJob] = useState<JobStatusResponse | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Limpar polling ao desmontar
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Polling automatico enquanto job estiver pending/running
  useEffect(() => {
    if (!activeJob || !token) {
      setIsPolling(false);
      return;
    }

    if (activeJob.status === 'completed' || activeJob.status === 'failed' || activeJob.status === 'timeout') {
      setIsPolling(false);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    setIsPolling(true);

    // Iniciar polling a cada 3 segundos
    pollingRef.current = setInterval(async () => {
      try {
        const updated = await apiGetJobStatus(token, activeJob.jobId);
        setActiveJob(updated);

        if (updated.status !== 'pending' && updated.status !== 'running') {
          setIsPolling(false);
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch (error) {
        console.error('Erro ao consultar job:', error);
      }
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeJob?.jobId, activeJob?.status, token]);

  // Persistir jobId no localStorage para sobreviver navegacao
  useEffect(() => {
    const savedJobId = localStorage.getItem('redistribuicao_job_id');
    if (savedJobId && token && !activeJob) {
      apiGetJobStatus(token, parseInt(savedJobId, 10))
        .then((job) => {
          // So restaurar se ainda estiver em andamento ou recentemente concluido
          const completedAt = job.completedAt ? new Date(job.completedAt) : null;
          const isRecent = completedAt && Date.now() - completedAt.getTime() < 30 * 60 * 1000; // 30 min
          const isInProgress = job.status === 'pending' || job.status === 'running';

          if (isInProgress || isRecent) {
            setActiveJob(job);
          } else {
            localStorage.removeItem('redistribuicao_job_id');
          }
        })
        .catch(() => {
          localStorage.removeItem('redistribuicao_job_id');
        });
    }
  }, [token, activeJob]);

  useEffect(() => {
    if (activeJob) {
      localStorage.setItem('redistribuicao_job_id', String(activeJob.jobId));
    }
  }, [activeJob?.jobId]);

  const iniciarJob = useCallback(
    async (filtros: RedistribuicaoFiltro) => {
      if (!token) throw new Error('Nao autenticado');

      const response = await apiIniciarJob(token, filtros);
      const jobStatus = await apiGetJobStatus(token, response.jobId);
      setActiveJob(jobStatus);

      return response.jobId;
    },
    [token]
  );

  const consultarJob = useCallback(
    async (jobId: number) => {
      if (!token) throw new Error('Nao autenticado');
      return apiGetJobStatus(token, jobId);
    },
    [token]
  );

  const limparJob = useCallback(() => {
    setActiveJob(null);
    localStorage.removeItem('redistribuicao_job_id');
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  return (
    <RedistribuicaoJobContext.Provider
      value={{
        activeJob,
        isPolling,
        iniciarJob,
        consultarJob,
        limparJob,
      }}
    >
      {children}
    </RedistribuicaoJobContext.Provider>
  );
}

export function useRedistribuicaoJob() {
  const context = useContext(RedistribuicaoJobContext);
  if (!context) {
    throw new Error('useRedistribuicaoJob deve ser usado dentro de RedistribuicaoJobProvider');
  }
  return context;
}

// Re-exportar tipos para uso externo
export type {
  RedistribuicaoFiltro,
  RedistribuicaoResultado,
  RedistribuicaoSugestao,
  JobStatusResponse,
};
