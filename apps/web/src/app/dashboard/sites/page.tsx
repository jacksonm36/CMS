"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Plus, Globe, Trash2, ExternalLink, Loader2, MoreVertical, Pause, Play, RefreshCw, Cpu, Box, Network, Database, Home } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatRelative, getStatusColor } from "@/lib/utils";
import type { Site, WebServerType } from "@hostpanel/types";

type StackCatalog = {
  phpVersions: readonly string[];
  nodeVersions: readonly string[];
  pythonVersions: readonly string[];
  dbStackVersions: readonly string[];
  siteTypes: readonly string[];
};

const WS_META: Record<WebServerType, { label: string; color: string; logo: string }> = {
  nginx:      { label: "Nginx",      color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", logo: "N" },
  apache2:    { label: "Apache2",    color: "bg-red-500/15 text-red-400 border-red-500/20",             logo: "A" },
  lighttpd:   { label: "Lighttpd",   color: "bg-sky-500/15 text-sky-400 border-sky-500/20",             logo: "L" },
  litespeed:  { label: "LiteSpeed",  color: "bg-violet-500/15 text-violet-400 border-violet-500/20",    logo: "LS" },
  caddy:      { label: "Caddy",      color: "bg-teal-500/15 text-teal-400 border-teal-500/25",           logo: "C" },
  openresty:  { label: "OpenResty",  color: "bg-orange-500/15 text-orange-400 border-orange-500/25",     logo: "OR" },
  traefik:    { label: "Traefik",    color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",           logo: "T" },
};

/** Traefik is reverse-proxy-only in HostPanel — hide for PHP/static site types. */
function wsChoicesForSiteType(type: Site["type"]): [WebServerType, (typeof WS_META)[WebServerType]][] {
  const all = Object.entries(WS_META) as [WebServerType, (typeof WS_META)[WebServerType]][];
  if (type === "php" || type === "static") return all.filter(([id]) => id !== "traefik");
  return all;
}

const SITE_TYPES: { value: Site["type"]; label: string }[] = [
  { value: "static", label: "Static HTML / JS" },
  { value: "php", label: "PHP" },
  { value: "nodejs", label: "Node.js app" },
  { value: "python", label: "Python app" },
];

function SiteTypeHint({ type }: { type: Site["type"] }) {
  const copy: Record<Site["type"], string> = {
    static: "Upload HTML, CSS, and client-side assets. No server-side code.",
    php: "Runs PHP via FastCGI (WordPress, Laravel, plain PHP). Upload scripts to your site root.",
    nodejs:
      "For Express, Fastify, Nest, custom HTTP servers, etc. Visitors reach Nginx/Caddy/Traefik first; it proxies to your Node process on the port you set below.",
    python: "For FastAPI, Django, Flask + gunicorn, etc. Run your app so it listens on the port below.",
  };
  return <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{copy[type]}</p>;
}

export default function SitesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const staff = user?.role === "superadmin" || user?.role === "admin";
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    type: "static" as Site["type"],
    webServer: "nginx" as WebServerType,
    phpVersion: "8.2",
    nodeVersion: "20",
    pythonVersion: "3.12",
    dbStackVersion: "postgresql-16",
    /** Empty = auto-assign from 10000–19999 */
    appProxyPort: "" as string,
    /** Staff: assign site to this panel user (customer tenant) */
    ownerId: "" as string,
    networkGroup: "",
    isCentralService: false,
    defaultDocument: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiClient.get<{ data: Site[] }>("/sites"),
  });

  const { data: catalogRes } = useQuery({
    queryKey: ["sites", "stack-catalog"],
    queryFn: () => apiClient.get<{ data: StackCatalog }>("/sites/stack-catalog"),
    staleTime: 60_000,
  });
  const catalog = catalogRes?.data;

  const { data: networkGroupsRes } = useQuery({
    queryKey: ["sites", "network-groups"],
    queryFn: () => apiClient.get<{ data: string[] }>("/sites/network-groups"),
    enabled: staff,
    staleTime: 30_000,
  });
  const existingGroups = networkGroupsRes?.data ?? [];

  const { data: panelUsersRes } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: () =>
      apiClient.get<{ data: { id: string; email: string; name: string | null; role: string }[] }>("/auth/users"),
    enabled: staff,
    staleTime: 60_000,
  });
  const panelUsers = panelUsersRes?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => {
      const body: Record<string, unknown> = {
        name: payload.name,
        domain: payload.domain,
        type: payload.type,
        webServer: payload.webServer,
        dbStackVersion: payload.dbStackVersion,
        networkGroup: payload.networkGroup.trim() || null,
        isCentralService: payload.isCentralService,
      };
      if (staff && payload.ownerId) body.ownerId = payload.ownerId;
      if (payload.type === "php") body.phpVersion = payload.phpVersion;
      if (payload.type === "nodejs") body.nodeVersion = payload.nodeVersion;
      if (payload.type === "python") body.pythonVersion = payload.pythonVersion;
      // Only send appProxyPort if explicitly set; otherwise backend auto-assigns
      const port = parseInt(payload.appProxyPort);
      if (!isNaN(port) && port >= 1024) body.appProxyPort = port;
      if (payload.type === "static" || payload.type === "php") {
        const h = payload.defaultDocument.trim();
        if (h) body.defaultDocument = h;
      }
      return apiClient.post("/sites", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["sites", "network-groups"] });
      setShowCreate(false);
      setForm({
        name: "", domain: "", type: "static", webServer: "nginx",
        phpVersion: "8.2", nodeVersion: "20", pythonVersion: "3.12",
        dbStackVersion: "postgresql-16", appProxyPort: "", ownerId: "",
        networkGroup: "", isCentralService: false, defaultDocument: "",
      });
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
    const ws = s.webServer ?? "nginx";
    acc[ws] = (acc[ws] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Sites</h2>
          <p className="text-sm text-muted-foreground">
            {sites.length} site{sites.length !== 1 ? "s" : ""} total · Host static files, PHP,{" "}
            <span className="text-foreground/90">Node.js</span>, or Python — each with its own domain and stack
          </p>
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
                  <select
                    value={form.type}
                    onChange={(e) => {
                      const t = e.target.value as Site["type"];
                      setForm((f) => ({
                        ...f,
                        type: t,
                        webServer:
                          (t === "php" || t === "static") && f.webServer === "traefik" ? "nginx" : f.webServer,
                        defaultDocument:
                          t === "static" || t === "php" ? f.defaultDocument : "",
                      }));
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {SITE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {form.type === "php" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">PHP Version</label>
                    <select value={form.phpVersion} onChange={(e) => setForm({ ...form, phpVersion: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      {(catalog?.phpVersions ?? ["8.4", "8.3", "8.2", "8.1", "8.0"]).map((v) => (
                        <option key={v} value={v}>PHP {v}</option>
                      ))}
                    </select>
                  </div>
                )}
                {form.type === "nodejs" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Node.js line</label>
                    <select value={form.nodeVersion} onChange={(e) => setForm({ ...form, nodeVersion: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      {(catalog?.nodeVersions ?? ["24", "22", "20", "18"]).map((v) => (
                        <option key={v} value={v}>Node {v}</option>
                      ))}
                    </select>
                  </div>
                )}
                {form.type === "python" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Python</label>
                    <select value={form.pythonVersion} onChange={(e) => setForm({ ...form, pythonVersion: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      {(catalog?.pythonVersions ?? ["3.13", "3.12", "3.11", "3.10"]).map((v) => (
                        <option key={v} value={v}>Python {v}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <SiteTypeHint type={form.type} />

              {(form.type === "static" || form.type === "php") && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Homepage file{" "}
                    <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <input
                    value={form.defaultDocument}
                    onChange={(e) => setForm({ ...form, defaultDocument: e.target.value })}
                    placeholder="e.g. main.html — empty uses index.html"
                    className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use when your entry page is not named index.html (avoids nginx 403 on /).
                  </p>
                </div>
              )}

              {staff && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Assign to customer (optional)</label>
                  <select
                    value={form.ownerId}
                    onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">— Panel operator (you) —</option>
                    {panelUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email}
                        {u.name ? ` (${u.name})` : ""} · {u.role}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Customers only see sites they own. Leave empty to keep the site under your admin account.
                  </p>
                </div>
              )}

              {(form.type === "nodejs" || form.type === "python" || form.type === "php") && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    App port{" "}
                    <span className="text-xs font-normal text-muted-foreground">(blank = auto-assign)</span>
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={form.appProxyPort}
                    onChange={(e) => setForm({ ...form, appProxyPort: e.target.value })}
                    placeholder="Auto (10000–19999)"
                    className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    A conflict-free port is auto-assigned if left blank. Your process must bind to this port.
                  </p>
                </div>
              )}

              {form.type === "nodejs" && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-xs text-muted-foreground leading-relaxed space-y-2">
                  <p>
                    <span className="font-medium text-foreground">Hosting your Node.js project:</span> After the site is created, add your app files — use the{" "}
                    <Link href="/dashboard/editor" className="text-primary underline underline-offset-2 hover:text-primary/90">Editor</Link>
                    {" "}or copy them in with git/rsync/SSH as you prefer — then run <code className="text-[10px] px-1 py-0.5 rounded bg-background/70">npm install</code> and start your server so it listens on{" "}
                    <code className="text-[10px] px-1 py-0.5 rounded bg-background/70">127.0.0.1:{form.appProxyPort}</code> (PM2, systemd, or a shell — HostPanel wires the public web server to this port).
                  </p>
                  <p className="text-[11px] opacity-90">
                    The Node line you pick documents which runtime to use on the server; ensure that major version is installed on the host (see Web Servers → system Node if you administer this machine).
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Preferred DB stack (hint)</label>
                <select
                  value={form.dbStackVersion}
                  onChange={(e) => setForm({ ...form, dbStackVersion: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {(catalog?.dbStackVersions ?? ["postgresql-16", "postgresql-15", "mysql-8.0"]).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">Used as a label for provisioning and documentation; does not migrate existing databases.</p>
              </div>

              {/* Modular networking */}
              <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Network className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">Modular networking</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        networkGroup: f.networkGroup ? "" : "default",
                        isCentralService: f.networkGroup ? false : f.isCentralService,
                      }))
                    }
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      form.networkGroup ? "bg-primary" : "bg-secondary border border-input"
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      form.networkGroup ? "translate-x-4" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
                {form.networkGroup && (
                  <div className="space-y-3 pt-1">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Containers in the same group share a Docker bridge and can communicate.
                      Different groups are fully isolated from each other.
                    </p>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Group name</label>
                      <div className="flex gap-2">
                        <input
                          value={form.networkGroup}
                          onChange={(e) => setForm({ ...form, networkGroup: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                          placeholder="e.g. my-saas"
                          className="flex h-8 flex-1 rounded-md border border-input bg-secondary/50 px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        {existingGroups.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) setForm({ ...form, networkGroup: e.target.value }); }}
                            className="h-8 rounded-md border border-input bg-secondary/50 px-2 text-xs text-muted-foreground"
                          >
                            <option value="">Existing…</option>
                            {existingGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.isCentralService}
                        onChange={(e) => setForm({ ...form, isCentralService: e.target.checked })}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="text-xs text-muted-foreground leading-relaxed">
                        <span className="flex items-center gap-1 text-foreground font-medium text-sm">
                          <Database className="w-3.5 h-3.5" /> Central service
                        </span>
                        This container (DB, cache, broker) connects to <em>all</em> group
                        networks automatically — every module can reach it without extra config.
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Web server picker */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Web Server</label>
                <div className="grid grid-cols-2 gap-2">
                  {wsChoicesForSiteType(form.type).map(([id, meta]) => (
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
                           id === "litespeed" ? "LSAPI + cache" :
                           id === "caddy" ? "Auto HTTPS, Caddyfile" :
                           id === "openresty" ? "Nginx + LuaJIT" :
                           id === "traefik" ? "Edge proxy (apps)" : ""}
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
          <p className="text-muted-foreground text-sm mb-2 max-w-md mx-auto">
            Create a site for each domain. Choose <span className="text-foreground/90 font-medium">Node.js app</span> to host APIs and servers built with Express, Fastify, etc. — not on the Web Servers page; that page is only for Nginx, Caddy, and other edge proxies.
          </p>
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
              catalog={catalog}
              canManageIsolation={staff || Boolean(user?.dockerAccess)}
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
  catalog,
  canManageIsolation,
  onDelete,
  onToggle,
  onSwitchWebServer,
}: {
  site: Site;
  catalog: StackCatalog | undefined;
  canManageIsolation: boolean;
  onDelete: () => void;
  onToggle: () => void;
  onSwitchWebServer: (ws: WebServerType) => void;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const [homepageOpen, setHomepageOpen] = useState(false);
  const statusColor = getStatusColor(site.status);
  const dotColor = statusColor === "success" ? "bg-emerald-400" : statusColor === "warning" ? "bg-amber-400" : "bg-red-400";
  const ws = (site.webServer ?? "nginx") as WebServerType;
  const wsMeta = WS_META[ws] ?? WS_META.nginx;

  const stackMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.patch(`/sites/${site.id}/stack`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setStackOpen(false);
      setMenuOpen(false);
    },
  });

  const homepageMutation = useMutation({
    mutationFn: (payload: { defaultDocument: string | null }) =>
      apiClient.patch(`/sites/${site.id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setHomepageOpen(false);
      setMenuOpen(false);
    },
  });

  const homepageDetectMutation = useMutation({
    mutationFn: () => apiClient.post(`/sites/${site.id}/homepage/detect`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setHomepageOpen(false);
      setMenuOpen(false);
    },
  });

  const deployIsolationMutation = useMutation({
    mutationFn: () => apiClient.post(`/sites/${site.id}/isolation/alpine`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setMenuOpen(false);
    },
  });

  const removeIsolationMutation = useMutation({
    mutationFn: () => apiClient.delete(`/sites/${site.id}/isolation`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setMenuOpen(false);
    },
  });

  /** TanStack Query keeps mutation errors forever — clears stale banners on dismiss / closing menu */
  function clearIsolationMutationErrors(): void {
    deployIsolationMutation.reset();
    removeIsolationMutation.reset();
  }

  useEffect(() => {
    if (!menuOpen && !deployIsolationMutation.isPending && !removeIsolationMutation.isPending) {
      clearIsolationMutationErrors();
    }
  }, [menuOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when menu hides

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
                {(site.type === "static" || site.type === "php") && (
                  <button
                    type="button"
                    onClick={() => { setHomepageOpen(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                  >
                    <Home className="w-3.5 h-3.5" /> Homepage file
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setStackOpen(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                >
                  <Cpu className="w-3.5 h-3.5" /> Runtime &amp; versions
                </button>
                {canManageIsolation && (
                  <>
                    {!site.dockerContainerId ? (
                      <button
                        type="button"
                        disabled={deployIsolationMutation.isPending}
                        onClick={() => deployIsolationMutation.mutate()}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                      >
                        {deployIsolationMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Box className="w-3.5 h-3.5" />}
                        Deploy tenant container
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={removeIsolationMutation.isPending}
                        onClick={() => {
                          if (confirm("Remove the Alpine sidecar and clear isolation for this site?")) removeIsolationMutation.mutate();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                      >
                        {removeIsolationMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Box className="w-3.5 h-3.5" />}
                        Remove tenant container
                      </button>
                    )}
                  </>
                )}
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
                    <div className="absolute left-full top-0 ml-1 w-44 max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-lg py-1 z-30">
                      {wsChoicesForSiteType(site.type).map(([id, meta]) => (
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
          {site.type}
          {site.type === "php" && site.phpVersion ? ` ${site.phpVersion}` : ""}
          {site.type === "nodejs" && site.nodeVersion ? ` Node ${site.nodeVersion}` : ""}
          {site.type === "python" && site.pythonVersion ? ` Py ${site.pythonVersion}` : ""}
        </span>
        {(site.type === "static" || site.type === "php") && site.defaultDocument && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium bg-sky-500/10 text-sky-300 border-sky-500/25" title="Custom homepage filename">
            → {site.defaultDocument}
          </span>
        )}
        {site.dbStackVersion && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium bg-muted text-muted-foreground" title="Preferred DB stack hint">
            DB {site.dbStackVersion}
          </span>
        )}
        {(site.type === "nodejs" || site.type === "python") && site.appProxyPort != null && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium bg-muted text-muted-foreground">
            :{site.appProxyPort}
          </span>
        )}
        {site.dockerContainerId && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium bg-violet-500/10 text-violet-300 border-violet-500/25"
            title="Editor terminal can run inside Alpine with site files at /srv when HOSTPANEL_TERMINAL_DOCKER=true"
          >
            <Box className="w-3 h-3" /> Tenant
          </span>
        )}
        {/* Status */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
          site.status === "active" ? "bg-emerald-500/15 text-emerald-400" :
          site.status === "suspended" ? "bg-amber-500/15 text-amber-400" :
          "bg-red-500/15 text-red-400"
        }`}>
          {site.status}
        </span>
      </div>

      {(deployIsolationMutation.isError || removeIsolationMutation.isError) && (
        <div className="flex items-start gap-2 mt-2">
          <p className="text-xs text-destructive flex-1 min-w-0">
            {(deployIsolationMutation.error as Error)?.message ??
              (removeIsolationMutation.error as Error)?.message}
          </p>
          <button
            type="button"
            onClick={() => clearIsolationMutationErrors()}
            className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">Created {formatRelative(site.createdAt)}</p>

      {homepageOpen && (site.type === "static" || site.type === "php") && (
        <HomepageFileDialog
          key={`${site.id}:${site.defaultDocument ?? ""}`}
          site={site}
          onClose={() => setHomepageOpen(false)}
          isSaving={homepageMutation.isPending}
          isDetecting={homepageDetectMutation.isPending}
          saveError={homepageMutation.error as Error | null}
          detectError={homepageDetectMutation.error as Error | null}
          onSave={(defaultDocument) => homepageMutation.mutate({ defaultDocument })}
          onDetect={() => homepageDetectMutation.mutate()}
        />
      )}
      {stackOpen && (
        <SiteStackDialog
          key={`${site.id}:${site.type}:${site.phpVersion ?? ""}:${site.nodeVersion ?? ""}:${site.pythonVersion ?? ""}:${site.dbStackVersion ?? ""}:${site.appProxyPort ?? ""}`}
          site={site}
          catalog={catalog}
          onClose={() => setStackOpen(false)}
          isPending={stackMutation.isPending}
          error={stackMutation.error as Error | null}
          onSave={(body) => stackMutation.mutate(body)}
        />
      )}
    </div>
  );
}

function HomepageFileDialog({
  site,
  onClose,
  onSave,
  onDetect,
  isSaving,
  isDetecting,
  saveError,
  detectError,
}: {
  site: Site;
  onClose: () => void;
  onSave: (defaultDocument: string | null) => void;
  onDetect: () => void;
  isSaving: boolean;
  isDetecting: boolean;
  saveError: Error | null;
  detectError: Error | null;
}) {
  const [filename, setFilename] = useState(site.defaultDocument ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md glass rounded-2xl p-6 shadow-2xl">
        <h3 className="text-lg font-semibold mb-1">Public homepage</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Which file should visitors see at <span className="text-foreground font-mono text-xs">/</span>? Leave empty to use normal{' '}
          <span className="font-mono text-xs">index.html</span> / <span className="font-mono text-xs">index.htm</span>
          {site.type === "php" ? " / index.php" : ""}.
        </p>
        <label className="text-xs font-medium text-muted-foreground">Filename in site root</label>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="main.html"
          className="mt-1 flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            onClick={() => onDetect()}
            disabled={isDetecting || isSaving}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-input text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {isDetecting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Auto-detect from files
          </button>
          <button
            type="button"
            onClick={() => setFilename("")}
            className="px-3 py-1.5 rounded-md border border-input text-xs text-muted-foreground hover:bg-accent"
          >
            Clear (use defaults)
          </button>
        </div>
        {(saveError || detectError) && (
          <p className="text-sm text-destructive mt-3">{(saveError ?? detectError)?.message}</p>
        )}
        <div className="flex gap-2 mt-6">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-md border border-input text-sm hover:bg-accent">
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving || isDetecting}
            onClick={() => onSave(filename.trim() === "" ? null : filename.trim())}
            className="flex-1 h-9 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save &amp; reload server
          </button>
        </div>
      </div>
    </div>
  );
}

function SiteStackDialog({
  site,
  catalog,
  onClose,
  onSave,
  isPending,
  error,
}: {
  site: Site;
  catalog: StackCatalog | undefined;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  isPending: boolean;
  error: Error | null;
}) {
  const [type, setType] = useState(site.type);
  const [phpVersion, setPhpVersion] = useState<string>(site.phpVersion ?? "8.2");
  const [nodeVersion, setNodeVersion] = useState(site.nodeVersion ?? "20");
  const [pythonVersion, setPythonVersion] = useState(site.pythonVersion ?? "3.12");
  const [dbStackVersion, setDbStackVersion] = useState(site.dbStackVersion ?? "postgresql-16");
  const [appProxyPort, setAppProxyPort] = useState(site.appProxyPort ?? 3000);

  const phpList = catalog?.phpVersions ?? ["8.4", "8.3", "8.2", "8.1", "8.0"];
  const nodeList = catalog?.nodeVersions ?? ["24", "22", "20", "18"];
  const pyList = catalog?.pythonVersions ?? ["3.13", "3.12", "3.11", "3.10"];
  const dbList = catalog?.dbStackVersions ?? ["postgresql-17", "postgresql-16", "postgresql-15", "mysql-8.0", "mariadb-10.11"];

  const submit = () => {
    const body: Record<string, unknown> = { type, dbStackVersion };
    if (type === "php") body.phpVersion = phpVersion;
    else body.phpVersion = null;
    if (type === "nodejs") {
      body.nodeVersion = nodeVersion;
      body.appProxyPort = appProxyPort;
      body.pythonVersion = null;
    } else if (type === "python") {
      body.pythonVersion = pythonVersion;
      body.appProxyPort = appProxyPort;
      body.nodeVersion = null;
    } else {
      body.nodeVersion = null;
      body.pythonVersion = null;
      body.appProxyPort = null;
    }
    onSave(body);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg glass rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-1">Runtime &amp; versions</h3>
        <p className="text-sm text-muted-foreground mb-5">{site.domain} — updates vhost (PHP socket, proxy port) where applicable.</p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Site type</label>
            <select value={type} onChange={(e) => setType(e.target.value as Site["type"])} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              {SITE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {type === "php" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">PHP version</label>
              <select value={phpVersion} onChange={(e) => setPhpVersion(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                {phpList.map((v) => <option key={v} value={v}>PHP {v}</option>)}
              </select>
            </div>
          )}
          {type === "nodejs" && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Node.js line</label>
                <select value={nodeVersion} onChange={(e) => setNodeVersion(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {nodeList.map((v) => <option key={v} value={v}>Node {v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">App proxy port</label>
                <input type="number" min={1024} max={65535} value={appProxyPort} onChange={(e) => setAppProxyPort(Number(e.target.value) || 3000)} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            </>
          )}
          {type === "python" && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Python</label>
                <select value={pythonVersion} onChange={(e) => setPythonVersion(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {pyList.map((v) => <option key={v} value={v}>Python {v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">App proxy port</label>
                <input type="number" min={1024} max={65535} value={appProxyPort} onChange={(e) => setAppProxyPort(Number(e.target.value) || 3000)} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Preferred DB stack (hint)</label>
            <select value={dbStackVersion} onChange={(e) => setDbStackVersion(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              {dbList.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-destructive mt-3">{error.message}</p>}
        <div className="flex gap-2 mt-6">
          <button type="button" onClick={onClose} className="flex-1 h-9 rounded-md border border-input text-sm hover:bg-accent transition-colors">Cancel</button>
          <button type="button" onClick={submit} disabled={isPending} className="flex-1 h-9 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save &amp; reload web server
          </button>
        </div>
      </div>
    </div>
  );
}
