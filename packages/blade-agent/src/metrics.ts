import type { BladeMetrics } from "@pi-blade/shared";
import { getContainerMetrics } from "./docker.ts";

async function readFile(path: string): Promise<string> {
  return await Bun.file(path).text();
}

async function getCpuPercent(): Promise<number> {
  const stat1 = await readFile("/proc/stat");
  await Bun.sleep(500);
  const stat2 = await readFile("/proc/stat");

  const parse = (line: string) => {
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  };

  const s1 = parse(stat1.split("\n")[0]);
  const s2 = parse(stat2.split("\n")[0]);

  const idleDelta = s2.idle - s1.idle;
  const totalDelta = s2.total - s1.total;

  if (totalDelta === 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 10000) / 100;
}

async function getMemoryPercent(): Promise<number> {
  const meminfo = await readFile("/proc/meminfo");
  const lines = meminfo.split("\n");
  const get = (key: string) => {
    const line = lines.find((l) => l.startsWith(key));
    return parseInt(line?.split(/\s+/)[1] || "0");
  };
  const total = get("MemTotal:");
  const available = get("MemAvailable:");
  if (total === 0) return 0;
  return Math.round(((total - available) / total) * 10000) / 100;
}

async function getDiskPercent(): Promise<number> {
  const proc = Bun.spawn(["df", "/"], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  const line = output.split("\n")[1];
  const parts = line?.split(/\s+/) || [];
  const usePercent = parts[4]?.replace("%", "");
  return parseFloat(usePercent || "0");
}

export async function collectMetrics(): Promise<BladeMetrics> {
  const [cpuPercent, memoryPercent, diskPercent, containers] = await Promise.all([
    getCpuPercent(),
    getMemoryPercent(),
    getDiskPercent(),
    getContainerMetrics(),
  ]);

  return {
    cpuPercent,
    memoryPercent,
    diskPercent,
    containers,
    timestamp: new Date().toISOString(),
  };
}
