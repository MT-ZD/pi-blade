import { getDb } from "../db.ts";

export async function handleDeployRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/deploys") {
    const deploys = db.query(`
      SELECT d.*, p.name as project_name, b.name as blade_name
      FROM deploys d
      JOIN projects p ON p.id = d.project_id
      JOIN blades b ON b.id = d.blade_id
      ORDER BY d.timestamp DESC
      LIMIT 100
    `).all();
    return Response.json(deploys);
  }

  if (req.method === "GET" && path.match(/^\/api\/deploys\/project\/\d+$/)) {
    const projectId = parseInt(path.split("/").pop()!);
    const deploys = db.query(`
      SELECT d.*, b.name as blade_name
      FROM deploys d
      JOIN blades b ON b.id = d.blade_id
      WHERE d.project_id = ?
      ORDER BY d.timestamp DESC
      LIMIT 50
    `).all(projectId);
    return Response.json(deploys);
  }

  return null;
}
