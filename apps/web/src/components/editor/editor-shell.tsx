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
  Loader2,
} from "lucide-react";
import { SitePagesPanel } from "./site-pages-panel";
import { EditorContextMenu } from "./editor-context-menu";
import { buildFileTreeContextItems, buildFolderAreaContextItems } from "./file-tree-menu-items";
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
  const [fileMenu, setFileMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
    isExpanded: boolean;
  } | null>(null);
  const [areaMenu, setAreaMenu] = useState<{ x: number; y: number; dirPath: string } | null>(null);

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

  const deleteFileMutation = useMutation({
    mutationFn: (path: string) =>
      apiClient.delete<{ message: string; data?: { kind: "file" | "directory" } }>(
        `/sites/${selectedSiteId}/files?path=${encodeURIComponent(path)}`,
      ),
    onSuccess: async (res, path) => {
      await queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
      await queryClient.invalidateQueries({ queryKey: ["site-pages", selectedSiteId] });
      if (currentFile === path || currentFile.startsWith(`${path}/`)) {
        setCurrentFile("/index.html");
        setContent("");
        setIsDirty(false);
      }
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        for (const p of prev) {
          if (p === path || p.startsWith(`${path}/`)) next.delete(p);
        }
        return next;
      });
      const kind = (res as { data?: { kind?: "file" | "directory" } }).data?.kind;
      toast.success(kind === "directory" ? "Folder deleted" : "File deleted");
    },
    onError: (err: Error) => toast.error("Delete failed", { description: err.message }),
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

  const canDeletePath = useCallback((path: string) => {
    if (!path || path === "/") return false;
    if (path === "/index.html") return false;
    if (path === "/.hostpanel" || path.startsWith("/.hostpanel/")) return false;
    return true;
  }, []);

  const handleDeletePath = useCallback(
    (path: string, kind: "file" | "directory") => {
      if (!selectedSiteId) return;
      if (!canDeletePath(path)) {
        toast.error(kind === "directory" ? "This folder cannot be deleted" : "This file cannot be deleted");
        return;
      }
      const msg =
        kind === "directory"
          ? `Delete folder ${path} and everything inside?\n\nThis cannot be undone.`
          : `Delete ${path}? This cannot be undone.`;
      if (!window.confirm(msg)) return;
      deleteFileMutation.mutate(path);
    },
    [selectedSiteId, canDeletePath, deleteFileMutation],
  );

  const openFile = useCallback((path: string, editorMode: EditorMode = "code") => {
    setCurrentFile(path);
    setMode(editorMode);
  }, []);

  const refreshFiles = useCallback(() => {
    if (!selectedSiteId) return;
    void queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
    void queryClient.invalidateQueries({ queryKey: ["site-pages", selectedSiteId] });
  }, [queryClient, selectedSiteId]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }, []);

  const handleNewFileInDir = useCallback(
    (dirPath: string) => {
      if (!selectedSiteId) return;
      const base = dirPath === "/" ? "" : dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      const suggested = `${base}new-file.html`;
      const raw = window.prompt("New file path (from site root)", suggested);
      if (raw == null || !raw.trim()) return;
      const path = raw.trim().startsWith("/") ? raw.trim() : `/${raw.trim()}`;
      const isHtml = /\.html?$/i.test(path);
      const body = isHtml
        ? `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>New page</title>\n</head>\n<body>\n  <p>Edit this page in the editor.</p>\n</body>\n</html>\n`
        : "";
      void apiClient
        .post(`/sites/${selectedSiteId}/files/write`, { path, content: body })
        .then(async () => {
          await queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
          openFile(path, "code");
          toast.success("File created");
        })
        .catch((err: Error) => toast.error(err.message));
    },
    [selectedSiteId, queryClient, openFile],
  );

  const handleRenameFile = useCallback(
    async (path: string) => {
      if (!selectedSiteId) return;
      const name = path.split("/").pop() ?? path;
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "/";
      const raw = window.prompt("Rename to", name);
      if (raw == null || !raw.trim() || raw.trim() === name) return;
      const newPath = dir === "/" ? `/${raw.trim()}` : `${dir}/${raw.trim()}`;
      try {
        const res = await apiClient.get<{ data: { content: string } }>(
          `/sites/${selectedSiteId}/files/read?path=${encodeURIComponent(path)}`,
        );
        await apiClient.post(`/sites/${selectedSiteId}/files/write`, {
          path: newPath,
          content: res.data.content,
        });
        await apiClient.delete(`/sites/${selectedSiteId}/files?path=${encodeURIComponent(path)}`);
        await queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
        if (currentFile === path) setCurrentFile(newPath);
        toast.success("Renamed");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Rename failed");
      }
    },
    [selectedSiteId, queryClient, currentFile],
  );

  const handleDuplicateFile = useCallback(
    async (path: string) => {
      if (!selectedSiteId) return;
      const dot = path.lastIndexOf(".");
      const copyPath =
        dot > 0
          ? `${path.slice(0, dot)}-copy${path.slice(dot)}`
          : `${path}-copy`;
      try {
        const res = await apiClient.get<{ data: { content: string } }>(
          `/sites/${selectedSiteId}/files/read?path=${encodeURIComponent(path)}`,
        );
        await apiClient.post(`/sites/${selectedSiteId}/files/write`, {
          path: copyPath,
          content: res.data.content,
        });
        await queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
        openFile(copyPath, "code");
        toast.success("Duplicated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Duplicate failed");
      }
    },
    [selectedSiteId, queryClient, openFile],
  );

  const handleSetupPageFromFile = useCallback(
    async (path: string) => {
      if (!selectedSiteId) return;
      const m = path.match(/^\/([^/]+)\.html?$/i);
      if (!m) return;
      try {
        await apiClient.post(`/sites/${selectedSiteId}/pages`, { op: "add_page", slug: m[1]!.toLowerCase() });
        await queryClient.invalidateQueries({ queryKey: ["site-pages", selectedSiteId] });
        await queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
        toast.success(`Page set up at /${m[1]!.toLowerCase()}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not set up page");
      }
    },
    [selectedSiteId, queryClient],
  );

  const publicUrlForPath = useCallback(
    (path: string) => {
      const host = selectedSite?.domain?.replace(/^https?:\/\//, "") ?? "";
      if (!host) return "";
      if (path === "/index.html") return `https://${host}/`;
      const folderIndex = path.match(/^\/([^/]+)\/index\.html?$/i);
      if (folderIndex) return `https://${host}/${folderIndex[1]}/`;
      return `https://${host}${path}`;
    },
    [selectedSite?.domain],
  );

  const fileMenuItems =
    fileMenu &&
    buildFileTreeContextItems({
      entry: fileMenu.entry,
      isExpanded: fileMenu.isExpanded,
      canDelete: fileMenu.entry.type === "file" && canDeletePath(fileMenu.entry.path),
      canDeleteFolder: fileMenu.entry.type === "directory" && canDeletePath(fileMenu.entry.path),
      isRootHtml: /^\/[^/]+\.html?$/i.test(fileMenu.entry.path),
      siteDomain: selectedSite?.domain,
      onEdit: () => openFile(fileMenu.entry.path, "code"),
      onVisual: () => openFile(fileMenu.entry.path, "visual"),
      onPreview: () => openFile(fileMenu.entry.path, "preview"),
      onRename: () => void handleRenameFile(fileMenu.entry.path),
      onDuplicate: () => void handleDuplicateFile(fileMenu.entry.path),
      onCopyPath: () => void copyToClipboard(fileMenu.entry.path, "Path"),
      onDelete: () => handleDeletePath(fileMenu.entry.path, "file"),
      onDeleteFolder: () => handleDeletePath(fileMenu.entry.path, "directory"),
      onNewFile: () => handleNewFileInDir(fileMenu.entry.path),
      onToggleDir: () => {
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          if (next.has(fileMenu.entry.path)) next.delete(fileMenu.entry.path);
          else next.add(fileMenu.entry.path);
          return next;
        });
      },
      onRefresh: refreshFiles,
      onSetupPage: () => void handleSetupPageFromFile(fileMenu.entry.path),
      onViewLive: () => {
        const url = publicUrlForPath(fileMenu.entry.path);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      },
    });

  const areaMenuItems =
    areaMenu &&
    buildFolderAreaContextItems({
      dirPath: areaMenu.dirPath,
      onNewFile: () => handleNewFileInDir(areaMenu.dirPath),
      onRefresh: refreshFiles,
    });

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
            <button
              type="button"
              title="Refresh files"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["files", selectedSiteId] });
                void queryClient.invalidateQueries({ queryKey: ["site-pages", selectedSiteId] });
              }}
              className="w-full flex items-center justify-center gap-1 text-[10px] text-muted-foreground rounded-md border border-border py-1 hover:bg-secondary/50"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          )}
        </div>
        {selectedSiteId && (
          <SitePagesPanel
            siteId={selectedSiteId}
            domain={selectedSite?.domain}
            onOpenFile={(path) => {
              setCurrentFile(path);
              setMode("code");
            }}
          />
        )}
        <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground shrink-0">
          Files <span className="font-normal opacity-70">· right-click</span>
        </p>
        <div
          className="flex-1 overflow-auto py-1 min-h-0"
          onContextMenu={(e) => {
            if (!selectedSiteId) return;
            if ((e.target as HTMLElement).closest("[data-file-row]")) return;
            e.preventDefault();
            setFileMenu(null);
            setAreaMenu({ x: e.clientX, y: e.clientY, dirPath: "/" });
          }}
        >
          {selectedSiteId ? (
            <FileTreeBranch
              siteId={selectedSiteId}
              dirPath="/"
              depth={0}
              currentFile={currentFile}
              onSelectFile={(path) => openFile(path, "code")}
              onOpenContextMenu={(entry, isExpanded, e) => {
                e.preventDefault();
                e.stopPropagation();
                setAreaMenu(null);
                setFileMenu({ x: e.clientX, y: e.clientY, entry, isExpanded });
              }}
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

      {fileMenu && fileMenuItems && (
        <EditorContextMenu x={fileMenu.x} y={fileMenu.y} items={fileMenuItems} onClose={() => setFileMenu(null)} />
      )}
      {areaMenu && areaMenuItems && (
        <EditorContextMenu x={areaMenu.x} y={areaMenu.y} items={areaMenuItems} onClose={() => setAreaMenu(null)} />
      )}

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
  onOpenContextMenu,
  expandedDirs,
  onToggleDir,
}: {
  siteId: string;
  dirPath: string;
  depth: number;
  currentFile: string;
  onSelectFile: (path: string) => void;
  onOpenContextMenu: (entry: FileEntry, isExpanded: boolean, e: React.MouseEvent) => void;
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
            ? "No files yet — create a page above."
            : "Empty folder."}
        </p>
      )}
      {entries.map((entry) => {
        const isExpanded = entry.type === "directory" && expandedDirs.has(entry.path);
        return (
          <div
            key={entry.path}
            data-file-row
            className="group/row"
          >
            <button
              type="button"
              onClick={() => {
                if (entry.type === "directory") onToggleDir(entry.path);
                else onSelectFile(entry.path);
              }}
              onContextMenu={(e) => onOpenContextMenu(entry, isExpanded, e)}
              className={cn(
                "w-full flex items-center gap-1.5 px-3 py-1 text-xs transition-colors text-left hover:bg-sidebar-accent",
                currentFile === entry.path && entry.type === "file" ? "bg-sky-500/10 text-sky-200" : "text-sidebar-foreground",
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
                onOpenContextMenu={onOpenContextMenu}
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
