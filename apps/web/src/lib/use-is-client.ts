"use client";

import { useSyncExternalStore } from "react";

/** True after client hydration; safe for `createPortal` and other browser-only APIs. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
