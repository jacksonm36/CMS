"use client";

import { AlertTriangle } from "lucide-react";
import type { DeployConflictInfo } from "@/lib/template-deploy-stream";

export type DeployConflictChoice =
  | "cancel"
  | "delete_and_redeploy"
  | "reset_db_and_redeploy"
  | "new_db_and_redeploy"
  | "new_site";

type Props = {
  open: boolean;
  conflict: DeployConflictInfo | null;
  templateName: string;
  pendingName: string;
  pendingDomain: string;
  onChoose: (choice: DeployConflictChoice) => void;
  onClose: () => void;
};

export function DeployConflictDialog({
  open,
  conflict,
  templateName,
  pendingName,
  pendingDomain,
  onChoose,
  onClose,
}: Props) {
  if (!open || !conflict) return null;

  const canDb = conflict.hasStackDb || conflict.hasDockerMysql || conflict.hasDbEnvFile;
  const engineLabel = conflict.stackDbEngine ?? "database";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-labelledby="deploy-conflict-title"
        className="w-full max-w-md rounded-xl border bg-card shadow-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 id="deploy-conflict-title" className="font-semibold">Site already exists</h3>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-mono text-foreground/90">{pendingDomain}</span> is already used by{" "}
              <span className="font-medium">{conflict.existingSiteName}</span>.
              {conflict.sameTemplate ? (
                <> You are deploying the same template ({templateName}) again.</>
              ) : (
                <> You are deploying {templateName}.</>
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {canDb && (
            <>
              <button
                type="button"
                onClick={() => onChoose("reset_db_and_redeploy")}
                className="w-full text-left rounded-lg border px-3 py-2.5 text-sm hover:bg-accent transition-colors"
              >
                <span className="font-medium">Reset database</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Clear {engineLabel} data, keep credentials, redeploy app files and CMS config.
                </span>
              </button>
              {conflict.hasStackDb && (
                <button
                  type="button"
                  onClick={() => onChoose("new_db_and_redeploy")}
                  className="w-full text-left rounded-lg border px-3 py-2.5 text-sm hover:bg-accent transition-colors"
                >
                  <span className="font-medium">New database</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Replace stack {engineLabel} with fresh storage and new credentials, then redeploy.
                  </span>
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => onChoose("delete_and_redeploy")}
            className="w-full text-left rounded-lg border border-destructive/30 px-3 py-2.5 text-sm hover:bg-destructive/10 transition-colors"
          >
            <span className="font-medium text-destructive">Delete site and redeploy</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Remove the site record, stack, and vhost, then install {pendingName} from scratch.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onChoose("new_site")}
            className="w-full text-left rounded-lg border px-3 py-2.5 text-sm hover:bg-accent transition-colors"
          >
            <span className="font-medium">Use a different domain</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Go back and enter another domain (or site name) without changing this site.
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onChoose("cancel")}
          className="w-full h-9 rounded-md border text-sm hover:bg-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
