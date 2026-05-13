"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { getBrowserApiWebSocketBase } from "@/lib/browser-api-origin";
import { jwtToWebSocketProtocol } from "@/lib/ws-jwt-protocol";

type DockerShellModalProps = {
  containerRef: string;
  containerName: string;
  onClose: () => void;
};

export function DockerShellModal({ containerRef, containerName, onClose }: DockerShellModalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<{ term: { dispose: () => void }; fitAddon: { fit: () => void } } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let dead = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      const { Terminal } = await import("xterm");
      if (dead) return;
      const { FitAddon } = await import("xterm-addon-fit");
      if (dead || !terminalRef.current) return;

      const term = new Terminal({
        convertEol: false,
        theme: {
          background: "#0d1117",
          foreground: "#e2e8f0",
          cursor: "#818cf8",
          black: "#1e293b",
          brightBlack: "#334155",
          white: "#e2e8f0",
          brightWhite: "#f8fafc",
          blue: "#818cf8",
          brightBlue: "#a5b4fc",
          green: "#34d399",
          brightGreen: "#6ee7b7",
          yellow: "#fbbf24",
          brightYellow: "#fcd34d",
          red: "#f87171",
          brightRed: "#fca5a5",
          cyan: "#22d3ee",
          brightCyan: "#67e8f9",
          magenta: "#c084fc",
          brightMagenta: "#d8b4fe",
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 2000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      if (dead) {
        term.dispose();
        return;
      }
      xtermRef.current = { term, fitAddon };

      const writeWsPayload = (data: unknown) => {
        if (typeof data === "string") {
          term.write(data);
          return;
        }
        if (data instanceof ArrayBuffer) {
          term.write(new TextDecoder("utf-8", { fatal: false }).decode(data));
          return;
        }
        if (typeof Blob !== "undefined" && data instanceof Blob) {
          void data.arrayBuffer().then((buf) => {
            term.write(new TextDecoder("utf-8", { fatal: false }).decode(buf));
          });
          return;
        }
        term.write(String(data));
      };

      const wsUrl = getBrowserApiWebSocketBase();
      const token = localStorage.getItem("hp_token");
      const path = `/api/docker/containers/${encodeURIComponent(containerRef)}/terminal`;
      const wsProto = token ? jwtToWebSocketProtocol(token) : "";
      const ws = token
        ? new WebSocket(`${wsUrl}${path}`, [wsProto])
        : new WebSocket(`${wsUrl}${path}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      if (dead) {
        ws.close();
        term.dispose();
        xtermRef.current = null;
        return;
      }

      /** Must be attached before any `term.write` from the server: ash sends `ESC[6n` (CPR) on the first prompt; xterm answers via `onData`. If `onData` is only registered in `ws.onopen`, the first WS frames can arrive first and garble the session. */
      const pendingStdin: string[] = [];
      term.onData((sendData) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(sendData);
        else pendingStdin.push(sendData);
      });

      ws.onopen = () => {
        for (const chunk of pendingStdin) ws.send(chunk);
        pendingStdin.length = 0;
        fitAddon.fit();
      };

      ws.onmessage = (e) => writeWsPayload(e.data);
      ws.onclose = () => term.writeln("\r\n\x1b[31m✗ Connection closed\x1b[0m\r\n");
      ws.onerror = () => term.writeln("\r\n\x1b[33m⚠ WebSocket error\x1b[0m\r\n");

      if (!dead && terminalRef.current) {
        ro = new ResizeObserver(() => {
          fitAddon.fit();
        });
        ro.observe(terminalRef.current);
      }
    })().catch(console.error);

    return () => {
      dead = true;
      ro?.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      if (xtermRef.current) {
        xtermRef.current.term.dispose();
        xtermRef.current = null;
      }
    };
  }, [containerRef]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="docker-shell-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl h-[min(32rem,70vh)] rounded-xl border bg-card shadow-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-secondary/30 shrink-0">
          <h3 id="docker-shell-title" className="font-semibold text-sm truncate">
            Shell — <span className="font-mono text-xs text-muted-foreground">{containerName}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg border border-border hover:bg-secondary shrink-0"
            aria-label="Close shell"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground px-4 py-1.5 border-b border-border shrink-0">
          Interactive <code className="text-[10px]">/bin/sh</code> via <code className="text-[10px]">docker exec -it</code> (PTY). Tenant
          sidecars open in <code className="text-[10px]">/srv</code> by default. Container must be running.
        </p>
        <div ref={terminalRef} className="flex-1 min-h-0 p-2 bg-[#0d1117]" />
      </div>
    </div>
  );
}
