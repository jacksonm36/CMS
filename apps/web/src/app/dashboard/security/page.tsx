"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Lock, FileText, Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw, AlertTriangle, Upload, Zap, ClipboardPaste, Info, CheckCircle2, XCircle } from "lucide-react";
import { apiClient } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/utils";
import type { FirewallRule, BlockedIp, AuditLog, SslCert, PaginatedResponse } from "@hostpanel/types";

type Tab = "ssl" | "firewall" | "blocked-ips" | "audit";

export default function SecurityPage() {
  const [tab, setTab] = useState<Tab>("ssl");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "ssl", label: "SSL Certificates", icon: Lock },
    { id: "firewall", label: "Firewall", icon: Shield },
    { id: "blocked-ips", label: "Blocked IPs", icon: AlertTriangle },
    { id: "audit", label: "Audit Log", icon: FileText },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-xl font-semibold">Security Center</h2>
        <p className="text-sm text-muted-foreground">Manage SSL, firewall rules, IP blocklist, and audit logs</p>
      </div>

      {/* Tab bar */}
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

      {tab === "ssl" && <SslTab />}
      {tab === "firewall" && <FirewallTab />}
      {tab === "blocked-ips" && <BlockedIpsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function SslTab() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"list" | "auto" | "import">("list");
  const [autoForm, setAutoForm] = useState({ siteId: "", domain: "" });
  const [importForm, setImportForm] = useState({ domain: "", siteId: "", certPem: "", keyPem: "", chainPem: "" });
  const [importResult, setImportResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);

  const { data: sitesData } = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiClient.get<{ data: { id: string; domain: string; name: string }[] }>("/sites"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["ssl-certs"],
    queryFn: () => apiClient.get<{ data: SslCert[] }>("/security/ssl"),
  });

  const issueMutation = useMutation({
    mutationFn: (payload: { siteId?: string; domain?: string }) => apiClient.post("/security/ssl/issue", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ssl-certs"] }); setMode("list"); },
  });

  const renewMutation = useMutation({
    mutationFn: (certId: string) => apiClient.post(`/security/ssl/${certId}/renew`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ssl-certs"] }),
  });

  const revokeMutation = useMutation({
    mutationFn: (certId: string) => apiClient.delete(`/security/ssl/${certId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ssl-certs"] }),
  });

  const toggleRenewMutation = useMutation({
    mutationFn: ({ id, autoRenew }: { id: string; autoRenew: boolean }) =>
      apiClient.patch(`/security/ssl/${id}`, { autoRenew }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ssl-certs"] }),
  });

  const importMutation = useMutation({
    mutationFn: (payload: typeof importForm) => apiClient.post("/security/ssl/import", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ssl-certs"] });
      setImportResult({ ok: true, message: "Certificate imported successfully" });
      setTimeout(() => setMode("list"), 2000);
    },
    onError: (err) => setImportResult({ ok: false, error: (err as Error).message }),
  });

  const certs = data?.data ?? [];
  const sites = sitesData?.data ?? [];
  const now = new Date();

  if (mode === "auto") return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => setMode("list")} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
        <h3 className="font-semibold">Issue {"Let's Encrypt"} Certificate</h3>
      </div>
      <div className="rounded-xl border bg-card p-6 space-y-5 max-w-lg">
        <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 text-xs text-blue-300">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Make sure your domain{"'"}s DNS A record points to this server{"'"}s IP. The ACME HTTP-01 challenge requires port 80 to be accessible from the internet.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Site</label>
            <select value={autoForm.siteId} onChange={(e) => {
              const site = sites.find(s => s.id === e.target.value);
              setAutoForm({ siteId: e.target.value, domain: site?.domain ?? autoForm.domain });
            }} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">Select a site (or enter domain manually)</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.domain}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Domain</label>
            <input value={autoForm.domain} onChange={(e) => setAutoForm({ ...autoForm, domain: e.target.value })} placeholder="example.com" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => setMode("list")} className="flex-1 h-9 rounded-md border border-input text-sm hover:bg-accent">Cancel</button>
          <button
            onClick={() => issueMutation.mutate(autoForm)}
            disabled={issueMutation.isPending || (!autoForm.siteId && !autoForm.domain)}
            className="flex-1 h-9 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {issueMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Issuing...</> : <><Zap className="w-3.5 h-3.5" /> Issue Certificate</>}
          </button>
        </div>
        {issueMutation.isError && <p className="text-xs text-destructive">{(issueMutation.error as Error).message}</p>}
      </div>
    </div>
  );

  if (mode === "import") return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => { setMode("list"); setImportResult(null); }} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
        <h3 className="font-semibold">Import Certificate Manually</h3>
      </div>
      <div className="rounded-xl border bg-card p-6 space-y-5 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Domain</label>
            <input value={importForm.domain} onChange={(e) => setImportForm({ ...importForm, domain: e.target.value })} placeholder="example.com" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Link to Site (optional)</label>
            <select value={importForm.siteId} onChange={(e) => setImportForm({ ...importForm, siteId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">No site (standalone cert)</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.domain}</option>)}
            </select>
          </div>
        </div>

        {[
          { key: "certPem", label: "Certificate (PEM)", placeholder: "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----" },
          { key: "keyPem", label: "Private Key (PEM)", placeholder: "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----" },
          { key: "chainPem", label: "Certificate Chain / CA Bundle (PEM, optional)", placeholder: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----" },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1.5">
            <label className="text-sm font-medium">{label}</label>
            <textarea
              value={(importForm as Record<string, string>)[key]}
              onChange={(e) => setImportForm({ ...importForm, [key]: e.target.value })}
              placeholder={placeholder}
              rows={key === "chainPem" ? 4 : 6}
              className="flex w-full rounded-md border border-input bg-secondary/20 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              spellCheck={false}
            />
          </div>
        ))}

        {importResult && (
          <div className={`flex items-center gap-2 text-sm rounded-lg p-3 ${importResult.ok ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-destructive/10 text-destructive border border-destructive/20"}`}>
            {importResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {importResult.message ?? importResult.error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => { setMode("list"); setImportResult(null); }} className="flex-1 h-9 rounded-md border border-input text-sm hover:bg-accent">Cancel</button>
          <button
            onClick={() => importMutation.mutate(importForm)}
            disabled={importMutation.isPending || !importForm.domain || !importForm.certPem || !importForm.keyPem}
            className="flex-1 h-9 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {importMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Importing...</> : <><Upload className="w-3.5 h-3.5" /> Import Certificate</>}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <h3 className="font-semibold">SSL Certificates</h3>
          <p className="text-sm text-muted-foreground">{"Let's Encrypt"} auto-issue or manual PEM import</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMode("import")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg hover:bg-accent transition-colors">
            <ClipboardPaste className="w-3.5 h-3.5" /> Paste / Import
          </button>
          <button onClick={() => setMode("auto")} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            <Zap className="w-3.5 h-3.5" /> Auto ({"Let's Encrypt"})
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
      ) : certs.length === 0 ? (
        <div className="p-12 text-center">
          <Lock className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm mb-4">No certificates yet</p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setMode("auto")} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90">
              <Zap className="w-3.5 h-3.5" /> {"Let's Encrypt"}
            </button>
            <button onClick={() => setMode("import")} className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-accent">
              <ClipboardPaste className="w-3.5 h-3.5" /> Import PEM
            </button>
          </div>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              {["Domain", "Provider", "Status", "Expires", "Auto-Renew", "Actions"].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {certs.map((cert) => {
              const expiresDays = cert.expiresAt
                ? Math.floor((new Date(cert.expiresAt).getTime() - now.getTime()) / 86400000)
                : null;
              const isManual = (cert as unknown as { provider?: string }).provider === "manual";
              return (
                <tr key={cert.id} className="hover:bg-muted/30 transition-colors group">
                  <td className="px-5 py-3 font-mono text-sm font-medium">{cert.domain}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${isManual ? "bg-violet-500/10 text-violet-400 border-violet-500/20" : "bg-sky-500/10 text-sky-400 border-sky-500/20"}`}>
                      {isManual ? "Manual" : "Let's Encrypt"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      cert.status === "valid" ? "bg-emerald-500/15 text-emerald-400" :
                      cert.status === "expiring" ? "bg-amber-500/15 text-amber-400" :
                      cert.status === "pending" ? "bg-blue-500/15 text-blue-400" :
                      "bg-red-500/15 text-red-400"
                    }`}>{cert.status}</span>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {cert.expiresAt ? (
                      <span className={expiresDays !== null && expiresDays < 30 ? "text-amber-400 font-medium" : "text-muted-foreground"}>
                        {formatDate(cert.expiresAt)}
                        {expiresDays !== null && <span className="ml-1 text-muted-foreground">({expiresDays}d)</span>}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleRenewMutation.mutate({ id: cert.id, autoRenew: !cert.autoRenew })} className={`text-xs ${cert.autoRenew ? "text-emerald-400 hover:text-emerald-300" : "text-muted-foreground hover:text-foreground"}`}>
                      {cert.autoRenew ? "Enabled" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      {!isManual && (
                        <button onClick={() => renewMutation.mutate(cert.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border hover:bg-accent">
                          <RefreshCw className="w-3 h-3" /> Renew
                        </button>
                      )}
                      <button onClick={() => { if (confirm(`Revoke and delete certificate for ${cert.domain}?`)) revokeMutation.mutate(cert.id); }} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-destructive/30 text-destructive hover:bg-destructive/10">
                        <Trash2 className="w-3 h-3" /> Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FirewallTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ direction: "inbound", protocol: "tcp", port: "", sourceIp: "", action: "allow", priority: 100, description: "" });

  const { data } = useQuery({
    queryKey: ["firewall-rules"],
    queryFn: () => apiClient.get<{ data: FirewallRule[] }>("/security/firewall"),
  });

  const addMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/security/firewall", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["firewall-rules"] }); setShowAdd(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/security/firewall/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["firewall-rules"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiClient.patch(`/security/firewall/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["firewall-rules"] }),
  });

  const rules = data?.data ?? [];

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <h3 className="font-semibold">Firewall Rules</h3>
          <p className="text-sm text-muted-foreground">iptables-based inbound/outbound rules</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Rule
        </button>
      </div>

      {showAdd && (
        <div className="p-5 border-b border-border bg-secondary/20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {["direction", "protocol", "action"].map((field) => (
              <div key={field} className="space-y-1">
                <label className="text-xs font-medium capitalize">{field}</label>
                <select
                  value={(form as Record<string, string | number>)[field] as string}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {field === "direction" && <><option value="inbound">Inbound</option><option value="outbound">Outbound</option></>}
                  {field === "protocol" && <><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option><option value="all">All</option></>}
                  {field === "action" && <><option value="allow">Allow</option><option value="deny">Deny</option></>}
                </select>
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium">Port</label>
              <input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="80, 443, 3000-3010" className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Source IP</label>
              <input value={form.sourceIp} onChange={(e) => setForm({ ...form, sourceIp: e.target.value })} placeholder="0.0.0.0/0" className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional note" className="w-full h-8 text-xs rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => addMutation.mutate(form)} disabled={addMutation.isPending} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {addMutation.isPending ? "Adding..." : "Add Rule"}
            </button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            {["Priority", "Direction", "Protocol", "Port", "Source", "Action", "Description", ""].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rules.map((rule) => (
            <tr key={rule.id} className={`hover:bg-muted/30 transition-colors ${!rule.enabled ? "opacity-50" : ""}`}>
              <td className="px-4 py-3 text-xs font-mono">{rule.priority}</td>
              <td className="px-4 py-3 text-xs capitalize">{rule.direction}</td>
              <td className="px-4 py-3 text-xs uppercase">{rule.protocol}</td>
              <td className="px-4 py-3 text-xs font-mono">{rule.port ?? "any"}</td>
              <td className="px-4 py-3 text-xs font-mono">{rule.sourceIp ?? "any"}</td>
              <td className="px-4 py-3">
                <span className={`text-xs font-semibold uppercase ${rule.action === "allow" ? "text-emerald-400" : "text-red-400"}`}>{rule.action}</span>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{rule.description}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })} className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground">
                    {rule.enabled ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteMutation.mutate(rule.id)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">No firewall rules configured</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BlockedIpsTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ip: "", reason: "Manually blocked", permanent: false });

  const { data } = useQuery({
    queryKey: ["blocked-ips"],
    queryFn: () => apiClient.get<{ data: BlockedIp[] }>("/security/blocked-ips"),
  });

  const addMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/security/blocked-ips", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["blocked-ips"] }); setShowAdd(false); },
  });

  const unblockMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/security/blocked-ips/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blocked-ips"] }),
  });

  const blockedIps = data?.data ?? [];

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div>
          <h3 className="font-semibold">Blocked IPs</h3>
          <p className="text-sm text-muted-foreground">Auto-blocked and manually blocked addresses</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-3 py-1.5 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors">
          <Plus className="w-4 h-4" /> Block IP
        </button>
      </div>

      {showAdd && (
        <div className="p-5 border-b border-border bg-secondary/20 flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium">IP Address</label>
            <input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="192.168.1.1" className="h-8 text-xs rounded-md border border-input bg-background px-2 w-40 focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Reason</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason" className="h-8 text-xs rounded-md border border-input bg-background px-2 w-48 focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="flex items-center gap-2 pb-0.5">
            <input type="checkbox" id="permanent" checked={form.permanent} onChange={(e) => setForm({ ...form, permanent: e.target.checked })} className="accent-primary" />
            <label htmlFor="permanent" className="text-xs">Permanent</label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => addMutation.mutate(form)} disabled={!form.ip} className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50 transition-colors">Block</button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            {["IP Address", "Reason", "Blocked", "Expires", "Type", ""].map((h) => (
              <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {blockedIps.map((ip) => (
            <tr key={ip.id} className="hover:bg-muted/30">
              <td className="px-5 py-3 font-mono text-sm">{ip.ip}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{ip.reason}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{formatRelative(ip.blockedAt)}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{ip.expiresAt ? formatDate(ip.expiresAt) : "Never"}</td>
              <td className="px-5 py-3">
                <span className={`text-xs font-medium ${ip.permanent ? "text-red-400" : "text-amber-400"}`}>
                  {ip.permanent ? "Permanent" : "Temporary"}
                </span>
              </td>
              <td className="px-5 py-3">
                <button onClick={() => unblockMutation.mutate(ip.id)} className="text-xs text-primary hover:underline">Unblock</button>
              </td>
            </tr>
          ))}
          {blockedIps.length === 0 && (
            <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">No blocked IPs</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ["audit-logs", page],
    queryFn: () => apiClient.get<{ data: PaginatedResponse<AuditLog> }>(`/security/audit-logs?page=${page}&pageSize=20`),
  });

  const result = data?.data;
  const logs = result?.data ?? [];

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold">Audit Log</h3>
        <p className="text-sm text-muted-foreground">All user actions and system mutations</p>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            {["Time", "User", "Action", "Resource", "IP", "Status"].map((h) => (
              <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {logs.map((log) => (
            <tr key={log.id} className="hover:bg-muted/30">
              <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(log.createdAt, "MMM d, HH:mm:ss")}</td>
              <td className="px-5 py-3 text-xs">{log.userEmail ?? "System"}</td>
              <td className="px-5 py-3 text-xs font-mono">{log.action}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{log.resourceType}{log.resourceId ? `/${log.resourceId.slice(0, 8)}` : ""}</td>
              <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{log.ip}</td>
              <td className="px-5 py-3">
                <span className={`text-xs ${(log.meta as { statusCode?: number })?.statusCode && (log.meta as { statusCode: number }).statusCode < 400 ? "text-emerald-400" : "text-red-400"}`}>
                  {(log.meta as { statusCode?: number })?.statusCode ?? "—"}
                </span>
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">No audit events</td></tr>
          )}
        </tbody>
      </table>
      {result && result.totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">Page {result.page} of {result.totalPages} ({result.total} events)</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 text-xs border rounded hover:bg-accent disabled:opacity-50 transition-colors">Previous</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page === result.totalPages} className="px-3 py-1 text-xs border rounded hover:bg-accent disabled:opacity-50 transition-colors">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
