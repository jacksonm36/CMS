"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, LayoutTemplate } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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
};

export default function SiteTemplatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    type: "nodejs" as SiteTemplateRow["type"],
    webServer: "nginx",
    nodeVersion: "20",
    appProxyPort: 3000 as number | null,
    description: "",
  });

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

  const createMutation = useMutation({
    mutationFn: async () => {
      const slug =
        form.slug.trim() ||
        form.name
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "") ||
        "template";
      return apiClient.post("/site-templates", {
        name: form.name,
        slug,
        description: form.description || null,
        type: form.type,
        webServer: form.webServer,
        nodeVersion: form.type === "nodejs" ? form.nodeVersion : null,
        pythonVersion: form.type === "python" ? "3.12" : null,
        phpVersion: form.type === "php" ? "8.2" : null,
        dbStackVersion: "postgresql-16",
        appProxyPort: form.type === "nodejs" || form.type === "python" ? form.appProxyPort : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-templates"] });
      setShowCreate(false);
      setForm({
        name: "",
        slug: "",
        type: "nodejs",
        webServer: "nginx",
        nodeVersion: "20",
        appProxyPort: 3000,
        description: "",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/site-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-templates"] }),
  });

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
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6" /> Site templates
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Presets for customer sites (e.g. Node VPS-style stack). Provision via{" "}
            <code className="text-xs px-1 rounded bg-muted">POST /api/sites/from-template</code> or assign when creating sites from the API.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" /> New template
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-medium">Create template</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
                placeholder="Node 20 + Nginx"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Slug</label>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
                placeholder="node-20-nginx"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Site type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
              >
                <option value="nodejs">Node.js</option>
                <option value="python">Python</option>
                <option value="php">PHP</option>
                <option value="static">Static</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Edge web server</label>
              <select
                value={form.webServer}
                onChange={(e) => setForm({ ...form, webServer: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
              >
                <option value="nginx">Nginx</option>
                <option value="caddy">Caddy</option>
                <option value="apache2">Apache2</option>
                <option value="traefik">Traefik</option>
              </select>
            </div>
            {form.type === "nodejs" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Node line</label>
                <input
                  value={form.nodeVersion}
                  onChange={(e) => setForm({ ...form, nodeVersion: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
                />
              </div>
            )}
            {(form.type === "nodejs" || form.type === "python") && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">App proxy port</label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={form.appProxyPort ?? 3000}
                  onChange={(e) => setForm({ ...form, appProxyPort: Number(e.target.value) || 3000 })}
                  className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm"
                />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="h-9 px-4 rounded-md border text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={createMutation.isPending || !form.name}
              onClick={() => createMutation.mutate()}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 inline-flex items-center gap-2"
            >
              {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save template
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border bg-card p-12 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground border rounded-xl p-8 text-center">No templates yet. Create one for reusable Node/PHP/Python presets.</p>
      ) : (
        <ul className="rounded-xl border divide-y">
          {templates.map((t) => (
            <li key={t.id} className="p-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{t.slug}</p>
                <p className="text-sm text-muted-foreground mt-1 capitalize">
                  {t.type} · {t.webServer}
                  {t.nodeVersion ? ` · Node ${t.nodeVersion}` : ""}
                  {t.appProxyPort != null ? ` · :${t.appProxyPort}` : ""}
                </p>
              </div>
              <button
                type="button"
                title="Delete template"
                onClick={() => {
                  if (confirm(`Delete template "${t.name}"?`)) deleteMutation.mutate(t.id);
                }}
                className="p-2 rounded-md hover:bg-destructive/10 text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
