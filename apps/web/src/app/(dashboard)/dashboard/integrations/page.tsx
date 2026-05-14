"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, Key, Webhook, Settings, Plus, Trash2, Copy, Check, Play } from "lucide-react";
import { apiClient } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import type { Webhook as WebhookType, ApiKey } from "@hostpanel/types";

type Tab = "webhooks" | "api-keys" | "providers";

export default function IntegrationsPage() {
  const [tab, setTab] = useState<Tab>("webhooks");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "webhooks", label: "Webhooks", icon: Webhook },
    { id: "api-keys", label: "API Keys", icon: Key },
    { id: "providers", label: "Providers", icon: Settings },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-xl font-semibold">Integrations Hub</h2>
        <p className="text-sm text-muted-foreground">Webhooks, API keys, and third-party service connectors</p>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === id ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "webhooks" && <WebhooksTab />}
      {tab === "api-keys" && <ApiKeysTab />}
      {tab === "providers" && <ProvidersTab />}
    </div>
  );
}

const WEBHOOK_EVENTS = [
  "site.created", "site.deleted", "site.deployed",
  "ssl.issued", "ssl.renewed", "ssl.expiring",
  "alert.triggered", "backup.completed",
];

function WebhooksTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", events: [] as string[], secret: "" });

  const { data } = useQuery({
    queryKey: ["webhooks"],
    queryFn: () => apiClient.get<{ data: WebhookType[] }>("/integrations/webhooks"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/integrations/webhooks", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["webhooks"] }); setShowCreate(false); setForm({ name: "", url: "", events: [], secret: "" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/integrations/webhooks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/integrations/webhooks/${id}/test`),
  });

  const webhooks = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> New Webhook
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">Create Webhook</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Deploy Notification" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">URL</label>
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://hooks.slack.com/..." className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Secret (optional)</label>
              <input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="HMAC signing secret" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Events</label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((event) => (
                <button
                  key={event}
                  type="button"
                  onClick={() => setForm({ ...form, events: form.events.includes(event) ? form.events.filter(e => e !== event) : [...form.events, event] })}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${form.events.includes(event) ? "bg-primary/15 border-primary/30 text-primary" : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => createMutation.mutate(form)} disabled={!form.name || !form.url || form.events.length === 0} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Create Webhook
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card divide-y divide-border overflow-hidden">
        {webhooks.length === 0 ? (
          <div className="p-12 text-center">
            <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No webhooks configured yet</p>
          </div>
        ) : webhooks.map((hook) => (
          <div key={hook.id} className="p-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-medium text-sm">{hook.name}</p>
                <span className={`w-2 h-2 rounded-full shrink-0 ${hook.enabled ? "bg-emerald-400" : "bg-muted-foreground"}`} />
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate">{hook.url}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {hook.events.map((e) => (
                  <span key={e} className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs">{e}</span>
                ))}
              </div>
              {hook.lastCalledAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last called {formatRelative(hook.lastCalledAt)}
                  {hook.lastStatusCode && <span className={`ml-1 ${hook.lastStatusCode < 400 ? "text-emerald-400" : "text-red-400"}`}>({hook.lastStatusCode})</span>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => testMutation.mutate(hook.id)} disabled={testMutation.isPending} className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-accent transition-colors">
                <Play className="w-3 h-3" /> Test
              </button>
              <button onClick={() => deleteMutation.mutate(hook.id)} className="w-7 h-7 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiKeysTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: [] as string[] });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiClient.get<{ data: ApiKey[] }>("/integrations/api-keys"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post<{ data: ApiKey & { key: string } }>("/integrations/api-keys", payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setNewKey(res.data.key);
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/integrations/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const keys = data?.data ?? [];

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const SCOPES = ["sites:read", "sites:write", "security:read", "security:write", "content:read", "content:write", "monitoring:read"];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> New API Key
        </button>
      </div>

      {newKey && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium text-emerald-400 mb-2">API key created — copy it now, it won{"'"}t be shown again</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-background/60 px-3 py-2 rounded-md border border-border break-all">{newKey}</code>
            <button onClick={() => copyKey(newKey)} className="flex items-center gap-1 px-3 py-2 text-xs border rounded-md hover:bg-accent transition-colors whitespace-nowrap">
              {copied ? <><Check className="w-3 h-3 text-emerald-400" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-muted-foreground mt-2 hover:text-foreground">Dismiss</button>
        </div>
      )}

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">Create API Key</h3>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="CI/CD Pipeline" className="flex h-9 w-64 rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Scopes</label>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setForm({ ...form, scopes: form.scopes.includes(scope) ? form.scopes.filter(s => s !== scope) : [...form.scopes, scope] })}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${form.scopes.includes(scope) ? "bg-primary/15 border-primary/30 text-primary" : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => createMutation.mutate(form)} disabled={!form.name || form.scopes.length === 0} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Generate Key
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card divide-y divide-border overflow-hidden">
        {keys.length === 0 ? (
          <div className="p-12 text-center">
            <Key className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No API keys yet</p>
          </div>
        ) : keys.map((key) => (
          <div key={key.id} className="p-5 flex items-start justify-between">
            <div>
              <p className="font-medium text-sm">{key.name}</p>
              <p className="text-xs font-mono text-muted-foreground mt-0.5">{key.keyPrefix}••••••••••••••••</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {key.scopes.map((s) => (
                  <span key={s} className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs">{s}</span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {key.lastUsedAt ? `Last used ${formatRelative(key.lastUsedAt)}` : "Never used"} · Created {formatRelative(key.createdAt)}
              </p>
            </div>
            <button onClick={() => { if (confirm(`Revoke key "${key.name}"?`)) deleteMutation.mutate(key.id); }} className="text-xs text-destructive hover:underline shrink-0">Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProvidersTab() {
  const [editing, setEditing] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, Record<string, string>>>({});
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: Record<string, string> }) =>
      apiClient.put(`/integrations/providers/${provider}`, { name: provider, config, enabled: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["providers"] }); setEditing(null); },
  });

  const providers = [
    { id: "cloudflare", name: "Cloudflare", description: "DNS & proxy management", fields: [{ key: "apiToken", label: "API Token", type: "password" }, { key: "zoneId", label: "Zone ID" }] },
    { id: "slack", name: "Slack", description: "Alert notifications", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "url" }, { key: "channel", label: "Channel (optional)" }] },
    { id: "github", name: "GitHub", description: "Deploy on push", fields: [{ key: "webhookSecret", label: "Webhook Secret", type: "password" }, { key: "defaultBranch", label: "Branch" }] },
    { id: "s3", name: "S3 Storage", description: "Backup storage", fields: [{ key: "endpoint", label: "Endpoint URL" }, { key: "accessKey", label: "Access Key" }, { key: "secretKey", label: "Secret Key", type: "password" }, { key: "bucket", label: "Bucket Name" }] },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {providers.map((provider) => (
        <div key={provider.id} className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-sm">{provider.name}</h3>
              <p className="text-xs text-muted-foreground">{provider.description}</p>
            </div>
            <button
              onClick={() => {
                setEditing(editing === provider.id ? null : provider.id);
                setConfigs((prev) => ({ ...prev, [provider.id]: {} }));
              }}
              className="text-xs text-primary hover:underline"
            >
              {editing === provider.id ? "Cancel" : "Configure"}
            </button>
          </div>

          {editing === provider.id && (
            <div className="space-y-3 mt-3 pt-3 border-t border-border">
              {provider.fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-xs font-medium">{field.label}</label>
                  <input
                    type={field.type ?? "text"}
                    value={configs[provider.id]?.[field.key] ?? ""}
                    onChange={(e) => setConfigs((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id], [field.key]: e.target.value } }))}
                    className="flex h-8 w-full rounded-md border border-input bg-secondary/50 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
              <button
                onClick={() => saveMutation.mutate({ provider: provider.id, config: configs[provider.id] ?? {} })}
                disabled={saveMutation.isPending}
                className="w-full py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? "Saving..." : "Save Configuration"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
