import { getDb } from "../db.ts";
import type { RegisterRequest } from "@pi-blade/shared";

export async function handleBladeRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/blades") {
    const blades = db.query("SELECT * FROM blades ORDER BY name").all();
    return Response.json(blades);
  }

  if (req.method === "POST" && path === "/api/blades/register") {
    const body = (await req.json()) as RegisterRequest;
    db.query(`
      INSERT INTO blades (name, hostname, status)
      VALUES (?1, ?2, 'online')
      ON CONFLICT(name) DO UPDATE SET hostname = ?2, status = 'online'
    `).run(body.name, body.hostname);
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && path.startsWith("/api/blades/")) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM blades WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  return null;
}
