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

/**
 * Validate IPv4 address or CIDR notation.
 * Checks both format and value ranges (0-255 per octet).
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255;
  });
}

/**
 * Validate IPv4 CIDR notation (e.g. 192.168.1.0/24).
 * Checks IP validity and CIDR prefix (0-32).
 */
function isValidIPv4CIDR(cidr: string): boolean {
  const parts = cidr.split("/");
  if (parts.length === 1) {
    // No CIDR suffix, just IP
    return isValidIPv4(parts[0]!);
  }
  if (parts.length !== 2) return false;
  const [ip, prefixStr] = parts;
  const prefix = parseInt(prefixStr!, 10);
  return isValidIPv4(ip!) && !isNaN(prefix) && prefix >= 0 && prefix <= 32;
}

/**
 * Validate port number or port range (e.g. 80 or 8000:8100).
 * Checks range 1-65535 per port.
 */
function isValidPort(port: string): boolean {
  const parts = port.split(":");
  if (parts.length === 0 || parts.length > 2) return false;
  return parts.every((p) => {
    const num = parseInt(p, 10);
    return !isNaN(num) && num >= 1 && num <= 65535;
  });
}

function validateRule(rule: FirewallRule): string | null {
  if (!SAFE_DIRECTIONS.has(rule.direction))        return `Invalid direction: ${rule.direction}`;
  if (!SAFE_PROTOCOLS.has(rule.protocol))          return `Invalid protocol: ${rule.protocol}`;
  if (!SAFE_ACTIONS.has(rule.action))              return `Invalid action: ${rule.action}`;
  
  // Enhanced IP validation: format + value ranges
  if (rule.sourceIp) {
    if (!SAFE_IP_CIDR_RE.test(rule.sourceIp)) {
      return `Invalid source IP/CIDR format: ${rule.sourceIp}`;
    }
    if (!isValidIPv4CIDR(rule.sourceIp)) {
      return `Invalid source IP/CIDR values (octets must be 0-255, prefix 0-32): ${rule.sourceIp}`;
    }
  }
  
  // Enhanced port validation: format + value ranges
  if (rule.port) {
    if (!SAFE_PORT_RE.test(rule.port)) {
      return `Invalid port format: ${rule.port}`;
    }
    if (!isValidPort(rule.port)) {
      return `Invalid port values (must be 1-65535): ${rule.port}`;
    }
  }
  
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
