import { getDb } from "../db.ts";

export async function handleProjectRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/projects") {
    const projects = db.query(`
      SELECT p.*, r.url as repo_url, r.branch as repo_branch,
             eg.name as env_group_name, eg.environment as env_group_environment
      FROM projects p
      JOIN repos r ON r.id = p.repo_id
      LEFT JOIN env_groups eg ON eg.id = p.env_group_id
      ORDER BY p.name
    `).all();
    return Response.json(projects);
  }

  if (req.method === "GET" && path.match(/^\/api\/projects\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    const project = db.query(`
      SELECT p.*, r.url as repo_url, r.branch as repo_branch
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
      envGroupId?: number;
      blades?: { bladeId: number; port: number }[];
    };

    const result = db.query(`
      INSERT INTO projects (repo_id, name, path, dockerfile_path, env_group_id)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).run(
      body.repoId,
      body.name,
      body.path || ".",
      body.dockerfilePath || "Dockerfile",
      body.envGroupId || null,
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

  if (req.method === "DELETE" && path.match(/^\/api\/projects\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM projects WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  return null;
}
