import { getDb } from "../db.ts";

export async function handleEnvRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  // GET /api/projects/:id/environments
  if (req.method === "GET" && path.match(/^\/api\/projects\/\d+\/environments$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const envs = db.query(`
      SELECT pe.*, (SELECT COUNT(*) FROM project_env_vars WHERE project_env_id = pe.id) as var_count
      FROM project_environments pe
      WHERE pe.project_id = ?
      ORDER BY pe.environment
    `).all(projectId);
    return Response.json(envs);
  }

  // GET /api/environments/:id
  if (req.method === "GET" && path.match(/^\/api\/environments\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const env = db.query("SELECT * FROM project_environments WHERE id = ?").get(id);
    if (!env) return Response.json({ error: "not found" }, { status: 404 });

    const vars = db.query(
      "SELECT id, key, value FROM project_env_vars WHERE project_env_id = ? ORDER BY key"
    ).all(id);

    return Response.json({ ...env as any, vars });
  }

  // POST /api/projects/:id/environments
  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/environments$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { environment: string };
    const result = db.query(
      "INSERT INTO project_environments (project_id, environment) VALUES (?1, ?2)"
    ).run(projectId, body.environment);
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  // POST /api/environments/:id/vars
  if (req.method === "POST" && path.match(/^\/api\/environments\/\d+\/vars$/)) {
    const envId = parseInt(path.split("/")[3]);
    const body = await req.json() as { key: string; value: string };
    const result = db.query(
      "INSERT INTO project_env_vars (project_env_id, key, value) VALUES (?1, ?2, ?3)"
    ).run(envId, body.key, body.value);
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  // PUT /api/env-vars/:id
  if (req.method === "PUT" && path.match(/^\/api\/env-vars\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json() as { key?: string; value?: string };
    const existing = db.query("SELECT * FROM project_env_vars WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query("UPDATE project_env_vars SET key = ?1, value = ?2 WHERE id = ?3").run(
      body.key ?? existing.key,
      body.value ?? existing.value,
      id,
    );
    return Response.json({ ok: true });
  }

  // DELETE /api/env-vars/:id
  if (req.method === "DELETE" && path.match(/^\/api\/env-vars\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM project_env_vars WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  // DELETE /api/environments/:id
  if (req.method === "DELETE" && path.match(/^\/api\/environments\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM project_environments WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  // PUT /api/projects/:id/active-environment
  if (req.method === "PUT" && path.match(/^\/api\/projects\/\d+\/active-environment$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { environment: string };
    db.query("UPDATE projects SET active_environment = ? WHERE id = ?").run(body.environment, projectId);
    return Response.json({ ok: true });
  }

  return null;
}
