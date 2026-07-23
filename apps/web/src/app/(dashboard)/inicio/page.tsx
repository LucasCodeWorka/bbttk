'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KPICard } from '@/components/dashboard/KPICard';
import { useAuth } from '@/contexts/AuthContext';
import { vendasApi, entregasApi, VendasResponse, VendedoresResponse, Entrega } from '@/lib/api';
import { formatMoney, formatNumber, getMonthStart, getToday } from '@/lib/utils';

interface AtalhoDash {
  titulo: string;
  descricao: string;
  href: string | null;
  icon: React.ReactNode;
  color: string;
  preview: React.ReactNode;
}

// Mini "screenshot" do Dashboard Comercial: barras de grafico + linha
function PreviewDashboard() {
  const barras = [40, 65, 50, 80, 60, 90, 45];
  return (
    <div className="w-full h-full flex items-end gap-1 px-3 pb-2">
      {barras.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-[var(--bbtk-red)]"
          style={{ height: `${h}%`, opacity: 0.25 + (i / barras.length) * 0.5 }}
        />
      ))}
    </div>
  );
}

// Mini "screenshot" de Metas: linhas com barra de progresso
function PreviewMetas() {
  const progresso = [80, 55, 95];
  return (
    <div className="w-full h-full flex flex-col justify-center gap-2 px-3">
      {progresso.map((p, i) => (
        <div key={i} className="h-2 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--bbtk-green)]"
            style={{ width: `${p}%`, opacity: 0.6 }}
          />
        </div>
      ))}
    </div>
  );
}

// Mini "screenshot" de Agrupamento de Cores: swatches se juntando num grupo
function PreviewCores() {
  const tons = ['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb'];
  return (
    <div className="w-full h-full flex items-center justify-center gap-1.5">
      {tons.map((cor, i) => (
        <div
          key={i}
          className="rounded-full"
          style={{
            width: 14,
            height: 14,
            backgroundColor: cor,
            marginTop: i % 2 === 0 ? -4 : 4,
          }}
        />
      ))}
    </div>
  );
}

const atalhos: AtalhoDash[] = [
  {
    titulo: 'Dashboard Comercial',
    descricao: 'Comparativo de vendas por filial',
    href: '/dashboard',
    color: 'var(--bbtk-red)',
    preview: <PreviewDashboard />,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 14l4-4 4 4 5-5" />
      </svg>
    ),
  },
  {
    titulo: 'Metas',
    descricao: 'Cadastro e distribuicao de metas',
    href: '/metas',
    color: 'var(--bbtk-green)',
    preview: <PreviewMetas />,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    titulo: 'PCP - Estoque Sem Giro',
    descricao: 'Estoque parado por SKU e loja',
    href: '/pcp-novo',
    color: 'var(--bbtk-yellow)',
    preview: <PreviewDashboard />,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    titulo: 'PCP - Agrupamento de Cores',
    descricao: 'Agrupar variacoes de cor de produto',
    href: '/pcp/agrupamento-cores',
    color: 'var(--bbtk-purple)',
    preview: <PreviewCores />,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 5.5-3 2.5-3-2.5L8 4z" />
      </svg>
    ),
  },
];

// Parser simples de texto: paragrafos, "## " vira subtitulo, "- " vira lista
function renderBody(body: string) {
  const blocks = body.split(/\n\n+/);

  return blocks.map((block, i) => {
    const lines = block.split('\n').filter(Boolean);

    if (lines.every((l) => l.trim().startsWith('- '))) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-1 text-sm text-gray-700">
          {lines.map((l, j) => (
            <li key={j}>{l.trim().slice(2)}</li>
          ))}
        </ul>
      );
    }

    if (block.startsWith('## ')) {
      return (
        <h4 key={i} className="font-semibold text-gray-900 mt-2">
          {block.slice(3)}
        </h4>
      );
    }

    return (
      <p key={i} className="text-sm text-gray-700">
        {block}
      </p>
    );
  });
}

const AUTO_ADVANCE_MS = 8000;

const MODULO_ESTILO: Record<string, { label: string; bg: string; text: string; accent: string }> = {
  comercial: { label: 'Comercial', bg: 'bg-red-50', text: 'text-[var(--bbtk-red)]', accent: 'var(--bbtk-red)' },
  pcp: { label: 'PCP', bg: 'bg-purple-50', text: 'text-[var(--bbtk-purple)]', accent: 'var(--bbtk-purple)' },
  pcp_servico: { label: 'PCP', bg: 'bg-yellow-50', text: 'text-yellow-700', accent: 'var(--bbtk-yellow)' },
};

function EntregasCarousel({ entregas }: { entregas: Entrega[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (entregas.length <= 1 || paused) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % entregas.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [entregas.length, paused]);

  if (entregas.length === 0) return null;

  const entrega = entregas[Math.min(index, entregas.length - 1)];
  const estilo = MODULO_ESTILO[entrega.modulo] || {
    label: entrega.modulo || 'Geral',
    bg: 'bg-gray-50',
    text: 'text-gray-500',
    accent: 'var(--muted)',
  };

  function anterior() {
    setIndex((prev) => (prev - 1 + entregas.length) % entregas.length);
  }

  function proxima() {
    setIndex((prev) => (prev + 1) % entregas.length);
  }

  return (
    <div
      className="relative rounded-xl border border-gray-100 bg-gradient-to-br from-white to-gray-50/60 p-5 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Barra de progresso estilo stories */}
      {entregas.length > 1 && (
        <div className="flex gap-1 mb-4">
          {entregas.map((e, i) => (
            <div key={e.title + e.date} className="h-1 flex-1 rounded-full bg-gray-200 overflow-hidden">
              <div
                className={`h-full rounded-full bg-[var(--bbtk-red)] ${i === index ? `animate-fillbar ${paused ? 'paused' : ''}` : ''}`}
                style={{
                  width: i < index ? '100%' : i === index ? undefined : '0%',
                  animationDuration: i === index ? `${AUTO_ADVANCE_MS}ms` : undefined,
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div key={entrega.title + entrega.date} className="animate-fadeIn">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-start gap-3">
            <div
              className="w-1 self-stretch rounded-full flex-shrink-0"
              style={{ backgroundColor: estilo.accent }}
            />
            <div>
              <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1.5 ${estilo.bg} ${estilo.text}`}>
                {estilo.label}
              </span>
              <p className="font-semibold text-gray-900">{entrega.title}</p>
              <p className="text-xs text-gray-400">{entrega.date}</p>
            </div>
          </div>
          {entregas.length > 1 && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={anterior}
                className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-white hover:shadow-sm transition-all"
                aria-label="Novidade anterior"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={proxima}
                className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-white hover:shadow-sm transition-all"
                aria-label="Proxima novidade"
              >
                ›
              </button>
            </div>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto space-y-3 pr-2 pl-4">{renderBody(entrega.body)}</div>
      </div>
    </div>
  );
}

export default function InicioPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [vendas, setVendas] = useState<VendasResponse | null>(null);
  const [vendedores, setVendedores] = useState<VendedoresResponse | null>(null);
  const [entregas, setEntregas] = useState<Entrega[]>([]);

  useEffect(() => {
    async function carregar() {
      setIsLoading(true);
      try {
        const [vendasRes, vendRes, entregasRes] = await Promise.all([
          vendasApi.getPeriodo(getMonthStart(), getToday()),
          vendasApi.getVendedores(getMonthStart(), getToday()),
          entregasApi.getAll(),
        ]);
        setVendas(vendasRes);
        setVendedores(vendRes);
        setEntregas(entregasRes.entregas);
      } catch (error) {
        console.error('Erro ao carregar dados da pagina inicial:', error);
      } finally {
        setIsLoading(false);
      }
    }
    carregar();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Ola, {user?.name?.split(' ')[0] || 'bem-vindo(a)'}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Acesso rapido, indicadores gerais e novidades do sistema
        </p>
      </div>

      {/* Bloco 1 - Atalhos rapidos */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-3">Dashboards Disponiveis</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {atalhos.map((atalho) => {
            const conteudo = (
              <Card hover={!!atalho.href} className={!atalho.href ? 'opacity-60' : undefined}>
                <div className="h-20 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden mb-3">
                  {atalho.preview}
                </div>
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0"
                    style={{ backgroundColor: atalho.color }}
                  >
                    {atalho.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{atalho.titulo}</p>
                    <p className="text-xs text-gray-500">{atalho.descricao}</p>
                  </div>
                </div>
              </Card>
            );

            return atalho.href ? (
              <Link key={atalho.titulo} href={atalho.href}>
                {conteudo}
              </Link>
            ) : (
              <div key={atalho.titulo}>{conteudo}</div>
            );
          })}
        </div>
      </div>

      {/* Bloco 2 - Indicadores principais */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-3">Indicadores do Mes</h2>
        <p className="text-xs text-gray-400 mb-3">Comercial</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Faturamento"
            value={formatMoney(vendas?.total.faturamento || 0)}
            color="red"
            isLoading={isLoading}
          />
          <KPICard
            title="Pecas Vendidas"
            value={formatNumber(vendas?.total.pecas || 0)}
            color="green"
            isLoading={isLoading}
          />
          <KPICard
            title="Ticket Medio"
            value={formatMoney(vendas?.total.tm || 0)}
            color="yellow"
            isLoading={isLoading}
          />
          <KPICard
            title="Vendedores Ativos"
            value={formatNumber(vendedores?.vendedores.length || 0)}
            color="purple"
            isLoading={isLoading}
          />
        </div>

        <p className="text-xs text-gray-400 mt-4 mb-3">PCP (em breve)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {['Producao', 'Eficiencia', 'Estoque', 'Perdas'].map((titulo) => (
            <Card key={titulo} className="opacity-50">
              <CardTitle>{titulo}</CardTitle>
              <div className="mt-2 text-2xl font-bold text-gray-300">-</div>
            </Card>
          ))}
        </div>
      </div>

      {/* Bloco 3 - Novidades */}
      <Card>
        <CardHeader>
          <CardTitle
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            }
          >
            Novidades
          </CardTitle>
        </CardHeader>
        {entregas.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            {isLoading ? 'Carregando...' : 'Nenhuma entrega registrada ainda'}
          </p>
        ) : (
          <EntregasCarousel entregas={entregas} />
        )}
      </Card>
    </div>
  );
}

