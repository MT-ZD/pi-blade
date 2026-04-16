import { getDb } from "../db.ts";
import { MAX_KEPT_IMAGES } from "@pi-blade/shared";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

async function cleanupOldImages() {
  const db = getDb();

  // Get all projects
  const projects = db.query("SELECT DISTINCT name FROM projects").all() as any[];

  for (const project of projects) {
    const imageName = project.name.toLowerCase();

    // Get all tags for this project from registry, sorted by deploy time
    const tags = db.query(`
      SELECT DISTINCT image_tag FROM deploys
      WHERE project_id IN (SELECT id FROM projects WHERE name = ?)
      ORDER BY timestamp DESC
    `).all(project.name) as any[];

    const allTags = tags.map((t: any) => t.image_tag);
    const keepTags = new Set(allTags.slice(0, MAX_KEPT_IMAGES));
    const removeTags = allTags.slice(MAX_KEPT_IMAGES);

    for (const tag of removeTags) {
      try {
        await run(["docker", "rmi", `localhost:5000/${imageName}:${tag}`]);
        console.log(`[cleanup] Removed image ${imageName}:${tag}`);
      } catch {}
    }
  }
}

async function cleanupBuildCache() {
  try {
    await run(["docker", "builder", "prune", "-f", "--keep-storage", "2GB"]);
    console.log("[cleanup] Pruned build cache");
  } catch {}
}

async function cleanupDanglingImages() {
  try {
    const output = await run(["docker", "images", "-q", "--filter", "dangling=true"]);
    if (output) {
      await run(["docker", "rmi", ...output.split("\n")]);
      console.log("[cleanup] Removed dangling images");
    }
  } catch {}
}

async function cleanupTempDirs() {
  try {
    await run(["rm", "-rf", "/tmp/pi-blade-build", "/tmp/pi-blade-repos", "/tmp/pi-blade-detect-*"]);
  } catch {}

  // Remove old temp SSH key files
  try {
    const output = await run(["find", "/tmp", "-name", "pi-blade-ssh-*", "-mmin", "+60"]);
    if (output) {
      for (const f of output.split("\n")) {
        if (f) await run(["rm", "-f", f]);
      }
    }
  } catch {}
}

async function cleanupOldDeploys() {
  const db = getDb();
  // Keep last 100 deploys per project, delete older
  db.query(`
    DELETE FROM deploys WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, project_id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY timestamp DESC) as rn
        FROM deploys
      ) WHERE rn <= 100
    )
  `).run();
}

export async function runCleanup(): Promise<string[]> {
  const log: string[] = [];
  try {
    await cleanupOldImages(); log.push("Old images pruned");
    await cleanupDanglingImages(); log.push("Dangling images removed");
    await cleanupBuildCache(); log.push("Build cache pruned");
    await cleanupTempDirs(); log.push("Temp dirs cleaned");
    await cleanupOldDeploys(); log.push("Old deploy records trimmed");
  } catch (e: any) {
    log.push(`Error: ${e.message}`);
  }
  return log;
}

export function startCleanup() {
  console.log("[cleanup] Started");

  const cleanup = async () => {
    try {
      await runCleanup();
      console.log("[cleanup] Done");
    } catch (e: any) {
      console.error(`[cleanup] Error: ${e.message}`);
    }
  };

  // Run first cleanup after 5 min
  setTimeout(cleanup, 5 * 60 * 1000);
  setInterval(cleanup, CLEANUP_INTERVAL_MS);
}
