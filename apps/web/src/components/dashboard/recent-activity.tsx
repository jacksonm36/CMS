"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import type { AuditLog, PaginatedResponse } from "@hostpanel/types";

export function RecentActivity() {
  const { data } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => apiClient.get<{ data: PaginatedResponse<AuditLog> }>("/security/audit-logs?pageSize=10"),
  });

  const logs = data?.data.data ?? [];

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between p-5 pb-3">
        <h3 className="font-semibold">Recent Activity</h3>
        <a href="/dashboard/security" className="text-xs text-primary hover:underline">View audit log</a>
      </div>
      <div className="divide-y divide-border">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start justify-between px-5 py-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">
                  {log.userEmail?.[0]?.toUpperCase() ?? "S"}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{log.action}</p>
                <p className="text-xs text-muted-foreground">{log.userEmail ?? "System"} · {log.ip}</p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap ml-3 mt-0.5">{formatRelative(log.createdAt)}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No activity yet</div>
        )}
      </div>
    </div>
  );
}
