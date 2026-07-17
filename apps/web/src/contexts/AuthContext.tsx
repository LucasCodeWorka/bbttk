'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi, User } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  canAccessBranch: (branchCode: number) => boolean;
  canAccessModule: (moduleKey: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Carregar token do localStorage
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      validateToken(savedToken);
    } else {
      setIsLoading(false);
    }
  }, []);

  async function validateToken(savedToken: string) {
    try {
      const { user } = await authApi.me(savedToken);
      setToken(savedToken);
      setUser(user);
    } catch {
      localStorage.removeItem('token');
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const result = await authApi.login(email, password);
    setToken(result.token);
    setUser(result.user);
    localStorage.setItem('token', result.token);
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
  }

  function canAccessBranch(branchCode: number): boolean {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.branchCodes.includes(branchCode);
  }

  function canAccessModule(moduleKey: string): boolean {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return (user.moduleAccess || []).includes(moduleKey);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        isAdmin: user?.role === 'admin',
        canAccessBranch,
        canAccessModule,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider');
  }
  return context;
}
