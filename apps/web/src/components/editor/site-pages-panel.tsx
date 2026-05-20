"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, ExternalLink, Globe, Home, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { EditorContextMenu, type EditorContextMenuItem } from "./editor-context-menu";
import { isValidPageSlug, parsePageSlugInput } from "@/lib/page-slug";

export type SiteRouteEntry =
  | { type: "page"; slug: string; file: string; title?: string }
  | { type: "redirect"; from: string; to: string; permanent?: boolean };

type DiscoveredPage = { slug: string; file: string; label: string };

type PageItem = {
  key: string;
  label: string;
  file: string;
  urlPath: string;
  isHome: boolean;
  shortcutFile?: string;
  shortcutSlug?: string;
  pageSlug?: string;
  redirectFrom?: string;
};

export function SitePagesPanel({
  siteId,
  domain,
  onOpenFile,
}: {
  siteId: string;
  domain?: string;
  onOpenFile: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [showRedirects, setShowRedirects] = useState(false);
  const [redirectLine, setRedirectLine] = useState("");
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number; item: PageItem } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["site-pages", siteId],
    queryFn: () =>
      apiClient.get<{
        data: { domain: string; routes: SiteRouteEntry[]; discovered: DiscoveredPage[] };
      }>(`/sites/${siteId}/pages`),
    enabled: !!siteId,
  });

  const domainHost = data?.data.domain ?? domain ?? "your-site";
  const routes = data?.data.routes ?? [];
  const discovered = useMemo(() => data?.data.discovered ?? [], [data?.data.discovered]);

  const pageRoutes = routes.filter((r): r is Extract<SiteRouteEntry, { type: "page" }> => r.type === "page");
  const redirectRoutes = routes.filter(
    (r): r is Extract<SiteRouteEntry, { type: "redirect" }> => r.type === "redirect",
  );

  const mutate = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient.post<{ data: { routes: SiteRouteEntry[] } }>(`/sites/${siteId}/pages`, body),
    onSuccess: async (res, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["site-pages", siteId] });
      await queryClient.invalidateQueries({ queryKey: ["files", siteId] });
      const op = (vars as { op: string }).op;
      if (op === "add_page") {
        const slug = (vars as { slug: string }).slug;
        const added = res.data.routes.find((r) => r.type === "page" && r.slug === slug);
        if (added?.type === "page") onOpenFile(added.file);
        setNewName("");
        toast.success(`Page live at /${slug}`);
      } else if (op === "migrate_page") {
        const slug = (vars as { slug: string }).slug;
        const added = res.data.routes.find((r) => r.type === "page" && r.slug === slug);
        if (added?.type === "page") onOpenFile(added.file);
        toast.success(`Page moved to /${slug}/`);
      } else if (op === "shortcut") {
        toast.success("Short link enabled");
      } else if (op === "add_redirect") {
        setRedirectLine("");
        toast.success("Redirect added");
      } else {
        toast.success("Removed");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = useMemo((): PageItem[] => {
    const list: PageItem[] = [];

    for (const d of discovered) {
      if (!d.slug) {
        list.push({
          key: "home",
          label: "Home",
          file: d.file,
          urlPath: "/",
          isHome: true,
        });
        continue;
      }

      const reg = pageRoutes.find((p) => p.slug === d.slug);
      const from = `/${d.slug}`;
      const short = redirectRoutes.find((r) => r.from === from);

      if (reg) {
        list.push({
          key: `page-${d.slug}`,
          label: reg.title ?? d.label,
          file: reg.file,
          urlPath: from,
          isHome: false,
          pageSlug: d.slug,
        });
      } else if (short) {
        list.push({
          key: `short-${d.slug}`,
          label: d.label,
          file: d.file,
          urlPath: from,
          isHome: false,
          redirectFrom: from,
        });
      } else {
        const rootHtml = /^\/[^/]+\.html?$/i.test(d.file);
        list.push({
          key: `file-${d.file}`,
          label: d.label,
          file: d.file,
          urlPath: d.file,
          isHome: false,
          shortcutFile: rootHtml ? d.file : undefined,
          shortcutSlug: rootHtml ? d.slug : undefined,
        });
      }
    }

    for (const p of pageRoutes) {
      if (!list.some((i) => i.pageSlug === p.slug)) {
        list.push({
          key: `reg-${p.slug}`,
          label: p.title ?? p.slug,
          file: p.file,
          urlPath: `/${p.slug}`,
          isHome: false,
          pageSlug: p.slug,
        });
      }
    }

    return list;
  }, [discovered, pageRoutes, redirectRoutes]);

  const baseUrl = `https://${domainHost.replace(/^https?:\/\//, "")}`;
  const domainLabel = domainHost.replace(/^https?:\/\//, "");

  const QUICK_PAGE_SLUGS = ["info", "about", "contact"] as const;
  const canCreatePage = isValidPageSlug(newName.trim());
  const previewUrl = canCreatePage ? `${baseUrl}/${newName.trim()}` : null;

  function submitNewPage() {
    const slug = newName.trim();
    if (!isValidPageSlug(slug)) {
      toast.error("Enter a valid page name (e.g. info, about-us)");
      return;
    }
    mutate.mutate({ op: "add_page", slug });
  }

  function buildPageMenuItems(item: PageItem): EditorContextMenuItem[] {
    const liveUrl = `${baseUrl}${item.isHome ? "/" : item.urlPath}`;
    const items: EditorContextMenuItem[] = [
      {
        type: "item",
        id: "edit",
        label: "Edit page",
        icon: <Pencil className="w-3.5 h-3.5" />,
        onClick: () => onOpenFile(item.file),
      },
      {
        type: "item",
        id: "view",
        label: "View live",
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        onClick: () => window.open(liveUrl, "_blank", "noopener,noreferrer"),
      },
    ];
    if (item.shortcutFile && item.shortcutSlug) {
      items.push({
        type: "item",
        id: "setup",
        label: "Set up page folder",
        icon: <Globe className="w-3.5 h-3.5" />,
        onClick: () => mutate.mutate({ op: "add_page", slug: item.shortcutSlug! }),
      });
    }
    items.push(
      {
        type: "item",
        id: "copy-url",
        label: "Copy URL",
        icon: <Copy className="w-3.5 h-3.5" />,
        onClick: () => {
          void navigator.clipboard.writeText(liveUrl).then(
            () => toast.success("URL copied"),
            () => toast.error("Could not copy"),
          );
        },
      },
    );
    if (!item.isHome && (item.pageSlug || item.redirectFrom)) {
      items.push(
        { type: "separator" },
        {
          type: "item",
          id: "remove",
          label: "Remove from site",
          icon: <Trash2 className="w-3.5 h-3.5" />,
          destructive: true,
          onClick: () => removeItem(item),
        },
      );
    }
    return items;
  }

  function parseRedirectLine(line: string): { from: string; to: string } | null {
    const t = line.trim();
    if (!t) return null;
    const parts = t.split(/\s*→\s*|\s*->\s*|\s+to\s+/i);
    if (parts.length >= 2) {
      return { from: parts[0]!.trim(), to: parts.slice(1).join(" ").trim() };
    }
    return null;
  }

  function removeItem(item: PageItem) {
    if (item.pageSlug) {
      mutate.mutate({ op: "remove_page", slug: item.pageSlug });
    } else if (item.redirectFrom) {
      mutate.mutate({ op: "remove_redirect", from: item.redirectFrom });
    }
  }

  return (
    <div className="border-b border-border px-3 py-3 space-y-3 shrink-0 bg-secondary/15">
      <div>
        <p className="text-xs font-medium text-foreground">Website pages</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
          Type a page name (e.g. <span className="font-mono text-foreground/90">info</span>) and click Create — visitors
          open <span className="font-mono text-foreground/90">{domainLabel || "yoursite.com"}/info</span>. You can paste{" "}
          <span className="font-mono">/info</span> or the full URL too.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex rounded-md border border-input bg-background overflow-hidden text-xs shadow-sm">
          <span
            className="px-2 py-2.5 text-muted-foreground bg-secondary/50 shrink-0 border-r border-border max-w-[9rem] truncate font-mono text-[10px]"
            title={domainLabel}
          >
            {domainLabel}/
          </span>
          <input
            value={newName}
            onChange={(e) => setNewName(parsePageSlugInput(e.target.value, domainHost))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewPage();
            }}
            placeholder="info"
            className="flex-1 min-w-0 px-2 py-2.5 bg-transparent outline-none font-mono"
            aria-label="Page name"
          />
          <button
            type="button"
            disabled={!canCreatePage || mutate.isPending}
            onClick={() => submitNewPage()}
            className="px-3.5 py-2.5 bg-sky-600 text-white font-semibold hover:bg-sky-500 disabled:opacity-40 shrink-0"
          >
            Create
          </button>
        </div>
        {previewUrl ? (
          <p className="text-[10px] text-muted-foreground pl-0.5">
            Opens at{" "}
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sky-400 hover:underline"
            >
              {previewUrl.replace(/^https?:\/\//, "")}
            </a>
          </p>
        ) : newName.trim() ? (
          <p className="text-[10px] text-amber-500/90 pl-0.5">
            Use letters, numbers, and hyphens only (not &quot;index&quot;).
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PAGE_SLUGS.map((slug) => {
            const exists = items.some((i) => i.pageSlug === slug);
            return (
              <button
                key={slug}
                type="button"
                disabled={exists || mutate.isPending}
                title={exists ? "Page already exists" : `Create /${slug}`}
                onClick={() => mutate.mutate({ op: "add_page", slug })}
                className="text-[10px] px-2 py-1 rounded-md border border-border bg-background hover:bg-accent disabled:opacity-40 font-medium"
              >
                + {slug}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground">Pages on this site</p>
        {isLoading ? (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </p>
        ) : (
          <ul className="space-y-0.5 max-h-44 overflow-auto rounded-md border border-border/50 bg-background/30">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-0.5 px-1.5 py-1 hover:bg-sidebar-accent/60 border-b border-border/30 last:border-0"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setPageMenu({ x: e.clientX, y: e.clientY, item });
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenFile(item.file)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPageMenu({ x: e.clientX, y: e.clientY, item });
                  }}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  {item.isHome ? (
                    <Home className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  ) : (
                    <span className="w-3.5 shrink-0 text-center text-[10px] text-muted-foreground">/</span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium truncate">{item.label}</span>
                    <span className="block text-[10px] text-muted-foreground font-mono truncate">
                      {item.isHome ? domainHost : `${domainHost}${item.urlPath}`}
                    </span>
                  </span>
                </button>
                {item.shortcutFile && item.shortcutSlug && (
                  <button
                    type="button"
                    title={`Move ${item.shortcutFile} into /${item.shortcutSlug}/`}
                    disabled={mutate.isPending}
                    onClick={() =>
                      mutate.mutate({
                        op: "add_page",
                        slug: item.shortcutSlug,
                      })
                    }
                    className="text-[9px] px-1.5 py-1 rounded bg-sky-600/90 text-white border border-sky-500/50 hover:bg-sky-500 shrink-0 font-medium"
                  >
                    Set up page
                  </button>
                )}
                <a
                  href={`${baseUrl}${item.isHome ? "/" : item.urlPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                  title="View live"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {!item.isHome && (item.pageSlug || item.redirectFrom) && (
                  <button
                    type="button"
                    title="Remove from site URLs"
                    disabled={mutate.isPending}
                    onClick={() => removeItem(item)}
                    className="p-1.5 text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageMenu && (
        <EditorContextMenu
          x={pageMenu.x}
          y={pageMenu.y}
          items={buildPageMenuItems(pageMenu.item)}
          onClose={() => setPageMenu(null)}
        />
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowRedirects((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {showRedirects ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Redirects (optional)
        </button>
        {showRedirects && (
          <div className="mt-2 space-y-2 pl-1">
            <p className="text-[9px] text-muted-foreground">Example: /old → /main</p>
            <div className="flex gap-1">
              <input
                value={redirectLine}
                onChange={(e) => setRedirectLine(e.target.value)}
                placeholder="/old → /main"
                className="flex-1 text-[11px] rounded-md border border-input bg-background px-2 py-1.5 font-mono"
              />
              <button
                type="button"
                disabled={!parseRedirectLine(redirectLine) || mutate.isPending}
                onClick={() => {
                  const p = parseRedirectLine(redirectLine)!;
                  mutate.mutate({ op: "add_redirect", from: p.from, to: p.to, permanent: true });
                }}
                className="px-2.5 text-[11px] rounded-md bg-secondary border border-border hover:bg-accent disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {redirectRoutes.map((r) => (
              <div
                key={r.from}
                className="flex items-center justify-between text-[10px] font-mono text-muted-foreground px-1"
              >
                <span className="truncate">
                  {r.from} → {r.to}
                </span>
                <button
                  type="button"
                  onClick={() => mutate.mutate({ op: "remove_redirect", from: r.from })}
                  className="p-1 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
