"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play, Square, RefreshCw, Download, CheckCircle2, XCircle,
  AlertTriangle, Terminal, FileCode2, ChevronDown, ChevronRight,
  Loader2, Server, Settings, Trash2, Copy, Check, Code2, TrendingUp,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { postHostNodeInstallStream } from "@/lib/host-node-install-stream";
import { WebserverAnalyticsPanel } from "@/components/webservers/webserver-analytics-panel";
import { postWebserverInstallStream } from "@/lib/webserver-install-stream";
import type { WebServerInfo, WebServerType } from "@hostpanel/types";

type ConfigureInfoPayload = {
  id: string;
  name: string;
  configDir: string;
  defaultPort: number;
  files: { label: string; path: string }[];
  notes: string;
  adminHint?: string;
};

type InstallPanelState = {
  id: WebServerType;
  name: string;
  lines: string[];
  phase: string;
  running: boolean;
  ok: boolean | null;
  error?: string;
};

type NodeInstallPanelState = {
  profile: string;
  lines: string[];
  phase: string;
  running: boolean;
  ok: boolean | null;
  error?: string;
};

type HostNodeStatus = {
  nodeInstalled: boolean;
  nodeVersion: string | null;
  npmVersion: string | null;
  nodePath: string | null;
  npmPath: string | null;
  installScriptPresent: boolean;
  installScriptPath: string | null;
};

const WS_COLORS: Record<WebServerType, { bg: string; border: string; text: string; logo: string }> = {
  nginx:      { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", logo: "N" },
  apache2:    { bg: "bg-red-500/10",     border: "border-red-500/30",     text: "text-red-400",     logo: "A" },
  lighttpd:   { bg: "bg-sky-500/10",     border: "border-sky-500/30",     text: "text-sky-400",     logo: "L" },
  litespeed:  { bg: "bg-violet-500/10",  border: "border-violet-500/30",  text: "text-violet-400",  logo: "LS" },
  caddy:      { bg: "bg-teal-500/10",    border: "border-teal-500/30",    text: "text-teal-400",    logo: "C" },
  openresty:  { bg: "bg-orange-500/10",  border: "border-orange-500/30",  text: "text-orange-400",  logo: "OR" },
  traefik:    { bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    text: "text-cyan-400",    logo: "T" },
};

function StatusBadge({ status }: { status: string }) {
  if (status === "running") return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Running
    </span>
  );
  if (status === "stopped") return (
    <span
      className="flex items-center gap-1.5 text-xs font-medium text-amber-400"
      title="Package/binaries present; web server service is not active"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Installed · stopped
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" /> Not installed
    </span>
  );
}

export default function WebServersPage() {
  const queryClient = useQueryClient();
  const { user, token } = useAuth();
  const [installPanel, setInstallPanel] = useState<InstallPanelState | null>(null);
  const [nodeInstallPanel, setNodeInstallPanel] = useState<NodeInstallPanelState | null>(null);
  const [installPortalReady, setInstallPortalReady] = useState(false);
  const installAbortRef = useRef<AbortController | null>(null);
  const nodeInstallAbortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const nodeLogEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInstallPortalReady(true);
  }, []);

  const runInstall = useCallback(
    async (ws: WebServerInfo) => {
      if (nodeInstallPanel?.running) return;
      installAbortRef.current?.abort();
      installAbortRef.current = new AbortController();
      const { signal } = installAbortRef.current;
      setInstallPanel({
        id: ws.id as WebServerType,
        name: ws.name,
        lines: [`# HostPanel — installing ${ws.name}`, ""],
        phase: "Connecting…",
        running: true,
        ok: null,
      });
      try {
        await postWebserverInstallStream(
          ws.id,
          (ev) => {
            setInstallPanel((prev) => {
              if (!prev) return prev;
              const lines = [...prev.lines];
              const max = 700;
              const push = (s: string) => {
                lines.push(s);
                if (lines.length > max) lines.splice(0, lines.length - max);
              };
              switch (ev.type) {
                case "start":
                  push(`# Target: ${ev.server}`);
                  return { ...prev, lines, phase: "Install started" };
                case "phase":
                  push("");
                  push(`━━ Step ${ev.index}/${ev.total}: ${ev.title} ━━`);
                  return { ...prev, lines, phase: ev.title };
                case "log": {
                  const pref = ev.source === "stderr" ? "err │ " : "    │ ";
                  push(`${pref}${ev.line}`);
                  return { ...prev, lines };
                }
                case "step_complete":
                  push(`    │ → finished (exit ${ev.code})`);
                  return { ...prev, lines };
                case "skip":
                  push(`※ ${ev.message}`);
                  return { ...prev, lines, phase: "Already installed" };
                case "done":
                  push(ev.ok ? "━━ Completed successfully ━━" : `━━ Failed: ${ev.error ?? "unknown"} ━━`);
                  if (ev.ok) push("");
                  if (ev.ok) push("Updating server list…");
                  return {
                    ...prev,
                    lines,
                    phase: ev.ok ? "Done — refreshing status" : "Failed",
                    running: false,
                    ok: ev.ok,
                    error: ev.error,
                  };
                default:
                  return prev;
              }
            });
          },
          signal
        );
        await queryClient.invalidateQueries({ queryKey: ["webservers"] });
        await queryClient.refetchQueries({ queryKey: ["webservers"] });
        await new Promise((r) => setTimeout(r, 700));
        await queryClient.refetchQueries({ queryKey: ["webservers"] });
      } catch (e) {
        const msg = (e as Error).name === "AbortError" ? "Cancelled" : (e as Error).message;
        setInstallPanel((prev) =>
          prev
            ? {
                ...prev,
                lines: [...prev.lines, "", `!! ${msg}`],
                running: false,
                ok: false,
                phase: "Failed",
                error: msg,
              }
            : prev
        );
      }
    },
    [queryClient, nodeInstallPanel?.running]
  );

  const runNodeInstall = useCallback(
    async (profile: string) => {
      if (installPanel?.running) return;
      nodeInstallAbortRef.current?.abort();
      nodeInstallAbortRef.current = new AbortController();
      const { signal } = nodeInstallAbortRef.current;
      setNodeInstallPanel({
        profile,
        lines: [`# HostPanel — installing Node.js (${profile})`, ""],
        phase: "Connecting…",
        running: true,
        ok: null,
      });
      try {
        await postHostNodeInstallStream(
          profile,
          (ev) => {
            setNodeInstallPanel((prev) => {
              if (!prev) return prev;
              const lines = [...prev.lines];
              const max = 700;
              const push = (s: string) => {
                lines.push(s);
                if (lines.length > max) lines.splice(0, lines.length - max);
              };
              switch (ev.type) {
                case "start":
                  push(`# Target: ${ev.server}`);
                  return { ...prev, lines, phase: "Install started" };
                case "phase":
                  push("");
                  push(`━━ ${ev.title} ━━`);
                  return { ...prev, lines, phase: ev.title };
                case "log": {
                  const pref = ev.source === "stderr" ? "err │ " : "    │ ";
                  push(`${pref}${ev.line}`);
                  return { ...prev, lines };
                }
                case "step_complete":
                  push(`    │ → finished (exit ${ev.code})`);
                  return { ...prev, lines };
                case "done":
                  push(ev.ok ? "━━ Completed successfully ━━" : `━━ Failed: ${ev.error ?? "unknown"} ━━`);
                  return {
                    ...prev,
                    lines,
                    phase: ev.ok ? "Done — refreshing status" : "Failed",
                    running: false,
                    ok: ev.ok,
                    error: ev.error,
                  };
                default:
                  return prev;
              }
            });
          },
          signal
        );
        await queryClient.invalidateQueries({ queryKey: ["host-node"] });
        await queryClient.refetchQueries({ queryKey: ["host-node"] });
      } catch (e) {
        const msg = (e as Error).name === "AbortError" ? "Cancelled" : (e as Error).message;
        setNodeInstallPanel((prev) =>
          prev
            ? {
                ...prev,
                lines: [...prev.lines, "", `!! ${msg}`],
                running: false,
                ok: false,
                phase: "Failed",
                error: msg,
              }
            : prev
        );
      }
    },
    [queryClient, installPanel?.running]
  );

  const closeInstallPanel = useCallback(() => {
    installAbortRef.current?.abort();
    installAbortRef.current = null;
    setInstallPanel(null);
  }, []);

  const closeNodeInstallPanel = useCallback(() => {
    nodeInstallAbortRef.current?.abort();
    nodeInstallAbortRef.current = null;
    setNodeInstallPanel(null);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installPanel?.lines]);

  useEffect(() => {
    nodeLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [nodeInstallPanel?.lines]);

  const { data: hostNodeData, isLoading: hostNodeLoading } = useQuery({
    queryKey: ["host-node"],
    queryFn: () => apiClient.get<{ data: HostNodeStatus }>("/host-node"),
    staleTime: 15_000,
  });
  const hostNode = hostNodeData?.data;

  const { data, isLoading } = useQuery({
    queryKey: ["webservers"],
    queryFn: () => apiClient.get<{ data: WebServerInfo[] }>("/webservers"),
    refetchInterval: 15000,
  });

  const servers = data?.data ?? [];

  const installBusy = !!installPanel?.running || !!nodeInstallPanel?.running;

  return (
    <div className={`space-y-6 max-w-5xl ${installPanel || nodeInstallPanel ? "pb-[min(42vh,300px)]" : ""}`}>
      <div>
        <h2 className="text-xl font-semibold">Web Servers</h2>
        <p className="text-sm text-muted-foreground">Install, start, stop, and configure your web servers. Each site can run on a different server.</p>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <Code2 className="w-6 h-6 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">System Node.js</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Global runtime on this host (HostPanel services and CLI). App sites use the version you choose per site; this panel upgrades the system <code className="text-[10px] px-1 py-0.5 rounded bg-muted">node</code> /{" "}
                <code className="text-[10px] px-1 py-0.5 rounded bg-muted">npm</code> used on PATH.
              </p>
              {hostNodeLoading ? (
                <p className="text-sm mt-2 text-muted-foreground animate-pulse">Loading…</p>
              ) : hostNode?.nodeVersion ? (
                <p className="text-sm mt-2 font-mono break-all">
                  {hostNode.nodePath ? `${hostNode.nodePath} → ` : ""}
                  node {hostNode.nodeVersion}
                  {hostNode.npmVersion ? ` · npm ${hostNode.npmVersion}` : ""}
                </p>
              ) : (
                <p className="text-sm mt-2 text-amber-400">No <code className="text-xs">node</code> on PATH{hostNode?.npmVersion ? ` (npm ${hostNode.npmVersion})` : ""}.</p>
              )}
              {hostNode && !hostNode.installScriptPresent && (
                <p className="text-xs text-destructive mt-2">
                  Install helper missing — ensure <code className="text-[10px]">deploy/hostpanel-install-node.sh</code> is deployed and sudoers updated (or re-run <code className="text-[10px]">install.sh</code>).
                </p>
              )}
            </div>
          </div>
          {user?.role === "superadmin" && (
            <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
              <label className="text-xs font-medium text-muted-foreground">Install or upgrade</label>
              <select
                defaultValue=""
                disabled={installBusy || hostNodeLoading || !hostNode?.installScriptPresent}
                onChange={(e) => {
                  const v = e.target.value as string;
                  e.target.value = "";
                  if (v) void runNodeInstall(v);
                }}
                className="h-9 rounded-md border border-input bg-secondary/50 px-3 text-sm min-w-[220px] disabled:opacity-50"
              >
                <option value="">Choose profile…</option>
                <option value="distro">Distro: nodejs + npm (apt)</option>
                <option value="ns18">NodeSource 18.x</option>
                <option value="ns20">NodeSource 20.x</option>
                <option value="ns22">NodeSource 22.x</option>
                <option value="ns24">NodeSource 24.x</option>
              </select>
              {!hostNode?.installScriptPresent && (
                <p className="text-[11px] text-muted-foreground max-w-xs">Panel cannot run installs until the helper script exists on disk.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-6 h-36 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {servers.map((ws) => (
            <WebServerCard
              key={ws.id}
              ws={ws}
              authToken={token}
              onRefresh={() => queryClient.invalidateQueries({ queryKey: ["webservers"] })}
              onInstallStream={runInstall}
              installStreamRunning={installBusy}
              installStreamActiveId={installPanel?.running ? installPanel.id : null}
            />
          ))}
        </div>
      )}

      {/* Info callouts */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex flex-col md:flex-row gap-6 md:gap-8">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Server className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-primary mb-1">Edge web servers</p>
            <p className="text-muted-foreground">
              When creating a site, you pick one of these as the HTTP/TLS front (reverse proxy, PHP/static, etc.). Multiple servers can coexist on the host; vhosts are written to each stack&apos;s config paths automatically.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 flex-1 min-w-0 md:border-l md:border-primary/20 md:pl-8">
          <Code2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-primary mb-1">Node.js is not listed here on purpose</p>
            <p className="text-muted-foreground">
              Node.js is your <span className="text-foreground/90 font-medium">application runtime</span>, not the edge server. Create a site with{" "}
              <span className="text-foreground/90 font-medium">Site type → Node.js</span> under{" "}
              <Link href="/dashboard/sites" className="text-primary underline underline-offset-2 hover:text-primary/90">Sites</Link>
              , choose a Node line and app port, then pick Nginx, Caddy, Traefik, or another server above — HostPanel generates the proxy to{" "}
              <code className="text-xs bg-background/60 px-1 py-0.5 rounded">localhost</code> for you. Same idea for Python apps.
            </p>
          </div>
        </div>
      </div>

      {installPortalReady &&
        nodeInstallPanel &&
        createPortal(
          <div
            className="fixed bottom-0 left-0 right-0 z-[9998] border-t border-[#30363d] bg-[#0d1117] shadow-[0_-8px_32px_rgba(0,0,0,0.55)] pb-[env(safe-area-inset-bottom)]"
            role="dialog"
            aria-label="Node.js installation output"
          >
            {nodeInstallPanel.running && (
              <div
                className="relative h-1 w-full overflow-hidden bg-[#21262d]"
                role="progressbar"
                aria-busy="true"
                aria-valuetext={nodeInstallPanel.phase}
              >
                <div className="absolute inset-y-0 left-0 w-[38%] rounded-sm bg-gradient-to-r from-teal-600 via-teal-400 to-teal-600 animate-hp-install-bar" />
              </div>
            )}
            <div className="max-w-5xl mx-auto px-4 pt-3 pb-4">
              <div className="flex items-center gap-3 mb-2">
                <Terminal className="w-4 h-4 text-teal-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#e2e8f0] truncate">Install Node.js — {nodeInstallPanel.profile}</p>
                  <p className="text-xs text-muted-foreground truncate">{nodeInstallPanel.phase}</p>
                </div>
                {nodeInstallPanel.running && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" aria-hidden />
                )}
                {!nodeInstallPanel.running && nodeInstallPanel.ok === true && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden />
                )}
                {!nodeInstallPanel.running && nodeInstallPanel.ok === false && (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden />
                )}
                {nodeInstallPanel.running && (
                  <button
                    type="button"
                    onClick={() => nodeInstallAbortRef.current?.abort()}
                    className="text-xs px-2 py-1 rounded-md border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeNodeInstallPanel}
                  className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent"
                >
                  Close
                </button>
              </div>
              <pre className="rounded-lg border border-[#30363d] bg-[#010409] p-3 text-[11px] font-mono text-[#94a3b8] max-h-[min(40vh,280px)] overflow-auto leading-relaxed whitespace-pre-wrap break-all">
                {nodeInstallPanel.lines.join("\n")}
                <div ref={nodeLogEndRef} />
              </pre>
            </div>
          </div>,
          document.body
        )}

      {installPortalReady &&
        installPanel &&
        createPortal(
          <div
            className="fixed bottom-0 left-0 right-0 z-[9999] border-t border-[#30363d] bg-[#0d1117] shadow-[0_-8px_32px_rgba(0,0,0,0.55)] pb-[env(safe-area-inset-bottom)]"
            role="dialog"
            aria-label="Web server installation output"
          >
            {installPanel.running && (
              <div
                className="relative h-1 w-full overflow-hidden bg-[#21262d]"
                role="progressbar"
                aria-busy="true"
                aria-valuetext={installPanel.phase}
              >
                <div className="absolute inset-y-0 left-0 w-[38%] rounded-sm bg-gradient-to-r from-violet-600 via-violet-400 to-violet-600 animate-hp-install-bar" />
              </div>
            )}
            <div className="max-w-5xl mx-auto px-4 pt-3 pb-4">
              <div className="flex items-center gap-3 mb-2">
                <Terminal className="w-4 h-4 text-violet-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#e2e8f0] truncate">Install — {installPanel.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{installPanel.phase}</p>
                </div>
                {installPanel.running && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" aria-hidden />
                )}
                {!installPanel.running && installPanel.ok === true && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden />
                )}
                {!installPanel.running && installPanel.ok === false && (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden />
                )}
                {installPanel.running && (
                  <button
                    type="button"
                    onClick={() => installAbortRef.current?.abort()}
                    className="text-xs px-2 py-1 rounded-md border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeInstallPanel}
                  className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent"
                >
                  Close
                </button>
              </div>
              <pre className="rounded-lg border border-[#30363d] bg-[#010409] p-3 text-[11px] font-mono text-[#94a3b8] max-h-[min(40vh,280px)] overflow-auto leading-relaxed whitespace-pre-wrap break-all">
                {installPanel.lines.join("\n")}
                <div ref={logEndRef} />
              </pre>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function WebServerCard({
  ws,
  authToken,
  onRefresh,
  onInstallStream,
  installStreamRunning,
  installStreamActiveId,
}: {
  ws: WebServerInfo;
  authToken: string | null;
  onRefresh: () => void;
  onInstallStream: (ws: WebServerInfo) => void;
  installStreamRunning: boolean;
  installStreamActiveId: WebServerType | null;
}) {
  const colors = WS_COLORS[ws.id as WebServerType] ?? WS_COLORS.nginx;
  const [logOpen, setLogOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [logType, setLogType] = useState<"error" | "access">("error");
  /** Nginx: main daemon logs vs HostPanel reverse-proxy vhost (hostpanel.* — same paths CrowdSec should read on the host). */
  const [logScope, setLogScope] = useState<"daemon" | "panel">("daemon");
  const [configTestOpen, setConfigTestOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

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

  const uninstallMutation = useMutation({
    mutationFn: () => apiClient.post<{ message?: string; output?: string }>(`/webservers/${ws.id}/uninstall`, {}),
    onSuccess: () => {
      onRefresh();
      setConfigureOpen(false);
    },
  });

  const { data: logData } = useQuery({
    queryKey: ["ws-logs", ws.id, logType, ws.id === "nginx" ? logScope : "daemon"],
    queryFn: () => {
      const scopeQs = ws.id === "nginx" ? `&scope=${logScope}` : "";
      return apiClient.get<{ data: { lines: string[]; path?: string; scope?: string } }>(
        `/webservers/${ws.id}/logs?lines=400&type=${logType}${scopeQs}`,
      );
    },
    enabled: logOpen,
    refetchInterval: logOpen ? 4000 : false,
  });

  const { data: testData, refetch: runConfigTest, isFetching: testRunning } = useQuery({
    queryKey: ["ws-config-test", ws.id],
    queryFn: () => apiClient.get<{ data: { ok: boolean; output: string } }>(`/webservers/${ws.id}/config-test`),
    enabled: false,
  });

  const { data: configurePayload, isLoading: configureLoading } = useQuery({
    queryKey: ["ws-configure-info", ws.id],
    queryFn: () => apiClient.get<{ data: ConfigureInfoPayload }>(`/webservers/${ws.id}/configure-info`),
    enabled: configureOpen,
  });

  const copyToClipboard = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const isInstalled = ws.status !== "not_installed";
  const isRunning = ws.status === "running";
  const installThisActive = installStreamActiveId === ws.id;
  const serverCtlPending =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending ||
    reloadMutation.isPending ||
    uninstallMutation.isPending;

  const confirmUninstall = () => {
    const msg =
      `Delete ${ws.name} from this server?\n\n` +
      `This will stop the service and run apt remove --purge. Sites using this server may break.`;
    if (!confirm(msg)) return;
    uninstallMutation.mutate();
  };

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
              type="button"
              onClick={() => onInstallStream(ws)}
              disabled={installStreamRunning}
              title={installStreamRunning ? "Another installation is running" : `Install ${ws.name}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${colors.border} ${colors.text} ${colors.bg} hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed transition-all`}
            >
              {installThisActive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Install
            </button>
          ) : (
            <>
              {!isRunning ? (
                <button onClick={() => startMutation.mutate()} disabled={serverCtlPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-all">
                  {startMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Start
                </button>
              ) : (
                <button onClick={() => stopMutation.mutate()} disabled={serverCtlPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-50 transition-all">
                  {stopMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                  Stop
                </button>
              )}
              <button onClick={() => restartMutation.mutate()} disabled={serverCtlPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/60 border border-border hover:bg-accent disabled:opacity-50 transition-all">
                {restartMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Restart
              </button>
              <button onClick={() => reloadMutation.mutate()} disabled={serverCtlPending} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/60 border border-border hover:bg-accent disabled:opacity-50 transition-all">
                {reloadMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 opacity-60" />}
                Reload
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error feedback */}
      {(startMutation.isError || stopMutation.isError || restartMutation.isError || uninstallMutation.isError) && (
        <div className="mx-6 mb-4 flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {(startMutation.error || stopMutation.error || restartMutation.error || uninstallMutation.error as Error)?.message}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-1 px-6 pb-4">
        {isInstalled && (
          <>
            <button
              type="button"
              onClick={() => { setConfigTestOpen(!configTestOpen); if (!configTestOpen) runConfigTest(); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              Config Test
              {configTestOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>

            <button
              type="button"
              onClick={() => setLogOpen(!logOpen)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              Logs
              {logOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>

            <button
              type="button"
              onClick={() => setAnalyticsOpen(!analyticsOpen)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Analytics
              {analyticsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => setConfigureOpen(true)}
          disabled={installStreamRunning}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors disabled:opacity-40"
        >
          <Settings className="w-3.5 h-3.5" />
          Configure
        </button>

        {isInstalled && (
          <button
            type="button"
            onClick={confirmUninstall}
            disabled={installStreamRunning || serverCtlPending}
            title="Delete web server packages from this system (superadmin)"
            className="flex items-center gap-1.5 text-xs text-destructive/90 hover:text-destructive px-2 py-1 rounded-md hover:bg-destructive/10 transition-colors disabled:opacity-40"
          >
            {uninstallMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Delete
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          Port {ws.defaultPort} · Config: <code className="font-mono text-[10px]">{ws.configDir}</code>
        </span>
      </div>

      {/* Config test output */}
      {isInstalled && configTestOpen && (
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
      {isInstalled && logOpen && (
        <div className="mx-6 mb-4 rounded-lg border bg-[#0d1117] overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#161b22] border-b border-border">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-muted-foreground">{ws.name} logs</span>
            {ws.id === "nginx" && (
              <div className="flex gap-1">
                <button
                  type="button"
                  title="Main nginx error/access logs"
                  onClick={() => setLogScope("daemon")}
                  className={`px-2 py-0.5 text-[10px] rounded ${logScope === "daemon" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent"}`}
                >
                  Main
                </button>
                <button
                  type="button"
                  title="HostPanel panel vhost (hostpanel.access/error.log)"
                  onClick={() => setLogScope("panel")}
                  className={`px-2 py-0.5 text-[10px] rounded ${logScope === "panel" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent"}`}
                >
                  HostPanel vhost
                </button>
              </div>
            )}
            <div className="ml-auto flex gap-1 shrink-0">
              {(["error", "access"] as const).map((t) => (
                <button key={t} onClick={() => setLogType(t)} className={`px-2 py-0.5 text-[10px] rounded ${logType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {logData?.data?.path && (
            <div className="px-4 py-1.5 bg-[#0d1117] border-b border-border text-[10px] font-mono text-muted-foreground break-all">
              {logData.data.path}
            </div>
          )}
          <div className="p-4 max-h-[min(28rem,55vh)] overflow-auto">
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

      {isInstalled && analyticsOpen && (
        <div className="mx-6 mb-4">
          <WebserverAnalyticsPanel
            enabled={analyticsOpen}
            authToken={authToken}
            serverId={ws.id as WebServerType}
            nginxLogScope={ws.id === "nginx" ? logScope : undefined}
            onNginxLogScopeChange={ws.id === "nginx" ? setLogScope : undefined}
          />
        </div>
      )}

      {configureOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => setConfigureOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h4 className="text-lg font-semibold flex items-center gap-2">
                  <Settings className="w-5 h-5 text-muted-foreground" />
                  Configure — {ws.name}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Paths on the HostPanel server (edit with SSH or your preferred editor). HostPanel writes site vhosts under the config directory when you assign this server to a site.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfigureOpen(false)}
                className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent shrink-0"
              >
                Close
              </button>
            </div>

            {configureLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            )}

            {!configureLoading && configurePayload?.data && (
              <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Primary config directory</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono break-all flex-1">{configurePayload.data.configDir}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(configurePayload.data.configDir)}
                      className="shrink-0 p-1.5 rounded-md border border-border hover:bg-accent"
                      title="Copy path"
                    >
                      {copiedPath === configurePayload.data.configDir ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">HTTP port {configurePayload.data.defaultPort} (default).</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Important paths</p>
                  <ul className="space-y-2">
                    {configurePayload.data.files.map((f) => (
                      <li key={f.path} className="rounded-lg border border-border p-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <span className="text-xs font-medium">{f.label}</span>
                          <code className="block text-[11px] font-mono text-muted-foreground break-all mt-0.5">{f.path}</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(f.path)}
                          className="shrink-0 self-start sm:self-center flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border hover:bg-accent"
                        >
                          {copiedPath === f.path ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          Copy
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {configurePayload.data.adminHint && (
                  <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs text-muted-foreground">
                    {configurePayload.data.adminHint}
                  </div>
                )}

                <p className="text-xs text-muted-foreground leading-relaxed">{configurePayload.data.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
