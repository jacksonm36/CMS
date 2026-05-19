"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Download, Plus, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api";

export interface HubCount { total: number; enabled: number }
export interface HubSummary {
  collections: HubCount;
  parsers: HubCount;
  scenarios: HubCount;
  postoverflows: HubCount;
}

export interface HubItem {
  name: string;
  status: string;
  local_version?: string;
  description?: string;
}

export type HubSection = "collections" | "parsers" | "scenarios" | "postoverflows";

export interface HubData {
  collections?: HubItem[];
  parsers?: HubItem[];
  scenarios?: HubItem[];
  postoverflows?: HubItem[];
  summary?: HubSummary;
  installed?: Record<HubSection, HubItem[]>;
}

function isEnabled(item: HubItem): boolean {
  return String(item.status ?? "").includes("enabled");
}

const SECTION_LABELS: { key: HubSection; label: string }[] = [
  { key: "collections", label: "Collections" },
  { key: "parsers", label: "Parsers" },
  { key: "scenarios", label: "Scenarios" },
  { key: "postoverflows", label: "Postoverflows" },
];

export function mergeHubInstalled(
  data?: HubData,
  fallback?: Record<HubSection, HubItem[]>,
): Record<HubSection, HubItem[]> {
  const fromLists = {
    collections: (data?.collections ?? []).filter(isEnabled),
    parsers: (data?.parsers ?? []).filter(isEnabled),
    scenarios: (data?.scenarios ?? []).filter(isEnabled),
    postoverflows: (data?.postoverflows ?? []).filter(isEnabled),
  };
  const base = data?.installed ?? fromLists;
  if (!fallback) return base;
  return {
    collections: base.collections?.length ? base.collections : fallback.collections ?? [],
    parsers: base.parsers?.length ? base.parsers : fallback.parsers ?? [],
    scenarios: base.scenarios?.length ? base.scenarios : fallback.scenarios ?? [],
    postoverflows: base.postoverflows?.length ? base.postoverflows : fallback.postoverflows ?? [],
  };
}

export function InstalledPackagesList({
  data,
  fallbackInstalled,
  loading,
  error,
  defaultOpen = true,
}: {
  data?: HubData;
  fallbackInstalled?: Record<HubSection, HubItem[]>;
  loading?: boolean;
  error?: string | null;
  defaultOpen?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<HubSection, boolean>>({
    collections: defaultOpen,
    parsers: defaultOpen,
    scenarios: defaultOpen,
    postoverflows: defaultOpen,
  });

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground animate-pulse">
        Loading installed packages…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">
        Could not load hub packages: {error}
      </div>
    );
  }

  const installed = mergeHubInstalled(data, fallbackInstalled);
  const q = search.trim().toLowerCase();
  const filterItems = (items: HubItem[]) =>
    q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;

  const total =
    (installed.collections?.length ?? 0) +
    (installed.parsers?.length ?? 0) +
    (installed.scenarios?.length ?? 0) +
    (installed.postoverflows?.length ?? 0);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border space-y-3">
        <div>
          <h3 className="font-semibold text-sm">Currently installed</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{total} enabled hub items on this host</p>
        </div>
        {total > 8 ? (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name…"
            className="h-8 w-full max-w-sm rounded-md border border-input bg-secondary/50 px-2.5 text-xs"
          />
        ) : null}
      </div>
      {total === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No enabled hub packages yet. Use <strong className="font-medium text-foreground">Install recommended hub</strong> above.
        </p>
      ) : (
      <div className="divide-y divide-border">
        {SECTION_LABELS.map(({ key, label }) => {
          const items = filterItems(installed[key] ?? []);
          if (items.length === 0) return null;
          const expanded = open[key];
          return (
            <div key={key}>
              <button
                type="button"
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 text-left"
                onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
              >
                <span className="text-sm font-medium">
                  {label}
                  <span className="ml-2 text-xs text-muted-foreground font-normal">({items.length})</span>
                </span>
                <span className="text-xs text-muted-foreground">{expanded ? "−" : "+"}</span>
              </button>
              {expanded ? (
                <ul className="px-5 pb-3 max-h-64 overflow-y-auto space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.name}
                      className="flex items-start justify-between gap-2 text-xs font-mono py-1 border-b border-border/50 last:border-0"
                    >
                      <span className="text-foreground break-all">{item.name}</span>
                      <span className="text-muted-foreground shrink-0">
                        {item.local_version ? `v${item.local_version}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick, disabled, pending, icon: Icon, label, variant = "default",
}: {
  onClick: () => void; disabled?: boolean; pending?: boolean;
  icon: React.ElementType; label: string; variant?: "default" | "primary";
}) {
  const cls = variant === "primary"
    ? "bg-primary text-primary-foreground hover:bg-primary/90"
    : "border hover:bg-accent";
  return (
    <button type="button" onClick={onClick} disabled={disabled || pending}
      className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 disabled:opacity-50 ${cls}`}>
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

export function HubPackageCards({ hub }: { hub: HubSummary }) {
  const items: { key: HubSection; label: string }[] = [
    { key: "collections", label: "Collections" },
    { key: "parsers", label: "Parsers" },
    { key: "scenarios", label: "Scenarios" },
    { key: "postoverflows", label: "Postoverflows" },
  ];
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="font-semibold text-sm mb-3">Installed hub packages</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map(({ key, label }) => (
          <div key={key} className="rounded-lg bg-secondary/30 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold mt-0.5">
              {hub[key].enabled}<span className="text-sm font-normal text-muted-foreground"> / {hub[key].total}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandOutput({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <pre className="text-xs bg-secondary/30 rounded-lg p-3 font-mono whitespace-pre-wrap max-h-48 overflow-auto border border-border">{text}</pre>
  );
}

export function HubTab() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<HubSection>("collections");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("enabled");
  const [installName, setInstallName] = useState("");
  const [cmdOut, setCmdOut] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["cs-hub"],
    queryFn: () => apiClient.get<{ data: HubData }>("/crowdsec/hub"),
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cs-hub"] });
    queryClient.invalidateQueries({ queryKey: ["cs-status"] });
  };

  const updateMutation = useMutation({
    mutationFn: () => apiClient.post("/crowdsec/hub/update", {}),
    onSuccess: (r) => { setCmdOut(String((r as { data?: { output?: string } })?.data?.output ?? "")); invalidate(); },
  });
  const setupMutation = useMutation({
    mutationFn: () => apiClient.post("/crowdsec/hub/setup", {}),
    onSuccess: (r) => { setCmdOut(String((r as { data?: { output?: string } })?.data?.output ?? "")); invalidate(); },
  });
  const installMutation = useMutation({
    mutationFn: ({ type, name }: { type: HubSection; name: string }) => apiClient.post("/crowdsec/hub/install", { type, name }),
    onSuccess: (r) => { setCmdOut(String((r as { data?: { output?: string } })?.data?.output ?? "")); invalidate(); },
  });
  const removeMutation = useMutation({
    mutationFn: ({ type, name }: { type: HubSection; name: string }) => apiClient.delete(`/crowdsec/hub/${type}/${encodeURIComponent(name)}`),
    onSuccess: (r) => { setCmdOut(String((r as { data?: { output?: string } })?.data?.output ?? "")); invalidate(); },
  });
  const upgradeItemMutation = useMutation({
    mutationFn: ({ type, name }: { type: HubSection; name: string }) => apiClient.post("/crowdsec/hub/upgrade-item", { type, name }),
    onSuccess: (r) => { setCmdOut(String((r as { data?: { output?: string } })?.data?.output ?? "")); invalidate(); },
  });

  const rawItems = (data?.data?.[section] as HubItem[] | undefined) ?? [];
  const items = rawItems.filter((item) => {
    const en = String(item.status ?? "").includes("enabled");
    if (filter === "enabled") return en;
    if (filter === "disabled") return !en;
    return true;
  });
  const hubPayload = data?.data;
  const summary = hubPayload?.summary;

  return (
    <div className="space-y-4">
      {summary ? <HubPackageCards hub={summary} /> : null}
      <InstalledPackagesList
        data={hubPayload}
        loading={isLoading}
        error={isError ? (error as Error)?.message ?? "Request failed" : null}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
        <ToolbarButton icon={RefreshCw} label="Refresh" onClick={() => invalidate()} />
        <ToolbarButton icon={Download} label="Hub update + upgrade" pending={updateMutation.isPending} onClick={() => updateMutation.mutate()} />
        <ToolbarButton icon={Download} label="Install recommended" variant="primary" pending={setupMutation.isPending} onClick={() => setupMutation.mutate()} />
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <select value={section} onChange={(e) => setSection(e.target.value as HubSection)} className="h-8 text-xs rounded-md border border-input bg-background px-2">
            {(["collections", "parsers", "scenarios", "postoverflows"] as const).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input value={installName} onChange={(e) => setInstallName(e.target.value)} placeholder="crowdsecurity/nginx" className="h-8 w-44 rounded-md border border-input bg-secondary/50 px-2 text-xs font-mono" />
          <ToolbarButton icon={Plus} label="Install" variant="primary" pending={installMutation.isPending} disabled={!installName.trim()} onClick={() => { if (installName.trim()) installMutation.mutate({ type: section, name: installName.trim() }); }} />
        </div>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
        {(["all", "enabled", "disabled"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1.5 text-xs rounded-md font-medium capitalize ${filter === f ? "bg-background shadow" : "text-muted-foreground"}`}>{f}</button>
        ))}
      </div>

      <CommandOutput text={cmdOut} />

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 flex-wrap">
        {(["collections", "parsers", "scenarios", "postoverflows"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSection(s)} className={`px-3 py-1.5 text-xs rounded-md font-medium capitalize ${section === s ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}>
            {s} ({((data?.data?.[s] as HubItem[] | undefined)?.length ?? 0)})
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading hub packages…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No {section} match this filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>{["Name", "Status", "Version", "Description", "Actions"].map((h) => <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => {
                const enabled = String(item.status ?? "").includes("enabled");
                const isLocal = String(item.status ?? "").includes("local");
                return (
                  <tr key={item.name} className="hover:bg-muted/30">
                    <td className="px-5 py-3 font-mono text-xs font-medium">{item.name}{isLocal ? <span className="ml-1 text-[10px] text-amber-500">local</span> : null}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-secondary text-muted-foreground"}`}>
                        {String(item.status ?? "").replace(/[^\w\s]/g, "").trim() || item.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{item.local_version ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground truncate max-w-[220px]" title={item.description}>{item.description ?? "—"}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {!enabled ? (
                          <button type="button" className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent" disabled={installMutation.isPending} onClick={() => installMutation.mutate({ type: section, name: item.name })}>Install</button>
                        ) : (
                          <>
                            <button type="button" className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent" disabled={upgradeItemMutation.isPending} onClick={() => upgradeItemMutation.mutate({ type: section, name: item.name })}>Upgrade</button>
                            <button type="button" className="text-[10px] px-2 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10" disabled={removeMutation.isPending} onClick={() => { if (confirm(`Remove ${item.name}?`)) removeMutation.mutate({ type: section, name: item.name }); }}>Remove</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
