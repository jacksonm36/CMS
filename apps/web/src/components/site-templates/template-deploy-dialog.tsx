"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Rocket, Terminal, X } from "lucide-react";

export type DeployTemplateTarget = {
  id: string;
  name: string;
  slug: string;
  type: string;
  provisionDockerDb?: boolean;
  dbStackVersion?: string | null;
};

type DeployPanelState = {
  lines: string[];
  phase: string;
  running: boolean;
  ok: boolean | null;
  error?: string;
};

type Props = {
  template: DeployTemplateTarget | null;
  open: boolean;
  onClose: () => void;
  onDeploy: (payload: { name: string; domain: string }) => void;
  deployPanel: DeployPanelState | null;
  canSubmit: boolean;
};

function TemplateDeployFields({
  template,
  running,
  canSubmit,
  onDeploy,
  onClose,
  deployPanel,
}: {
  template: DeployTemplateTarget;
  running: boolean;
  canSubmit: boolean;
  onDeploy: (payload: { name: string; domain: string }) => void;
  onClose: () => void;
  deployPanel: DeployPanelState | null;
}) {
  const [name, setName] = useState(template.name);
  const [domain, setDomain] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deployPanel?.lines.length]);

  const hasDb =
    template.provisionDockerDb ||
    (template.dbStackVersion?.startsWith("mysql") ?? false) ||
    (template.dbStackVersion?.startsWith("mariadb") ?? false);

  return (
    <>
      <p className="text-sm text-muted-foreground shrink-0">
        Provisions stack, vhost, and app files when supported
        {hasDb ? " (Docker DB + .hostpanel-db.env)" : ""}.
      </p>

      <label className="block space-y-1 shrink-0">
        <span className="text-xs font-medium">Site name</span>
        <input
          className="w-full h-9 px-3 rounded-md border bg-background text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={running}
          placeholder="My blog"
        />
      </label>
      <label className="block space-y-1 shrink-0">
        <span className="text-xs font-medium">Domain</span>
        <input
          className="w-full h-9 px-3 rounded-md border bg-background text-sm font-mono"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={running}
          placeholder="app.example.com"
        />
      </label>

      {deployPanel && (
        <div className="rounded-lg border bg-zinc-950 text-zinc-100 flex flex-col min-h-[200px] max-h-[40vh] overflow-hidden shrink">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 text-xs text-zinc-400">
            <Terminal className="w-3.5 h-3.5" />
            <span className="truncate flex-1">{deployPanel.phase}</span>
            {running && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
          </div>
          <pre className="flex-1 overflow-auto p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">
            {deployPanel.lines.join("\n")}
            <div ref={logEndRef} />
          </pre>
        </div>
      )}

      {deployPanel?.error && !running && (
        <p className="text-sm text-destructive shrink-0">{deployPanel.error}</p>
      )}

      <div className="flex gap-2 justify-end pt-1 shrink-0">
        <button type="button" onClick={onClose} disabled={running} className="h-9 px-4 rounded-md border text-sm disabled:opacity-50">
          {running ? "Deploying…" : deployPanel?.ok ? "Close" : "Cancel"}
        </button>
        <button
          type="button"
          disabled={!canSubmit || running || !name.trim() || !domain.trim()}
          onClick={() => onDeploy({ name: name.trim(), domain: domain.trim().toLowerCase() })}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 inline-flex items-center gap-2"
        >
          {running && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Deploy site
        </button>
      </div>
    </>
  );
}

export function TemplateDeployDialog({
  template,
  open,
  onClose,
  onDeploy,
  deployPanel,
  canSubmit,
}: Props) {
  if (!open || !template) return null;

  const running = deployPanel?.running ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={running ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-labelledby="deploy-template-title"
        className="w-full max-w-lg rounded-xl border bg-card shadow-lg p-5 space-y-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div>
            <h3 id="deploy-template-title" className="font-semibold flex items-center gap-2">
              <Rocket className="w-5 h-5 text-primary" />
              Deploy {template.name}
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{template.slug}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="p-1 rounded-md hover:bg-secondary disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <TemplateDeployFields
          key={template.id}
          template={template}
          running={running}
          canSubmit={canSubmit}
          onDeploy={onDeploy}
          onClose={onClose}
          deployPanel={deployPanel}
        />
      </div>
    </div>
  );
}
