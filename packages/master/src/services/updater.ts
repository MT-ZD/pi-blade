import { getDb } from "../db.ts";
import { BLADE_AGENT_PORT, getVersion, clearVersionCache } from "@pi-blade/shared";

const INSTALL_DIR = "/opt/pi-blade";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function run(cmd: string[], opts?: { cwd?: string }): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.cwd ?? INSTALL_DIR,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function checkForUpdate(): Promise<string | null> {
  await run(["git", "fetch", "origin"]);
  const local = await run(["git", "rev-parse", "HEAD"]);
  const remote = await run(["git", "rev-parse", "origin/master"]);

  if (!local.ok || !remote.ok) return null;
  if (local.stdout === remote.stdout) return null;

  return remote.stdout;
}

async function applySelfUpdate(): Promise<boolean> {
  console.log("[updater] Pulling latest changes...");
  const pull = await run(["git", "pull", "origin", "master"]);
  if (!pull.ok) {
    console.error("[updater] git pull failed:", pull.stderr);
    return false;
  }

  console.log("[updater] Installing dependencies...");
  const install = await run(["bun", "install"]);
  if (!install.ok) {
    console.error("[updater] bun install failed:", install.stderr);
    return false;
  }

  console.log("[updater] Rebuilding web UI...");
  const build = await run(["bun", "run", "build"], { cwd: `${INSTALL_DIR}/packages/web-ui` });
  if (!build.ok) {
    console.error("[updater] web-ui build failed:", build.stderr);
  }

  clearVersionCache();
  return true;
}

async function updateBlade(blade: any): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const res = await fetch(`http://${blade.hostname}:${BLADE_AGENT_PORT}/update`, {
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[updater] Blade "${blade.name}" update failed:`, (err as any).error);
      return false;
    }

    console.log(`[updater] Blade "${blade.name}" updated`);
    return true;
  } catch (e: any) {
    console.error(`[updater] Could not reach blade "${blade.name}": ${e.message}`);
    return false;
  }
}

async function updateAllBlades() {
  const db = getDb();
  const blades = db.query("SELECT * FROM blades WHERE status != 'offline'").all() as any[];

  for (const blade of blades) {
    await updateBlade(blade);
  }
}

async function restartServices() {
  console.log("[updater] Restarting services...");
  await run(["sudo", "systemctl", "restart", "pi-blade-master", "pi-blade-agent", "pi-blade-web"]);
}

export function startUpdater() {
  console.log("[updater] Started");

  const check = async () => {
    try {
      const newCommit = await checkForUpdate();
      if (!newCommit) return;

      console.log(`[updater] Update available: ${newCommit.slice(0, 12)}`);

      const ok = await applySelfUpdate();
      if (!ok) return;

      await updateAllBlades();
      await restartServices();
    } catch (e: any) {
      console.error(`[updater] Error: ${e.message}`);
    }
  };

  setTimeout(check, 30_000);
  setInterval(check, CHECK_INTERVAL_MS);
}
