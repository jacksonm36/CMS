"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert, ShieldCheck, ShieldOff, RefreshCw, Download,
  Trash2, Plus, Terminal, AlertTriangle, Activity, Package,
  ChevronDown, ChevronRight, Loader2, Ban,
} from "lucide-react";
import { apiClient } from "@/lib/api";

type Tab = "overview" | "alerts" | "decisions" | "hub" | "logs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrowdSecStatus {
  installed: boolean;
  running: boolean;
  lapiReachable: boolean;
  lapiVersion: string;
  bouncers: { name: string; ip_address: string; type: string; last_pull: string }[];
}

interface CsAlert {
  id: number;
  scenario: string;
  scenario_hash: string;
  events_count: number;
  created_at: string;
  source: { ip: string; range: string; as_name: string; cn: string };
  decisions?: { type: string; duration: string }[];
}

interface CsDecision {
  id: number;
  origin: string;
  type: string;
  scope: string;
  value: string;
  duration: string;
  scenario: string;
  simulated: boolean;
  created_at: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CrowdSecPage() {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview",  label: "Overview",   icon: ShieldAlert },
    { id: "alerts",    label: "Alerts",     icon: Activity },
    { id: "decisions", label: "Decisions",  icon: Ban },
    { id: "hub",       label: "Hub",        icon: Package },
    { id: "logs",      label: "Logs",       icon: Terminal },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold">CrowdSec</h2>
        <p className="text-sm text-muted-foreground">Collaborative threat intelligence — detect, ban, and share attack data across the network</p>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === "overview"  && <OverviewTab />}
      {tab === "alerts"    && <AlertsTab />}
      {tab === "decisions" && <DecisionsTab />}
      {tab === "hub"       && <HubTab />}
      {tab === "logs"      && <LogsTab />}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["cs-status"],
    queryFn: () => apiClient.get<{ data: CrowdSecStatus }>("/crowdsec/status"),
    refetchInterval: 15000,
  });

  const installMutation = useMutation({
    mutationFn: () => apiClient.post("/crowdsec/install", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cs-status"] }),
  });

  const addBouncerMutation = useMutation({
    mutationFn: (name: string) => apiClient.post("/crowdsec/bouncers", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cs-status"] }),
  });

  const removeBouncerMutation = useMutation({
    mutationFn: (name: string) => apiClient.delete(`/crowdsec/bouncers/${encodeURIComponent(name)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cs-status"] }),
  });

  const [newBouncer, setNewBouncer] = useState("");
  const status = data?.data;

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({length: 4}).map((_,i) => <div key={i} className="rounded-xl border bg-card p-5 h-24 animate-pulse" />)}</div>;

  if (!status?.installed) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-8 text-center">
        <ShieldOff className="w-12 h-12 text-amber-400 mx-auto mb-4" />
        <h3 className="font-semibold text-lg mb-2">CrowdSec Not Installed</h3>
        <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
          CrowdSec is a collaborative security engine. It reads your web server logs, detects attacks, and automatically shares threat data across its global network of ~600K+ users.
        </p>
        <button
          onClick={() => installMutation.mutate()}
          disabled={installMutation.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-400 disabled:opacity-50 transition-colors"
        >
          {installMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Install CrowdSec
        </button>
        {installMutation.isError && <p className="text-xs text-destructive mt-3">{(installMutation.error as Error).message}</p>}
        {installMutation.data != null ? (
          <pre className="text-xs text-muted-foreground mt-3 text-left bg-secondary/30 rounded p-3 max-h-40 overflow-auto">
            {String((installMutation.data as { output?: string }).output ?? "")}
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Agent", value: status.running ? "Running" : "Stopped", color: status.running ? "text-emerald-400" : "text-red-400", dot: status.running ? "bg-emerald-400 animate-pulse" : "bg-red-400" },
          { label: "LAPI",  value: status.lapiReachable ? "Reachable" : "Unreachable", color: status.lapiReachable ? "text-emerald-400" : "text-red-400", dot: status.lapiReachable ? "bg-emerald-400" : "bg-red-400" },
          { label: "Version", value: status.lapiVersion, color: "text-foreground", dot: "" },
          { label: "Bouncers", value: String(status.bouncers?.length ?? 0), color: "text-primary font-bold", dot: "" },
        ].map(({ label, value, color, dot }) => (
          <div key={label} className="rounded-xl border bg-card p-5">
            <p className="text-xs text-muted-foreground mb-2">{label}</p>
            <div className="flex items-center gap-2">
              {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
              <span className={`text-lg font-semibold ${color}`}>{value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Bouncers */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold">Bouncers</h3>
          <div className="flex items-center gap-2">
            <input value={newBouncer} onChange={(e) => setNewBouncer(e.target.value)} placeholder="bouncer-name" className="h-8 w-40 rounded-md border border-input bg-secondary/50 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
            <button onClick={() => { if (newBouncer) { addBouncerMutation.mutate(newBouncer); setNewBouncer(""); } }} disabled={!newBouncer || addBouncerMutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>

        {(status.bouncers?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <p className="mb-2">No bouncers registered.</p>
            <p className="text-xs">After installing a bouncer (e.g. <code className="font-mono">crowdsec-firewall-bouncer-iptables</code>), add its API key here.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>{["Name", "IP", "Type", "Last Pull", ""].map((h) => <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {status.bouncers.map((b) => (
                <tr key={b.name} className="hover:bg-muted/30 group">
                  <td className="px-5 py-3 font-mono text-sm font-medium">{b.name}</td>
                  <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{b.ip_address || "—"}</td>
                  <td className="px-5 py-3 text-xs">{b.type}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{b.last_pull ? new Date(b.last_pull).toLocaleString() : "Never"}</td>
                  <td className="px-5 py-3 opacity-0 group-hover:opacity-100">
                    <button onClick={() => removeBouncerMutation.mutate(b.name)} className="text-xs text-destructive hover:underline flex items-center gap-1"><Trash2 className="w-3 h-3" /> Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={() => queryClient.invalidateQueries({ queryKey: ["cs-status"] })} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
    </div>
  );
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

function AlertsTab() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cs-alerts"],
    queryFn: () => apiClient.get<{ data: CsAlert[] }>("/crowdsec/alerts?limit=100"),
    retry: 1,
  });

  const alerts = (data?.data ?? []).filter((a) =>
    !search || a.source?.ip?.includes(search) || a.scenario?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by IP or scenario..." className="h-8 w-64 rounded-md border border-input bg-secondary/50 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
        <span className="text-xs text-muted-foreground">{alerts.length} alert{alerts.length !== 1 ? "s" : ""}</span>
      </div>

      {error && <AlertWarning msg="CrowdSec LAPI not reachable. Make sure CrowdSec is installed and running." />}

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading alerts...</div> : alerts.length === 0 ? (
          <div className="p-8 text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-400/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{search ? "No matching alerts" : "No alerts — all clear!"}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map((alert) => (
              <div key={alert.id}>
                <button
                  onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
                  className="w-full flex items-center gap-4 px-5 py-3 hover:bg-muted/30 text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-4 h-4 text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium font-mono truncate">{alert.scenario}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="text-amber-400 font-mono">{alert.source?.ip}</span>
                      {alert.source?.cn && ` · ${alert.source.cn}`}
                      {alert.source?.as_name && ` · ${alert.source.as_name}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-red-400">{alert.events_count} event{alert.events_count !== 1 ? "s" : ""}</p>
                    <p className="text-xs text-muted-foreground">{new Date(alert.created_at).toLocaleString()}</p>
                  </div>
                  {expanded === alert.id ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>
                {expanded === alert.id && (
                  <div className="px-5 pb-4 bg-secondary/10">
                    <pre className="text-xs font-mono text-muted-foreground bg-secondary/30 rounded-lg p-3 overflow-auto">{JSON.stringify(alert, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Decisions ────────────────────────────────────────────────────────────────

function DecisionsTab() {
  const queryClient = useQueryClient();
  const [showBan, setShowBan] = useState(false);
  const [banForm, setBanForm] = useState({ ip: "", duration: "4h", reason: "Manual ban", type: "ban" as "ban" | "captcha" });
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["cs-decisions"],
    queryFn: () => apiClient.get<{ data: CsDecision[] }>("/crowdsec/decisions"),
    refetchInterval: 20000,
    retry: 1,
  });

  const banMutation = useMutation({
    mutationFn: (form: typeof banForm) => apiClient.post("/crowdsec/decisions", form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["cs-decisions"] }); setShowBan(false); },
  });

  const unbanIpMutation = useMutation({
    mutationFn: (ip: string) => apiClient.delete(`/crowdsec/decisions?ip=${encodeURIComponent(ip)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cs-decisions"] }),
  });

  const decisions = (data?.data ?? []).filter((d) =>
    !search || d.value?.includes(search) || d.scenario?.toLowerCase().includes(search.toLowerCase())
  );

  const banCount = decisions.filter((d) => d.type === "ban").length;
  const captchaCount = decisions.filter((d) => d.type === "captcha").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by IP or scenario..." className="h-8 w-64 rounded-md border border-input bg-secondary/50 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
          <span className="text-xs text-muted-foreground">{banCount} ban{banCount !== 1 ? "s" : ""} · {captchaCount} captcha{captchaCount !== 1 ? "s" : ""}</span>
        </div>
        <button onClick={() => setShowBan(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors">
          <Ban className="w-3.5 h-3.5" /> Manual Ban
        </button>
      </div>

      {showBan && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h4 className="font-semibold text-sm">Add Manual Decision</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: "ip", label: "IP / Range", placeholder: "1.2.3.4 or 1.2.3.0/24" },
              { key: "duration", label: "Duration", placeholder: "4h, 1d, 1w" },
              { key: "reason", label: "Reason", placeholder: "Manual ban" },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium">{label}</label>
                <input value={(banForm as Record<string, string>)[key]} onChange={(e) => setBanForm({ ...banForm, [key]: e.target.value })} placeholder={placeholder} className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium">Type</label>
              <select value={banForm.type} onChange={(e) => setBanForm({ ...banForm, type: e.target.value as "ban" | "captcha" })} className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="ban">Ban</option>
                <option value="captcha">Captcha</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => banMutation.mutate(banForm)} disabled={!banForm.ip || banMutation.isPending} className="px-4 py-1.5 text-sm bg-red-500 text-white rounded-md hover:bg-red-400 disabled:opacity-50">
              {banMutation.isPending ? "Adding..." : "Add Decision"}
            </button>
            <button onClick={() => setShowBan(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent">Cancel</button>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading decisions...</div>
          : decisions.length === 0 ? (
          <div className="p-8 text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-400/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No active decisions</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>{["IP / Value", "Type", "Duration", "Origin", "Scenario", ""].map((h) => <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {decisions.map((d) => (
                <tr key={d.id} className="hover:bg-muted/30 group">
                  <td className="px-5 py-3 font-mono font-semibold text-sm">{d.value}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.type === "ban" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"}`}>{d.type}</span>
                  </td>
                  <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{d.duration}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{d.origin}</td>
                  <td className="px-5 py-3 text-xs font-mono max-w-[200px] truncate text-muted-foreground">{d.scenario}</td>
                  <td className="px-5 py-3 opacity-0 group-hover:opacity-100">
                    <button onClick={() => { if (confirm(`Remove ban for ${d.value}?`)) unbanIpMutation.mutate(d.value); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Hub ──────────────────────────────────────────────────────────────────────

function HubTab() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"collections" | "parsers" | "scenarios">("collections");

  const { data, isLoading } = useQuery({
    queryKey: ["cs-hub"],
    queryFn: () => apiClient.get<{ data: Record<string, unknown[]> }>("/crowdsec/hub"),
  });

  const updateMutation = useMutation({
    mutationFn: () => apiClient.post("/crowdsec/hub/update", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cs-hub"] }),
  });

  const items = (data?.data?.[section] as unknown[] ?? []) as { name: string; status: string; local_version?: string; local_path?: string; description?: string; author?: string }[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
          {(["collections", "parsers", "scenarios"] as const).map((s) => (
            <button key={s} onClick={() => setSection(s)} className={`px-3 py-1.5 text-xs rounded-md font-medium capitalize transition-all ${section === s ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}>
              {s} {data?.data?.[s] ? `(${(data.data[s] as unknown[]).length})` : ""}
            </button>
          ))}
        </div>
        <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="flex items-center gap-1.5 text-xs border rounded-lg px-3 py-1.5 hover:bg-accent transition-colors disabled:opacity-50">
          {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Update Hub
        </button>
      </div>

      {updateMutation.data != null ? (
        <div className="text-xs bg-secondary/30 rounded-lg p-3 font-mono whitespace-pre-wrap">
          {String((updateMutation.data as { data?: { output?: string } }).data?.output ?? "")}
        </div>
      ) : null}

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading hub data...</div> : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No {section} found. Make sure CrowdSec is installed.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>{["Name", "Status", "Version", "Author", "Description"].map((h) => <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.name} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-mono text-xs font-medium">{item.name}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${item.status === "enabled" ? "bg-emerald-500/15 text-emerald-400" : "bg-secondary text-muted-foreground"}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{item.local_version ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{item.author ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground truncate max-w-[300px]">{item.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function LogsTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["cs-logs"],
    queryFn: () => apiClient.get<{ data: { lines: string[] } }>("/crowdsec/logs?lines=200"),
    refetchInterval: 10000,
  });

  const lines = data?.data?.lines ?? [];

  return (
    <div className="rounded-xl border bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-border">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">CrowdSec Agent Logs</span>
        </div>
        <button onClick={() => refetch()} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      <div className="p-4 max-h-[600px] overflow-auto">
        {isLoading ? <p className="text-xs text-muted-foreground">Loading...</p>
          : lines.map((line, i) => (
          <div key={i} className={`text-xs font-mono py-0.5 ${
            line.includes("level=error") || line.includes("ERR") ? "text-red-400" :
            line.includes("level=warn")  || line.includes("WARN") ? "text-amber-400" :
            line.includes("level=info")  ? "text-[#94a3b8]" :
            "text-[#64748b]"
          }`}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function AlertWarning({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-300">{msg}</p>
    </div>
  );
}
