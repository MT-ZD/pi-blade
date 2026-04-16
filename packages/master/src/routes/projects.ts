import { getDb } from "../db.ts";

export async function handleProjectRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/projects") {
    const projects = db.query(`
      SELECT p.*, r.url as repo_url
      FROM projects p
      JOIN repos r ON r.id = p.repo_id
      ORDER BY p.name
    `).all();
    return Response.json(projects);
  }

  if (req.method === "GET" && path.match(/^\/api\/projects\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const project = db.query(`
      SELECT p.*, r.url as repo_url
      FROM projects p
      JOIN repos r ON r.id = p.repo_id
      WHERE p.id = ?
    `).get(id);
    if (!project) return Response.json({ error: "not found" }, { status: 404 });

    const blades = db.query(`
      SELECT b.*, pb.port FROM project_blades pb
      JOIN blades b ON b.id = pb.blade_id
      WHERE pb.project_id = ?
    `).all(id);

    return Response.json({ ...project as any, blades });
  }

  if (req.method === "POST" && path === "/api/projects") {
    const body = await req.json() as {
      repoId: number;
      name: string;
      path?: string;
      dockerfilePath?: string;
      branch?: string;
      blades?: { bladeId: number; port: number }[];
    };

    const result = db.query(`
      INSERT INTO projects (repo_id, name, path, dockerfile_path, branch)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).run(
      body.repoId,
      body.name,
      body.path || ".",
      body.dockerfilePath || "Dockerfile",
      body.branch || "main",
    );

    const projectId = result.lastInsertRowid;

    if (body.blades) {
      const stmt = db.query(
        "INSERT INTO project_blades (project_id, blade_id, port) VALUES (?1, ?2, ?3)"
      );
      for (const b of body.blades) {
        stmt.run(projectId, b.bladeId, b.port);
      }
    }

    return Response.json({ ok: true, id: projectId });
  }

  if (req.method === "PUT" && path.match(/^\/api\/projects\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json() as {
      name?: string;
      path?: string;
      dockerfilePath?: string;
      branch?: string;
    };
    const existing = db.query("SELECT * FROM projects WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query(`
      UPDATE projects SET name = ?1, path = ?2, dockerfile_path = ?3, branch = ?4
      WHERE id = ?5
    `).run(
      body.name ?? existing.name,
      body.path ?? existing.path,
      body.dockerfilePath ?? existing.dockerfile_path,
      body.branch ?? existing.branch,
      id,
    );
    return Response.json({ ok: true });
  }

  // POST /api/projects/:id/blades — add blade to project
  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/blades$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { bladeId: number; port: number };
    db.query(
      "INSERT OR REPLACE INTO project_blades (project_id, blade_id, port) VALUES (?1, ?2, ?3)"
    ).run(projectId, body.bladeId, body.port);
    return Response.json({ ok: true });
  }

  // PUT /api/projects/:id/blades/:bladeId — update port
  if (req.method === "PUT" && path.match(/^\/api\/projects\/\d+\/blades\/\d+$/)) {
    const parts = path.split("/");
    const projectId = parseInt(parts[3]);
    const bladeId = parseInt(parts[5]);
    const body = await req.json() as { port: number };
    db.query(
      "UPDATE project_blades SET port = ? WHERE project_id = ? AND blade_id = ?"
    ).run(body.port, projectId, bladeId);
    return Response.json({ ok: true });
  }

  // DELETE /api/projects/:id/blades/:bladeId
  if (req.method === "DELETE" && path.match(/^\/api\/projects\/\d+\/blades\/\d+$/)) {
    const parts = path.split("/");
    const projectId = parseInt(parts[3]);
    const bladeId = parseInt(parts[5]);
    db.query(
      "DELETE FROM project_blades WHERE project_id = ? AND blade_id = ?"
    ).run(projectId, bladeId);
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && path.match(/^\/api\/projects\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM projects WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  return null;
}
