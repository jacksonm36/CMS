"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type EditorContextMenuItem =
  | {
      type: "item";
      id: string;
      label: string;
      icon?: React.ReactNode;
      onClick: () => void;
      disabled?: boolean;
      destructive?: boolean;
    }
  | { type: "separator" };

export function EditorContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: EditorContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setPos({ x, y });
      return;
    }
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - pad) nx = window.innerWidth - rect.width - pad;
    if (ny + rect.height > window.innerHeight - pad) ny = window.innerHeight - rect.height - pad;
    if (nx < pad) nx = pad;
    if (ny < pad) ny = pad;
    setPos({ x: nx, y: ny });
  }, [x, y, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[9999] min-w-[11rem] max-w-[16rem] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.type === "separator" ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
              item.disabled && "opacity-40 cursor-not-allowed",
              !item.disabled && !item.destructive && "hover:bg-accent",
              !item.disabled && item.destructive && "text-red-400 hover:bg-red-500/10",
            )}
          >
            {item.icon && <span className="w-3.5 h-3.5 shrink-0 opacity-80">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
