"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { User, Shield, Key, Loader2, Check, Fingerprint, Trash2, Pencil, X } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [tab, setTab] = useState<"profile" | "security" | "2fa" | "passkeys">("profile");

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: User },
    { id: "security" as const, label: "Password", icon: Key },
    { id: "2fa" as const, label: "2FA", icon: Shield },
    { id: "passkeys" as const, label: "Passkeys", icon: Fingerprint },
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

      {tab === "profile" && <ProfileForm user={user} onRefresh={refreshUser} />}

      {tab === "security" && <ChangePasswordForm />}
      {tab === "2fa" && <TwoFactorSetup user={user} onRefresh={refreshUser} />}
      {tab === "passkeys" && <PasskeysPanel />}
    </div>
  );
}

function ProfileForm({ user, onRefresh }: { user: { name?: string | null; email?: string; role?: string; twoFactorEnabled?: boolean; dockerAccess?: boolean } | null; onRefresh: () => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: { name?: string; email?: string }) => apiClient.patch("/auth/profile", payload),
    onSuccess: () => {
      onRefresh();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  const isDirty = name.trim() !== (user?.name ?? "") || email.trim() !== (user?.email ?? "");

  function handleSave() {
    const payload: { name?: string; email?: string } = {};
    if (name.trim() !== (user?.name ?? "")) payload.name = name.trim();
    if (email.trim() !== (user?.email ?? "")) payload.email = email.trim();
    mutation.mutate(payload);
  }

  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <h3 className="font-semibold">Account Information</h3>

      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          <Check className="w-4 h-4" /> Profile updated
        </div>
      )}
      {mutation.isError && (
        <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          {(mutation.error as Error).message}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Display name <span className="text-muted-foreground font-normal">(used for login)</span></label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Email <span className="text-muted-foreground font-normal">(used for login)</span></label>
        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Role</label>
        <p className="text-sm font-medium capitalize">{user?.role}</p>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Docker access</label>
        <p className="text-sm font-medium">
          {user?.role === "superadmin" || user?.role === "admin"
            ? "Full access (staff)"
            : user?.dockerAccess
              ? "Enabled — you can use the Docker page"
              : "Disabled — ask an administrator to enable it for your account"}
        </p>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">2FA Status</label>
        <p className={`text-sm font-medium ${user?.twoFactorEnabled ? "text-emerald-400" : "text-muted-foreground"}`}>
          {user?.twoFactorEnabled ? "Enabled" : "Not enabled"}
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={!isDirty || mutation.isPending}
        className="h-9 px-4 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
      >
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Save changes
      </button>
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

interface PasskeyRow {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

function PasskeysPanel() {
  const qc = useQueryClient();
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState("");
  const [regSuccess, setRegSuccess] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const { data } = useQuery<{ data: PasskeyRow[] }>({
    queryKey: ["passkeys"],
    queryFn: () => apiClient.get("/auth/passkey/credentials"),
  });

  const passkeys = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/auth/passkey/credentials/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiClient.patch(`/auth/passkey/credentials/${id}`, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["passkeys"] }); setEditingId(null); },
  });

  async function handleRegister() {
    setRegError("");
    setRegistering(true);
    try {
      const optRes = await apiClient.get<{ data: Record<string, unknown> }>("/auth/passkey/register/options");
      const options = optRes.data;
      const credential = await startRegistration({ optionsJSON: options as any });
      await apiClient.post("/auth/passkey/register/verify", {
        ...credential,
        passkeyName: passkeyName.trim() || "Passkey",
      });
      setRegSuccess(true);
      setPasskeyName("");
      qc.invalidateQueries({ queryKey: ["passkeys"] });
      setTimeout(() => setRegSuccess(false), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      if (!msg.toLowerCase().includes("cancelled") && !msg.toLowerCase().includes("aborted")) {
        setRegError(msg);
      }
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Register new passkey */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
            <Fingerprint className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Passkeys</h3>
            <p className="text-sm text-muted-foreground">Sign in with Face ID, Touch ID, or a hardware key — no password needed</p>
          </div>
        </div>

        {regSuccess && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
            <Check className="w-4 h-4" /> Passkey registered successfully
          </div>
        )}
        {regError && (
          <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">{regError}</div>
        )}

        <div className="flex gap-2 items-end">
          <div className="space-y-1.5 flex-1">
            <label className="text-sm font-medium">Passkey name <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input
              type="text"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              placeholder="e.g. MacBook Touch ID"
              className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            onClick={handleRegister}
            disabled={registering}
            className="h-9 px-4 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors shrink-0"
          >
            {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
            Add passkey
          </button>
        </div>
      </div>

      {/* Existing passkeys */}
      {passkeys.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b bg-secondary/30">
            <p className="text-sm font-medium">Registered passkeys</p>
          </div>
          <ul className="divide-y divide-border">
            {passkeys.map((pk) => (
              <li key={pk.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                  <Fingerprint className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  {editingId === pk.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameMutation.mutate({ id: pk.id, name: editName });
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="flex h-7 rounded-md border border-input bg-secondary/50 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-48"
                      />
                      <button onClick={() => renameMutation.mutate({ id: pk.id, name: editName })} className="text-primary hover:text-primary/80">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm font-medium truncate">{pk.name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {pk.deviceType === "multiDevice" ? "Synced" : "Single-device"}{pk.backedUp ? " · backed up" : ""}
                    {" · "}Added {new Date(pk.createdAt).toLocaleDateString()}
                    {pk.lastUsedAt ? ` · Last used ${new Date(pk.lastUsedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => { setEditingId(pk.id); setEditName(pk.name); }}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { if (confirm(`Remove passkey "${pk.name}"?`)) deleteMutation.mutate(pk.id); }}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
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
