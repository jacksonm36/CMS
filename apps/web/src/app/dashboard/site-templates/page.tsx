"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, LayoutTemplate, Pencil, X, Network, Database, Rocket } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { TemplateDeployDialog } from "@/components/site-templates/template-deploy-dialog";
import {
  DeployConflictDialog,
  type DeployConflictChoice,
} from "@/components/site-templates/deploy-conflict-dialog";
import {
  postSiteTemplateDeployStream,
  type DeployConflictAction,
  type DeployConflictInfo,
  type DeployStreamEvent,
} from "@/lib/template-deploy-stream";

type SiteTemplateRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: string;
  webServer: string;
  phpVersion: string | null;
  nodeVersion: string | null;
  pythonVersion: string | null;
  dbStackVersion: string | null;
  appProxyPort: number | null;
  networkGroup: string | null;
  isCentralService: boolean;
  defaultDocument: string | null;
  autoDeployIsolation: boolean;
  stackNetworkPerSite: boolean;
  provisionDockerDb: boolean;
};

type TemplateForm = {
  name: string;
  slug: string;
  type: string;
  webServer: string;
  phpVersion: string;
  nodeVersion: string;
  pythonVersion: string;
  dbStackVersion: string;
  appProxyPort: number | null;
  description: string;
  networkGroup: string;
  isCentralService: boolean;
  defaultDocument: string;
  autoDeployIsolation: boolean;
  stackNetworkPerSite: boolean;
  provisionDockerDb: boolean;
};

const emptyForm = (): TemplateForm => ({
  name: "",
  slug: "",
  type: "nodejs",
  webServer: "nginx",
  phpVersion: "8.3",
  nodeVersion: "20",
  pythonVersion: "3.12",
  dbStackVersion: "postgresql-16",
  appProxyPort: null,
  description: "",
  networkGroup: "",
  isCentralService: false,
  defaultDocument: "",
  autoDeployIsolation: false,
  stackNetworkPerSite: false,
  provisionDockerDb: false,
});

function templateToForm(t: SiteTemplateRow): TemplateForm {
  return {
    name: t.name,
    slug: t.slug,
    type: t.type,
    webServer: t.webServer,
    phpVersion: t.phpVersion ?? "8.3",
    nodeVersion: t.nodeVersion ?? "20",
    pythonVersion: t.pythonVersion ?? "3.12",
    dbStackVersion: t.dbStackVersion ?? "postgresql-16",
    appProxyPort: t.appProxyPort,
    description: t.description ?? "",
    networkGroup: t.networkGroup ?? "",
    isCentralService: t.isCentralService ?? false,
    defaultDocument: t.defaultDocument ?? "",
    autoDeployIsolation: t.autoDeployIsolation ?? false,
    stackNetworkPerSite: t.stackNetworkPerSite ?? false,
    provisionDockerDb: t.provisionDockerDb ?? false,
  };
}

function buildPayload(form: TemplateForm) {
  const slug =
    form.slug.trim() ||
    form.name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") ||
    "template";
  const homepage =
    form.type === "static" || form.type === "php"
      ? form.defaultDocument.trim() || null
      : null;
  return {
    name: form.name,
    slug,
    description: form.description || null,
    type: form.type,
    webServer: form.webServer,
    nodeVersion: form.type === "nodejs" ? form.nodeVersion : null,
    pythonVersion: form.type === "python" ? form.pythonVersion : null,
    phpVersion: form.type === "php" ? form.phpVersion : null,
    dbStackVersion: form.dbStackVersion || null,
    appProxyPort: form.appProxyPort || null, // null = auto-assign per site
    networkGroup: form.networkGroup.trim() || null,
    isCentralService: form.isCentralService,
    defaultDocument: homepage,
    autoDeployIsolation: form.autoDeployIsolation,
    stackNetworkPerSite: form.stackNetworkPerSite,
    provisionDockerDb: form.provisionDockerDb,
  };
}

function ModularSetupSection({
  networkGroup,
  isCentralService,
  existingGroups,
  onChange,
}: {
  networkGroup: string;
  isCentralService: boolean;
  existingGroups: string[];
  onChange: (patch: { networkGroup?: string; isCentralService?: boolean }) => void;
}) {
  const enabled = networkGroup.trim().length > 0 || isCentralService;

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Modular networking</span>
        </div>
        <button
          type="button"
          onClick={() => {
            if (enabled) {
              onChange({ networkGroup: "", isCentralService: false });
            } else {
              onChange({ networkGroup: "default" });
            }
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            enabled ? "bg-primary" : "bg-secondary border border-input"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-3 pt-1">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Containers in the same group share a Docker bridge network (ICC enabled) and can communicate
            directly. Containers in different groups remain fully isolated.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Group name</label>
            <div className="flex gap-2">
              <input
                value={networkGroup}
                onChange={(e) => onChange({ networkGroup: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                placeholder="e.g. my-saas, ecommerce-backend"
                className="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
              />
              {existingGroups.length > 0 && (
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) onChange({ networkGroup: e.target.value }); }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
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
              checked={isCentralService}
              onChange={(e) => onChange({ isCentralService: e.target.checked })}
              className="mt-0.5 accent-primary"
            />
            <span className="text-xs text-muted-foreground leading-relaxed">
              <span className="flex items-center gap-1 text-foreground font-medium text-sm">
                <Database className="w-3.5 h-3.5" /> Central service
              </span>
              This container (DB, cache, broker) is automatically connected to
              <em> all</em> group networks so every module can reach it without
              explicit wiring.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function TemplateFormFields({
  form,
  existingGroups,
  onChange,
}: {
  form: TemplateForm;
  existingGroups: string[];
  onChange: (f: TemplateForm) => void;
}) {
  const set = (patch: Partial<TemplateForm>) => onChange({ ...form, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Name</label>
          <input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
            placeholder="Node 20 + Nginx + PG16"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Slug</label>
          <input
            value={form.slug}
            onChange={(e) => set({ slug: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
            placeholder="node-20-nginx-pg16"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Site type</label>
          <select value={form.type} onChange={(e) => set({ type: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm">
            <option value="nodejs">Node.js</option>
            <option value="python">Python</option>
            <option value="php">PHP</option>
            <option value="static">Static</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Edge web server</label>
          <select value={form.webServer} onChange={(e) => set({ webServer: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm">
            <option value="nginx">Nginx</option>
            <option value="caddy">Caddy</option>
            <option value="apache2">Apache2</option>
            <option value="traefik">Traefik</option>
          </select>
        </div>
        {form.type === "nodejs" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Node version</label>
            <select value={form.nodeVersion} onChange={(e) => set({ nodeVersion: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm">
              {["18", "20", "22", "24"].map((v) => <option key={v} value={v}>Node {v}</option>)}
            </select>
          </div>
        )}
        {form.type === "python" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Python version</label>
            <select value={form.pythonVersion} onChange={(e) => set({ pythonVersion: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm">
              {["3.10", "3.11", "3.12", "3.13"].map((v) => <option key={v} value={v}>Python {v}</option>)}
            </select>
          </div>
        )}
        {form.type === "php" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">PHP version</label>
            <select value={form.phpVersion} onChange={(e) => set({ phpVersion: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm">
              {["8.0", "8.1", "8.2", "8.3", "8.4"].map((v) => <option key={v} value={v}>PHP {v}</option>)}
            </select>
          </div>
        )}
        {(form.type === "static" || form.type === "php") && (
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-sm font-medium">
              Default homepage file{" "}
              <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              value={form.defaultDocument}
              onChange={(e) => set({ defaultDocument: e.target.value })}
              placeholder="e.g. main.html — empty uses index.html"
              className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm font-mono"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Database</label>
          <select value={form.dbStackVersion} onChange={(e) => set({ dbStackVersion: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm">
            <option value="">None</option>
            <option value="postgresql-15">PostgreSQL 15</option>
            <option value="postgresql-16">PostgreSQL 16</option>
            <option value="postgresql-17">PostgreSQL 17</option>
            <option value="mysql-8.0">MySQL 8.0</option>
            <option value="mariadb-10.11">MariaDB 10.11</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            App port{" "}
            <span className="text-xs font-normal text-muted-foreground">(blank = auto-assign)</span>
          </label>
          <input
            type="number"
            min={1024}
            max={65535}
            value={form.appProxyPort ?? ""}
            onChange={(e) => set({ appProxyPort: e.target.value ? Number(e.target.value) : null })}
            placeholder="Auto (10000–19999)"
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
          <input value={form.description} onChange={(e) => set({ description: e.target.value })}
            placeholder="Standard Node.js stack with Nginx and PostgreSQL"
            className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-3">
        <p className="text-sm font-medium">Template deploy (Docker on host)</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          When staff creates a site from this template, HostPanel can provision a per-site Docker bridge, Alpine
          sidecar (same bind-mount as <code className="text-[10px]">/var/www</code>), and optionally a MySQL/MariaDB
          container on that bridge with a loopback port for host PHP-FPM. Requires Docker and is skipped on Windows.
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="accent-primary"
            checked={form.stackNetworkPerSite}
            onChange={(e) => set({ stackNetworkPerSite: e.target.checked })}
          />
          Per-site stack network (<code className="text-xs">site-&lt;id&gt;</code>) — app + DB containers share one bridge
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="accent-primary"
            checked={form.autoDeployIsolation}
            onChange={(e) => set({ autoDeployIsolation: e.target.checked })}
          />
          Auto-deploy Alpine tenant sidecar after provision
        </label>
        <label className={`flex items-start gap-2 text-sm cursor-pointer ${!form.autoDeployIsolation ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            className="accent-primary mt-0.5"
            disabled={!form.autoDeployIsolation}
            checked={form.provisionDockerDb}
            onChange={(e) => set({ provisionDockerDb: e.target.checked })}
          />
          <span>
            Docker MySQL/MariaDB on the same bridge (needs <strong>mysql-*</strong> or <strong>mariadb-*</strong> DB stack;
            host PHP uses <code className="text-xs">127.0.0.1:&lt;port&gt;</code>; a Site database row is created)
          </span>
        </label>
      </div>

      <ModularSetupSection
        networkGroup={form.networkGroup}
        isCentralService={form.isCentralService}
        existingGroups={existingGroups}
        onChange={(patch) => set(patch)}
      />
    </div>
  );
}

export default function SiteTemplatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<TemplateForm>(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TemplateForm>(emptyForm());

  useEffect(() => {
    if (!loading && user && user.role !== "superadmin" && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  const { data, isLoading } = useQuery({
    queryKey: ["site-templates"],
    queryFn: () => apiClient.get<{ data: SiteTemplateRow[] }>("/site-templates"),
    enabled: !!user && (user.role === "superadmin" || user.role === "admin"),
  });

  const { data: groupsRes } = useQuery({
    queryKey: ["sites", "network-groups"],
    queryFn: () => apiClient.get<{ data: string[] }>("/sites/network-groups"),
    enabled: !!user && (user.role === "superadmin" || user.role === "admin"),
  });
  const existingGroups = groupsRes?.data ?? [];

  const createMutation = useMutation({
    mutationFn: () => apiClient.post("/site-templates", buildPayload(createForm)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-templates"] });
      setShowCreate(false);
      setCreateForm(emptyForm());
    },
  });

  const editMutation = useMutation({
    mutationFn: () => apiClient.patch(`/site-templates/${editId}`, buildPayload(editForm)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-templates"] });
      setEditId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/site-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-templates"] }),
  });

  const [deployTarget, setDeployTarget] = useState<SiteTemplateRow | null>(null);
  const [deployPanel, setDeployPanel] = useState<{
    lines: string[];
    phase: string;
    running: boolean;
    ok: boolean | null;
    error?: string;
  } | null>(null);
  const deployAbortRef = useRef<AbortController | null>(null);
  const [deployConflict, setDeployConflict] = useState<DeployConflictInfo | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<{ name: string; domain: string } | null>(null);

  const runDeployStream = useCallback(
    async (
      templateId: string,
      name: string,
      domain: string,
      conflictAction?: DeployConflictAction,
    ) => {
      deployAbortRef.current?.abort();
      deployAbortRef.current = new AbortController();
      const { signal } = deployAbortRef.current;
      setDeployPanel({
        lines: [`# HostPanel — deploy ${name}`, `# ${domain}`, ""],
        phase: "Connecting…",
        running: true,
        ok: null,
      });
      try {
        await postSiteTemplateDeployStream(
          templateId,
          { name, domain, conflictAction },
          (ev: DeployStreamEvent) => {
            setDeployPanel((prev) => {
              if (!prev) return prev;
              const lines = [...prev.lines];
              const max = 700;
              const push = (s: string) => {
                lines.push(s);
                if (lines.length > max) lines.splice(0, lines.length - max);
              };
              switch (ev.type) {
                case "start":
                  push(`# template ${ev.templateId}`);
                  return { ...prev, lines, phase: "Deploy started" };
                case "phase":
                  push("");
                  push(`━━ ${ev.title} (${ev.index}/${ev.total}) ━━`);
                  return { ...prev, lines, phase: ev.title };
                case "log":
                  push(`${ev.source === "stderr" ? "err │ " : "    │ "}${ev.line}`);
                  return { ...prev, lines };
                case "step_complete":
                  push(`    │ finished (exit ${ev.code})`);
                  return { ...prev, lines };
                case "deploy_conflict":
                  setDeployConflict(ev.conflict);
                  setPendingDeploy({ name, domain });
                  push("━━ Domain already in use — choose an action in the dialog ━━");
                  return {
                    ...prev,
                    lines,
                    phase: "Conflict",
                    running: false,
                    ok: false,
                    error: "Site already exists for this domain.",
                  };
                case "done":
                  push(ev.ok ? "━━ Deploy completed ━━" : `━━ Failed: ${ev.error ?? "unknown"} ━━`);
                  if (ev.ok) {
                    push("");
                    push("Opening site…");
                    void queryClient.invalidateQueries({ queryKey: ["sites"] });
                    if (ev.siteId) {
                      const newSiteId = ev.siteId;
                      setTimeout(() => {
                        setDeployTarget(null);
                        setDeployPanel(null);
                        router.push(`/dashboard/editor?siteId=${encodeURIComponent(newSiteId)}`);
                      }, 600);
                    }
                  }
                  return {
                    ...prev,
                    lines,
                    phase: ev.ok ? "Complete" : "Failed",
                    running: false,
                    ok: ev.ok,
                    error: ev.error,
                  };
                default:
                  return prev;
              }
            });
          },
          signal,
        );
      } catch (e) {
        const msg = (e as Error).name === "AbortError" ? "Cancelled" : (e as Error).message;
        setDeployPanel((prev) =>
          prev
            ? { ...prev, lines: [...prev.lines, "", `!! ${msg}`], running: false, ok: false, phase: "Failed", error: msg }
            : prev,
        );
      }
    },
    [queryClient, router],
  );

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (user.role !== "superadmin" && user.role !== "admin") return null;

  const templates = data?.data ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6" /> Site templates
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Presets for customer sites. Stack tools auto-install in the Docker sidecar.
            Ports auto-assign from 10000–19999 — no conflicts. Use{" "}
            <span className="font-medium text-foreground">Modular networking</span> to
            let containers in the same group communicate (microservices, shared DB, etc).
          </p>
        </div>
        <button type="button" onClick={() => { setShowCreate(true); setEditId(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 shrink-0">
          <Plus className="w-4 h-4" /> New template
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Create template</h3>
            <button type="button" onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <TemplateFormFields form={createForm} existingGroups={existingGroups} onChange={setCreateForm} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="h-9 px-4 rounded-md border text-sm">Cancel</button>
            <button type="button" disabled={createMutation.isPending || !createForm.name}
              onClick={() => createMutation.mutate()}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 inline-flex items-center gap-2">
              {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save template
            </button>
          </div>
          {createMutation.isError && <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border bg-card p-12 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground border rounded-xl p-8 text-center">
          No templates yet. Create one for reusable Node/PHP/Python presets.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <article
              key={t.id}
              className="rounded-xl border bg-card p-4 flex flex-col gap-3 shadow-sm hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{t.name}</p>
                    {t.networkGroup && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary border border-primary/20">
                        <Network className="w-3 h-3" /> {t.networkGroup}
                        {t.isCentralService && " · central"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{t.slug}</p>
                  {(t.autoDeployIsolation || t.stackNetworkPerSite || t.provisionDockerDb) && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {t.stackNetworkPerSite && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 border border-emerald-500/25">per-site net</span>
                      )}
                      {t.autoDeployIsolation && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 border border-sky-500/25">auto sidecar</span>
                      )}
                      {t.provisionDockerDb && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 border border-amber-500/25">Docker DB</span>
                      )}
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground mt-1 capitalize">
                    {t.type} · {t.webServer}
                    {t.phpVersion ? ` · PHP ${t.phpVersion}` : ""}
                    {t.nodeVersion ? ` · Node ${t.nodeVersion}` : ""}
                    {t.pythonVersion ? ` · Python ${t.pythonVersion}` : ""}
                    {t.dbStackVersion ? ` · ${t.dbStackVersion}` : ""}
                    {t.appProxyPort != null ? ` · :${t.appProxyPort}` : " · port auto"}
                    {(t.type === "static" || t.type === "php") && t.defaultDocument
                      ? ` · home:${t.defaultDocument}`
                      : ""}
                  </p>
                  {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" title="Edit template"
                    onClick={() => {
                      if (editId === t.id) { setEditId(null); return; }
                      setEditId(t.id); setEditForm(templateToForm(t)); setShowCreate(false);
                    }}
                    className="p-2 rounded-md hover:bg-secondary text-muted-foreground">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" title="Delete template"
                    onClick={() => { if (confirm(`Delete template "${t.name}"?`)) deleteMutation.mutate(t.id); }}
                    className="p-2 rounded-md hover:bg-destructive/10 text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeployTarget(t);
                  setDeployPanel(null);
                }}
                className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-primary/90"
              >
                <Rocket className="w-4 h-4" /> Deploy site
              </button>
              {editId === t.id && (
                <div className="px-4 pb-4 space-y-4 border-t bg-secondary/10">
                  <p className="text-xs text-muted-foreground pt-3">Editing template</p>
                  <TemplateFormFields form={editForm} existingGroups={existingGroups} onChange={setEditForm} />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditId(null)} className="h-9 px-4 rounded-md border text-sm">Cancel</button>
                    <button type="button" disabled={editMutation.isPending || !editForm.name}
                      onClick={() => editMutation.mutate()}
                      className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 inline-flex items-center gap-2">
                      {editMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save changes
                    </button>
                  </div>
                  {editMutation.isError && <p className="text-sm text-destructive">{(editMutation.error as Error).message}</p>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <TemplateDeployDialog
        template={deployTarget}
        open={deployTarget != null && deployConflict == null}
        onClose={() => {
          if (deployPanel?.running) deployAbortRef.current?.abort();
          setDeployTarget(null);
          setDeployPanel(null);
          setDeployConflict(null);
          setPendingDeploy(null);
        }}
        deployPanel={deployPanel}
        canSubmit={!deployPanel?.running}
        onDeploy={({ name, domain }) => {
          if (!deployTarget) return;
          setDeployConflict(null);
          setPendingDeploy(null);
          void runDeployStream(deployTarget.id, name, domain);
        }}
      />

      <DeployConflictDialog
        open={deployConflict != null && deployTarget != null}
        conflict={deployConflict}
        templateName={deployTarget?.name ?? ""}
        pendingName={pendingDeploy?.name ?? ""}
        pendingDomain={pendingDeploy?.domain ?? deployConflict?.domain ?? ""}
        onClose={() => {
          setDeployConflict(null);
          setPendingDeploy(null);
        }}
        onChoose={(choice: DeployConflictChoice) => {
          if (!deployTarget || !pendingDeploy) return;
          if (choice === "cancel") {
            setDeployConflict(null);
            setPendingDeploy(null);
            return;
          }
          if (choice === "new_site") {
            setDeployConflict(null);
            setPendingDeploy(null);
            setDeployPanel(null);
            return;
          }
          setDeployConflict(null);
          void runDeployStream(
            deployTarget.id,
            pendingDeploy.name,
            pendingDeploy.domain,
            choice,
          );
        }}
      />
    </div>
  );
}
