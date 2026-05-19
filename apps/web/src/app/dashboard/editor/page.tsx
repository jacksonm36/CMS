"use client";

import { Suspense } from "react";
import { EditorShell } from "@/components/editor/editor-shell";

export default function EditorPage() {
  return (
    <div className="-m-6 h-[calc(100vh-4rem)]">
      <Suspense fallback={
        <div className="h-full flex items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <EditorShell />
      </Suspense>
    </div>
  );
}
