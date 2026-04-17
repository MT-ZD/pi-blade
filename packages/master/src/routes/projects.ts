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

    for (const p of projects) {
      p.branches = db.query(
        "SELECT branch, port FROM project_branches WHERE project_id = ? ORDER BY branch"
      ).all(p.id);
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
      "SELECT id, branch, port FROM project_branches WHERE project_id = ? ORDER BY branch"
    ).all(id) as any[];
    for (const b of project.branches as any[]) {
      b.extra_ports = db.query(
        "SELECT id, host_port, container_port, label FROM branch_extra_ports WHERE project_branch_id = ? ORDER BY id"
      ).all(b.id);
    }

    project.blades = db.query(`
      SELECT b.* FROM project_blades pb
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
      containerPort?: number;
      buildContext?: string;
      branches?: { branch: string; port: number }[];
      bladeIds?: number[];
    };

    const result = db.query(`
      INSERT INTO projects (repo_id, name, path, dockerfile_path, container_port, build_context)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).run(
      body.repoId,
      body.name,
      body.path || ".",
      body.dockerfilePath || "Dockerfile",
      body.containerPort || 3000,
      body.buildContext || null,
    );

    const projectId = result.lastInsertRowid;

    if (body.branches) {
      const stmt = db.query(
        "INSERT INTO project_branches (project_id, branch, port) VALUES (?1, ?2, ?3)"
      );
      for (const b of body.branches) {
        stmt.run(projectId, b.branch, b.port);
      }
    }

    if (body.bladeIds) {
      const stmt = db.query(
        "INSERT INTO project_blades (project_id, blade_id) VALUES (?1, ?2)"
      );
      for (const id of body.bladeIds) {
        stmt.run(projectId, id);
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
      containerPort?: number;
      buildContext?: string | null;
    };
    const existing = db.query("SELECT * FROM projects WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    db.query(`
      UPDATE projects SET name = ?1, path = ?2, dockerfile_path = ?3, container_port = ?4, build_context = ?5
      WHERE id = ?6
    `).run(
      body.name ?? existing.name,
      body.path ?? existing.path,
      body.dockerfilePath ?? existing.dockerfile_path,
      body.containerPort ?? existing.container_port,
      body.buildContext !== undefined ? (body.buildContext || null) : existing.build_context,
      id,
    );
    return Response.json({ ok: true });
  }

  // POST /api/projects/:id/branches — add branch with port
  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/branches$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { branch: string; port: number };
    db.query(
      "INSERT OR IGNORE INTO project_branches (project_id, branch, port) VALUES (?1, ?2, ?3)"
    ).run(projectId, body.branch, body.port || 8080);
    return Response.json({ ok: true });
  }

  // PUT /api/projects/:id/branches/:branch — update branch port
  if (req.method === "PUT" && path.match(/^\/api\/projects\/\d+\/branches\/.+$/)) {
    const parts = path.split("/");
    const projectId = parseInt(parts[3]);
    const branch = decodeURIComponent(parts[5]);
    const body = await req.json() as { port: number };
    db.query(
      "UPDATE project_branches SET port = ? WHERE project_id = ? AND branch = ?"
    ).run(body.port, projectId, branch);
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

  // POST /api/branches/:branchId/extra-ports — add extra port
  if (req.method === "POST" && path.match(/^\/api\/branches\/\d+\/extra-ports$/)) {
    const branchId = parseInt(path.split("/")[3]);
    const body = await req.json() as { hostPort: number; containerPort: number; label?: string };
    const result = db.query(
      "INSERT INTO branch_extra_ports (project_branch_id, host_port, container_port, label) VALUES (?, ?, ?, ?)"
    ).run(branchId, body.hostPort, body.containerPort, body.label || null);
    return Response.json({ ok: true, id: result.lastInsertRowid });
  }

  // DELETE /api/extra-ports/:id
  if (req.method === "DELETE" && path.match(/^\/api\/extra-ports\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM branch_extra_ports WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  // POST /api/projects/:id/blades — add blade
  if (req.method === "POST" && path.match(/^\/api\/projects\/\d+\/blades$/)) {
    const projectId = parseInt(path.split("/")[3]);
    const body = await req.json() as { bladeId: number };
    db.query(
      "INSERT OR IGNORE INTO project_blades (project_id, blade_id) VALUES (?1, ?2)"
    ).run(projectId, body.bladeId);
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
