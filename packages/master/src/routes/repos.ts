import { getDb } from "../db.ts";

export async function handleRepoRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/repos") {
    const repos = db.query("SELECT * FROM repos ORDER BY id").all();
    return Response.json(repos);
  }

  if (req.method === "POST" && path === "/api/repos") {
    const body = await req.json() as {
      url: string;
      branch?: string;
      pollInterval?: number;
      isMonorepo?: boolean;
    };
    const result = db.query(`
      INSERT INTO repos (url, branch, poll_interval, is_monorepo)
      VALUES (?1, ?2, ?3, ?4)
    `).run(
      body.url,
      body.branch || "main",
      body.pollInterval || 60,
      body.isMonorepo ? 1 : 0,
    );
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  if (req.method === "PUT" && path.match(/^\/api\/repos\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json() as {
      url?: string;
      branch?: string;
      pollInterval?: number;
      isMonorepo?: boolean;
    };
    const existing = db.query("SELECT * FROM repos WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query(`
      UPDATE repos SET url = ?1, branch = ?2, poll_interval = ?3, is_monorepo = ?4
      WHERE id = ?5
    `).run(
      body.url ?? existing.url,
      body.branch ?? existing.branch,
      body.pollInterval ?? existing.poll_interval,
      body.isMonorepo !== undefined ? (body.isMonorepo ? 1 : 0) : existing.is_monorepo,
      id,
    );
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && path.match(/^\/api\/repos\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM repos WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  return null;
}
