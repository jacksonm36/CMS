import { execFile } from "child_process";
import { promisify } from "util";
import type { FirewallRule } from "@hostpanel/db";

const execFileAsync = promisify(execFile);

// Strict allow-lists — nothing from user input reaches the shell unsanitised
const SAFE_IP_CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const SAFE_PORT_RE    = /^\d{1,5}(:\d{1,5})?$/;   // single port or range (iptables --dport syntax)
const SAFE_PROTOCOLS  = new Set(["tcp", "udp", "icmp", "all"]);
const SAFE_DIRECTIONS = new Set(["inbound", "outbound"]);
const SAFE_ACTIONS    = new Set(["allow", "block"]);

function validateRule(rule: FirewallRule): string | null {
  if (!SAFE_DIRECTIONS.has(rule.direction))        return `Invalid direction: ${rule.direction}`;
  if (!SAFE_PROTOCOLS.has(rule.protocol))          return `Invalid protocol: ${rule.protocol}`;
  if (!SAFE_ACTIONS.has(rule.action))              return `Invalid action: ${rule.action}`;
  if (rule.sourceIp && !SAFE_IP_CIDR_RE.test(rule.sourceIp)) return `Invalid source IP/CIDR: ${rule.sourceIp}`;
  if (rule.port     && !SAFE_PORT_RE.test(rule.port))         return `Invalid port/range: ${rule.port}`;
  return null;
}

async function runIptables(op: "-I" | "-D", rule: FirewallRule): Promise<void> {
  const err = validateRule(rule);
  if (err) throw new Error(`[Firewall] Rule validation failed — ${err}`);

  const chain  = rule.direction === "inbound" ? "INPUT" : "OUTPUT";
  const target = rule.action    === "allow"   ? "ACCEPT" : "DROP";

  // Build args array — never a shell string — so no metacharacter injection is possible
  const args: string[] = [op, chain];
  if (rule.sourceIp)          { args.push("-s", rule.sourceIp); }
  if (rule.protocol !== "all") { args.push("-p", rule.protocol); }
  if (rule.port)               { args.push("--dport", rule.port); }
  args.push("-j", target);

  await execFileAsync("iptables", args);
}

export async function applyFirewallRule(rule: FirewallRule): Promise<void> {
  if (!rule.enabled) return;
  try {
    await runIptables("-I", rule);
    console.log(`[Firewall] Applied rule #${rule.id} (${rule.direction} ${rule.protocol})`);
  } catch (err) {
    console.warn("[Firewall] Could not apply rule:", (err as Error).message);
  }
}

export async function removeFirewallRule(rule: FirewallRule): Promise<void> {
  try {
    await runIptables("-D", rule);
  } catch (err) {
    console.warn("[Firewall] Could not remove rule:", (err as Error).message);
  }
}
