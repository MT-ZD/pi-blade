import { getDb } from "../db.ts";

export async function handleEnvRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/env-groups") {
    const groups = db.query("SELECT * FROM env_groups ORDER BY name").all();
    return Response.json(groups);
  }

  if (req.method === "GET" && path.match(/^\/api\/env-groups\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const group = db.query("SELECT * FROM env_groups WHERE id = ?").get(id);
    if (!group) return Response.json({ error: "not found" }, { status: 404 });

    const vars = db.query(
      "SELECT id, key, value FROM env_vars WHERE env_group_id = ? ORDER BY key"
    ).all(id);

    return Response.json({ ...group as any, vars });
  }

  if (req.method === "POST" && path === "/api/env-groups") {
    const body = await req.json() as { name: string; environment: string };
    const result = db.query(
      "INSERT INTO env_groups (name, environment) VALUES (?1, ?2)"
    ).run(body.name, body.environment);
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  if (req.method === "POST" && path.match(/^\/api\/env-groups\/\d+\/vars$/)) {
    const groupId = parseInt(path.split("/")[3]);
    const body = await req.json() as { key: string; value: string };
    const result = db.query(
      "INSERT INTO env_vars (env_group_id, key, value) VALUES (?1, ?2, ?3)"
    ).run(groupId, body.key, body.value);
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  if (req.method === "PUT" && path.match(/^\/api\/env-vars\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json() as { key?: string; value?: string };
    const existing = db.query("SELECT * FROM env_vars WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query("UPDATE env_vars SET key = ?1, value = ?2 WHERE id = ?3").run(
      body.key ?? existing.key,
      body.value ?? existing.value,
      id,
    );
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && path.match(/^\/api\/env-vars\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM env_vars WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && path.match(/^\/api\/env-groups\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM env_groups WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  return null;
}
