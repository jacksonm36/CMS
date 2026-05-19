"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Code2, FileCode2, Network } from "lucide-react";
import type { WebServerInfo, WebServerType } from "@hostpanel/types";

const EDGE_PROXY_FILE = "/etc/nginx/sites-enabled/hostpanel-edge-{domain}.conf";

const WS_COLORS: Record<WebServerType, { text: string }> = {
  nginx: { text: "text-emerald-400" },
  apache2: { text: "text-red-400" },
  lighttpd: { text: "text-sky-400" },
  litespeed: { text: "text-violet-400" },
  caddy: { text: "text-teal-400" },
  openresty: { text: "text-orange-400" },
  traefik: { text: "text-cyan-400" },
};

export function WebServersArchitectureDocs({
  servers,
  edge,
  coexistence,
}: {
  servers: WebServerInfo[];
  edge?: { webServer: string; publicPort: number };
  coexistence?: string;
}) {
  const publicPort = edge?.publicPort ?? 80;
  const edgeName = edge?.webServer ?? "nginx";
  const sorted = [...servers].sort((a, b) => a.defaultPort - b.defaultPort);

  return (
    <section className="rounded-xl border bg-card overflow-hidden" aria-labelledby="ws-architecture-heading">
      <div className="px-5 py-4 border-b bg-secondary/20 flex items-start gap-3">
        <BookOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden />
        <div>
          <h3 id="ws-architecture-heading" className="text-sm font-semibold">
            Multi-stack architecture
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
            {coexistence ??
              "Several web servers can run on this host at once. Only the edge binds public HTTP; every other stack listens on loopback."}
          </p>
        </div>
      </div>

      <div className="p-5 space-y-6">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Request flow</p>
          <div className="rounded-lg border border-border bg-[#0d1117] p-4 font-mono text-[11px] sm:text-xs text-muted-foreground leading-relaxed overflow-x-auto">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground/90">
              <span>Client</span>
              <ArrowRight className="w-3 h-3 shrink-0" />
              <span className="text-emerald-400">
                :{publicPort} {edgeName} (edge)
              </span>
              <ArrowRight className="w-3 h-3 shrink-0" />
              <span className="text-muted-foreground">routing by Host / domain</span>
            </div>
            <div className="mt-3 pl-4 border-l border-border space-y-2">
              <p>
                <span className="text-emerald-400">Nginx site</span>
                {" → "}
                <span className="text-foreground/80">served directly</span>
                <span className="text-muted-foreground"> (full vhost in sites-enabled)</span>
              </p>
              <p>
                <span className="text-amber-400">Apache / Caddy / … site</span>
                {" → "}
                <span className="text-foreground/80">proxy_pass</span>
                <span className="text-muted-foreground">
                  {" "}
                  127.0.0.1:backendPort → that stack&apos;s vhost
                </span>
              </p>
              <p>
                <span className="text-sky-400">Node / Python / PHP (container)</span>
                {" → "}
                <span className="text-foreground/80">web server</span>
                <span className="text-muted-foreground">
                  {" "}
                  → 127.0.0.1:appProxyPort (Docker, ports 10000–19999)
                </span>
              </p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Ports on this host</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Server</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Listens on</th>
                  <th className="px-3 py-2 font-medium hidden sm:table-cell">Public HTTP</th>
                  <th className="px-3 py-2 font-medium hidden md:table-cell">Site config path</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((ws) => {
                  const isEdge = ws.id === edgeName;
                  const colors = WS_COLORS[ws.id as WebServerType];
                  return (
                    <tr key={ws.id} className="hover:bg-secondary/20">
                      <td className="px-3 py-2.5">
                        <span className={`font-medium ${colors.text}`}>{ws.name}</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {isEdge ? "Edge + native vhosts" : "Backend only"}
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        {isEdge ? `:${ws.defaultPort}` : `127.0.0.1:${ws.defaultPort}`}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                        {isEdge ? `Direct :${publicPort}` : `Via Nginx :${publicPort}`}
                      </td>
                      <td
                        className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground hidden md:table-cell max-w-[200px] truncate"
                        title={ws.configDir}
                      >
                        {ws.configDir}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-secondary/10">
                  <td className="px-3 py-2.5 font-medium text-sky-400">App containers</td>
                  <td className="px-3 py-2.5 text-muted-foreground">Runtime</td>
                  <td className="px-3 py-2.5 font-mono">127.0.0.1:10000–19999</td>
                  <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                    Proxied by site&apos;s web server
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Override backend ports with{" "}
            <code className="px-1 py-0.5 rounded bg-muted font-mono">HOSTPANEL_WS_PORT_APACHE2</code>,{" "}
            <code className="px-1 py-0.5 rounded bg-muted font-mono">HOSTPANEL_EDGE_PUBLIC_PORT</code> for the edge.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Network className="w-4 h-4 text-primary" />
              Per-site assignment
            </div>
            <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
              <li>
                In{" "}
                <Link href="/dashboard/sites" className="text-primary underline underline-offset-2">
                  Sites
                </Link>
                , each site picks one web server. Different sites can use different stacks at the same time.
              </li>
              <li>
                <span className="text-foreground/90">Static / PHP</span> files are served by that stack from the site root.
              </li>
              <li>
                <span className="text-foreground/90">Node.js / Python</span> apps run in isolated containers; the web server
                reverse-proxies to the allocated loopback app port.
              </li>
              <li>
                <span className="text-foreground/90">Traefik</span> is proxy-only (no static/PHP).{" "}
                <span className="text-foreground/90">OpenResty</span> supports site-editor URL redirects like Nginx.
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileCode2 className="w-4 h-4 text-primary" />
              Generated files
            </div>
            <ul className="text-xs text-muted-foreground space-y-2">
              <li>
                <span className="text-foreground/90">Nginx site</span>
                {" — "}
                <code className="font-mono text-[10px] bg-muted px-1 rounded">
                  /etc/nginx/sites-enabled/&#123;domain&#125;.conf
                </code>
              </li>
              <li>
                <span className="text-foreground/90">Other stacks</span>
                {" — backend file under that server&apos;s config dir (see table)."}
              </li>
              <li>
                <span className="text-foreground/90">Edge route</span>
                {" — "}
                <code className="font-mono text-[10px] bg-muted px-1 rounded break-all">{EDGE_PROXY_FILE}</code>
                {" "}
                (non-Nginx sites only).
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex gap-3">
          <Code2 className="w-5 h-5 text-primary shrink-0" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-primary mb-1">Node.js is not a web server here</p>
            <p>
              Node.js is an application runtime. Create a site with type Node.js, allocate an app port, then choose Nginx,
              Caddy, Traefik, or another stack — HostPanel wires the proxy chain for you.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
