"use client";

import { useEffect, useRef } from "react";
import "grapesjs/dist/css/grapes.min.css";
import "./grapes-panel-overrides.css";

interface VisualEditorProps {
  content: string;
  onChange: (html: string) => void;
}

/** GrapesJS expects body markup + CSS, not a full document string. */
function parseHtmlForGrapes(html: string): { components: string; style: string } {
  const trimmed = html.trim();
  if (!trimmed) return { components: "<div></div>", style: "" };
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, "text/html");
    const styles = Array.from(doc.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("\n");
    const bodyHtml = doc.body?.innerHTML?.trim();
    if (bodyHtml) return { components: bodyHtml, style: styles };
  } catch {
    /* fall through */
  }
  return { components: trimmed, style: "" };
}

/**
 * GrapesJS uses `--gjs-primary-color` for large chrome areas (not “brand accent”).
 * Match HostPanel / typical static-site dark UI: slate shells, cyan only for focus.
 */
const GJS_THEME: React.CSSProperties = {
  /* Slightly wider style rail for readability */
  "--gjs-left-width": "clamp(272px, 24vw, 360px)",
  "--gjs-font-size": "0.78rem",
  "--gjs-main-color": "#0b1224",
  "--gjs-primary-color": "#0f172a",
  "--gjs-secondary-color": "#1e293b",
  "--gjs-tertiary-color": "#334155",
  "--gjs-quaternary-color": "#64748b",
  "--gjs-font-color": "#eef2f6",
  "--gjs-font-color-active": "#ffffff",
  "--gjs-main-dark-color": "rgba(0, 0, 0, 0.5)",
  "--gjs-secondary-dark-color": "rgba(15, 23, 42, 0.55)",
  "--gjs-main-light-color": "rgba(255, 255, 255, 0.09)",
  "--gjs-secondary-light-color": "#cbd5e1",
  "--gjs-soft-light-color": "rgba(255, 255, 255, 0.06)",
  "--gjs-light-border": "rgba(148, 163, 184, 0.28)",
  "--gjs-color-blue": "#38bdf8",
  "--gjs-color-highlight": "#7dd3fc",
  "--gjs-color-green": "#4ade80",
  "--gjs-color-yellow": "#fde047",
  "--gjs-color-red": "#f87171",
  /* Softer “warn” tint so it is not mistaken for body text color */
  "--gjs-color-warn": "#f59e0b",
  "--gjs-arrow-color": "#94a3b8",
  "--gjs-dark-text-shadow": "rgba(0, 0, 0, 0.35)",
} as React.CSSProperties;

export function VisualEditor({ content, onChange }: VisualEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ destroy: () => void } | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;
    const { components, style } = parseHtmlForGrapes(content);

    async function initGrapesJS() {
      const grapesjs = (await import("grapesjs")).default;

      if (destroyed || !containerRef.current) return;

      const editor = grapesjs.init({
        container: containerRef.current,
        height: "100%",
        width: "100%",
        fromElement: false,
        components,
        style,
        storageManager: false,
        plugins: [],
        noticeOnUnload: false,
        showOffsets: false,
        showOffsetsSelected: true,
        selectorManager: {
          componentFirst: true,
        },
        deviceManager: {
          devices: [
            { name: "Desktop", width: "" },
            { name: "Tablet", width: "768px", widthMedia: "992px" },
            { name: "Mobile", width: "320px", widthMedia: "480px" },
          ],
        },
        blockManager: {
          blocks: [
            {
              id: "section",
              label: "Section",
              category: "Layout",
              content: `<section class="section" style="padding: 2rem; min-height: 200px;"><div class="container" style="max-width: 1200px; margin: 0 auto;"></div></section>`,
            },
            {
              id: "text",
              label: "Text",
              category: "Content",
              content: `<p>Write your text here...</p>`,
            },
            {
              id: "heading",
              label: "Heading",
              category: "Content",
              content: `<h2 style="font-size: 2rem; font-weight: 700;">Heading</h2>`,
            },
            {
              id: "button",
              label: "Button",
              category: "Content",
              content: `<a href="#" style="display: inline-block; padding: 0.75rem 1.5rem; background: #0ea5e9; color: #020617; border-radius: 0.5rem; text-decoration: none; font-weight: 600;">Click Me</a>`,
            },
            {
              id: "image",
              label: "Image",
              category: "Media",
              content: `<img src="https://via.placeholder.com/400x200" alt="Image" style="max-width: 100%; height: auto;" />`,
            },
            {
              id: "two-col",
              label: "2 Columns",
              category: "Layout",
              content: `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 1rem;"><div style="padding: 1rem; border: 1px dashed #ccc;">Column 1</div><div style="padding: 1rem; border: 1px dashed #ccc;">Column 2</div></div>`,
            },
            {
              id: "three-col",
              label: "3 Columns",
              category: "Layout",
              content: `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; padding: 1rem;"><div style="padding: 1rem; border: 1px dashed #ccc;">Column 1</div><div style="padding: 1rem; border: 1px dashed #ccc;">Column 2</div><div style="padding: 1rem; border: 1px dashed #ccc;">Column 3</div></div>`,
            },
            {
              id: "divider",
              label: "Divider",
              category: "Layout",
              content: `<hr style="border: none; border-top: 1px solid rgba(148,163,184,0.35); margin: 1.5rem 0;" />`,
            },
            {
              id: "spacer",
              label: "Spacer",
              category: "Layout",
              content: `<div style="height: 2rem;"></div>`,
            },
            {
              id: "link",
              label: "Link",
              category: "Content",
              content: `<a href="#" style="color: #38bdf8; text-decoration: underline;">Link text</a>`,
            },
            {
              id: "list",
              label: "Bullet list",
              category: "Content",
              content: `<ul style="padding-left: 1.25rem; line-height: 1.6;"><li>First item</li><li>Second item</li></ul>`,
            },
            {
              id: "quote",
              label: "Quote",
              category: "Content",
              content: `<blockquote style="margin: 0; padding-left: 1rem; border-left: 3px solid #38bdf8; color: #94a3b8; font-style: italic;">Quote text</blockquote>`,
            },
            {
              id: "video",
              label: "Video placeholder",
              category: "Media",
              content: `<div style="aspect-ratio: 16/9; max-width: 100%; background: #0f172a; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 0.85rem;">Replace with iframe or video</div>`,
            },
          ],
        },
      });

      editor.on("load", () => {
        try {
          const sectors = editor.StyleManager.getSectors() as unknown as {
            each?: (cb: (m: { set: (k: string, v: unknown) => void }, i: number) => void) => void;
          };
          sectors.each?.((sector, i) => {
            sector.set("open", i < 5);
          });
        } catch {
          /* Style manager not ready */
        }
      });

      editor.on("update", () => {
        onChangeRef.current(editor.getHtml() + `<style>${editor.getCss()}</style>`);
      });

      editorRef.current = editor;
    }

    initGrapesJS().catch(console.error);

    return () => {
      destroyed = true;
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
    // Intentionally run once per mount: parent uses `key` so a new file remounts with fresh `content`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div
        ref={containerRef}
        className="gjs-hostpanel-root flex-1 min-h-0 w-full min-w-0 overflow-hidden bg-[#020617] [&_.gjs-cv-canvas-bg]:!bg-[#020617]/90"
        style={GJS_THEME}
      />
    </div>
  );
}
