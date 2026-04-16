import { getDb } from "../db.ts";

export async function handleProjectRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/projects") {
    const projects = db.query(`
      SELECT p.*, r.url as repo_url
      FROM projects p
      JOIN repos r ON r.id = p.repo_id
      ORDER BY p.name
    `).all() as any[];

    // Attach branches to each project
    for (const p of projects) {
      p.branches = db.query(
        "SELECT branch FROM project_branches WHERE project_id = ? ORDER BY branch"
      ).all(p.id).map((r: any) => r.branch);
    }
    return Response.json(projects);
  }

  if (req.method === "GET" && path.match(/^\/api\/projects\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const project = db.query(`
      SELECT p.*, r.url as repo_url
      FROM projects p
      JOIN repos r ON r.id = p.repo_id
      WHERE p.id = ?
    `).get(id) as any;
    if (!project) return Response.json({ error: "not found" }, { status: 404 });

    project.branches = db.query(
      "SELECT branch FROM project_branches WHERE project_id = ? ORDER BY branch"
    ).all(id).map((r: any) => r.branch);

    project.blades = db.query(`
      SELECT b.*, pb.port FROM project_blades pb
      JOIN blades b ON b.id = pb.blade_id
      WHERE pb.project_id = ?
    `).all(id);

    return Response.json(project);
  }

  if (req.method === "POST" && path === "/api/projects") {
    const body = await req.json() as {
      repoId: number;
      name: string;
      path?: string;
      dockerfilePath?: string;
      branches?: string[];
      blades?: { bladeId: number; port: number }[];
    };

    const result = db.query(`
      INSERT INTO projects (repo_id, name, path, dockerfile_path)
      VALUES (?1, ?2, ?3, ?4)
    `).run(
      body.repoId,
      body.name,
      body.path || ".",
      body.dockerfilePath || "Dockerfile",
    );

    const projectId = result.lastInsertRowid;

    if (body.branches) {
      const stmt = db.query(
        "INSERT INTO project_branches (project_id, branch) VALUES (?1, ?2)"
      );
      for (const b of body.branches) {
        stmt.run(projectId, b);
      }
    }

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
    };
    const existing = db.query("SELECT * FROM projects WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query(`
      UPDATE projects SET name = ?1, path = ?2, dockerfile_path = ?3
      WHERE id = ?4
    `).run(
      body.name ?? existing.name,
      body.path ?? existing.path,
      body.dockerfilePath ?? existing.dockerfile_path,
      id,
    );
    return Response.json({ ok: true });
  }

  // POST /api/projects/:id/branches — add branch
  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/branches$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { branch: string };
    db.query(
      "INSERT OR IGNORE INTO project_branches (project_id, branch) VALUES (?1, ?2)"
    ).run(projectId, body.branch);
    return Response.json({ ok: true });
  }

  // DELETE /api/projects/:id/branches/:branch
  if (req.method === "DELETE" && path.match(/^\/api\/projects\/\d+\/branches\/.+$/)) {
    const parts = path.split("/");
    const projectId = parseInt(parts[3]);
    const branch = decodeURIComponent(parts[5]);
    db.query(
      "DELETE FROM project_branches WHERE project_id = ? AND branch = ?"
    ).run(projectId, branch);
    return Response.json({ ok: true });
  }

  // POST /api/projects/:id/blades
  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/blades$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { bladeId: number; port: number };
    db.query(
      "INSERT OR REPLACE INTO project_blades (project_id, blade_id, port) VALUES (?1, ?2, ?3)"
    ).run(projectId, body.bladeId, body.port);
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
