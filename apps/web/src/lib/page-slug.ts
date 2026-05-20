/** Turn pasted paths or URLs into a single page slug (e.g. "info"). */
export function parsePageSlugInput(raw: string, siteDomain?: string): string {
  let s = raw.trim();
  if (!s) return "";

  s = s.replace(/^https?:\/\//i, "");

  const host = (siteDomain ?? "").replace(/^https?:\/\//i, "").toLowerCase();
  if (host && s.toLowerCase().startsWith(host)) {
    s = s.slice(host.length);
  }

  s = s.replace(/^\/+/, "");
  const segment = s.split("/").filter(Boolean)[0] ?? "";
  return segment.replace(/\.html?$/i, "").replace(/[^a-z0-9-]/gi, "").toLowerCase();
}

export function isValidPageSlug(slug: string): boolean {
  if (!slug || slug === "index") return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i.test(slug);
}
