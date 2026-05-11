"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import type { SystemMetrics } from "@hostpanel/types";

interface MetricsChartProps {
  data: SystemMetrics[];
  metric: string;
  title: string;
  color?: string;
  unit?: string;
}

function getValue(obj: SystemMetrics, path: string): number {
  const parts = path.split(".");
  let val: unknown = obj;
  for (const part of parts) {
    if (val !== null && typeof val === "object") val = (val as Record<string, unknown>)[part];
    else return 0;
  }
  return typeof val === "number" ? val : 0;
}

export function MetricsChart({ data, metric, title, color = "#6366f1", unit = "" }: MetricsChartProps) {
  const chartData = data.map((d) => ({
    time: format(new Date(d.timestamp), "HH:mm"),
    value: getValue(d, metric),
  }));

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">{title}</h3>
        {chartData.length > 0 && (
          <span className="text-xl font-bold" style={{ color }}>
            {chartData[chartData.length - 1]?.value ?? 0}{unit}
          </span>
        )}
      </div>
      <div className="h-[120px]">
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 2, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                interval="preserveStartEnd"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}${unit}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "hsl(var(--foreground))",
                }}
                formatter={(value: number) => [`${value}${unit}`, title]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#grad-${metric})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Collecting metrics...
          </div>
        )}
      </div>
    </div>
  );
}
