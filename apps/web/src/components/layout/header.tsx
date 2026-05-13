"use client";

import { Bell, LogOut, User, Settings, Moon, Sun } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { usePathname } from "next/navigation";

const routeLabels: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/sites": "Sites",
  "/dashboard/editor": "Editor",
  "/dashboard/security": "Security",
  "/dashboard/integrations": "Integrations",
  "/dashboard/content": "Content",
  "/dashboard/monitoring": "Monitoring",
  "/dashboard/databases": "Database Management",
  "/dashboard/redis": "Redis Management",
  "/dashboard/webservers": "Web Servers",
  "/dashboard/crowdsec": "CrowdSec",
  "/dashboard/docker": "Docker",
  "/dashboard/users": "Users",
  "/dashboard/settings": "Settings",
};

export function Header() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  const pageTitle = routeLabels[pathname] ?? "HostPanel";

  function toggleTheme() {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle("light");
  }

  return (
    <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm shrink-0">
      <div>
        <h1 className="text-lg font-semibold">{pageTitle}</h1>
        <p className="text-xs text-muted-foreground hidden sm:block">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Notifications */}
        <button className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent transition-colors"
          >
            <div className="w-7 h-7 bg-primary/20 rounded-full flex items-center justify-center">
              <span className="text-xs font-semibold text-primary">
                {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "U"}
              </span>
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium leading-none">{user?.name ?? "User"}</p>
              <p className="text-xs text-muted-foreground">{user?.role}</p>
            </div>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 z-20 rounded-lg border bg-popover shadow-lg py-1">
                <div className="px-3 py-2 border-b">
                  <p className="text-sm font-medium truncate">{user?.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
                </div>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left transition-colors"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  Profile
                </Link>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left transition-colors"
                >
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  Settings
                </Link>
                <div className="border-t my-1" />
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-destructive/10 text-destructive text-left transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
