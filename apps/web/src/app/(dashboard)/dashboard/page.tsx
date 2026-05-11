"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Globe, Shield, Activity, Server, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, Clock,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { formatBytes, formatRelative } from "@/lib/utils";
import type { SystemMetrics, Site, UptimeCheck } from "@hostpanel/types";
import { MetricsChart } from "@/components/monitoring/metrics-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { RecentActivity } from "@/components/dashboard/recent-activity";

export default function DashboardPage() {
  const { data: metricsData } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => apiClient.get<{ data: SystemMetrics }>("/monitoring/metrics"),
    refetchInterval: 10000,
  });

  const { data: metricsHistory } = useQuery({
    queryKey: ["metrics-history"],
    queryFn: () => apiClient.get<{ data: SystemMetrics[] }>("/monitoring/metrics/history?minutes=60"),
    refetchInterval: 60000,
  });

  const { data: sitesData } = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiClient.get<{ data: Site[] }>("/sites"),
  });

  const { data: uptimeData } = useQuery({
    queryKey: ["uptime"],
    queryFn: () => apiClient.get<{ data: UptimeCheck[] }>("/monitoring/uptime"),
  });

  const metrics = metricsData?.data;
  const sites = sitesData?.data ?? [];
  const uptimeChecks = uptimeData?.data ?? [];
  const history = metricsHistory?.data ?? [];

  const activeSites = sites.filter((s) => s.status === "active").length;
  const upChecks = uptimeChecks.filter((c) => c.lastStatus === "up").length;
  const downChecks = uptimeChecks.filter((c) => c.lastStatus === "down").length;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Sites"
          value={activeSites}
          total={sites.length}
          icon={Globe}
          color="primary"
          trend={activeSites === sites.length ? "up" : "warn"}
        />
        <StatCard
          title="CPU Usage"
          value={metrics ? `${metrics.cpu}%` : "—"}
          icon={Server}
          color={!metrics ? "muted" : metrics.cpu > 80 ? "red" : metrics.cpu > 60 ? "warn" : "green"}
          subtitle={metrics ? `${metrics.loadAvg[0].toFixed(2)} load avg` : undefined}
        />
        <StatCard
          title="Memory"
          value={metrics ? `${metrics.memory.percent}%` : "—"}
          icon={Activity}
          color={!metrics ? "muted" : metrics.memory.percent > 85 ? "red" : "green"}
          subtitle={metrics ? `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}` : undefined}
        />
        <StatCard
          title="Uptime Monitors"
          value={`${upChecks}/${uptimeChecks.length}`}
          icon={Shield}
          color={downChecks > 0 ? "red" : "green"}
          trend={downChecks > 0 ? "down" : "up"}
          subtitle={downChecks > 0 ? `${downChecks} down` : "All healthy"}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricsChart data={history} metric="cpu" title="CPU Usage" color="#6366f1" unit="%" />
        <MetricsChart data={history} metric="memory.percent" title="Memory Usage" color="#8b5cf6" unit="%" />
      </div>

      {/* Disk / Network */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Disk Usage</p>
              <span className={`text-sm font-bold ${metrics.disk.percent > 80 ? "text-red-400" : "text-emerald-400"}`}>
                {metrics.disk.percent}%
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${metrics.disk.percent > 80 ? "bg-red-400" : "bg-emerald-400"}`}
                style={{ width: `${metrics.disk.percent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatBytes(metrics.disk.used)} / {formatBytes(metrics.disk.total)}
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Network I/O</p>
            <div className="flex gap-4">
              <div>
                <div className="flex items-center gap-1 text-emerald-400 text-sm font-semibold">
                  <TrendingDown className="w-3.5 h-3.5" />
                  {metrics.network.rx} KB/s
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Inbound</p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-violet-400 text-sm font-semibold">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {metrics.network.tx} KB/s
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Outbound</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">System Uptime</p>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span className="text-lg font-bold">{formatUptime(metrics.uptime)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Load: {metrics.loadAvg.join(" / ")}</p>
          </div>
        </div>
      )}

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sites table */}
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="font-semibold">Recent Sites</h3>
            <a href="/dashboard/sites" className="text-xs text-primary hover:underline">View all</a>
          </div>
          <div className="divide-y divide-border">
            {sites.slice(0, 5).map((site) => (
              <div key={site.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${site.status === "active" ? "bg-emerald-400" : site.status === "error" ? "bg-red-400" : "bg-amber-400"}`} />
                  <div>
                    <p className="text-sm font-medium">{site.name}</p>
                    <p className="text-xs text-muted-foreground">{site.domain}</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground capitalize">{site.type}</span>
              </div>
            ))}
            {sites.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                No sites yet. <a href="/dashboard/sites" className="text-primary hover:underline">Create one</a>
              </div>
            )}
          </div>
        </div>

        {/* Uptime monitors */}
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="font-semibold">Uptime Monitors</h3>
            <a href="/dashboard/monitoring" className="text-xs text-primary hover:underline">View all</a>
          </div>
          <div className="divide-y divide-border">
            {uptimeChecks.slice(0, 5).map((check) => (
              <div key={check.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  {check.lastStatus === "up"
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  }
                  <div>
                    <p className="text-sm font-medium">{check.name}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[160px]">{check.url}</p>
                  </div>
                </div>
                <div className="text-right">
                  {check.lastResponseMs && (
                    <p className="text-xs font-medium">{check.lastResponseMs}ms</p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatRelative(check.lastCheckedAt)}</p>
                </div>
              </div>
            ))}
            {uptimeChecks.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                No monitors. <a href="/dashboard/monitoring" className="text-primary hover:underline">Add one</a>
              </div>
            )}
          </div>
        </div>
      </div>

      <RecentActivity />
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
