"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Code2, Eye, Layers, ChevronRight, ChevronDown, File, Folder, Save, RefreshCw, Terminal } from "lucide-react";
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
  const [expandedDirs, setExpandedDirs] = useState(new Set([""]));
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(200);

  const { data: sitesData } = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiClient.get<{ data: Site[] }>("/sites"),
  });

  const [selectedSiteId, setSelectedSiteId] = useState(siteId ?? "");

  const sites = sitesData?.data ?? [];
  useEffect(() => {
    if (!selectedSiteId && sites.length > 0) setSelectedSiteId(sites[0]!.id);
  }, [sites, selectedSiteId]);

  const { data: filesData } = useQuery({
    queryKey: ["files", selectedSiteId, "/"],
    queryFn: () => apiClient.get<{ data: FileEntry[] }>(`/sites/${selectedSiteId}/files?path=/`),
    enabled: !!selectedSiteId,
  });

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

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/sites/${selectedSiteId}/files/write`, { path: currentFile, content }),
    onSuccess: () => {
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["file-content", selectedSiteId, currentFile] });
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

  const files = filesData?.data ?? [];

  return (
    <div className="flex h-full bg-background">
      {/* File tree sidebar */}
      <div className="w-56 border-r border-border flex flex-col bg-sidebar shrink-0">
        <div className="p-3 border-b border-border">
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full text-xs rounded-md border border-input bg-secondary/50 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select site...</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {files.map((entry) => (
            <FileTreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              selectedPath={currentFile}
              onSelect={(path) => setCurrentFile(path)}
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
          ))}
          {files.length === 0 && selectedSiteId && (
            <p className="px-4 py-3 text-xs text-muted-foreground">No files found</p>
          )}
        </div>
      </div>

      {/* Main editor area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 h-11 border-b border-border bg-card/50 shrink-0">
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

          <div className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-xs">
            <File className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate font-mono">{currentFile}</span>
            {isDirty && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0" />}
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
                isDirty ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary text-muted-foreground cursor-default"
              )}
            >
              <Save className="w-3.5 h-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden">
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
                content={content}
                onChange={(html) => { setContent(html); setIsDirty(true); }}
              />
            ) : (
              <div className="h-full bg-white">
                <iframe
                  srcDoc={content}
                  className="w-full h-full border-none"
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

function FileTreeItem({
  entry,
  depth,
  selectedPath,
  onSelect,
  expandedDirs,
  onToggleDir,
}: {
  entry: FileEntry;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}) {
  const isExpanded = expandedDirs.has(entry.path);

  return (
    <div>
      <button
        onClick={() => {
          if (entry.type === "directory") onToggleDir(entry.path);
          else onSelect(entry.path);
        }}
        className={cn(
          "w-full flex items-center gap-1.5 px-3 py-1 text-xs transition-colors text-left hover:bg-sidebar-accent",
          selectedPath === entry.path && "bg-primary/10 text-primary",
          selectedPath !== entry.path && "text-sidebar-foreground"
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        {entry.type === "directory" ? (
          isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
        ) : null}
        {entry.type === "directory"
          ? <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          : <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate">{entry.name}</span>
      </button>
    </div>
  );
}
