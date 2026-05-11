"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, Plus, Trash2, CheckCircle2, XCircle, AlertTriangle, Bell } from "lucide-react";
import { apiClient } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import type { UptimeCheck, AlertRule, SystemMetrics } from "@hostpanel/types";
import { MetricsChart } from "@/components/monitoring/metrics-chart";

type Tab = "overview" | "uptime" | "alerts";

export default function MonitoringPage() {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "System Metrics", icon: Activity },
    { id: "uptime", label: "Uptime Monitors", icon: CheckCircle2 },
    { id: "alerts", label: "Alert Rules", icon: Bell },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-xl font-semibold">Monitoring & Alerts</h2>
        <p className="text-sm text-muted-foreground">Real-time metrics, uptime checks, and alerting rules</p>
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

      {tab === "overview" && <MetricsOverview />}
      {tab === "uptime" && <UptimeTab />}
      {tab === "alerts" && <AlertsTab />}
    </div>
  );
}

function MetricsOverview() {
  const { data: currentData } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => apiClient.get<{ data: SystemMetrics }>("/monitoring/metrics"),
    refetchInterval: 5000,
  });

  const { data: historyData } = useQuery({
    queryKey: ["metrics-history"],
    queryFn: () => apiClient.get<{ data: SystemMetrics[] }>("/monitoring/metrics/history?minutes=120"),
    refetchInterval: 60000,
  });

  const metrics = currentData?.data;
  const history = historyData?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "CPU", value: metrics?.cpu ?? 0, color: metrics && metrics.cpu > 80 ? "#f87171" : "#6366f1", unit: "%" },
          { label: "Memory", value: metrics?.memory.percent ?? 0, color: metrics && metrics.memory.percent > 85 ? "#f87171" : "#8b5cf6", unit: "%" },
          { label: "Disk", value: metrics?.disk.percent ?? 0, color: metrics && metrics.disk.percent > 90 ? "#f87171" : "#06b6d4", unit: "%" },
          { label: "Load Avg", value: metrics?.loadAvg[0] ?? 0, color: "#10b981", unit: "" },
        ].map(({ label, value, color, unit }) => (
          <div key={label} className="rounded-xl border bg-card p-5 text-center">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-3xl font-bold" style={{ color }}>{value}{unit}</p>
            <div className="mt-3 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, typeof value === "number" ? value : 0)}%`, background: color }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricsChart data={history} metric="cpu" title="CPU Usage (%)" color="#6366f1" unit="%" />
        <MetricsChart data={history} metric="memory.percent" title="Memory Usage (%)" color="#8b5cf6" unit="%" />
        <MetricsChart data={history} metric="disk.percent" title="Disk Usage (%)" color="#06b6d4" unit="%" />
        <MetricsChart data={history} metric="network.rx" title="Network Inbound (KB/s)" color="#10b981" unit=" KB/s" />
      </div>
    </div>
  );
}

function UptimeTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", interval: 60, timeout: 10, enabled: true });

  const { data } = useQuery({
    queryKey: ["uptime"],
    queryFn: () => apiClient.get<{ data: UptimeCheck[] }>("/monitoring/uptime"),
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/monitoring/uptime", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["uptime"] }); setShowCreate(false); setForm({ name: "", url: "", interval: 60, timeout: 10, enabled: true }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/monitoring/uptime/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["uptime"] }),
  });

  const checks = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Add Monitor
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">New Uptime Monitor</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Website" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">URL</label>
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Check Interval (seconds)</label>
              <input type="number" value={form.interval} onChange={(e) => setForm({ ...form, interval: Number(e.target.value) })} min={30} max={3600} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Timeout (seconds)</label>
              <input type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: Number(e.target.value) })} min={1} max={30} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => createMutation.mutate(form)} disabled={!form.name || !form.url} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Create Monitor
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card divide-y divide-border overflow-hidden">
        {checks.length === 0 ? (
          <div className="p-12 text-center">
            <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No uptime monitors configured</p>
          </div>
        ) : checks.map((check) => (
          <div key={check.id} className="flex items-center justify-between p-5">
            <div className="flex items-center gap-3 min-w-0">
              {check.lastStatus === "up"
                ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                : check.lastStatus === "down"
                ? <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                : <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0" />
              }
              <div className="min-w-0">
                <p className="font-medium text-sm">{check.name}</p>
                <p className="text-xs text-muted-foreground truncate">{check.url}</p>
              </div>
            </div>
            <div className="flex items-center gap-6 shrink-0 ml-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium">{check.lastResponseMs ? `${check.lastResponseMs}ms` : "—"}</p>
                <p className="text-xs text-muted-foreground">Response</p>
              </div>
              <div className="text-right hidden md:block">
                <p className="text-xs text-muted-foreground">{formatRelative(check.lastCheckedAt)}</p>
                <p className="text-xs text-muted-foreground">Every {check.interval}s</p>
              </div>
              <span className={`text-xs font-semibold capitalize ${check.lastStatus === "up" ? "text-emerald-400" : check.lastStatus === "down" ? "text-red-400" : "text-muted-foreground"}`}>
                {check.lastStatus}
              </span>
              <button onClick={() => { if (confirm(`Delete monitor "${check.name}"?`)) deleteMutation.mutate(check.id); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertsTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", metric: "cpu" as string, threshold: 80, operator: "gt" as string, windowMinutes: 5, notifyVia: ["webhook"] as string[], enabled: true });

  const { data } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => apiClient.get<{ data: AlertRule[] }>("/monitoring/alerts"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/monitoring/alerts", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["alerts"] }); setShowCreate(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/monitoring/alerts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const rules = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Add Alert Rule
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">New Alert Rule</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium">Rule Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="High CPU Usage" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Metric</label>
              <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="cpu">CPU %</option>
                <option value="memory">Memory %</option>
                <option value="disk">Disk %</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Operator</label>
              <select value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="gt">&gt; Greater than</option>
                <option value="gte">&gt;= Greater or equal</option>
                <option value="lt">&lt; Less than</option>
                <option value="lte">&lt;= Less or equal</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Threshold (%)</label>
              <input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} min={0} max={100} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Window (minutes)</label>
              <input type="number" value={form.windowMinutes} onChange={(e) => setForm({ ...form, windowMinutes: Number(e.target.value) })} min={1} max={60} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => createMutation.mutate(form)} disabled={!form.name} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Create Rule
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card divide-y divide-border overflow-hidden">
        {rules.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No alert rules configured</p>
          </div>
        ) : rules.map((rule) => (
          <div key={rule.id} className="flex items-center justify-between p-5">
            <div>
              <p className="font-medium text-sm">{rule.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Alert when <span className="text-foreground font-medium">{rule.metric}</span> is{" "}
                <span className="text-foreground font-medium">{rule.operator} {rule.threshold}%</span>{" "}
                for {rule.windowMinutes} min
              </p>
              {rule.lastTriggeredAt && (
                <p className="text-xs text-amber-400 mt-0.5">Last triggered {formatRelative(rule.lastTriggeredAt)}</p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-xs font-medium ${rule.enabled ? "text-emerald-400" : "text-muted-foreground"}`}>
                {rule.enabled ? "Active" : "Disabled"}
              </span>
              <button onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteMutation.mutate(rule.id); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
