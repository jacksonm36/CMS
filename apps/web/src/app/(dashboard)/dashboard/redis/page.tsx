"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database, Search, Trash2, RefreshCw, AlertTriangle, Plus, Terminal,
  Clock, HardDrive, Activity, Server,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import type { RedisInfo, RedisKeyEntry, RedisKeyValue, RedisKeyspaceStat, RedisCommandResult } from "@hostpanel/types";

type Tab = "overview" | "keys" | "cli";

export default function RedisPage() {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Server },
    { id: "keys", label: "Key Browser", icon: Search },
    { id: "cli", label: "CLI", icon: Terminal },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-xl font-semibold">Redis Management</h2>
        <p className="text-sm text-muted-foreground">Monitor memory, browse keys, run commands</p>
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

      {tab === "overview" && <OverviewTab />}
      {tab === "keys" && <KeyBrowserTab />}
      {tab === "cli" && <CliTab />}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab() {
  const queryClient = useQueryClient();

  const { data: infoData, isLoading, error } = useQuery({
    queryKey: ["redis-info"],
    queryFn: () => apiClient.get<{ data: RedisInfo }>("/redis/info"),
    refetchInterval: 10000,
    retry: 1,
  });

  const { data: keyspaceData } = useQuery({
    queryKey: ["redis-keyspace"],
    queryFn: () => apiClient.get<{ data: RedisKeyspaceStat[] }>("/redis/keyspace"),
    refetchInterval: 10000,
  });

  const flushMutation = useMutation({
    mutationFn: (db: number) => apiClient.post("/redis/flush", { db, confirm: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["redis-info", "redis-keyspace"] }),
  });

  const info = infoData?.data;
  const keyspace = keyspaceData?.data ?? [];
  const server = info?.server ?? {};
  const mem = info?.memory ?? {};
  const clients = info?.clients ?? {};
  const stats = info?.stats ?? {};

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-destructive text-sm">Could not connect to Redis</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ["redis-info"] })} className="mt-2 text-xs text-primary hover:underline flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const usedMemBytes = Number(mem.used_memory ?? 0);
  const maxMemBytes = Number(mem.maxmemory ?? 0) || Number(mem.total_system_memory ?? 1);
  const memPercent = Math.min(100, Math.round((usedMemBytes / maxMemBytes) * 100));

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Redis Version", value: server.redis_version ?? "—", icon: Server, color: "text-primary" },
          { label: "Connected Clients", value: clients.connected_clients ?? "—", icon: Activity, color: "text-emerald-400" },
          { label: "Used Memory", value: mem.used_memory_human ?? "—", icon: HardDrive, color: "text-violet-400" },
          { label: "Uptime", value: formatUptime(Number(server.uptime_in_seconds ?? 0)), icon: Clock, color: "text-amber-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border bg-card p-5 flex items-start gap-4">
            <div className={`mt-0.5 ${color}`}><Icon className="w-5 h-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              {isLoading ? <div className="h-6 w-20 bg-muted animate-pulse rounded mt-1" /> : <p className="text-xl font-bold font-mono">{value}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Memory bar */}
      {!isLoading && mem.used_memory && (
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Memory Usage</h3>
            <span className={`text-sm font-bold ${memPercent > 80 ? "text-red-400" : "text-emerald-400"}`}>{memPercent}%</span>
          </div>
          <div className="h-3 bg-secondary rounded-full overflow-hidden mb-3">
            <div className={`h-full rounded-full transition-all ${memPercent > 80 ? "bg-red-400" : memPercent > 60 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${memPercent}%` }} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {[
              { label: "Used Memory", value: mem.used_memory_human },
              { label: "Peak Memory", value: mem.used_memory_peak_human },
              { label: "RSS Memory", value: mem.used_memory_rss_human },
              { label: "Fragmentation Ratio", value: `${Number(mem.mem_fragmentation_ratio ?? 0).toFixed(2)}x` },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-muted-foreground">{label}</p>
                <p className="font-mono font-medium mt-0.5">{value ?? "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Server info grid */}
      {!isLoading && Object.keys(server).length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold text-sm mb-4">Server Information</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2">
            {[
              ["Redis Mode", server.redis_mode],
              ["OS", server.os],
              ["Architecture", server.arch_bits ? `${server.arch_bits}-bit` : undefined],
              ["TCP Port", server.tcp_port],
              ["Config File", server.config_file || "(default)"],
              ["Executable", server.executable],
              ["Total Commands Processed", Number(stats.total_commands_processed ?? 0).toLocaleString()],
              ["Total Connections Received", Number(stats.total_connections_received ?? 0).toLocaleString()],
              ["Rejected Connections", stats.rejected_connections],
              ["Keyspace Hits", Number(stats.keyspace_hits ?? 0).toLocaleString()],
              ["Keyspace Misses", Number(stats.keyspace_misses ?? 0).toLocaleString()],
              ["Hit Rate", (() => { const h = Number(stats.keyspace_hits ?? 0); const m = Number(stats.keyspace_misses ?? 0); return h + m > 0 ? `${((h / (h + m)) * 100).toFixed(1)}%` : "—"; })()],
            ].filter(([, v]) => v !== undefined).map(([label, value]) => (
              <div key={label as string} className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground min-w-0 shrink-0">{label}:</span>
                <span className="text-xs font-mono break-all">{value as string}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keyspace */}
      {keyspace.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-sm">Keyspace</h3>
            <button onClick={() => { if (confirm("Flush the selected DB? All keys will be deleted!")) flushMutation.mutate(0); }} disabled={flushMutation.isPending} className="flex items-center gap-1.5 text-xs text-destructive border border-destructive/30 rounded-md px-2 py-1 hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 className="w-3 h-3" /> Flush DB 0
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                {["Database", "Keys", "Keys with TTL", "Avg TTL (ms)"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keyspace.map((ks) => (
                <tr key={ks.db} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-mono font-medium">{ks.db}</td>
                  <td className="px-5 py-3 font-semibold text-primary">{ks.keys.toLocaleString()}</td>
                  <td className="px-5 py-3 text-muted-foreground">{ks.expires.toLocaleString()}</td>
                  <td className="px-5 py-3 font-mono text-xs">{ks.avgTtl.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Key Browser ──────────────────────────────────────────────────────────────

function KeyBrowserTab() {
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState("*");
  const [inputPattern, setInputPattern] = useState("*");
  const [cursor, setCursor] = useState("0");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState({ key: "", value: "", ttl: "" });

  const { data: keysData, isLoading: loadingKeys } = useQuery({
    queryKey: ["redis-keys", pattern, cursor],
    queryFn: () => apiClient.get<{ data: { keys: RedisKeyEntry[]; nextCursor: string; pattern: string } }>(`/redis/keys?pattern=${encodeURIComponent(pattern)}&cursor=${cursor}&count=100`),
  });

  const { data: valueData, isLoading: loadingValue } = useQuery({
    queryKey: ["redis-key-value", selectedKey],
    queryFn: () => apiClient.get<{ data: RedisKeyValue }>(`/redis/keys/${encodeURIComponent(selectedKey!)}`),
    enabled: !!selectedKey,
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => apiClient.delete(`/redis/keys/${encodeURIComponent(key)}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["redis-keys"] }); setSelectedKey(null); },
  });

  const ttlMutation = useMutation({
    mutationFn: ({ key, ttl }: { key: string; ttl: number }) =>
      apiClient.patch(`/redis/keys/${encodeURIComponent(key)}/ttl`, { ttl }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["redis-key-value", selectedKey] }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof newKey) => apiClient.post("/redis/keys", {
      key: payload.key,
      value: payload.value,
      ttl: payload.ttl ? Number(payload.ttl) : undefined,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["redis-keys"] }); setShowCreate(false); setNewKey({ key: "", value: "", ttl: "" }); },
  });

  const keys = keysData?.data?.keys ?? [];
  const nextCursor = keysData?.data?.nextCursor ?? "0";
  const value = valueData?.data;

  const typeColor: Record<string, string> = {
    string: "bg-blue-500/15 text-blue-400",
    hash: "bg-violet-500/15 text-violet-400",
    list: "bg-amber-500/15 text-amber-400",
    set: "bg-emerald-500/15 text-emerald-400",
    zset: "bg-pink-500/15 text-pink-400",
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-20rem)] min-h-[500px]">
      {/* Left: key list */}
      <div className="w-80 rounded-xl border bg-card flex flex-col shrink-0 overflow-hidden">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={inputPattern}
                onChange={(e) => setInputPattern(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPattern(inputPattern); setCursor("0"); } }}
                placeholder="Pattern (e.g. user:*)"
                className="flex h-8 w-full rounded-md border border-input bg-secondary/50 pl-7 pr-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <button onClick={() => { setPattern(inputPattern); setCursor("0"); queryClient.invalidateQueries({ queryKey: ["redis-keys"] }); }} className="w-8 h-8 flex items-center justify-center rounded-md border border-input bg-secondary/50 hover:bg-accent transition-colors shrink-0">
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <button onClick={() => setShowCreate(true)} className="w-full flex items-center justify-center gap-1.5 h-7 text-xs border rounded-md hover:bg-accent transition-colors text-muted-foreground">
            <Plus className="w-3 h-3" /> New Key
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loadingKeys ? (
            <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}</div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">No keys matching "{pattern}"</div>
          ) : (
            <>
              {keys.map((entry) => (
                <button
                  key={entry.key}
                  onClick={() => setSelectedKey(entry.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent text-left transition-colors border-b border-border/30 last:border-0 ${selectedKey === entry.key ? "bg-primary/10" : ""}`}
                >
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${typeColor[entry.type] ?? "bg-secondary text-muted-foreground"}`}>{entry.type.slice(0, 3).toUpperCase()}</span>
                  <span className="font-mono truncate flex-1">{entry.key}</span>
                  <span className={`text-[10px] shrink-0 ${entry.ttl === -1 ? "text-muted-foreground/50" : "text-amber-400"}`}>
                    {entry.ttl === -1 ? "∞" : `${entry.ttl}s`}
                  </span>
                </button>
              ))}
              {nextCursor !== "0" && (
                <button onClick={() => setCursor(nextCursor)} className="w-full py-2 text-xs text-primary hover:underline">
                  Load more ({nextCursor})
                </button>
              )}
            </>
          )}
        </div>

        <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
          {keys.length} key{keys.length !== 1 ? "s" : ""} shown
        </div>
      </div>

      {/* Right: key details */}
      <div className="flex-1 rounded-xl border bg-card overflow-hidden flex flex-col min-w-0">
        {showCreate && (
          <div className="p-5 border-b border-border bg-secondary/20 space-y-3">
            <h4 className="font-semibold text-sm">Create String Key</h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Key</label>
                <input value={newKey.key} onChange={(e) => setNewKey({ ...newKey, key: e.target.value })} placeholder="my:key:name" className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Value</label>
                <input value={newKey.value} onChange={(e) => setNewKey({ ...newKey, value: e.target.value })} placeholder="value" className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">TTL (seconds, optional)</label>
                <input type="number" value={newKey.ttl} onChange={(e) => setNewKey({ ...newKey, ttl: e.target.value })} placeholder="3600" className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createMutation.mutate(newKey)} disabled={!newKey.key || createMutation.isPending} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">Set Key</button>
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {!selectedKey ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Database className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a key to inspect its value</p>
            </div>
          </div>
        ) : loadingValue ? (
          <div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : value ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Key header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${typeColor[value.type] ?? "bg-secondary text-muted-foreground"}`}>{value.type.toUpperCase()}</span>
                <code className="text-sm font-mono font-semibold truncate">{value.key}</code>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  TTL:
                  <input
                    type="number"
                    defaultValue={value.ttl}
                    onBlur={(e) => ttlMutation.mutate({ key: value.key, ttl: Number(e.target.value) })}
                    className="w-20 h-6 px-2 rounded-md border border-input bg-secondary/50 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span>s {value.ttl === -1 ? "(persistent)" : ""}</span>
                </div>
                <button onClick={() => { if (confirm(`Delete key "${value.key}"?`)) deleteMutation.mutate(value.key); }} className="flex items-center gap-1 text-xs text-destructive border border-destructive/30 rounded-md px-2 py-1 hover:bg-destructive/10 transition-colors">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            </div>

            {/* Value display */}
            <div className="flex-1 overflow-auto p-5">
              <KeyValueDisplay type={value.type} value={value.value} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KeyValueDisplay({ type, value }: { type: string; value: unknown }) {
  if (type === "string") {
    let parsed: unknown = null;
    try { parsed = JSON.parse(value as string); } catch {}
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Raw value</p>
          <pre className="text-sm font-mono bg-secondary/30 p-4 rounded-lg overflow-auto break-all whitespace-pre-wrap border border-border">{String(value)}</pre>
        </div>
        {parsed !== null && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Parsed JSON</p>
            <pre className="text-xs font-mono bg-secondary/30 p-4 rounded-lg overflow-auto border border-border text-emerald-400">{JSON.stringify(parsed, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  }

  if (type === "hash") {
    const hash = value as Record<string, string>;
    return (
      <table className="w-full text-xs">
        <thead><tr>{["Field", "Value"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border/50">
          {Object.entries(hash).map(([k, v]) => (
            <tr key={k} className="hover:bg-muted/20">
              <td className="px-3 py-2 font-mono font-medium text-violet-400">{k}</td>
              <td className="px-3 py-2 font-mono break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (type === "list" || type === "set") {
    const items = value as string[];
    return (
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-3 py-1.5 border-b border-border/30 last:border-0">
            <span className="text-xs text-muted-foreground font-mono w-8 shrink-0 mt-0.5">{i}</span>
            <span className="text-sm font-mono break-all">{item}</span>
          </div>
        ))}
      </div>
    );
  }

  if (type === "zset") {
    const members = value as { member: string; score: number }[];
    return (
      <table className="w-full text-xs">
        <thead><tr>{["Rank", "Score", "Member"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border/50">
          {members.map(({ member, score }, i) => (
            <tr key={member} className="hover:bg-muted/20">
              <td className="px-3 py-2 text-muted-foreground font-mono">{i}</td>
              <td className="px-3 py-2 font-mono text-amber-400">{score}</td>
              <td className="px-3 py-2 font-mono break-all">{member}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return <pre className="text-xs font-mono">{JSON.stringify(value, null, 2)}</pre>;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function CliTab() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<{ command: string; result: unknown; error?: string; durationMs?: number }[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const commandMutation = useMutation({
    mutationFn: (command: string) =>
      apiClient.post<{ success: boolean; data?: RedisCommandResult; error?: string }>("/redis/command", { command }),
    onSuccess: (res, command) => {
      setHistory((prev) => [{
        command,
        result: res.data?.result,
        error: res.success ? undefined : res.error,
        durationMs: res.data?.durationMs,
      }, ...prev]);
      setInput("");
      setHistIdx(-1);
    },
    onError: (err, command) => {
      setHistory((prev) => [{ command, result: null, error: (err as Error).message }, ...prev]);
      setInput("");
    },
  });

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && input.trim()) {
      commandMutation.mutate(input.trim());
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIdx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(newIdx);
      if (history[newIdx]) setInput(history[newIdx]!.command);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIdx = Math.max(histIdx - 1, -1);
      setHistIdx(newIdx);
      setInput(newIdx === -1 ? "" : (history[newIdx]?.command ?? ""));
    }
  }

  const QUICK_COMMANDS = ["INFO server", "DBSIZE", "KEYS *", "MEMORY USAGE", "CLIENT LIST", "CONFIG GET maxmemory", "SLOWLOG GET 10", "LATENCY LATEST"];

  function formatResult(result: unknown): string {
    if (result === null || result === undefined) return "(nil)";
    if (Array.isArray(result)) return result.map((r, i) => `${i + 1}) ${formatResult(r)}`).join("\n");
    if (typeof result === "object") return JSON.stringify(result, null, 2);
    return String(result);
  }

  return (
    <div className="space-y-4">
      {/* Quick commands */}
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">Quick Commands</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_COMMANDS.map((cmd) => (
            <button key={cmd} onClick={() => commandMutation.mutate(cmd)} className="px-2.5 py-1 text-xs font-mono bg-secondary/50 border border-border rounded hover:bg-accent transition-colors">{cmd}</button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="rounded-xl border bg-[#0d1117] overflow-hidden">
        <div className="px-4 py-2 border-b border-border flex items-center gap-2 bg-[#161b22]">
          <span className="text-xs font-medium text-muted-foreground font-mono">REDIS CLI</span>
          <span className="text-xs text-muted-foreground">— arrow keys for history, Enter to run</span>
        </div>

        {/* Output */}
        <div className="p-4 max-h-[400px] overflow-auto space-y-3 font-mono text-xs" onClick={() => inputRef.current?.focus()}>
          {history.length === 0 && (
            <p className="text-muted-foreground/60">Type a Redis command and press Enter...</p>
          )}
          {history.map((item, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-primary">›</span>
                <span className="text-emerald-300">{item.command}</span>
                {item.durationMs !== undefined && <span className="text-muted-foreground/50 text-[10px]">{item.durationMs}ms</span>}
              </div>
              {item.error ? (
                <pre className="text-red-400 pl-4">(error) {item.error}</pre>
              ) : (
                <pre className="text-[#e2e8f0] pl-4 whitespace-pre-wrap">{formatResult(item.result)}</pre>
              )}
            </div>
          ))}
        </div>

        {/* Input line */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-[#0d1117]">
          <span className="text-primary font-mono text-sm shrink-0">›</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="PING"
            autoFocus
            spellCheck={false}
            className="flex-1 bg-transparent text-sm font-mono text-[#e2e8f0] placeholder:text-muted-foreground/50 focus:outline-none"
          />
          {commandMutation.isPending && <div className="w-3.5 h-3.5 border border-primary border-t-transparent rounded-full animate-spin shrink-0" />}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${seconds % 60}s`;
}

