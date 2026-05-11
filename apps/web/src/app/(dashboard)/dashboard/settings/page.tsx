"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { User, Shield, Key, Loader2, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [tab, setTab] = useState<"profile" | "security" | "2fa">("profile");

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: User },
    { id: "security" as const, label: "Password", icon: Key },
    { id: "2fa" as const, label: "2FA Setup", icon: Shield },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your account and security preferences</p>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <h3 className="font-semibold">Account Information</h3>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <p className="text-sm font-medium">{user?.email}</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Role</label>
            <p className="text-sm font-medium capitalize">{user?.role}</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">2FA Status</label>
            <p className={`text-sm font-medium ${user?.twoFactorEnabled ? "text-emerald-400" : "text-muted-foreground"}`}>
              {user?.twoFactorEnabled ? "Enabled" : "Not enabled"}
            </p>
          </div>
        </div>
      )}

      {tab === "security" && <ChangePasswordForm />}
      {tab === "2fa" && <TwoFactorSetup user={user} onRefresh={refreshUser} />}
    </div>
  );
}

function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) =>
      apiClient.post("/auth/change-password", payload),
    onSuccess: () => { setSuccess(true); setForm({ currentPassword: "", newPassword: "", confirmPassword: "" }); setTimeout(() => setSuccess(false), 3000); },
  });

  const canSubmit = form.currentPassword && form.newPassword.length >= 8 && form.newPassword === form.confirmPassword;

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <h3 className="font-semibold">Change Password</h3>
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          <Check className="w-4 h-4" /> Password changed successfully
        </div>
      )}
      {mutation.isError && (
        <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          {(mutation.error as Error).message}
        </div>
      )}
      {(["currentPassword", "newPassword", "confirmPassword"] as const).map((field) => (
        <div key={field} className="space-y-1.5">
          <label className="text-sm font-medium capitalize">{field.replace(/([A-Z])/g, " $1").trim()}</label>
          <input
            type="password"
            value={form[field]}
            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      ))}
      <button
        onClick={() => mutation.mutate({ currentPassword: form.currentPassword, newPassword: form.newPassword })}
        disabled={!canSubmit || mutation.isPending}
        className="w-full h-9 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
      >
        {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Change Password
      </button>
    </div>
  );
}

function TwoFactorSetup({ user, onRefresh }: { user: { twoFactorEnabled?: boolean } | null; onRefresh: () => void }) {
  const [qrData, setQrData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  const setupMutation = useMutation({
    mutationFn: () => apiClient.post<{ data: { qrDataUrl: string; secret: string } }>("/auth/2fa/setup"),
    onSuccess: (res) => setQrData(res.data),
  });

  const verifyMutation = useMutation({
    mutationFn: (code: string) => apiClient.post("/auth/2fa/verify", { code }),
    onSuccess: () => { onRefresh(); setQrData(null); setCode(""); },
  });

  const disableMutation = useMutation({
    mutationFn: () => apiClient.delete("/auth/2fa"),
    onSuccess: () => onRefresh(),
  });

  if (user?.twoFactorEnabled) {
    return (
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold">2FA is Active</h3>
            <p className="text-sm text-muted-foreground">Your account is protected with TOTP authentication</p>
          </div>
        </div>
        <button
          onClick={() => { if (confirm("Disable 2FA? This will reduce your account security.")) disableMutation.mutate(); }}
          disabled={disableMutation.isPending}
          className="px-4 py-2 text-sm border border-destructive/30 text-destructive rounded-md hover:bg-destructive/10 transition-colors"
        >
          Disable 2FA
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <h3 className="font-semibold">Set Up Two-Factor Authentication</h3>
      <p className="text-sm text-muted-foreground">Add an extra layer of security by enabling TOTP-based 2FA.</p>

      {!qrData ? (
        <button
          onClick={() => setupMutation.mutate()}
          disabled={setupMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {setupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          Enable 2FA
        </button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-3 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrData.qrDataUrl} alt="QR Code" className="w-48 h-48" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Or enter manually:</label>
            <code className="block text-xs font-mono bg-secondary/50 px-3 py-2 rounded-md border break-all">{qrData.secret}</code>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Enter verification code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              className="flex h-10 w-40 rounded-md border border-input bg-secondary/50 px-3 text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {verifyMutation.isError && <p className="text-sm text-destructive">{(verifyMutation.error as Error).message}</p>}
          <button
            onClick={() => verifyMutation.mutate(code)}
            disabled={code.length !== 6 || verifyMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {verifyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Verify & Enable
          </button>
        </div>
      )}
    </div>
  );
}
