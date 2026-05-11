import si from "systeminformation";

export interface MetricsSnapshot {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  network: { rx: number; tx: number };
  uptime: number;
  loadAvg: [number, number, number];
  timestamp: string;
}

// In-memory circular buffer (last 1440 minutes = 24h at 1/min)
const HISTORY_MAX = 1440;
const metricsHistory: MetricsSnapshot[] = [];

export async function getSystemMetrics(): Promise<MetricsSnapshot> {
  const [cpu, mem, disk, net, load] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats("eth0"),
    si.currentLoad(),
  ]);

  const primaryDisk = disk[0] ?? { used: 0, size: 1 };
  const primaryNet = net[0] ?? { rx_sec: 0, tx_sec: 0 };

  return {
    cpu: Math.round(cpu.currentLoad),
    memory: {
      used: mem.used,
      total: mem.total,
      percent: Math.round((mem.used / mem.total) * 100),
    },
    disk: {
      used: primaryDisk.used,
      total: primaryDisk.size,
      percent: Math.round((primaryDisk.used / primaryDisk.size) * 100),
    },
    network: {
      rx: Math.round((primaryNet.rx_sec ?? 0) / 1024),
      tx: Math.round((primaryNet.tx_sec ?? 0) / 1024),
    },
    uptime: Math.floor(process.uptime()),
    loadAvg: [
      Math.round(load.avgLoad * 100) / 100,
      Math.round(load.avgLoad * 100) / 100,
      Math.round(load.avgLoad * 100) / 100,
    ],
    timestamp: new Date().toISOString(),
  };
}

export async function captureMetrics(): Promise<void> {
  const snapshot = await getSystemMetrics();
  if (metricsHistory.length >= HISTORY_MAX) metricsHistory.shift();
  metricsHistory.push(snapshot);
}

export function getMetricsHistory(minutes: number): MetricsSnapshot[] {
  return metricsHistory.slice(-Math.min(minutes, metricsHistory.length));
}
