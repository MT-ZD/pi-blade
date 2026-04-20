import { getDb } from "../db.ts";
import { regenerateNginxConfig } from "../services/nginx.ts";

export async function handleRoutingRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/routes") {
    const routes = db.query(`
      SELECT r.*, p.name as project_name,
        json_group_array(json_object(
          'id', u.id, 'bladeId', u.blade_id, 'port', u.port, 'weight', u.weight,
          'bladeName', b.name, 'bladeHostname', b.hostname
        )) as upstreams
      FROM routes r
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN upstreams u ON u.route_id = r.id
      LEFT JOIN blades b ON b.id = u.blade_id
      GROUP BY r.id
      ORDER BY r.domain
    `).all();

    return Response.json(
      (routes as any[]).map((r) => ({
        ...r,
        upstreams: JSON.parse(r.upstreams),
      }))
    );
  }

  if (req.method === "POST" && path === "/api/routes") {
    const body = await req.json() as {
      domain: string;
      projectId: number;
      clientMaxBodySize?: string;
      upstreams?: { bladeId: number; port: number; weight?: number }[];
    };

    const result = db.query(
      "INSERT INTO routes (domain, project_id, client_max_body_size) VALUES (?1, ?2, ?3)"
    ).run(body.domain, body.projectId, body.clientMaxBodySize || null);

    const routeId = result.lastInsertRowid;

    if (body.upstreams) {
      const stmt = db.query(
        "INSERT INTO upstreams (route_id, blade_id, port, weight) VALUES (?1, ?2, ?3, ?4)"
      );
      for (const u of body.upstreams) {
        stmt.run(routeId, u.bladeId, u.port, u.weight || 1);
      }
    }

    await regenerateNginxConfig();
    return Response.json({ ok: true, id: routeId });
  }

  if (req.method === "PUT" && path.match(/^\/api\/routes\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json() as { domain?: string; projectId?: number; clientMaxBodySize?: string | null };
    const existing = db.query("SELECT * FROM routes WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query("UPDATE routes SET domain = ?1, project_id = ?2, client_max_body_size = ?3 WHERE id = ?4").run(
      body.domain ?? existing.domain,
      body.projectId ?? existing.project_id,
      body.clientMaxBodySize !== undefined ? (body.clientMaxBodySize || null) : existing.client_max_body_size,
      id,
    );
    await regenerateNginxConfig();
    return Response.json({ ok: true });
  }

  if (req.method === "POST" && path.match(/^\/api\/routes\/\d+\/upstreams$/)) {
    const routeId = parseInt(path.split("/")[3]);
    const body = await req.json() as { bladeId: number; port: number; weight?: number };
    const result = db.query(
      "INSERT INTO upstreams (route_id, blade_id, port, weight) VALUES (?1, ?2, ?3, ?4)"
    ).run(routeId, body.bladeId, body.port, body.weight || 1);
    await regenerateNginxConfig();
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  if (req.method === "DELETE" && path.match(/^\/api\/routes\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM routes WHERE id = ?").run(id);
    await regenerateNginxConfig();
    return Response.json({ ok: true });
  }

  if (req.method === "PUT" && path.match(/^\/api\/upstreams\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json() as { bladeId?: number; port?: number; weight?: number };
    const existing = db.query("SELECT * FROM upstreams WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    db.query("UPDATE upstreams SET blade_id = ?, port = ?, weight = ? WHERE id = ?").run(
      body.bladeId ?? existing.blade_id,
      body.port ?? existing.port,
      body.weight ?? existing.weight,
      id,
    );
    await regenerateNginxConfig();
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && path.match(/^\/api\/upstreams\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM upstreams WHERE id = ?").run(id);
    await regenerateNginxConfig();
    return Response.json({ ok: true });
  }

  return null;
}
