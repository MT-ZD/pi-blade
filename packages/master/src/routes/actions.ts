import { getDb } from "../db.ts";
import { buildAndDeploy, triggerRollback } from "../services/builder.ts";
import { regenerateNginxConfig } from "../services/nginx.ts";
import { getLatestMetrics, getBladeVersions } from "../services/monitor.ts";
import { sshEnvForRepo, cleanupSshKey } from "../lib/ssh.ts";

export async function handleActionRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/deploy$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const project = db.query(`
      SELECT p.*, r.url, r.ssh_key FROM projects p
      JOIN repos r ON r.id = p.repo_id
      WHERE p.id = ?
    `).get(projectId) as any;
    if (!project) return Response.json({ error: "not found" }, { status: 404 });

    const repo = { id: project.repo_id, url: project.url, ssh_key: project.ssh_key };
    const body = (await req.json().catch(() => ({}))) as { commitSha?: string; branch?: string };

    const branch = body.branch;
    if (!branch) return Response.json({ error: "branch required" }, { status: 400 });

    let commitSha = body.commitSha;
    if (!commitSha || commitSha === "HEAD") {
      // Resolve HEAD to actual SHA
      const sshEnv = sshEnvForRepo(repo);
      try {
        const proc = Bun.spawn(["git", "ls-remote", repo.url, `refs/heads/${branch}`], {
          stdout: "pipe", stderr: "pipe",
          env: sshEnv ? { ...process.env, ...sshEnv } : undefined,
        });
        const output = await new Response(proc.stdout).text();
        commitSha = output.split("\t")[0] || `${Date.now()}`;
      } finally {
        cleanupSshKey(repo.id);
      }
    }
    buildAndDeploy(project, repo, commitSha, branch);
    return Response.json({ ok: true, message: "build started" });
  }

  if (req.method === "POST" && path === "/api/rollback") {
    const body = await req.json() as {
      projectId: number;
      bladeId: number;
      imageTag: string;
    };
    try {
      const result = await triggerRollback(body.projectId, body.bladeId, body.imageTag);
      return Response.json(result);
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  if (req.method === "POST" && path === "/api/nginx/reload") {
    try {
      await regenerateNginxConfig();
      return Response.json({ ok: true });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  if (req.method === "GET" && path.match(/^\/api\/blades\/\d+\/metrics-history$/)) {
    const bladeId = parseInt(path.split("/")[3]);
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "168"); // default 7 days
    const rows = db.query(`
      SELECT cpu_percent, memory_percent, disk_percent, timestamp
      FROM metrics_history
      WHERE blade_id = ? AND timestamp >= datetime('now', '-' || ? || ' hours')
      ORDER BY timestamp ASC
    `).all(bladeId, hours);
    return Response.json(rows);
  }

  if (req.method === "GET" && path === "/api/metrics") {
    const metrics = getLatestMetrics();
    const versions = getBladeVersions();
    const result: Record<string, any> = {};
    for (const [bladeId, m] of metrics) {
      result[bladeId] = { ...m, version: versions.get(bladeId) };
    }
    return Response.json(result);
  }

  return null;
}
