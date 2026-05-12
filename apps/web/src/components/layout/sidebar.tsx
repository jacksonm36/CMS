"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Globe,
  Shield,
  Zap,
  FileText,
  Activity,
  Code2,
  Settings,
  ChevronRight,
  Server,
  Database,
  Layers,
  MonitorCog,
  ShieldAlert,
  LayoutTemplate,
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const staff = user?.role === "superadmin" || user?.role === "admin";
  const dockerUser = Boolean(user?.dockerAccess);

  const navGroups = [
    {
      label: "Main",
      items: [
        { href: "/dashboard", icon: LayoutDashboard, label: "Overview", exact: true },
        { href: "/dashboard/sites", icon: Globe, label: "Sites" },
        ...(staff
          ? [
              { href: "/dashboard/site-templates", icon: LayoutTemplate, label: "Site templates" },
              { href: "/dashboard/webservers", icon: MonitorCog, label: "Web Servers" },
            ]
          : []),
        ...(staff || dockerUser ? [{ href: "/dashboard/docker", icon: Box, label: "Docker" }] : []),
        { href: "/dashboard/editor", icon: Code2, label: "Editor" },
      ],
    },
    {
      label: "Data",
      items: staff
        ? [
            { href: "/dashboard/databases", icon: Database, label: "Databases" },
            { href: "/dashboard/redis", icon: Layers, label: "Redis" },
            { href: "/dashboard/content", icon: FileText, label: "Content" },
          ]
        : [{ href: "/dashboard/content", icon: FileText, label: "Content" }],
    },
    {
      label: "Ops",
      items: staff
        ? [
            { href: "/dashboard/security", icon: Shield, label: "Security" },
            { href: "/dashboard/crowdsec", icon: ShieldAlert, label: "CrowdSec" },
            { href: "/dashboard/integrations", icon: Zap, label: "Integrations" },
            { href: "/dashboard/monitoring", icon: Activity, label: "Monitoring" },
            { href: "/dashboard/settings", icon: Settings, label: "Settings" },
          ]
        : [{ href: "/dashboard/settings", icon: Settings, label: "Settings" }],
    },
  ];

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <aside className="w-60 flex flex-col border-r border-sidebar-border bg-sidebar shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
        <div className="w-8 h-8 bg-primary/15 rounded-lg flex items-center justify-center">
          <Server className="w-4 h-4 text-primary" />
        </div>
        <span className="font-bold text-lg gradient-text">HostPanel</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-4">
        {navGroups.map(({ label, items }) => (
          <div key={label}>
            <p className="px-3 mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground/60 uppercase">{label}</p>
            <div className="space-y-0.5">
              {items.map(({ href, icon: Icon, label: itemLabel, exact }) => {
                const active = isActive(href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                    <span className="flex-1">{itemLabel}</span>
                    {active && <ChevronRight className="w-3.5 h-3.5 text-primary/60" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Version badge */}
      <div className="px-5 py-4 border-t border-sidebar-border">
        <p className="text-xs text-muted-foreground">HostPanel v1.0.0</p>
      </div>
    </aside>
  );
}
