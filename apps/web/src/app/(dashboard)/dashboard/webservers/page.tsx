"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play, Square, RefreshCw, Download, CheckCircle2, XCircle,
  AlertTriangle, Terminal, FileCode2, ChevronDown, ChevronRight,
  Loader2, Server,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import type { WebServerInfo, WebServerType } from "@hostpanel/types";

const WS_COLORS: Record<WebServerType, { bg: string; border: string; text: string; logo: string }> = {
  nginx:     { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", logo: "N" },
  apache2:   { bg: "bg-red-500/10",     border: "border-red-500/30",     text: "text-red-400",     logo: "A" },
  lighttpd:  { bg: "bg-sky-500/10",     border: "border-sky-500/30",     text: "text-sky-400",     logo: "L" },
  litespeed: { bg: "bg-violet-500/10",  border: "border-violet-500/30",  text: "text-violet-400",  logo: "LS" },
};

function StatusBadge({ status }: { status: string }) {
  if (status === "running") return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Running
    </span>
  );
  if (status === "stopped") return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Stopped
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" /> Not Installed
    </span>
  );
}

export default function WebServersPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["webservers"],
    queryFn: () => apiClient.get<{ data: WebServerInfo[] }>("/webservers"),
    refetchInterval: 15000,
  });

  const servers = data?.data ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold">Web Servers</h2>
        <p className="text-sm text-muted-foreground">Install, start, stop, and configure your web servers. Each site can run on a different server.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-6 h-36 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {servers.map((ws) => (
            <WebServerCard key={ws.id} ws={ws} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["webservers"] })} />
          ))}
        </div>
      )}

      {/* Info callout */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex items-start gap-3">
        <Server className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-primary mb-1">Per-site web server selection</p>
          <p className="text-muted-foreground">When creating or editing a site, you can choose which web server handles it. Multiple web servers can coexist — each bound to a different port or virtual host. Config files are written automatically to the appropriate server directory.</p>
        </div>
      </div>
    </div>
  );
}

function WebServerCard({ ws, onRefresh }: { ws: WebServerInfo; onRefresh: () => void }) {
  const queryClient = useQueryClient();
  const colors = WS_COLORS[ws.id as WebServerType] ?? WS_COLORS.nginx;
  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState<"error" | "access">("error");
  const [configTestOpen, setConfigTestOpen] = useState(false);

  const installMutation = useMutation({
    mutationFn: () => apiClient.post(`/webservers/${ws.id}/install`, {}),
    onSuccess: () => onRefresh(),
  });
  const startMutation = useMutation({
    mutationFn: () => apiClient.post(`/webservers/${ws.id}/start`, {}),
    onSuccess: () => onRefresh(),
  });
  const stopMutation = useMutation({
    mutationFn: () => apiClient.post(`/webservers/${ws.id}/stop`, {}),
    onSuccess: () => onRefresh(),
  });
  const restartMutation = useMutation({
    mutationFn: () => apiClient.post(`/webservers/${ws.id}/restart`, {}),
    onSuccess: () => onRefresh(),
  });
  const reloadMutation = useMutation({
    mutationFn: () => apiClient.post(`/webservers/${ws.id}/reload`, {}),
    onSuccess: () => onRefresh(),
  });

  const { data: logData } = useQuery({
    queryKey: ["ws-logs", ws.id, logType],
    queryFn: () => apiClient.get<{ data: { lines: string[] } }>(`/webservers/${ws.id}/logs?lines=150&type=${logType}`),
    enabled: logOpen,
    refetchInterval: logOpen ? 8000 : false,
  });

  const { data: testData, refetch: runConfigTest, isFetching: testRunning } = useQuery({
    queryKey: ["ws-config-test", ws.id],
    queryFn: () => apiClient.get<{ data: { ok: boolean; output: string } }>(`/webservers/${ws.id}/config-test`),
    enabled: false,
  });

  const isInstalled = ws.status !== "not_installed";
  const isRunning = ws.status === "running";
  const anyPending = installMutation.isPending || startMutation.isPending || stopMutation.isPending || restartMutation.isPending || reloadMutation.isPending;

  return (
    <div className={`rounded-xl border ${colors.border} bg-card overflow-hidden transition-colors`}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center`}>
            <span className={`text-sm font-bold ${colors.text}`}>{colors.logo}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{ws.name}</h3>
              {isInstalled && ws.version !== "unknown" && (
                <span className="text-xs font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">v{ws.version}</span>
              )}
              <StatusBadge status={ws.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{ws.description}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {!isInstalled ? (
            <button
              onClick={() => installMutation.mutate()}
              disabled={installMutation.isPending}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${colors.border} ${colors.text} ${colors.bg} hover:opacity-80 disabled:opacity-50 transition-all`}
            >
              {installMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Install
            </button>
          ) : (
            <>
              {!isRunning ? (
                <button onClick={() => startMutation.mutate()} disabled={anyPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-all">
                  {startMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Start
                </button>
              ) : (
                <button onClick={() => stopMutation.mutate()} disabled={anyPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-50 transition-all">
                  {stopMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                  Stop
                </button>
              )}
              <button onClick={() => restartMutation.mutate()} disabled={anyPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/60 border border-border hover:bg-accent disabled:opacity-50 transition-all">
                {restartMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Restart
              </button>
              <button onClick={() => reloadMutation.mutate()} disabled={anyPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/60 border border-border hover:bg-accent disabled:opacity-50 transition-all">
                {reloadMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 opacity-60" />}
                Reload
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error feedback */}
      {(installMutation.isError || startMutation.isError || stopMutation.isError || restartMutation.isError) && (
        <div className="mx-6 mb-4 flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {(installMutation.error || startMutation.error || stopMutation.error || restartMutation.error as Error)?.message}
        </div>
      )}

      {/* Footer actions */}
      {isInstalled && (
        <div className="flex items-center gap-1 px-6 pb-4">
          {/* Config test */}
          <button
            onClick={() => { setConfigTestOpen(!configTestOpen); if (!configTestOpen) runConfigTest(); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            Config Test
            {configTestOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {/* Logs */}
          <button
            onClick={() => setLogOpen(!logOpen)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            Logs
            {logOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          {/* Meta info */}
          <span className="ml-auto text-xs text-muted-foreground">Port {ws.defaultPort} · Config: <code className="font-mono text-[10px]">{ws.configDir}</code></span>
        </div>
      )}

      {/* Config test output */}
      {configTestOpen && (
        <div className="mx-6 mb-4 rounded-lg border bg-[#0d1117] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-[#161b22] border-b border-border">
            <FileCode2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">{ws.name} config test</span>
            {testRunning && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
            {!testRunning && testData && (
              testData.data.ok
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
                : <XCircle className="w-3.5 h-3.5 text-red-400 ml-auto" />
            )}
          </div>
          <pre className="p-4 text-xs font-mono text-[#e2e8f0] whitespace-pre-wrap max-h-40 overflow-auto">
            {testRunning ? "Running config test..." : testData?.data.output ?? "Click Config Test to run"}
          </pre>
        </div>
      )}

      {/* Log viewer */}
      {logOpen && (
        <div className="mx-6 mb-4 rounded-lg border bg-[#0d1117] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-[#161b22] border-b border-border">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">{ws.name} logs</span>
            <div className="ml-auto flex gap-1">
              {(["error", "access"] as const).map((t) => (
                <button key={t} onClick={() => setLogType(t)} className={`px-2 py-0.5 text-[10px] rounded ${logType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="p-4 max-h-60 overflow-auto">
            {!logData ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : logData.data.lines.length === 0 ? (
              <p className="text-xs text-muted-foreground">No log entries</p>
            ) : (
              logData.data.lines.map((line, i) => (
                <div key={i} className={`text-xs font-mono py-0.5 ${
                  line.includes(" error ") || line.includes("[error]") || line.includes("[crit]") ? "text-red-400" :
                  line.includes("[warn]") || line.includes(" warn ") ? "text-amber-400" :
                  "text-[#94a3b8]"
                }`}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
