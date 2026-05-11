"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

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

      // WebSocket connection to API shell endpoint
      const wsUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000")
        .replace("http://", "ws://")
        .replace("https://", "wss://");

      const token = localStorage.getItem("hp_token");

      try {
        const ws = new WebSocket(`${wsUrl}/api/sites/${siteId}/terminal?token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => term.writeln("\r\n\x1b[32m✓ Connected to shell\x1b[0m\r\n");
        ws.onmessage = (e) => term.write(e.data);
        ws.onclose = () => term.writeln("\r\n\x1b[31m✗ Connection closed\x1b[0m");
        ws.onerror = () => term.writeln("\r\n\x1b[33m⚠ WebSocket unavailable (demo mode)\x1b[0m");

        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });

        term.writeln("\x1b[36mHostPanel Terminal\x1b[0m — Type commands below");
      } catch {
        term.writeln("\x1b[33m⚠ Terminal requires a live server connection\x1b[0m");
        // Provide a simulated shell for demo
        term.write("$ ");
        let cmd = "";
        term.onData((data) => {
          if (data === "\r") {
            term.writeln("");
            if (cmd.trim() === "ls") term.writeln("index.html  style.css  app.js");
            else if (cmd.trim() === "pwd") term.writeln("/var/www/site");
            else if (cmd.trim() === "whoami") term.writeln("www-data");
            else if (cmd.trim() === "clear") term.clear();
            else if (cmd.trim()) term.writeln(`bash: ${cmd}: command not found`);
            cmd = "";
            term.write("$ ");
          } else if (data === "\x7f") {
            if (cmd.length > 0) { cmd = cmd.slice(0, -1); term.write("\b \b"); }
          } else {
            cmd += data;
            term.write(data);
          }
        });
      }

      const resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(terminalRef.current);

      return () => resizeObserver.disconnect();
    }

    initTerminal().catch(console.error);

    return () => {
      destroyed = true;
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
      <div ref={terminalRef} className="flex-1 p-2" />
    </div>
  );
}
