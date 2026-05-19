import {
  Copy,
  ExternalLink,
  Eye,
  FileInput,
  FilePlus,
  FolderOpen,
  Globe,
  Layers,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { EditorContextMenuItem } from "./editor-context-menu";

export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export function buildFileTreeContextItems(opts: {
  entry: FileTreeEntry;
  isExpanded: boolean;
  canDelete: boolean;
  isRootHtml: boolean;
  siteDomain?: string;
  onEdit: () => void;
  onVisual: () => void;
  onPreview: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  onDeleteFolder: () => void;
  canDeleteFolder: boolean;
  onNewFile: () => void;
  onToggleDir: () => void;
  onRefresh: () => void;
  onSetupPage: () => void;
  onViewLive: () => void;
}): EditorContextMenuItem[] {
  const isHtml = /\.html?$/i.test(opts.entry.name);
  const isFile = opts.entry.type === "file";

  if (isFile) {
    const items: EditorContextMenuItem[] = [
      { type: "item", id: "edit", label: "Edit", icon: <Pencil className="w-3.5 h-3.5" />, onClick: opts.onEdit },
    ];
    if (isHtml) {
      items.push(
        { type: "item", id: "visual", label: "Open in Visual", icon: <Layers className="w-3.5 h-3.5" />, onClick: opts.onVisual },
        { type: "item", id: "preview", label: "Preview", icon: <Eye className="w-3.5 h-3.5" />, onClick: opts.onPreview },
      );
    }
    if (opts.isRootHtml) {
      items.push({
        type: "item",
        id: "setup-page",
        label: "Set up as page",
        icon: <Globe className="w-3.5 h-3.5" />,
        onClick: opts.onSetupPage,
      });
    }
    if (opts.siteDomain && isHtml) {
      items.push({
        type: "item",
        id: "view-live",
        label: "View on site",
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        onClick: opts.onViewLive,
      });
    }
    items.push(
      { type: "separator" },
      { type: "item", id: "rename", label: "Rename…", icon: <FileInput className="w-3.5 h-3.5" />, onClick: opts.onRename },
      { type: "item", id: "duplicate", label: "Duplicate", icon: <Copy className="w-3.5 h-3.5" />, onClick: opts.onDuplicate },
      { type: "item", id: "copy-path", label: "Copy path", icon: <Copy className="w-3.5 h-3.5" />, onClick: opts.onCopyPath },
      { type: "separator" },
      {
        type: "item",
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="w-3.5 h-3.5" />,
        onClick: opts.onDelete,
        destructive: true,
        disabled: !opts.canDelete,
      },
    );
    return items;
  }

  return [
    { type: "item", id: "new-file", label: "New file here…", icon: <FilePlus className="w-3.5 h-3.5" />, onClick: opts.onNewFile },
    {
      type: "item",
      id: "toggle-dir",
      label: opts.isExpanded ? "Collapse folder" : "Expand folder",
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      onClick: opts.onToggleDir,
    },
    { type: "item", id: "refresh", label: "Refresh", icon: <RefreshCw className="w-3.5 h-3.5" />, onClick: opts.onRefresh },
    { type: "separator" },
    { type: "item", id: "copy-path", label: "Copy path", icon: <Copy className="w-3.5 h-3.5" />, onClick: opts.onCopyPath },
    {
      type: "item",
      id: "delete-folder",
      label: "Delete folder…",
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: opts.onDeleteFolder,
      destructive: true,
      disabled: !opts.canDeleteFolder,
    },
  ];
}

export function buildFolderAreaContextItems(opts: {
  dirPath: string;
  onNewFile: () => void;
  onRefresh: () => void;
}): EditorContextMenuItem[] {
  return [
    { type: "item", id: "new-file", label: "New file here…", icon: <FilePlus className="w-3.5 h-3.5" />, onClick: opts.onNewFile },
    { type: "item", id: "refresh", label: "Refresh", icon: <RefreshCw className="w-3.5 h-3.5" />, onClick: opts.onRefresh },
  ];
}
