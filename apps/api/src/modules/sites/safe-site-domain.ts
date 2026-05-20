/** Validate hostname used for /var/www/<domain> paths (no traversal, no slashes). */

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function assertSafeSiteDomain(raw: string): string {
  const domain = raw.trim().toLowerCase();
  if (!domain || domain.length > 253) {
    throw new Error("Invalid domain");
  }
  if (domain.includes("..") || domain.includes("/") || domain.includes("\\")) {
    throw new Error("Invalid domain");
  }
  if (domain.startsWith(".") || domain.endsWith(".")) {
    throw new Error("Invalid domain");
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    throw new Error("Domain must include at least one dot (e.g. app.example.com)");
  }
  for (const label of labels) {
    if (!DOMAIN_LABEL.test(label)) {
      throw new Error("Invalid domain");
    }
  }
  return domain;
}

export function siteRootPathFromDomain(raw: string): string {
  return `/var/www/${assertSafeSiteDomain(raw)}`;
}
