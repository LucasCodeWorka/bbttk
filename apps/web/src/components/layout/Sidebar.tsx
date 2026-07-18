'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface SubItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

type NavEntry =
  | { type: 'link'; label: string; href: string; icon: React.ReactNode; adminOnly?: boolean }
  | { type: 'module'; key: string; label: string; icon: React.ReactNode; items: SubItem[]; disabled?: boolean };

const iconInicio = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const iconComercial = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 14l4-4 4 4 5-5" />
  </svg>
);

const iconDashboard = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v8a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4z" />
  </svg>
);

const iconMetas = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const iconPcp = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 5.5-3 2.5-3-2.5L8 4z" />
  </svg>
);

const iconUsuarios = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
  </svg>
);

const iconAgrupamentoCores = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h10a2 2 0 002-2v-4a2 2 0 00-2-2h-2.5M7 21V9m0 0V5m0 4h4" />
  </svg>
);

const navEntries: NavEntry[] = [
  { type: 'link', label: 'Inicio', href: '/inicio', icon: iconInicio },
  {
    type: 'module',
    key: 'comercial',
    label: 'Comercial',
    icon: iconComercial,
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: iconDashboard },
      { label: 'Metas', href: '/metas', icon: iconMetas },
    ],
  },
  {
    type: 'module',
    key: 'pcp',
    label: 'PCP',
    icon: iconPcp,
    items: [
      { label: 'Agrupamento de Cores', href: '/pcp/agrupamento-cores', icon: iconAgrupamentoCores },
    ],
  },
  { type: 'link', label: 'Usuarios', href: '/usuarios', icon: iconUsuarios, adminOnly: true },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ isCollapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout, isAdmin, canAccessModule } = useAuth();
  const [expandedModule, setExpandedModule] = useState<string | null>(null);

  // Auto-expande o modulo que contem a rota ativa
  useEffect(() => {
    const activeModule = navEntries.find(
      (entry) => entry.type === 'module' && entry.items.some((item) => item.href === pathname)
    );
    if (activeModule && activeModule.type === 'module') {
      setExpandedModule(activeModule.key);
    }
  }, [pathname]);

  const visibleEntries = navEntries.filter((entry) => {
    if (entry.type === 'module') return entry.disabled || canAccessModule(entry.key);
    return !entry.adminOnly || (entry.adminOnly && isAdmin);
  });

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-full bg-white border-r border-gray-200 transition-all duration-300 z-40 flex flex-col',
        isCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative">
            <Image src="/logo.png" alt="Bebetenkite" fill className="object-cover" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="font-bold text-gray-900 normal-case">
                <span className="text-[var(--bbtk-red)]">bebê</span>
                <span className="text-[var(--bbtk-green)]">tenkitê</span>
              </h1>
              <p className="text-xs text-gray-500">Dashboard</p>
            </div>
          )}
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleEntries.map((entry) => {
          if (entry.type === 'link') {
            const isActive = pathname === entry.href;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                  isActive
                    ? 'bg-[var(--bbtk-yellow)] text-gray-900 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <span className={cn(isActive && 'text-[var(--bbtk-red)]')}>{entry.icon}</span>
                {!isCollapsed && <span>{entry.label}</span>}
              </Link>
            );
          }

          // Modulo
          const isExpanded = expandedModule === entry.key;
          const hasActiveChild = entry.items.some((item) => item.href === pathname);

          if (entry.disabled) {
            return (
              <div
                key={entry.key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 cursor-not-allowed"
                title="Em breve"
              >
                <span>{entry.icon}</span>
                {!isCollapsed && (
                  <span className="flex-1 flex items-center justify-between">
                    {entry.label}
                    <span className="text-[10px] font-semibold uppercase bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                      Em breve
                    </span>
                  </span>
                )}
              </div>
            );
          }

          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => setExpandedModule(isExpanded ? null : entry.key)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                  hasActiveChild
                    ? 'text-[var(--bbtk-red)] font-semibold'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <span>{entry.icon}</span>
                {!isCollapsed && (
                  <span className="flex-1 flex items-center justify-between text-left">
                    {entry.label}
                    <svg
                      className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-90')}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                )}
              </button>

              {isExpanded && !isCollapsed && (
                <div className="ml-4 mt-1 space-y-1 border-l border-gray-100 pl-3">
                  {entry.items.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
                          isActive
                            ? 'bg-[var(--bbtk-yellow)] text-gray-900 font-semibold'
                            : 'text-gray-600 hover:bg-gray-100'
                        )}
                      >
                        <span className={cn(isActive && 'text-[var(--bbtk-red)]')}>{item.icon}</span>
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Toggle */}
      <button
        onClick={onToggleCollapse}
        className="absolute -right-3 top-20 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50"
      >
        <svg
          className={cn('w-4 h-4 text-gray-500 transition-transform', isCollapsed && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* User */}
      <div className="p-3 border-t border-gray-100">
        {user ? (
          <div className={cn('flex items-center gap-3', isCollapsed && 'justify-center')}>
            <div className="w-9 h-9 rounded-full bg-[var(--bbtk-purple)] flex items-center justify-center text-white font-semibold text-sm">
              {user.name.charAt(0).toUpperCase()}
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                <p className="text-xs text-gray-500 truncate">{user.role}</p>
              </div>
            )}
            {!isCollapsed && (
              <button
                onClick={logout}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                title="Sair"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className={cn(
              'flex items-center gap-3 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg',
              isCollapsed && 'justify-center px-2'
            )}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
            {!isCollapsed && <span>Entrar</span>}
          </Link>
        )}
      </div>
    </aside>
  );
}
