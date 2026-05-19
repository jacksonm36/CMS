"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, Globe2, Hash, Loader2, Radio, RefreshCw, Table2, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiClient } from "@/lib/api";
import type { WebServerType } from "@hostpanel/types";
import type { WebserverAnalyticsPayload } from "@/types/webserver-analytics";
import { useWebserverLiveStream } from "@/hooks/use-webserver-live-stream";

export type { WebserverAnalyticsPayload };

function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function trunc(s: string | null, max: number): string {
  if (!s) return "—";
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

const LIVE_CAPABLE: ReadonlySet<WebServerType> = new Set(["nginx", "openresty", "apache2", "lighttpd", "litespeed", "caddy", "traefik"]);

export function WebserverAnalyticsPanel({
  enabled = true,
  authToken,
  serverId,
  nginxLogScope,
  onNginxLogScopeChange,
}: {
  enabled?: boolean;
  authToken?: string | null;
  serverId: WebServerType;
  nginxLogScope?: "daemon" | "panel";
  onNginxLogScopeChange?: (scope: "daemon" | "panel") => void;
}) {
  const canLive = LIVE_CAPABLE.has(serverId);
  const [liveOn, setLiveOn] = useState(true);
  const scopeEff = nginxLogScope ?? "daemon";
  const scopeQs = serverId === "nginx" ? `&scope=${scopeEff}` : "";

  const live = useWebserverLiveStream({
    enabled: Boolean(enabled && liveOn && canLive && authToken),
    token: authToken ?? null,
    serverId,
    scope: serverId === "nginx" ? scopeEff : "daemon",
  });

  const query = useQuery({
    queryKey: ["webservers", serverId, "analytics", serverId === "nginx" ? scopeEff : "daemon"],
    queryFn: () =>
      apiClient.get<{ data: WebserverAnalyticsPayload }>(
        `/webservers/${serverId}/analytics?lines=5000${scopeQs}`,
      ),
    staleTime: 20_000,
    enabled,
    refetchInterval: enabled && (!liveOn || !canLive || !authToken) ? 15_000 : false,
  });

  const d = live.payload?.analytics ?? query.data?.data ?? null;

  const chartData = useMemo(
    () =>
      d?.requestsPerMinute.map((p) => ({
        ...p,
        tick: (() => {
          try {
            return format(new Date(`${p.minuteKey}:00`), "HH:mm");
          } catch {
            return p.label;
          }
        })(),
      })) ?? [],
    [d?.requestsPerMinute],
  );

  const showBody = Boolean(d);
  const showLoader = !d && query.isLoading;

  return (
    <div className="rounded-lg border bg-[#0d1117] overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#161b22] border-b border-border">
        <Activity className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">Access log analytics</span>
        {canLive && authToken && (
          <button
            type="button"
            title="WebSocket ~2.5s updates + merged vhost logs"
            onClick={() => setLiveOn((v) => !v)}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border ${
              liveOn ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <Radio className={`w-3 h-3 ${liveOn && live.connected ? "animate-pulse" : ""}`} />
            Live
            {liveOn && (
              <span className="text-muted-foreground">
                {live.connected ? "· on" : "· …"}
              </span>
            )}
          </button>
        )}
        <span className="text-[10px] text-muted-foreground/80">(tail sample)</span>
        {serverId === "nginx" && onNginxLogScopeChange && (
          <div className="flex gap-1 order-last sm:order-none sm:ml-2">
            <button
              type="button"
              onClick={() => onNginxLogScopeChange("daemon")}
              className={`px-2 py-0.5 text-[10px] rounded ${scopeEff === "daemon" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              Main access
            </button>
            <button
              type="button"
              onClick={() => onNginxLogScopeChange("panel")}
              className={`px-2 py-0.5 text-[10px] rounded ${scopeEff === "panel" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              HostPanel vhost
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {live.error && liveOn && canLive && (
        <div className="px-4 py-1.5 text-[10px] text-amber-400 border-b border-border bg-amber-500/5">{live.error}</div>
      )}

      {d?.logPath && (
        <div className="px-4 py-1.5 border-b border-border text-[10px] font-mono text-muted-foreground break-all">
          {d.logPath}
          {d.sourceHint && (
            <span className="block text-[9px] text-muted-foreground/80 mt-1 normal-case">{d.sourceHint}</span>
          )}
          {live.payload?.at && liveOn ? (
            <span className="block text-[9px] text-muted-foreground/70 mt-0.5">Live frame: {live.payload.at}</span>
          ) : null}
        </div>
      )}

      <div className="p-4 space-y-4">
        {showLoader && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…
          </div>
        )}

        {query.isError && !d && (
          <p className="text-sm text-destructive">{(query.error as Error).message}</p>
        )}

        {showBody && d && (
          <>
            {liveOn && live.payload && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-lg border border-border/60 bg-[#010409] overflow-hidden">
                  <p className="text-[10px] font-medium text-muted-foreground px-2 py-1.5 bg-[#161b22] border-b border-border">
                    Access log (tail)
                  </p>
                  <pre className="text-[10px] font-mono text-[#94a3b8] p-2 max-h-40 overflow-auto leading-relaxed whitespace-pre-wrap break-all">
                    {live.payload.accessTail.filter(Boolean).join("\n") || "—"}
                  </pre>
                </div>
                <div className="rounded-lg border border-border/60 bg-[#010409] overflow-hidden">
                  <p className="text-[10px] font-medium text-muted-foreground px-2 py-1.5 bg-[#161b22] border-b border-border">
                    Error log (tail)
                  </p>
                  <pre className="text-[10px] font-mono text-[#94a3b8] p-2 max-h-40 overflow-auto leading-relaxed whitespace-pre-wrap break-all">
                    {live.payload.errorTail.filter(Boolean).join("\n") || "—"}
                  </pre>
                </div>
              </div>
            )}

            {d.note && (
              <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">{d.note}</p>
            )}
            {scopeEff === "daemon" && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Daemon scope merges the main access log with per-site HostPanel vhost logs for this stack
                {serverId === "nginx" ? " (including edge proxy *.edge.access.log for non-nginx backends)" : ""}.
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border/60 bg-[#161b22] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  <Activity className="w-3 h-3" /> Requests
                </div>
                <p className="text-lg font-semibold text-foreground mt-0.5">{d.parsedLines}</p>
                <p className="text-[10px] text-muted-foreground">parsed / {d.sampleLines} lines</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-[#161b22] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  <Users className="w-3 h-3" /> Clients
                </div>
                <p className="text-lg font-semibold text-foreground mt-0.5">{d.uniqueClients}</p>
                <p className="text-[10px] text-muted-foreground">unique IPs in sample</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-[#161b22] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  <Globe2 className="w-3 h-3" /> Volume
                </div>
                <p className="text-lg font-semibold text-foreground mt-0.5">{formatBytes(d.totalBytes)}</p>
                <p className="text-[10px] text-muted-foreground">response bytes (parsed)</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-[#161b22] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  <Hash className="w-3 h-3" /> Skipped
                </div>
                <p className="text-lg font-semibold text-foreground mt-0.5">{d.parseFailures}</p>
                <p className="text-[10px] text-muted-foreground">non-matching lines</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Traffic (requests per minute)</p>
              <div className="h-[140px] w-full">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`ws-analytics-${serverId}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="tick"
                        tick={{ fontSize: 9, fill: "#64748b" }}
                        interval="preserveStartEnd"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        width={32}
                        tick={{ fontSize: 9, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "11px",
                        }}
                        formatter={(value: number, name: string) => [value, name === "requests" ? "Requests" : name]}
                        labelFormatter={(_, payload) => {
                          const p = payload?.[0]?.payload as { minuteKey?: string } | undefined;
                          return p?.minuteKey?.replace("T", " ") ?? "";
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="requests"
                        name="requests"
                        stroke="#a78bfa"
                        strokeWidth={1.5}
                        fill={`url(#ws-analytics-${serverId})`}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/50 rounded-lg">
                    No minute buckets yet
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Top client IPs</p>
                <div className="rounded-lg border border-border/60 max-h-44 overflow-auto">
                  {d.topClients.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3">No client data</p>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead className="text-muted-foreground border-b border-border/60 bg-[#161b22]">
                        <tr>
                          <th className="text-left font-medium px-2 py-1.5">IP</th>
                          <th className="text-right font-medium px-2 py-1.5 w-20">Hits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.topClients.map((row) => (
                          <tr key={row.ip} className="border-b border-border/40 last:border-0">
                            <td className="px-2 py-1 font-mono text-[#94a3b8]">{row.ip}</td>
                            <td className="px-2 py-1 text-right text-foreground">{row.requests}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">HTTP status</p>
                  <div className="h-[100px]">
                    {d.statusDistribution.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={d.statusDistribution} layout="vertical" margin={{ left: 4, right: 8, top: 0, bottom: 0 }}>
                          <XAxis type="number" hide />
                          <YAxis
                            type="category"
                            dataKey="status"
                            width={36}
                            tick={{ fontSize: 10, fill: "#94a3b8" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "11px",
                            }}
                          />
                          <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </div>
                </div>
                {d.methodDistribution.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Methods</p>
                    <div className="flex flex-wrap gap-1.5">
                      {d.methodDistribution.map((m) => (
                        <span
                          key={m.method}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-secondary/80 text-muted-foreground border border-border/60"
                        >
                          <span className="font-mono text-foreground/90">{m.method}</span>{" "}
                          <span className="text-muted-foreground">{m.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {(d.recentAccess?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#161b22] border-b border-border">
                  <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <p className="text-xs font-medium text-muted-foreground">Recent requests</p>
                  <span className="text-[10px] text-muted-foreground/80">
                    Newest first · country via GeoIP on server (geoip-lite)
                  </span>
                </div>
                <div className="max-h-[min(28rem,55vh)] overflow-auto">
                  <table className="w-full text-[10px]">
                    <thead className="sticky top-0 bg-[#0d1117] z-10 text-muted-foreground border-b border-border shadow-sm">
                      <tr>
                        <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">When</th>
                        <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">IP</th>
                        <th className="text-left font-medium px-2 py-1.5">Country</th>
                        <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">Method</th>
                        <th className="text-left font-medium px-2 py-1.5 min-w-[140px]">Resource</th>
                        <th className="text-center font-medium px-2 py-1.5 w-10">HTTP</th>
                        <th className="text-right font-medium px-2 py-1.5 w-14">Bytes</th>
                        <th className="text-left font-medium px-2 py-1.5 min-w-[120px]">Client</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(d.recentAccess ?? []).map((row, idx) => (
                        <tr key={`${row.datetime}-${row.ip}-${idx}`} className="border-b border-border/30 align-top hover:bg-[#161b22]/40">
                          <td className="px-2 py-1 font-mono text-[#94a3b8] whitespace-nowrap">{row.datetime}</td>
                          <td className="px-2 py-1 font-mono text-[#a7c4e8] whitespace-nowrap">{row.ip}</td>
                          <td className="px-2 py-1 text-[#94a3b8]" title={row.countryName}>
                            <span className="font-mono text-foreground/90">{row.countryCode}</span>
                            {row.countryCode !== "—" && (
                              <span className="block truncate max-w-[120px] text-muted-foreground">{row.countryName}</span>
                            )}
                          </td>
                          <td className="px-2 py-1 font-mono text-emerald-400/90 whitespace-nowrap">{row.method}</td>
                          <td
                            className="px-2 py-1 max-w-[min(24rem,40vw)]"
                            title={[row.path, row.referrer ? `Referer: ${row.referrer}` : ""].filter(Boolean).join("\n")}
                          >
                            <span className="truncate block font-mono text-[#c9d1d9]">{row.path}</span>
                          </td>
                          <td className="px-2 py-1 text-center font-mono">{row.status}</td>
                          <td className="px-2 py-1 text-right font-mono text-muted-foreground">{formatBytes(row.bytes)}</td>
                          <td className="px-2 py-1 max-w-[min(18rem,32vw)] text-muted-foreground" title={row.userAgent ?? ""}>
                            <span className="truncate block">{trunc(row.userAgent, 80)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
