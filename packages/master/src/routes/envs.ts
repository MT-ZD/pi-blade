import { getDb } from "../db.ts";

export async function handleEnvRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

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
