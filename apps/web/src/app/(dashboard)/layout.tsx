'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { RedistribuicaoJobProvider } from '@/contexts/RedistribuicaoJobContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { cn } from '@/lib/utils';
import { getModuleForPath, isAdminOnlyPath } from '@/lib/permissions';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, isAdmin, canAccessModule } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const requiredModule = getModuleForPath(pathname);
  const isAuthorized =
    !requiredModule || canAccessModule(requiredModule);
  const isAdminAuthorized = !isAdminOnlyPath(pathname) || isAdmin;
  const bloqueado = !!user && (!isAuthorized || !isAdminAuthorized);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
      return;
    }
    if (!isLoading && user && bloqueado) {
      router.push('/inicio');
    }
  }, [user, isLoading, bloqueado, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[var(--bbtk-red)] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user || bloqueado) {
    return null;
  }

  return (
    <RedistribuicaoJobProvider>
      <div className="min-h-screen bg-gray-100">
        <Sidebar isCollapsed={isCollapsed} onToggleCollapse={() => setIsCollapsed((prev) => !prev)} />
        <main className={cn('p-6 transition-all duration-300 print:ml-0 print:p-0', isCollapsed ? 'ml-16' : 'ml-64')}>
          {children}
        </main>
      </div>
    </RedistribuicaoJobProvider>
  );
}
