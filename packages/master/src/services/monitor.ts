import { getDb } from "../db.ts";
import { BLADE_AGENT_PORT, METRICS_INTERVAL_MS, getVersion } from "@pi-blade/shared";
import type { BladeMetrics } from "@pi-blade/shared";
import { sendDiscordAlert } from "../routes/alerts.ts";

const latestMetrics = new Map<number, BladeMetrics>();
const bladeVersions = new Map<number, string>();

export function getLatestMetrics(): Map<number, BladeMetrics> {
  return latestMetrics;
}

export function getBladeVersions(): Map<number, string> {
  return bladeVersions;
}

async function checkBlade(blade: any) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`http://${blade.hostname}:${BLADE_AGENT_PORT}/metrics`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const metrics = (await res.json()) as BladeMetrics;
    latestMetrics.set(blade.id, metrics);

    // Store historical snapshot
    getDb().query(`
      INSERT INTO metrics_history (blade_id, cpu_percent, memory_percent, disk_percent)
      VALUES (?, ?, ?, ?)
    `).run(blade.id, metrics.cpuPercent, metrics.memoryPercent, metrics.diskPercent);

    try {
      const vRes = await fetch(`http://${blade.hostname}:${BLADE_AGENT_PORT}/version`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (vRes.ok) {
        const { version } = (await vRes.json()) as { version: string };
        bladeVersions.set(blade.id, version);

        const masterVersion = getVersion();
        if (version !== masterVersion && version !== "unknown") {
          console.log(`[monitor] Blade "${blade.name}" version mismatch: ${version.slice(0, 12)} (master: ${masterVersion.slice(0, 12)})`);
        }
      }
    } catch {}

    const db = getDb();

    if (blade.status !== "online") {
      db.query("UPDATE blades SET status = 'online' WHERE id = ?").run(blade.id);
    }

    if (metrics.cpuPercent > 80 || metrics.memoryPercent > 80) {
      const type = metrics.cpuPercent > 80 ? "CPU" : "Memory";
      const value = metrics.cpuPercent > 80 ? metrics.cpuPercent : metrics.memoryPercent;

      if (blade.status !== "degraded") {
        db.query("UPDATE blades SET status = 'degraded' WHERE id = ?").run(blade.id);
        db.query(`
          INSERT INTO alerts (type, blade_id, message)
          VALUES ('high_usage', ?, ?)
        `).run(blade.id, `${type} at ${value}% on ${blade.name}`);
        await sendDiscordAlert(`${type} at ${value}% on ${blade.name}`);
      }
    }
  } catch {
    const db = getDb();
    if (blade.status !== "offline") {
      db.query("UPDATE blades SET status = 'offline' WHERE id = ?").run(blade.id);
      db.query(`
        INSERT INTO alerts (type, blade_id, message)
        VALUES ('blade_down', ?, ?)
      `).run(blade.id, `Blade "${blade.name}" is unreachable`);
      await sendDiscordAlert(`Blade "${blade.name}" is unreachable`);
    }
    latestMetrics.delete(blade.id);
  }
}

export function startMonitor() {
  console.log("[monitor] Started");

  let pruneCounter = 0;

  const check = async () => {
    const db = getDb();
    const blades = db.query("SELECT * FROM blades").all() as any[];
    await Promise.all(blades.map(checkBlade));

    // Prune metrics older than 7 days every ~60 checks (~30 min)
    if (++pruneCounter >= 60) {
      pruneCounter = 0;
      db.query("DELETE FROM metrics_history WHERE timestamp < datetime('now', '-7 days')").run();
    }
  };

  check();
  setInterval(check, METRICS_INTERVAL_MS);
}
