import { exec } from "child_process";
import { promisify } from "util";
import type { WebServerType } from "./index.js";
import { backendListenPort, EDGE_PUBLIC_PORT } from "./webserver-ports.js";

const execAsync = promisify(exec);
const SUDO = "sudo -n";

/**
 * After apt install, bind each non-edge web server to its loopback backend port only
 * so nginx can own :80 and route per-site domains to the right stack.
 */
export async function configureWebServerCoexistence(id: WebServerType): Promise<void> {
  const port = backendListenPort(id);
  if (id === "nginx" || port === EDGE_PUBLIC_PORT) return;

  try {
    switch (id) {
      case "apache2": {
        const ports = `${SUDO} /usr/bin/tee /etc/apache2/ports.conf > /dev/null`;
        await execAsync(
          `printf '%s\\n' '# HostPanel — backend only (edge nginx on :80)' 'Listen 127.0.0.1:${port}' | ${ports}`
        );
        await execAsync(
          `${SUDO} /usr/sbin/a2dissite 000-default.conf 2>/dev/null; ${SUDO} /usr/sbin/a2enmod proxy proxy_http proxy_fcgi headers deflate rewrite 2>/dev/null; true`
        );
        break;
      }
      case "lighttpd": {
        await execAsync(
          `${SUDO} /usr/bin/tee /etc/lighttpd/conf-available/10-hostpanel-port.conf > /dev/null <<EOF
# HostPanel — backend port
server.port = ${port}
server.bind = "127.0.0.1"
EOF`
        );
        await execAsync(
          `${SUDO} /usr/sbin/lighttpd-enable-mod hostpanel-port 2>/dev/null || ${SUDO} /bin/ln -sf ../conf-available/10-hostpanel-port.conf /etc/lighttpd/conf-enabled/10-hostpanel-port.conf`
        );
        break;
      }
      case "caddy": {
        await execAsync(
          `${SUDO} /usr/bin/tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
# HostPanel — import per-site snippets (each binds 127.0.0.1:backend port)
{
    auto_https off
    admin off
}
import /etc/caddy/conf.d/*.caddy
EOF`
        );
        break;
      }
      case "openresty": {
        const dir = "/etc/openresty/nginx/sites-enabled";
        await execAsync(
          `${SUDO} /bin/mkdir -p ${dir} && ${SUDO} /usr/bin/tee ${dir}/00-hostpanel-listen.conf > /dev/null <<EOF
# HostPanel default listen (per-site files override server block)
EOF`
        );
        break;
      }
      case "traefik": {
        await execAsync(
          `${SUDO} /usr/bin/tee /etc/traefik/traefik.yml > /dev/null <<EOF
# HostPanel — file provider on loopback :${port}
entryPoints:
  web:
    address: "127.0.0.1:${port}"
providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true
api:
  dashboard: false
EOF`
        );
        break;
      }
      case "litespeed":
        // OpenLiteSpeed listener is set per vhost in generated vhconf.conf
        break;
    }
  } catch (err) {
    console.warn(`[${id}] coexistence configure:`, (err as Error).message);
  }
}
