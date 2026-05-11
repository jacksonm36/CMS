"use client";

import { useEffect, useRef } from "react";

interface VisualEditorProps {
  content: string;
  onChange: (html: string) => void;
}

export function VisualEditor({ content, onChange }: VisualEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    async function initGrapesJS() {
      const grapesjs = (await import("grapesjs")).default;

      if (destroyed || !containerRef.current) return;

      const editor = grapesjs.init({
        container: containerRef.current,
        fromElement: false,
        components: content,
        style: "",
        storageManager: false,
        plugins: [],
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
              content: `<a href="#" style="display: inline-block; padding: 0.75rem 1.5rem; background: #6366f1; color: white; border-radius: 0.5rem; text-decoration: none;">Click Me</a>`,
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
          ],
        },
        panels: {
          defaults: [
            {
              id: "panel-top",
              el: ".panel__top",
            },
            {
              id: "devices-c",
              el: ".panel__devices",
              buttons: [
                { id: "set-desktop", label: "D", command: "set-device-desktop", active: true },
                { id: "set-tablet", label: "T", command: "set-device-tablet" },
                { id: "set-mobile", label: "M", command: "set-device-mobile" },
              ],
            },
          ],
        },
      });

      editor.on("update", () => {
        onChange(editor.getHtml() + `<style>${editor.getCss()}</style>`);
      });

      editorRef.current = editor;
    }

    initGrapesJS().catch(console.error);

    return () => {
      destroyed = true;
      if (editorRef.current) {
        (editorRef.current as { destroy: () => void }).destroy();
        editorRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ "--gjs-primary-color": "#6366f1" } as React.CSSProperties}
    />
  );
}
