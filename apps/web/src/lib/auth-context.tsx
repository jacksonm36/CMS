"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User } from "@hostpanel/types";
import { apiClient } from "./api";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  login: () => {},
  logout: () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, token: null, loading: true });

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("hp_token");
    if (!token) {
      setState({ user: null, token: null, loading: false });
      return;
    }
    try {
      const res = await apiClient.get<{ data: User }>("/auth/me", token);
      setState({ user: res.data, token, loading: false });
    } catch {
      localStorage.removeItem("hp_token");
      setState({ user: null, token: null, loading: false });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = localStorage.getItem("hp_token");
      if (!token) {
        if (active) setState({ user: null, token: null, loading: false });
        return;
      }
      try {
        const res = await apiClient.get<{ data: User }>("/auth/me", token);
        if (active) setState({ user: res.data, token, loading: false });
      } catch {
        localStorage.removeItem("hp_token");
        if (active) setState({ user: null, token: null, loading: false });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback((token: string, user: User) => {
    localStorage.setItem("hp_token", token);
    setState({ user, token, loading: false });
  }, []);

  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).finally(() => {
      localStorage.removeItem("hp_token");
      setState({ user: null, token: null, loading: false });
      window.location.href = "/login";
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
