"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Globe, Trash2, ExternalLink, Loader2, MoreVertical, Pause, Play, RefreshCw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { formatRelative, getStatusColor } from "@/lib/utils";
import type { Site, WebServerType } from "@hostpanel/types";

const WS_META: Record<WebServerType, { label: string; color: string; logo: string }> = {
  nginx:     { label: "Nginx",     color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", logo: "N" },
  apache2:   { label: "Apache2",   color: "bg-red-500/15 text-red-400 border-red-500/20",             logo: "A" },
  lighttpd:  { label: "Lighttpd",  color: "bg-sky-500/15 text-sky-400 border-sky-500/20",             logo: "L" },
  litespeed: { label: "LiteSpeed", color: "bg-violet-500/15 text-violet-400 border-violet-500/20",    logo: "LS" },
};

const SITE_TYPES = [
  { value: "static",  label: "Static HTML" },
  { value: "php",     label: "PHP" },
  { value: "nodejs",  label: "Node.js" },
  { value: "python",  label: "Python" },
];

export default function SitesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    type: "static" as Site["type"],
    webServer: "nginx" as WebServerType,
    phpVersion: "8.2",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiClient.get<{ data: Site[] }>("/sites"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/sites", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setShowCreate(false);
      setForm({ name: "", domain: "", type: "static", webServer: "nginx", phpVersion: "8.2" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/sites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sites"] }),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/sites/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sites"] }),
  });

  const switchWsMutation = useMutation({
    mutationFn: ({ id, webServer }: { id: string; webServer: WebServerType }) =>
      apiClient.patch(`/sites/${id}/webserver`, { webServer }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sites"] }),
  });

  const sites = data?.data ?? [];

  const wsCounts = sites.reduce<Record<string, number>>((acc, s) => {
    const ws = (s as unknown as { webServer?: string }).webServer ?? "nginx";
    acc[ws] = (acc[ws] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Sites</h2>
          <p className="text-sm text-muted-foreground">{sites.length} site{sites.length !== 1 ? "s" : ""} total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Site
        </button>
      </div>

      {/* Web server summary pills */}
      {sites.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(wsCounts) as [WebServerType, number][]).map(([ws, count]) => {
            const meta = WS_META[ws] ?? WS_META.nginx;
            return (
              <span key={ws} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${meta.color}`}>
                <span className="font-bold">{meta.logo}</span>
                {meta.label} — {count} site{count !== 1 ? "s" : ""}
              </span>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative z-10 w-full max-w-lg glass rounded-2xl p-6 shadow-2xl">
            <h3 className="text-lg font-semibold mb-5">Create New Site</h3>
            <div className="space-y-4">
              {/* Name + Domain */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Site Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Site" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Domain</label>
                  <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>

              {/* Site type + PHP version */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Site Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Site["type"] })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    {SITE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {form.type === "php" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">PHP Version</label>
                    <select value={form.phpVersion} onChange={(e) => setForm({ ...form, phpVersion: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      {["8.3", "8.2", "8.1", "8.0"].map((v) => <option key={v} value={v}>PHP {v}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Web server picker */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Web Server</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(WS_META) as [WebServerType, typeof WS_META[WebServerType]][]).map(([id, meta]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setForm({ ...form, webServer: id })}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                        form.webServer === id
                          ? `${meta.color} border-current ring-1 ring-current`
                          : "border-input hover:bg-accent"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold ${form.webServer === id ? meta.color : "bg-secondary text-muted-foreground"}`}>
                        {meta.logo}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {id === "nginx" ? "High performance" :
                           id === "apache2" ? ".htaccess support" :
                           id === "lighttpd" ? "Low memory" :
                           "LSAPI + cache"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowCreate(false)} className="flex-1 h-9 rounded-md border border-input text-sm hover:bg-accent transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => createMutation.mutate(form)}
                  disabled={createMutation.isPending || !form.name || !form.domain}
                  className="flex-1 h-9 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create Site
                </button>
              </div>
              {createMutation.isError && (
                <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sites grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-5 animate-pulse">
              <div className="h-4 bg-muted rounded w-1/2 mb-3" />
              <div className="h-3 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : sites.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Globe className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-1">No sites yet</h3>
          <p className="text-muted-foreground text-sm mb-4">Create your first site to get started</p>
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            <Plus className="w-4 h-4" /> New Site
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              onDelete={() => deleteMutation.mutate(site.id)}
              onToggle={() => toggleStatusMutation.mutate({ id: site.id, status: site.status === "active" ? "suspended" : "active" })}
              onSwitchWebServer={(ws) => switchWsMutation.mutate({ id: site.id, webServer: ws })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteCard({
  site,
  onDelete,
  onToggle,
  onSwitchWebServer,
}: {
  site: Site;
  onDelete: () => void;
  onToggle: () => void;
  onSwitchWebServer: (ws: WebServerType) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const statusColor = getStatusColor(site.status);
  const dotColor = statusColor === "success" ? "bg-emerald-400" : statusColor === "warning" ? "bg-amber-400" : "bg-red-400";
  const ws = ((site as unknown as { webServer?: WebServerType }).webServer ?? "nginx") as WebServerType;
  const wsMeta = WS_META[ws] ?? WS_META.nginx;

  return (
    <div className="rounded-xl border bg-card p-5 hover:border-border/80 transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${dotColor} mt-0.5 shrink-0`} />
          <div>
            <h3 className="font-semibold text-sm">{site.name}</h3>
            <a href={`http://${site.domain}`} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
              {site.domain}<ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-44 z-20 rounded-lg border bg-popover shadow-lg py-1">
                <a href={`/dashboard/editor?siteId=${site.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent">Open Editor</a>
                <button onClick={() => { onToggle(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left">
                  {site.status === "active" ? <><Pause className="w-3.5 h-3.5" /> Suspend</> : <><Play className="w-3.5 h-3.5" /> Activate</>}
                </button>
                {/* Web server sub-menu */}
                <div className="border-t my-1" />
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setWsMenuOpen(!wsMenuOpen); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Switch Web Server
                  </button>
                  {wsMenuOpen && (
                    <div className="absolute left-full top-0 ml-1 w-40 rounded-lg border bg-popover shadow-lg py-1 z-30">
                      {(Object.entries(WS_META) as [WebServerType, typeof WS_META[WebServerType]][]).map(([id, meta]) => (
                        <button
                          key={id}
                          onClick={() => { onSwitchWebServer(id); setMenuOpen(false); setWsMenuOpen(false); }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left ${ws === id ? "text-primary font-medium" : ""}`}
                        >
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${meta.color}`}>{meta.logo}</span>
                          {meta.label}
                          {ws === id && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t my-1" />
                <button onClick={() => { if (confirm(`Delete ${site.name}?`)) { onDelete(); setMenuOpen(false); } }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-destructive/10 text-destructive text-left">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {/* Web server badge */}
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${wsMeta.color}`}>
          <span className="font-bold">{wsMeta.logo}</span> {wsMeta.label}
        </span>
        {/* Site type */}
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium capitalize bg-secondary text-secondary-foreground">
          {site.type}{site.phpVersion ? ` ${site.phpVersion}` : ""}
        </span>
        {/* Status */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
          site.status === "active" ? "bg-emerald-500/15 text-emerald-400" :
          site.status === "suspended" ? "bg-amber-500/15 text-amber-400" :
          "bg-red-500/15 text-red-400"
        }`}>
          {site.status}
        </span>
      </div>

      <p className="text-xs text-muted-foreground mt-3">Created {formatRelative(site.createdAt)}</p>
    </div>
  );
}
