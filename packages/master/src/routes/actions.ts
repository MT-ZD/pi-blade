import { getDb } from "../db.ts";
import { buildAndDeploy, triggerRollback } from "../services/builder.ts";
import { regenerateNginxConfig } from "../services/nginx.ts";
import { getLatestMetrics, getBladeVersions } from "../services/monitor.ts";

export async function handleActionRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/deploy$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const project = db.query(`
      SELECT p.*, r.url, r.branch FROM projects p
      JOIN repos r ON r.id = p.repo_id
      WHERE p.id = ?
    `).get(projectId) as any;
    if (!project) return Response.json({ error: "not found" }, { status: 404 });

    const repo = { id: project.repo_id, url: project.url, branch: project.branch };
    const body = (await req.json().catch(() => ({}))) as { commitSha?: string };

    const commitSha = body.commitSha || "HEAD";
    buildAndDeploy(project, repo, commitSha);
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
