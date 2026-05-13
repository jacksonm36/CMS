"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Box,
  Loader2,
  Play,
  Square,
  RefreshCw,
  ScrollText,
  Server,
  Shield,
  Trash2,
  Users,
  X,
  Pause,
  PlayCircle,
  Skull,
  Terminal,
} from "lucide-react";
import { DockerShellModal } from "@/components/docker/docker-shell-modal";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DockerContainerRow } from "@hostpanel/types";

type PanelUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  dockerAccess: boolean;
  createdAt: string;
};

function containerId(row: DockerContainerRow): string {
  return (row.ID ?? row.Id ?? row.id ?? "").trim();
}

function containerName(row: DockerContainerRow): string {
  const n = row.Names ?? row.NamesJSON ?? "";
  return n.replace(/^\//, "").split(",")[0]?.trim() || "—";
}

function containerImage(row: DockerContainerRow): string {
  return row.Image ?? row.ImageID ?? "—";
}

function containerStatus(row: DockerContainerRow): string {
  return row.Status ?? row.State ?? "—";
}

function containerPorts(row: DockerContainerRow): string {
  return row.Ports ?? "—";
}

/** API ref: full image ID when present; superadmin may fall back to container name (matches server id-or-name mode). */
function containerApiRef(row: DockerContainerRow, allowNameFallback: boolean): string {
  const id = containerId(row);
  if (id) return id;
  if (!allowNameFallback) return "";
  const n = containerName(row);
  if (n && n !== "—") return n;
  return "";
}

export default function DockerPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const staff = user?.role === "superadmin" || user?.role === "admin";
  const superadmin = user?.role === "superadmin";
  const canUseDocker = staff || Boolean(user?.dockerAccess);

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
    else if (!canUseDocker) router.replace("/dashboard");
  }, [authLoading, user, canUseDocker, router]);

  const ping = useQuery({
    queryKey: ["docker", "ping"],
    queryFn: () =>
      apiClient.get<{
        data: {
          ok: boolean;
          serverVersion?: string;
          interactiveDockerShell?: "staff-only" | "staff-or-docker-access";
        };
      }>("/docker/ping"),
    enabled: canUseDocker,
    retry: 1,
  });

  const containers = useQuery({
    queryKey: ["docker", "containers"],
    queryFn: () => apiClient.get<{ data: DockerContainerRow[] }>("/docker/containers"),
    enabled: canUseDocker && ping.isSuccess,
    refetchInterval: 15_000,
  });

  const panelUsers = useQuery({
    queryKey: ["auth", "users", "docker"],
    queryFn: () => apiClient.get<{ data: PanelUser[] }>("/auth/users"),
    enabled: staff && canUseDocker,
  });

  const accessMutation = useMutation({
    mutationFn: ({ userId, dockerAccess }: { userId: string; dockerAccess: boolean }) =>
      apiClient.patch(`/docker/panel-users/${userId}`, { dockerAccess }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "users"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "users", "docker"] });
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({
      ref,
      action,
    }: {
      ref: string;
      action: "start" | "stop" | "restart" | "remove" | "pause" | "unpause" | "kill";
    }) => apiClient.post(`/docker/containers/${encodeURIComponent(ref)}/action`, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["docker", "containers"] }),
  });

  const [shellTarget, setShellTarget] = useState<{ ref: string; name: string } | null>(null);
  const [logsTarget, setLogsTarget] = useState<{ ref: string; name: string } | null>(null);
  const logsQuery = useQuery({
    queryKey: ["docker", "logs", logsTarget?.ref],
    queryFn: () =>
      apiClient.get<{ data: { logs: string } }>(
        `/docker/containers/${encodeURIComponent(logsTarget!.ref)}/logs?tail=300`
      ),
    enabled: Boolean(logsTarget?.ref),
  });

  if (authLoading || !user || !canUseDocker) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading…
      </div>
    );
  }

  const pingData = ping.data?.data;
  const canOpenDockerShell =
    staff ||
    (Boolean(user?.dockerAccess) && pingData?.interactiveDockerShell === "staff-or-docker-access");
  const list = containers.data?.data ?? [];

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Box className="w-6 h-6 text-primary" />
          Docker
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Inspect the local Docker engine, stream logs, and run lifecycle actions. Staff always have access; other panel users need{" "}
          <span className="text-foreground/90">Docker access</span> enabled below.
        </p>
        <p className="text-sm text-muted-foreground mt-2 rounded-lg border border-border/80 bg-secondary/20 px-3 py-2">
          <strong className="text-foreground/90 font-medium">Site isolation containers</strong> are named{" "}
          <code className="text-[11px]">hostpanel-site-…</code> (not your public domain). They run with{" "}
          <code className="text-[11px]">--network none</code> and no published ports, so you{" "}
          <strong className="text-foreground/90 font-medium">cannot browse to them</strong> like a website. Traffic still hits nginx on the host
          (:80/:443). The shell exists so the Editor terminal can <code className="text-[11px]">docker exec</code> into{" "}
          <code className="text-[11px]">/srv</code> when <code className="text-[11px]">HOSTPANEL_TERMINAL_DOCKER=true</code> on the API.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">Engine</span>
          {ping.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : pingData?.ok ? (
            <span className="font-mono text-emerald-400">reachable · server {pingData.serverVersion ?? "?"}</span>
          ) : (
            <span className="text-amber-400">unreachable — install/start Docker and set DOCKER_HOST in .env</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["docker"] });
          }}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary/80 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {staff && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Panel user permissions</h3>
            <Shield className="w-3.5 h-3.5 text-muted-foreground ml-1" aria-hidden />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Docker access</th>
                </tr>
              </thead>
              <tbody>
                {(panelUsers.data?.data ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5">{u.email}</td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{u.role}</td>
                    <td className="px-4 py-2.5">
                      {u.role === "superadmin" || u.role === "admin" ? (
                        <span className="text-xs text-muted-foreground">Always on (staff)</span>
                      ) : (
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded border-border"
                            checked={u.dockerAccess}
                            disabled={accessMutation.isPending}
                            onChange={(e) =>
                              accessMutation.mutate({ userId: u.id, dockerAccess: e.target.checked })
                            }
                          />
                          <span className="text-xs text-muted-foreground">Can open Docker page &amp; run actions</span>
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {panelUsers.isLoading && (
            <div className="px-4 py-6 flex justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Containers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Same list as <code className="text-[10px]">docker ps -a</code> for the API process.{" "}
            <span className="text-foreground/80">Shell</span> (running container;{" "}
            <strong className="text-foreground/90 font-medium">administrators only</strong> unless the API sets{" "}
            <code className="text-[10px]">HOSTPANEL_DOCKER_SHELL_ALLOW_DOCKER_ACCESS=true</code>),{" "}
            <span className="text-foreground/80">Logs</span>, <span className="text-foreground/80">Start / Stop / Restart</span>; staff can{" "}
            <span className="text-foreground/80">Remove</span>. Actions apply only to containers currently returned by the engine listing.{" "}
            <strong className="text-foreground/90 font-medium">Superadmin</strong> additionally gets{" "}
            <span className="text-foreground/80">Pause / Unpause / Kill</span> and may target a row by container name when the engine omits an ID in
            JSON.
          </p>
        </div>
        {containers.isLoading ? (
          <div className="py-16 flex justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : containers.isError ? (
          <div className="px-4 py-8 text-sm text-destructive">{(containers.error as Error).message}</div>
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-sm text-muted-foreground text-center">No containers (or daemon not running).</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Image</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium min-w-[200px]">Ports / publish</th>
                  <th className="px-4 py-2 font-medium w-[1%] whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row, idx) => {
                  const id = containerId(row);
                  const ref = containerApiRef(row, superadmin);
                  const status = containerStatus(row);
                  const running = /^Up\s/i.test(status);
                  const paused = /\bPaused\b/i.test(status);
                  const rowKey = ref || id || `docker-row-${idx}`;
                  return (
                    <tr key={rowKey} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs max-w-[200px] truncate" title={ref || id || ""}>
                        {containerName(row)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">{containerImage(row)}</td>
                      <td className="px-4 py-2.5 text-xs">{status}</td>
                      <td
                        className="px-4 py-2.5 text-xs text-muted-foreground max-w-[min(28rem,55vw)] align-top"
                        title={containerPorts(row)}
                      >
                        <span className="line-clamp-2 leading-snug">{containerPorts(row)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={!ref || running || actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ ref, action: "start" })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title="Start"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!ref || !running || actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ ref, action: "stop" })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title="Stop"
                          >
                            <Square className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!ref || actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ ref, action: "restart" })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title="Restart (also starts if currently stopped)"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          {superadmin ? (
                            <>
                              <button
                                type="button"
                                disabled={!ref || !running || paused || actionMutation.isPending}
                                onClick={() => actionMutation.mutate({ ref, action: "pause" })}
                                className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                                title="Pause (superadmin)"
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={!ref || !paused || actionMutation.isPending}
                                onClick={() => actionMutation.mutate({ ref, action: "unpause" })}
                                className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                                title="Unpause (superadmin)"
                              >
                                <PlayCircle className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={!ref || !running || actionMutation.isPending}
                                onClick={() => {
                                  if (confirm(`Send SIGKILL to "${containerName(row)}"? Processes stop immediately.`)) {
                                    actionMutation.mutate({ ref, action: "kill" });
                                  }
                                }}
                                className="p-1.5 rounded-md border border-amber-500/40 text-amber-600 hover:bg-amber-500/10 disabled:opacity-40"
                                title="Kill (SIGKILL, superadmin)"
                              >
                                <Skull className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            disabled={
                              !ref || !running || actionMutation.isPending || !canOpenDockerShell
                            }
                            onClick={() => setShellTarget({ ref, name: containerName(row) })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title={
                              canOpenDockerShell
                                ? "Interactive shell (docker exec /bin/sh)"
                                : "Shell is limited to administrators, or enable HOSTPANEL_DOCKER_SHELL_ALLOW_DOCKER_ACCESS on the API host."
                            }
                          >
                            <Terminal className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!ref || (logsTarget?.ref === ref && logsQuery.isFetching)}
                            onClick={() => setLogsTarget({ ref, name: containerName(row) })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title="View logs"
                          >
                            <ScrollText className="w-3.5 h-3.5" />
                          </button>
                          {staff ? (
                            <button
                              type="button"
                              disabled={!ref || actionMutation.isPending}
                              onClick={() => {
                                const n = containerName(row);
                                if (
                                  confirm(
                                    `Permanently remove Docker container "${n}"?\n\nFor hostpanel-site-* shells, re-enable isolation from the Sites page if needed.`
                                  )
                                ) {
                                  actionMutation.mutate({ ref, action: "remove" });
                                }
                              }}
                              className="p-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                              title="Remove container (staff)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {actionMutation.isError && (
          <div className="px-4 py-2 text-xs text-destructive border-t border-border">
            {(actionMutation.error as Error).message}
          </div>
        )}
      </div>

      {shellTarget ? (
        <DockerShellModal
          containerRef={shellTarget.ref}
          containerName={shellTarget.name}
          onClose={() => setShellTarget(null)}
        />
      ) : null}

      {logsTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="docker-logs-title"
        >
          <div className="w-full max-w-4xl max-h-[85vh] rounded-xl border bg-card shadow-lg flex flex-col">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
              <h3 id="docker-logs-title" className="font-semibold text-sm truncate">
                Logs — <span className="font-mono text-xs">{logsTarget.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setLogsTarget(null);
                  void queryClient.removeQueries({ queryKey: ["docker", "logs", logsTarget.ref] });
                }}
                className="p-2 rounded-lg border border-border hover:bg-secondary"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void logsQuery.refetch()}
                className="text-xs flex items-center gap-1.5 px-2 py-1 rounded-md border border-border hover:bg-secondary"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${logsQuery.isFetching ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <span className="text-xs text-muted-foreground">Last 300 lines</span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4">
              {logsQuery.isLoading ? (
                <div className="flex justify-center py-12 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : logsQuery.isError ? (
                <p className="text-sm text-destructive">{(logsQuery.error as Error).message}</p>
              ) : (
                <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-muted-foreground">
                  {logsQuery.data?.data?.logs ?? ""}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
