"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Box,
  Loader2,
  Play,
  Square,
  RefreshCw,
  Server,
  Shield,
  Users,
} from "lucide-react";
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
  return (row.ID ?? row.Id ?? "").trim();
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

export default function DockerPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const staff = user?.role === "superadmin" || user?.role === "admin";
  const canUseDocker = staff || Boolean(user?.dockerAccess);

  useEffect(() => {
    if (authLoading) return;
    if (!user) router.replace("/login");
    else if (!canUseDocker) router.replace("/dashboard");
  }, [authLoading, user, canUseDocker, router]);

  const ping = useQuery({
    queryKey: ["docker", "ping"],
    queryFn: () => apiClient.get<{ data: { ok: boolean; serverVersion?: string } }>("/docker/ping"),
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
    mutationFn: ({ id, action }: { id: string; action: "start" | "stop" | "restart" }) =>
      apiClient.post(`/docker/containers/${encodeURIComponent(id)}/action`, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["docker", "containers"] }),
  });

  if (authLoading || !user || !canUseDocker) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading…
      </div>
    );
  }

  const pingData = ping.data?.data;
  const list = containers.data?.data ?? [];

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Box className="w-6 h-6 text-primary" />
          Docker
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          View containers on this host and run start/stop/restart. Staff always have access; other panel users need{" "}
          <span className="text-foreground/90">Docker access</span> enabled below.
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
            All containers visible to the HostPanel service account (same as <code className="text-[10px]">docker ps -a</code>). Rows named{" "}
            <code className="text-[10px]">hostpanel-site-…</code> are tenant isolation shells: they intentionally have{" "}
            <strong className="text-foreground/90 font-medium">no published ports</strong>; your site is still served by nginx on{" "}
            <strong className="text-foreground/90 font-medium">:80 / :443</strong>.
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
                  <th className="px-4 py-2 font-medium w-[1%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row, idx) => {
                  const id = containerId(row);
                  const running = /^Up\s/i.test(containerStatus(row));
                  return (
                    <tr key={id || `docker-row-${idx}`} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs max-w-[200px] truncate" title={id}>
                        {containerName(row)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">{containerImage(row)}</td>
                      <td className="px-4 py-2.5 text-xs">{containerStatus(row)}</td>
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
                            disabled={!id || running || actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ id, action: "start" })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title="Start"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!id || !running || actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ id, action: "stop" })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title="Stop"
                          >
                            <Square className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!id || !running || actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ id, action: "restart" })}
                            className="p-1.5 rounded-md border border-border hover:bg-secondary disabled:opacity-40"
                            title="Restart"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
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
    </div>
  );
}
