"use client";

import { useRef } from "react";
import MonacoEditorReact, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

interface MonacoEditorProps {
  value: string;
  language: string;
  onChange: (value: string | undefined) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

export function MonacoEditor({ value, language, onChange, onSave, readOnly }: MonacoEditorProps) {
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Save shortcut
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave?.());

    // Theme
    monaco.editor.defineTheme("hostpanel-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "e2e8f0", background: "0f172a" },
        { token: "comment", foreground: "64748b", fontStyle: "italic" },
        { token: "keyword", foreground: "818cf8" },
        { token: "string", foreground: "34d399" },
        { token: "number", foreground: "fb923c" },
        { token: "type", foreground: "38bdf8" },
        { token: "function", foreground: "a78bfa" },
      ],
      colors: {
        "editor.background": "#0d1117",
        "editor.foreground": "#e2e8f0",
        "editor.lineHighlightBackground": "#1e293b50",
        "editorLineNumber.foreground": "#334155",
        "editorLineNumber.activeForeground": "#64748b",
        "editor.selectionBackground": "#6366f130",
        "editorCursor.foreground": "#818cf8",
        "editorGutter.background": "#0d1117",
      },
    });
    monaco.editor.setTheme("hostpanel-dark");
  };

  return (
    <MonacoEditorReact
      height="100%"
      language={language}
      value={value}
      onChange={onChange}
      onMount={handleMount}
      options={{
        readOnly,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontLigatures: true,
        lineNumbers: "on",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true },
        cursorBlinking: "smooth",
        smoothScrolling: true,
        padding: { top: 12, bottom: 12 },
        scrollbar: { vertical: "auto", horizontal: "auto", verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
        overviewRulerLanes: 0,
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        formatOnPaste: true,
        formatOnType: false,
      }}
    />
  );
}
