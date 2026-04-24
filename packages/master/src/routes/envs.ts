import { getDb } from "../db.ts";

function formatDotenvValue(value: string): string {
  if (/[\n\r"'\\#\s=]/.test(value) || value === "") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
  }
  return value;
}

export async function handleEnvRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  // GET /api/projects/:id/vars/export — merged vars (global + branch override) as .env text
  if (req.method === "GET" && path.match(/^\/api\/projects\/\d+\/vars\/export$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const project = db.query("SELECT name, branch FROM projects WHERE id = ?").get(projectId) as any;
    if (!project) return Response.json({ error: "not found" }, { status: 404 });

    const rows = db.query(
      "SELECT key, value, scope FROM project_vars WHERE project_id = ? AND (scope = 'global' OR scope = ?)"
    ).all(projectId, project.branch) as any[];

    const merged: Record<string, string> = {};
    for (const r of rows) if (r.scope === "global") merged[r.key] = r.value;
    for (const r of rows) if (r.scope !== "global") merged[r.key] = r.value;

    const lines = Object.keys(merged).sort().map((k) => `${k}=${formatDotenvValue(merged[k])}`);
    const body = lines.join("\n") + (lines.length ? "\n" : "");
    const filename = `${project.name}-${project.branch}.env`.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // GET /api/projects/:id/vars — all vars for a project (global + branch)
  if (req.method === "GET" && path.match(/^\/api\/projects\/\d+\/vars$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const vars = db.query(
      "SELECT * FROM project_vars WHERE project_id = ? ORDER BY scope, key"
    ).all(projectId);
    return Response.json(vars);
  }

  // POST /api/projects/:id/vars — add a var
  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/vars$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { key: string; value: string; scope?: string };
    const result = db.query(
      "INSERT INTO project_vars (project_id, key, value, scope) VALUES (?1, ?2, ?3, ?4)"
    ).run(projectId, body.key, body.value, body.scope || "global");
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  // PUT /api/project-vars/:id — update a var
  if (req.method === "PUT" && path.match(/^\/api\/project-vars\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json() as { key?: string; value?: string; scope?: string };
    const existing = db.query("SELECT * FROM project_vars WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query("UPDATE project_vars SET key = ?1, value = ?2, scope = ?3 WHERE id = ?4").run(
      body.key ?? existing.key,
      body.value ?? existing.value,
      body.scope ?? existing.scope,
      id,
    );
    return Response.json({ ok: true });
  }

  // DELETE /api/project-vars/:id
  if (req.method === "DELETE" && path.match(/^\/api\/project-vars\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM project_vars WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  return null;
}
