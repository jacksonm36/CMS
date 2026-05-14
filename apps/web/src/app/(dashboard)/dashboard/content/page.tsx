"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, Edit, Eye, Image as ImageIcon, Database } from "lucide-react";
import { apiClient } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import type { ContentType, ContentEntry, PaginatedResponse, MediaFile } from "@hostpanel/types";

type Tab = "entries" | "types" | "media";

export default function ContentPage() {
  const [tab, setTab] = useState<Tab>("entries");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "entries", label: "Entries", icon: FileText },
    { id: "types", label: "Content Types", icon: Database },
    { id: "media", label: "Media Library", icon: ImageIcon },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="text-xl font-semibold">Content Management</h2>
        <p className="text-sm text-muted-foreground">Manage content types, entries, and media files</p>
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

      {tab === "entries" && <EntriesTab />}
      {tab === "types" && <ContentTypesTab />}
      {tab === "media" && <MediaTab />}
    </div>
  );
}

function ContentTypesTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", schema: [{ name: "title", label: "Title", type: "text", required: true }] });

  const { data } = useQuery({
    queryKey: ["content-types"],
    queryFn: () => apiClient.get<{ data: ContentType[] }>("/content/types"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => apiClient.post("/content/types", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["content-types"] }); setShowCreate(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/content/types/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-types"] }),
  });

  const types = data?.data ?? [];

  const addField = () => setForm({ ...form, schema: [...form.schema, { name: "", label: "", type: "text", required: false }] });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> New Content Type
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">Create Content Type</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Blog Post" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Slug (API path)</label>
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })} placeholder="blog-post" className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Schema Fields</label>
              <button onClick={addField} className="text-xs text-primary hover:underline">+ Add field</button>
            </div>
            {form.schema.map((field, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={field.name}
                  onChange={(e) => { const s = [...form.schema]; s[i] = { ...s[i]!, name: e.target.value }; setForm({ ...form, schema: s }); }}
                  placeholder="field_name"
                  className="flex h-8 rounded-md border border-input bg-secondary/50 px-2 text-xs font-mono w-32 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <input
                  value={field.label}
                  onChange={(e) => { const s = [...form.schema]; s[i] = { ...s[i]!, label: e.target.value }; setForm({ ...form, schema: s }); }}
                  placeholder="Label"
                  className="flex h-8 rounded-md border border-input bg-secondary/50 px-2 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <select
                  value={field.type}
                  onChange={(e) => { const s = [...form.schema]; s[i] = { ...s[i]!, type: e.target.value }; setForm({ ...form, schema: s }); }}
                  className="h-8 rounded-md border border-input bg-secondary/50 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {["text", "textarea", "richtext", "number", "boolean", "date", "image"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {i > 0 && (
                  <button onClick={() => setForm({ ...form, schema: form.schema.filter((_, j) => j !== i) })} className="text-destructive/70 hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => createMutation.mutate(form)} disabled={!form.name || !form.slug} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              Create Type
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {types.map((type) => (
          <div key={type.id} className="rounded-xl border bg-card p-5 hover:border-border/80 transition-colors group">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm">{type.name}</h3>
                <code className="text-xs text-primary font-mono">/{type.slug}</code>
              </div>
              <button onClick={() => { if (confirm(`Delete type "${type.name}"?`)) deleteMutation.mutate(type.id); }} className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{(type.schema as unknown[]).length} field{(type.schema as unknown[]).length !== 1 ? "s" : ""}</p>
            <p className="text-xs text-muted-foreground mt-1">Created {formatRelative(type.createdAt)}</p>
            <div className="mt-3 pt-3 border-t border-border flex gap-2">
              <a href={`/api/content/public/${type.slug}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Eye className="w-3 h-3" /> View API
              </a>
            </div>
          </div>
        ))}
        {types.length === 0 && (
          <div className="col-span-3 rounded-xl border bg-card p-12 text-center">
            <Database className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No content types yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EntriesTab() {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<string>("");

  const { data: typesData } = useQuery({
    queryKey: ["content-types"],
    queryFn: () => apiClient.get<{ data: ContentType[] }>("/content/types"),
  });

  const { data: entriesData } = useQuery({
    queryKey: ["content-entries", selectedType],
    queryFn: () => apiClient.get<{ data: PaginatedResponse<ContentEntry> }>(`/content/entries${selectedType ? `?typeId=${selectedType}` : ""}`),
    enabled: true,
  });

  const togglePublish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      apiClient.put(`/content/entries/${id}`, { published }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-entries"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/content/entries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["content-entries"] }),
  });

  const types = typesData?.data ?? [];
  const entries = entriesData?.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="h-9 rounded-md border border-input bg-secondary/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              {["Title", "Type", "Status", "Author", "Updated", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((entry) => {
              const title = (entry.data as Record<string, unknown>)?.title ?? (entry.data as Record<string, unknown>)?.name ?? entry.id.slice(0, 8);
              return (
                <tr key={entry.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium text-sm">{String(title)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{entry.typeName}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => togglePublish.mutate({ id: entry.id, published: !entry.published })}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${entry.published ? "bg-emerald-500/15 text-emerald-400" : "bg-secondary text-muted-foreground"}`}
                    >
                      {entry.published ? "Published" : "Draft"}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{entry.authorId.slice(0, 8)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{formatRelative(entry.updatedAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { if (confirm("Delete entry?")) deleteMutation.mutate(entry.id); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">No entries yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MediaTab() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["media"],
    queryFn: () => apiClient.get<{ data: PaginatedResponse<MediaFile> }>("/content/media"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/content/media/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["media"] }),
  });

  const files = data?.data?.data ?? [];

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const token = localStorage.getItem("hp_token");
    await fetch("/api/content/media", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    queryClient.invalidateQueries({ queryKey: ["media"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer">
          <Plus className="w-4 h-4" /> Upload File
          <input type="file" className="hidden" onChange={handleUpload} />
        </label>
      </div>

      {files.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <ImageIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" aria-hidden />
          <p className="text-muted-foreground text-sm">No media files yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {files.map((file) => (
            <div key={file.id} className="group relative rounded-lg border bg-card overflow-hidden aspect-square flex items-center justify-center">
              {file.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={file.url} alt={file.name} className="w-full h-full object-cover" />
              ) : (
                <FileText className="w-8 h-8 text-muted-foreground" />
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-2">
                <p className="text-xs text-white truncate">{file.name}</p>
                <button onClick={() => deleteMutation.mutate(file.id)} className="w-6 h-6 flex items-center justify-center bg-destructive rounded text-white">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
