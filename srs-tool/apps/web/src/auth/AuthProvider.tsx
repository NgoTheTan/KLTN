import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getAuthToken, setAuthToken, type UsageSummary, type UserProfile } from '../api/client';

interface AuthContextValue {
  user: UserProfile | null;
  usage: UsageSummary | null;
  loading: boolean;
  signInDev: (email?: string) => Promise<void>;
  refreshUsage: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUsage = useCallback(async () => {
    try {
      const u = await api.usage.get();
      setUsage(u);
    } catch {
      // Ignore if backend unavailable
    }
  }, []);

  const signInDev = useCallback(
    async (email?: string) => {
      const res = await api.auth.devToken(email);
      setUser(res.user);
      await refreshUsage();
    },
    [refreshUsage],
  );

  const signOut = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setUsage(null);
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const token = getAuthToken();
        if (token) {
          const me = await api.auth.me();
          if (active) setUser(me);
        } else {
          // Seamless local-dev initialization
          const res = await api.auth.devToken('dev@srs-tool.local');
          if (active) setUser(res.user);
        }
        if (active) {
          const u = await api.usage.get().catch(() => null);
          if (active && u) setUsage(u);
        }
      } catch {
        // Token may be expired or invalid; clear and attempt dev fallback once
        setAuthToken(null);
        try {
          const res = await api.auth.devToken('dev@srs-tool.local');
          if (active) {
            setUser(res.user);
            const u = await api.usage.get().catch(() => null);
            if (active && u) setUsage(u);
          }
        } catch {
          // Backend offline
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, usage, loading, signInDev, refreshUsage, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
