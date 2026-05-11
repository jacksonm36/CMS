"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import type { AuthSession } from "@hostpanel/types";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [form, setForm] = useState({ email: "", password: "", totpCode: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await apiClient.post<{ success: boolean; requires2FA?: boolean; data?: AuthSession }>("/auth/login", {
        email: form.email,
        password: form.password,
        ...(requires2FA ? { totpCode: form.totpCode } : {}),
      });

      if (res.requires2FA) {
        setRequires2FA(true);
        return;
      }

      if (res.data) {
        login(res.data.token, res.data.user);
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      {/* Background gradient blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="glass rounded-2xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">HostPanel</h1>
              <p className="text-xs text-muted-foreground">Secure Control Panel</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold mb-1">
            {requires2FA ? "Two-Factor Auth" : "Sign in"}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {requires2FA ? "Enter the 6-digit code from your authenticator app" : "Welcome back to HostPanel"}
          </p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!requires2FA ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="admin@localhost"
                    required
                    className="flex h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="••••••••"
                      required
                      className="flex h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Authenticator Code</label>
                <input
                  type="text"
                  value={form.totpCode}
                  onChange={(e) => setForm({ ...form, totpCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  required
                  className="flex h-12 w-full rounded-lg border border-input bg-secondary/50 px-4 py-2 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {requires2FA ? "Verify" : "Sign in"}
            </button>

            {requires2FA && (
              <button
                type="button"
                onClick={() => { setRequires2FA(false); setForm({ ...form, totpCode: "" }); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground"
              >
                Back to login
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
