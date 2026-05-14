import type { Site } from "@hostpanel/db";
import { indexFilenamesForSite } from "../default-document.js";
import { appUpstreamPort } from "./proxy-port.js";

export const LIGHTTPD_CONF_DIR = process.env.LIGHTTPD_CONF_DIR ?? "/etc/lighttpd/conf-enabled";
export const LIGHTTPD_LOG_DIR = process.env.LIGHTTPD_LOG_DIR ?? "/var/log/lighttpd";

export function generateConfig(site: Site): string {
  const phpVersion = site.phpVersion ?? "8.2";
  const upstream = appUpstreamPort(site);
  const idxList = indexFilenamesForSite(site).map((n) => `"${n}"`).join(", ");

  const phpBlock = site.type === "php" ? `
# PHP via FastCGI
fastcgi.server += (
    ".php" => ((
        "socket"        => "/run/php/php${phpVersion}-fpm.sock",
        "broken-scriptfilename" => "enable"
    ))
)` : "";

  const proxyBlock =
    site.type === "nodejs" || site.type === "python"
      ? `
# Node.js / Python reverse proxy
proxy.server = (
    "" => ((
        "host" => "127.0.0.1",
        "port" => ${upstream}
    ))
)`
      : "";

  return `# HostPanel — managed by hostpanel (lighttpd)
$HTTP["host"] =~ "^(www\\.)?${site.domain.replace(".", "\\.")}$" {
    server.document-root = "${site.rootPath}"
    server.indexfiles     = (${idxList})

    accesslog.filename = "${LIGHTTPD_LOG_DIR}/${site.domain}.access.log"

    # Security
    setenv.add-response-header = (
        "X-Frame-Options"         => "SAMEORIGIN",
        "X-Content-Type-Options"  => "nosniff",
        "X-XSS-Protection"        => "1; mode=block",
        "Referrer-Policy"         => "strict-origin-when-cross-origin"
    )

    # Deny hidden files
    url.access-deny = ("~", ".inc", "/.ht")

    # Compression
    compress.cache-dir   = "/var/cache/lighttpd/compress/"
    compress.filetype    = ("application/javascript", "text/css", "text/html", "text/plain")
    ${phpBlock}
    ${proxyBlock}
}
`;
}

export function configPath(domain: string): string {
  return `${LIGHTTPD_CONF_DIR}/${domain}.conf`;
}

export async function reload(): Promise<void> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    await execAsync("lighttpd -t -f /etc/lighttpd/lighttpd.conf && service lighttpd force-reload");
  } catch (err) {
    console.warn("[lighttpd] Could not reload:", (err as Error).message);
  }
}
