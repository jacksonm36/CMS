"use client";

import { useEffect, useState, useCallback } from "react";
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
  Network,
  Plus,
  Save,
  AlertCircle,
} from "lucide-react";
import { DockerShellModal } from "@/components/docker/docker-shell-modal";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DockerContainerRow } from "@hostpanel/types";

type PortBinding = {
  containerPort: string;
  hostIp: string;
  hostPort: string;
};

type DockerInspectData = {
  id: string;
  name: string;
  image: string;
  portBindings: PortBinding[];
  networkMode: string;
  isSidecar: boolean;
};

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

  const [portsTarget, setPortsTarget] = useState<{ ref: string; name: string } | null>(null);
  const [portsError, setPortsError] = useState<string | null>(null);

  const inspectQuery = useQuery({
    queryKey: ["docker", "inspect", portsTarget?.ref],
    queryFn: () =>
      apiClient.get<{ data: DockerInspectData }>(
        `/docker/containers/${encodeURIComponent(portsTarget!.ref)}/inspect`
      ),
    enabled: Boolean(portsTarget?.ref),
  });

  const portsMutation = useMutation({
    mutationFn: ({ ref, portBindings }: { ref: string; portBindings: PortBinding[] }) =>
      apiClient.post(`/docker/containers/${encodeURIComponent(ref)}/ports`, { portBindings }),
    onSuccess: () => {
      setPortsTarget(null);
      queryClient.invalidateQueries({ queryKey: ["docker", "containers"] });
      queryClient.invalidateQueries({ queryKey: ["docker", "inspect"] });
    },
    onError: (e) => setPortsError(e instanceof Error ? e.message : String(e)),
  });

  const openPortsModal = useCallback((ref: string, name: string) => {
    setPortsError(null);
    setPortsTarget({ ref, name });
  }, []);

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
                              disabled={!ref}
                              onClick={() => openPortsModal(ref, containerName(row))}
                              className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                              title="Manage port bindings (recreates container)"
                            >
                              <Network className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
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

      {portsTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="docker-ports-title"
        >
          <div className="w-full max-w-2xl rounded-xl border bg-card shadow-lg flex flex-col">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <h3 id="docker-ports-title" className="font-semibold text-sm flex items-center gap-2 truncate">
                <Network className="w-4 h-4 text-primary shrink-0" />
                Port bindings —{" "}
                <span className="font-mono text-xs">{portsTarget.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setPortsTarget(null);
                  void queryClient.removeQueries({ queryKey: ["docker", "inspect", portsTarget.ref] });
                }}
                className="p-2 rounded-lg border border-border hover:bg-secondary"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {inspectQuery.isLoading ? (
                <div className="flex justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : inspectQuery.isError ? (
                <p className="text-sm text-destructive">{(inspectQuery.error as Error).message}</p>
              ) : inspectQuery.data?.data?.isSidecar ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400 space-y-1">
                  <p className="font-medium">Site isolation container</p>
                  <p className="text-xs text-amber-400/80">
                    This is a HostPanel tenant sidecar (<code className="text-[10px]">hostpanel-site-*</code>). It uses{" "}
                    <code className="text-[10px]">--network none</code> and runs{" "}
                    <code className="text-[10px]">sleep infinity</code> as a filesystem-only shell target.
                    HTTP/HTTPS traffic is served by <strong>nginx on the host</strong> (:80/:443) — not by this container.
                    Port management is not applicable here.
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 space-y-1">
                    <p>
                      <strong className="text-foreground/80">Network mode:</strong>{" "}
                      <code className="text-[10px]">{inspectQuery.data?.data?.networkMode ?? "—"}</code>
                    </p>
                    <p className="text-muted-foreground/70">
                      Applying changes will <strong className="text-foreground/70">stop, remove, and recreate</strong> the container
                      with the same image, volumes, env, and labels but new port bindings.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
                      <span>Host port</span>
                      <span>Container port</span>
                      <span>Host IP (optional)</span>
                      <span />
                    </div>

                    <ContainerPortsBindingsEditor
                      key={inspectQuery.dataUpdatedAt ?? "loading"}
                      initialBindings={inspectQuery.data?.data?.portBindings ?? []}
                      portsError={portsError}
                      onClearError={() => setPortsError(null)}
                      onCancel={() => setPortsTarget(null)}
                      isPending={portsMutation.isPending}
                      onApply={(bindings) => {
                        setPortsError(null);
                        portsMutation.mutate({ ref: portsTarget.ref, portBindings: bindings });
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContainerPortsBindingsEditor({
  initialBindings,
  portsError,
  onClearError,
  onCancel,
  isPending,
  onApply,
}: {
  initialBindings: PortBinding[];
  portsError: string | null;
  onClearError: () => void;
  onCancel: () => void;
  isPending: boolean;
  onApply: (bindings: PortBinding[]) => void;
}) {
  const [editedPorts, setEditedPorts] = useState<PortBinding[]>(
    initialBindings.length > 0 ? initialBindings : [],
  );

  return (
    <>
      {editedPorts.map((pb, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <input
            type="number"
            min={1}
            max={65535}
            value={pb.hostPort}
            onChange={(e) => {
              const next = [...editedPorts];
              next[i] = { ...next[i]!, hostPort: e.target.value };
              setEditedPorts(next);
              onClearError();
            }}
            placeholder="e.g. 8080"
            className="px-2 py-1.5 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            value={pb.containerPort}
            onChange={(e) => {
              const next = [...editedPorts];
              next[i] = { ...next[i]!, containerPort: e.target.value };
              setEditedPorts(next);
              onClearError();
            }}
            placeholder="e.g. 80/tcp"
            className="px-2 py-1.5 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="text"
            value={pb.hostIp === "0.0.0.0" ? "" : pb.hostIp}
            onChange={(e) => {
              const next = [...editedPorts];
              next[i] = { ...next[i]!, hostIp: e.target.value || "0.0.0.0" };
              setEditedPorts(next);
              onClearError();
            }}
            placeholder="0.0.0.0"
            className="px-2 py-1.5 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => setEditedPorts(editedPorts.filter((_, j) => j !== i))}
            className="p-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10"
            title="Remove this binding"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setEditedPorts([...editedPorts, { hostPort: "", containerPort: "80/tcp", hostIp: "0.0.0.0" }])
        }
        className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md border border-dashed border-border hover:bg-secondary text-muted-foreground"
      >
        <Plus className="w-3.5 h-3.5" />
        Add port binding
      </button>

      {portsError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {portsError}
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => onApply(editedPorts)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Apply &amp; recreate
        </button>
      </div>
    </>
  );
}
