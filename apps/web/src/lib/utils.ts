import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatRelative(date: string | Date | null): string {
  if (!date) return "Never";
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDate(date: string | Date | null, fmt = "MMM d, yyyy HH:mm"): string {
  if (!date) return "—";
  return format(new Date(date), fmt);
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    active: "success",
    up: "success",
    valid: "success",
    suspended: "warning",
    expiring: "warning",
    pending: "info",
    error: "destructive",
    down: "destructive",
    expired: "destructive",
    unknown: "secondary",
  };
  return map[status] ?? "secondary";
}
