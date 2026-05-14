"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Code2,
  Eye,
  Layers,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  Save,
  RefreshCw,
  Terminal,
  Plus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import type { Site } from "@hostpanel/types";
import { MonacoEditor } from "./monaco-editor";
import { VisualEditor } from "./visual-editor";
import { TerminalPane } from "./terminal-pane";
import { cn } from "@/lib/utils";

type EditorMode = "code" | "visual" | "preview";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
}

export function EditorShell() {
  const searchParams = useSearchParams();
  const siteId = searchParams.get("siteId");
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<EditorMode>("code");
  const [currentFile, setCurrentFile] = useState("/index.html");
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight] = useState(200);

  const { data: sitesData } = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiClient.get<{ data: Site[] }>("/sites"),
  });

  const [selectedSiteId, setSelectedSiteId] = useState(siteId ?? "");

  const sites = useMemo(() => sitesData?.data ?? [], [sitesData?.data]);
  useEffect(() => {
    if (!selectedSiteId && sites.length > 0) setSelectedSiteId(sites[0]!.id);
  }, [sites, selectedSiteId]);

  const { data: fileContent, isLoading: loadingFile } = useQuery({
    queryKey: ["file-content", selectedSiteId, currentFile],
    queryFn: () =>
      apiClient.get<{ data: { content: string } }>(`/sites/${selectedSiteId}/files/read?path=${encodeURIComponent(currentFile)}`),
    enabled: !!selectedSiteId && !!currentFile,
  });

  useEffect(() => {
    if (fileContent?.data?.content !== undefined) {
      setContent(fileContent.data.content);
      setIsDirty(false);
    }
  }, [fileContent]);

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/sites/${selectedSiteId}/files/write`, { path: currentFile, content }),
    onSuccess: () => {
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["file-content", selectedSiteId, currentFile] });
      void queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
      toast.success("File saved", {
        description: `${selectedSite?.rootPath ?? ""}${currentFile}`,
      });
    },
    onError: (err: Error) => {
      toast.error("Save failed", { description: err.message });
    },
  });

  const createFileMutation = useMutation({
    mutationFn: (path: string) => {
      const normalized = path.startsWith("/") ? path : `/${path}`;
      const isHtml = /\.html?$/i.test(normalized);
      const body = isHtml
        ? `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>New page</title>\n</head>\n<body>\n  <p>Edit this page in Code or Visual mode.</p>\n</body>\n</html>\n`
        : "";
      return apiClient.post(`/sites/${selectedSiteId}/files/write`, { path: normalized, content: body });
    },
    onSuccess: async (_, path) => {
      const normalized = path.startsWith("/") ? path : `/${path}`;
      await queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
      setCurrentFile(normalized);
      setMode("code");
      setIsDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["file-content", selectedSiteId, normalized] });
      toast.success("File created", {
        description: `${selectedSite?.rootPath ?? ""}${normalized}`,
      });
    },
    onError: (err: Error) => {
      toast.error("Could not create file", { description: err.message });
    },
  });

  const handleSave = useCallback(() => {
    if (selectedSiteId && isDirty) saveMutation.mutate();
  }, [selectedSiteId, isDirty, saveMutation]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const getLanguage = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      html: "html", htm: "html", php: "php", js: "javascript", ts: "typescript",
      css: "css", scss: "scss", json: "json", md: "markdown", yaml: "yaml", yml: "yaml",
      xml: "xml", sh: "shell", nginx: "nginx",
    };
    return map[ext ?? ""] ?? "plaintext";
  };

  const handleNewFile = useCallback(() => {
    if (!selectedSiteId) return;
    const suggested = "/new-page.html";
    const raw = window.prompt("New file path (from site root)", suggested);
    if (raw == null || !raw.trim()) return;
    const path = raw.trim().startsWith("/") ? raw.trim() : `/${raw.trim()}`;
    createFileMutation.mutate(path);
  }, [selectedSiteId, createFileMutation]);

  return (
    <div className="flex h-full bg-background">
      {/* File tree sidebar */}
      <div className="w-56 border-r border-border flex flex-col bg-sidebar shrink-0">
        <div className="p-3 border-b border-border space-y-2">
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full text-xs rounded-md border border-input bg-secondary/50 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select site...</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {selectedSiteId && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleNewFile}
                disabled={createFileMutation.isPending}
                className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium rounded-md border border-border bg-secondary/40 py-1.5 hover:bg-secondary/70 disabled:opacity-50"
              >
                {createFileMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                New file
              </button>
              <button
                type="button"
                title="Refresh file list"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] })}
                className="px-2 rounded-md border border-border bg-secondary/40 hover:bg-secondary/70"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {selectedSiteId && (
          <div className="border-b border-border px-3 py-2 space-y-1.5 shrink-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Quick open</p>
            <div className="flex flex-wrap gap-1">
              {["/index.html", "/styles.css", "/style.css", "/main.css", "/app.js", "/script.js"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCurrentFile(p)}
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                    currentFile === p
                      ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                      : "border-border/80 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}
                >
                  {p.replace(/^\//, "")}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto py-1 min-h-0">
          {selectedSiteId ? (
            <FileTreeBranch
              siteId={selectedSiteId}
              dirPath="/"
              depth={0}
              currentFile={currentFile}
              onSelectFile={(path) => setCurrentFile(path)}
              expandedDirs={expandedDirs}
              onToggleDir={(path) => {
                setExpandedDirs((prev) => {
                  const next = new Set(prev);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                });
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Main editor area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-4 py-2 min-h-11 border-b border-border bg-card/50 shrink-0">
          <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
            {(["code", "visual", "preview"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize",
                  mode === m ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "code" && <Code2 className="w-3.5 h-3.5" />}
                {m === "visual" && <Layers className="w-3.5 h-3.5" />}
                {m === "preview" && <Eye className="w-3.5 h-3.5" />}
                {m}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-center min-w-0 max-w-md mx-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground truncate w-full justify-center">
              <File className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-mono">{currentFile}</span>
              {isDirty && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0" title="Unsaved changes" />}
            </div>
            {selectedSite?.rootPath && (
              <p className="text-[10px] text-muted-foreground/60 truncate w-full text-center leading-tight font-mono">
                {selectedSite.rootPath}{currentFile}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className={cn("w-8 h-7 rounded flex items-center justify-center transition-colors text-xs", showTerminal ? "bg-primary/10 text-primary" : "hover:bg-accent text-muted-foreground")}
              title="Toggle terminal (Ctrl+`)"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["file-content"] })}
              className="w-8 h-7 rounded flex items-center justify-center hover:bg-accent text-muted-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || saveMutation.isPending}
              className={cn(
                "flex items-center gap-1.5 px-3 h-7 rounded text-xs font-medium transition-colors",
                isDirty
                  ? "bg-sky-600 text-white hover:bg-sky-500 shadow-sm"
                  : "bg-secondary text-muted-foreground cursor-default"
              )}
            >
              <Save className="w-3.5 h-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {loadingFile ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : mode === "code" ? (
              <MonacoEditor
                value={content}
                language={getLanguage(currentFile)}
                onChange={(val) => { setContent(val ?? ""); setIsDirty(true); }}
                onSave={handleSave}
              />
            ) : mode === "visual" ? (
              <VisualEditor
                key={`${selectedSiteId}:${currentFile}`}
                content={content}
                onChange={(html) => { setContent(html); setIsDirty(true); }}
              />
            ) : (
              <div className="h-full min-h-0 bg-white flex flex-col">
                <iframe
                  srcDoc={content}
                  className="w-full flex-1 min-h-0 border-none"
                  sandbox="allow-scripts"
                  title="Live Preview"
                />
              </div>
            )}
          </div>

          {/* Terminal pane */}
          {showTerminal && (
            <div
              className="border-t border-border shrink-0"
              style={{ height: terminalHeight }}
            >
              <TerminalPane siteId={selectedSiteId} height={terminalHeight} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileTreeBranch({
  siteId,
  dirPath,
  depth,
  currentFile,
  onSelectFile,
  expandedDirs,
  onToggleDir,
}: {
  siteId: string;
  dirPath: string;
  depth: number;
  currentFile: string;
  onSelectFile: (path: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}) {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["files", siteId, dirPath],
    queryFn: () =>
      apiClient.get<{ data: FileEntry[] }>(`/sites/${siteId}/files?path=${encodeURIComponent(dirPath)}`),
    enabled: !!siteId,
    staleTime: 15_000,
  });

  const entries = data?.data ?? [];
  const showLoader = (isLoading || isFetching) && entries.length === 0;

  return (
    <>
      {showLoader && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground" style={{ paddingLeft: `${12 + depth * 14}px` }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          Loading…
        </div>
      )}
      {!showLoader && entries.length === 0 && (
        <p className="px-4 py-2 text-xs text-muted-foreground leading-relaxed" style={{ paddingLeft: `${12 + depth * 14}px` }}>
          {depth === 0
            ? "This folder is empty. Use Quick open, New file, or add files on the server."
            : "Empty folder."}
        </p>
      )}
      {entries.map((entry) => {
        const isExpanded = entry.type === "directory" && expandedDirs.has(entry.path);
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => {
                if (entry.type === "directory") onToggleDir(entry.path);
                else onSelectFile(entry.path);
              }}
              className={cn(
                "w-full flex items-center gap-1.5 px-3 py-1 text-xs transition-colors text-left hover:bg-sidebar-accent",
                currentFile === entry.path && entry.type === "file" && "bg-sky-500/10 text-sky-200",
                !(currentFile === entry.path && entry.type === "file") && "text-sidebar-foreground"
              )}
              style={{ paddingLeft: `${12 + depth * 14}px` }}
            >
              {entry.type === "directory" ? (
                isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {entry.type === "directory" ? (
                <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              ) : (
                <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {entry.type === "directory" && isExpanded && (
              <FileTreeBranch
                siteId={siteId}
                dirPath={entry.path}
                depth={depth + 1}
                currentFile={currentFile}
                onSelectFile={onSelectFile}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
