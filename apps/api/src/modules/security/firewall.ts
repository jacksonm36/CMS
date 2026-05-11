import { exec } from "child_process";
import { promisify } from "util";
import type { FirewallRule } from "@hostpanel/db";

const execAsync = promisify(exec);

export async function applyFirewallRule(rule: FirewallRule): Promise<void> {
  if (!rule.enabled) return;

  try {
    const chain = rule.direction === "inbound" ? "INPUT" : "OUTPUT";
    const action = rule.action === "allow" ? "ACCEPT" : "DROP";
    const proto = rule.protocol !== "all" ? `-p ${rule.protocol}` : "";
    const port = rule.port ? `--dport ${rule.port}` : "";
    const src = rule.sourceIp ? `-s ${rule.sourceIp}` : "";

    const cmd = `iptables -I ${chain} ${src} ${proto} ${port} -j ${action}`.trim().replace(/\s+/g, " ");
    await execAsync(cmd);
    console.log(`[Firewall] Applied rule: ${cmd}`);
  } catch (err) {
    console.warn("[Firewall] Could not apply iptables rule (non-Linux environment?):", err);
  }
}

export async function removeFirewallRule(rule: FirewallRule): Promise<void> {
  try {
    const chain = rule.direction === "inbound" ? "INPUT" : "OUTPUT";
    const action = rule.action === "allow" ? "ACCEPT" : "DROP";
    const proto = rule.protocol !== "all" ? `-p ${rule.protocol}` : "";
    const port = rule.port ? `--dport ${rule.port}` : "";
    const src = rule.sourceIp ? `-s ${rule.sourceIp}` : "";

    const cmd = `iptables -D ${chain} ${src} ${proto} ${port} -j ${action}`.trim().replace(/\s+/g, " ");
    await execAsync(cmd);
  } catch (err) {
    console.warn("[Firewall] Could not remove iptables rule:", err);
  }
}
