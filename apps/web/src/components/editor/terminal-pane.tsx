"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { getBrowserApiWebSocketBase } from "@/lib/browser-api-origin";
import { jwtToWebSocketProtocol } from "@/lib/ws-jwt-protocol";

interface TerminalPaneProps {
  siteId: string;
  height: number;
}

export function TerminalPane({ siteId, height }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<unknown>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    let destroyed = false;
    let cleanupResizeObserver: (() => void) | undefined;

    async function initTerminal() {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");
      const { WebLinksAddon } = await import("xterm-addon-web-links");

      if (destroyed || !terminalRef.current) return;

      const term = new Terminal({
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
        scrollback: 1000,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      term.open(terminalRef.current);
      fitAddon.fit();
      xtermRef.current = { term, fitAddon };
      requestAnimationFrame(() => { if (!destroyed) term.focus(); });

      const wsUrl = getBrowserApiWebSocketBase();
      const token = localStorage.getItem("hp_token");
      const sizeQuery = `?cols=${term.cols}&rows=${term.rows}`;
      const wsProto = token ? jwtToWebSocketProtocol(token) : "";
      const ws = token
        ? new WebSocket(`${wsUrl}/api/sites/${siteId}/terminal${sizeQuery}`, [wsProto])
        : new WebSocket(`${wsUrl}/api/sites/${siteId}/terminal${sizeQuery}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      const writeWsData = (data: unknown) => {
        if (typeof data === "string") { term.write(data); return; }
        if (data instanceof ArrayBuffer) {
          term.write(new TextDecoder("utf-8", { fatal: false }).decode(data));
          return;
        }
        if (typeof Blob !== "undefined" && data instanceof Blob) {
          void data.arrayBuffer().then((buf) => term.write(new TextDecoder("utf-8", { fatal: false }).decode(buf)));
          return;
        }
        term.write(String(data));
      };

      const sendResize = (cols: number, rows: number) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(JSON.stringify({ r: [cols, rows] })));
        }
      };

      const pendingStdin: string[] = [];
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
        else pendingStdin.push(data);
      });
      term.onResize(({ cols, rows }) => sendResize(cols, rows));

      ws.onopen = () => {
        for (const chunk of pendingStdin) ws.send(chunk);
        pendingStdin.length = 0;
        if (term.cols !== parseInt(new URL(ws.url).searchParams.get("cols") ?? "0") ||
            term.rows !== parseInt(new URL(ws.url).searchParams.get("rows") ?? "0")) {
          sendResize(term.cols, term.rows);
        }
        term.focus();
      };
      ws.onmessage = (e) => writeWsData(e.data);
      ws.onclose = () => term.writeln("\r\n\x1b[31m✗ Connection closed\x1b[0m");
      ws.onerror = () => term.writeln("\r\n\x1b[33m⚠ WebSocket error\x1b[0m");

      const resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(terminalRef.current);
      cleanupResizeObserver = () => resizeObserver.disconnect();
    }

    initTerminal().catch(console.error);

    return () => {
      destroyed = true;
      cleanupResizeObserver?.();
      wsRef.current?.close();
      if (xtermRef.current) (xtermRef.current as { term: { dispose: () => void } }).term.dispose();
    };
  }, [siteId]);

  useEffect(() => {
    if (xtermRef.current) {
      (xtermRef.current as { fitAddon: { fit: () => void } }).fitAddon.fit();
    }
  }, [height]);

  return (
    <div className="h-full bg-[#0d1117] flex flex-col">
      <div className="flex items-center justify-between px-3 py-1 bg-[#161b22] border-b border-border">
        <span className="text-xs font-medium text-muted-foreground font-mono">TERMINAL</span>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-amber-400/80" />
          <div className="w-3 h-3 rounded-full bg-emerald-400/80" />
        </div>
      </div>
      <div
        ref={terminalRef}
        className="flex-1 p-2 cursor-text"
        onClick={() => (xtermRef.current as { term: { focus: () => void } } | null)?.term.focus()}
      />
    </div>
  );
}
