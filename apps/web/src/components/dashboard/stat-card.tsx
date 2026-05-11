import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  total?: number;
  icon: LucideIcon;
  color?: "primary" | "green" | "red" | "warn" | "muted";
  trend?: "up" | "down" | "warn" | "neutral";
  subtitle?: string;
}

const colorMap = {
  primary: "text-primary bg-primary/10",
  green: "text-emerald-400 bg-emerald-400/10",
  red: "text-red-400 bg-red-400/10",
  warn: "text-amber-400 bg-amber-400/10",
  muted: "text-muted-foreground bg-muted",
};

export function StatCard({ title, value, total, icon: Icon, color = "primary", trend, subtitle }: StatCardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-amber-400";

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground font-medium">{title}</p>
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", colorMap[color])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold">
          {value}
          {total !== undefined && <span className="text-base font-normal text-muted-foreground">/{total}</span>}
        </p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {trend && (
        <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
          <TrendIcon className="w-3 h-3" />
          {trend === "up" ? "Healthy" : trend === "down" ? "Issues detected" : "Warning"}
        </div>
      )}
    </div>
  );
}
