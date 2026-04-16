import { getDb } from "../db.ts";

const EXCLUDED_SETTINGS = ["password_hash", "github_token"];

interface ConfigV1 {
  version: 1;
  exportedAt: string;
  repos: {
    url: string;
    poll_interval: number;
    is_monorepo: number;
    projects: {
      name: string;
      path: string;
      dockerfile_path: string;
      container_port: number;
      branches: { branch: string; port: number }[];
      vars: { key: string; value: string; scope: string }[];
      blade_names: string[];
    }[];
  }[];
  routes: {
    domain: string;
    project_name: string;
    upstreams: { blade_name: string; port: number; weight: number }[];
  }[];
  settings: { key: string; value: string }[];
}

function exportConfig(): ConfigV1 {
  const db = getDb();

  const repos = db.query("SELECT * FROM repos ORDER BY id").all() as any[];
  const exportRepos = repos.map((r) => {
    const projects = db.query("SELECT * FROM projects WHERE repo_id = ?").all(r.id) as any[];
    return {
      url: r.url,
      poll_interval: r.poll_interval,
      is_monorepo: r.is_monorepo,
      projects: projects.map((p) => ({
        name: p.name,
        path: p.path,
        dockerfile_path: p.dockerfile_path,
        container_port: p.container_port || 3000,
        branches: db.query("SELECT branch, port FROM project_branches WHERE project_id = ?").all(p.id) as any[],
        vars: db.query("SELECT key, value, scope FROM project_vars WHERE project_id = ? ORDER BY scope, key").all(p.id) as any[],
        blade_names: (db.query(`
          SELECT b.name FROM project_blades pb
          JOIN blades b ON b.id = pb.blade_id
          WHERE pb.project_id = ?
        `).all(p.id) as any[]).map((b: any) => b.name),
      })),
    };
  });

  const routes = db.query(`
    SELECT r.domain, p.name as project_name, r.id as route_id
    FROM routes r JOIN projects p ON p.id = r.project_id
  `).all() as any[];
  const exportRoutes = routes.map((r) => ({
    domain: r.domain,
    project_name: r.project_name,
    upstreams: (db.query(`
      SELECT b.name as blade_name, u.port, u.weight
      FROM upstreams u JOIN blades b ON b.id = u.blade_id
      WHERE u.route_id = ?
    `).all(r.route_id) as any[]),
  }));

  const settings = (db.query("SELECT key, value FROM settings").all() as any[])
    .filter((s) => !EXCLUDED_SETTINGS.includes(s.key));

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    repos: exportRepos,
    routes: exportRoutes,
    settings,
  };
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  plan: {
    repos: { url: string; action: string }[];
    projects: { name: string; action: string }[];
    routes: { domain: string; action: string }[];
    settings: { key: string; action: string }[];
  };
}

function validateConfig(config: any, conflictStrategy: string): ValidationResult {
  const db = getDb();
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan = {
    repos: [] as { url: string; action: string }[],
    projects: [] as { name: string; action: string }[],
    routes: [] as { domain: string; action: string }[],
    settings: [] as { key: string; action: string }[],
  };

  if (!config || config.version !== 1) {
    errors.push("Invalid config: version must be 1");
    return { valid: false, errors, warnings, plan };
  }

  if (!Array.isArray(config.repos)) {
    errors.push("Invalid config: repos must be an array");
    return { valid: false, errors, warnings, plan };
  }

  const bladeMap = new Map<string, number>();
  (db.query("SELECT id, name FROM blades").all() as any[]).forEach((b) => bladeMap.set(b.name, b.id));

  const projectNames = new Set<string>();

  for (const [ri, repo] of (config.repos || []).entries()) {
    if (!repo.url) { errors.push(`repos[${ri}]: url is required`); continue; }

    const existing = db.query("SELECT id FROM repos WHERE url = ?").get(repo.url) as any;
    plan.repos.push({ url: repo.url, action: existing ? conflictStrategy : "create" });

    for (const [pi, proj] of (repo.projects || []).entries()) {
      if (!proj.name) { errors.push(`repos[${ri}].projects[${pi}]: name is required`); continue; }
      if (projectNames.has(proj.name)) { errors.push(`Duplicate project name: ${proj.name}`); continue; }
      projectNames.add(proj.name);

      const existingProj = db.query("SELECT id FROM projects WHERE name = ?").get(proj.name) as any;
      plan.projects.push({ name: proj.name, action: existingProj ? conflictStrategy : "create" });

      for (const [bi, br] of (proj.branches || []).entries()) {
        if (!br.branch) errors.push(`${proj.name}.branches[${bi}]: branch is required`);
        if (!br.port && br.port !== 0) errors.push(`${proj.name}.branches[${bi}]: port is required`);
      }

      for (const [vi, v] of (proj.vars || []).entries()) {
        if (!v.key) errors.push(`${proj.name}.vars[${vi}]: key is required`);
      }

      for (const bladeName of (proj.blade_names || [])) {
        if (!bladeMap.has(bladeName)) {
          warnings.push(`Blade "${bladeName}" not registered — assignment for "${proj.name}" will be skipped`);
        }
      }
    }
  }

  for (const [ri, route] of (config.routes || []).entries()) {
    if (!route.domain) { errors.push(`routes[${ri}]: domain is required`); continue; }
    if (!route.project_name) { errors.push(`routes[${ri}]: project_name is required`); continue; }
    if (!projectNames.has(route.project_name)) {
      const existsInDb = db.query("SELECT id FROM projects WHERE name = ?").get(route.project_name);
      if (!existsInDb) errors.push(`routes[${ri}]: project "${route.project_name}" not found`);
    }

    const existingRoute = db.query("SELECT id FROM routes WHERE domain = ?").get(route.domain) as any;
    plan.routes.push({ domain: route.domain, action: existingRoute ? conflictStrategy : "create" });

    for (const up of (route.upstreams || [])) {
      if (!bladeMap.has(up.blade_name)) {
        warnings.push(`Blade "${up.blade_name}" not registered — upstream for "${route.domain}" will be skipped`);
      }
    }
  }

  for (const s of (config.settings || [])) {
    if (EXCLUDED_SETTINGS.includes(s.key)) continue;
    const exists = db.query("SELECT key FROM settings WHERE key = ?").get(s.key);
    plan.settings.push({ key: s.key, action: exists ? "overwrite" : "create" });
  }

  const hasSSH = (config.repos || []).some((r: any) =>
    r.url?.startsWith("git@") || r.url?.includes("ssh://")
  );
  if (hasSSH) warnings.push("Some repos use SSH URLs — SSH keys must be configured manually after import");

  return { valid: errors.length === 0, errors, warnings, plan };
}

function applyConfig(config: any, conflictStrategy: string): { ok: boolean; error?: string } {
  const db = getDb();

  const bladeMap = new Map<string, number>();
  (db.query("SELECT id, name FROM blades").all() as any[]).forEach((b) => bladeMap.set(b.name, b.id));

  try {
    db.exec("BEGIN");

    const repoIdMap = new Map<string, number>();

    for (const repo of config.repos || []) {
      let existing = db.query("SELECT id FROM repos WHERE url = ?").get(repo.url) as any;

      if (existing && conflictStrategy === "skip") {
        repoIdMap.set(repo.url, existing.id);
      } else if (existing && conflictStrategy === "overwrite") {
        db.query("UPDATE repos SET poll_interval = ?, is_monorepo = ? WHERE id = ?")
          .run(repo.poll_interval || 60, repo.is_monorepo || 0, existing.id);
        repoIdMap.set(repo.url, existing.id);
      } else {
        const result = db.query("INSERT INTO repos (url, poll_interval, is_monorepo) VALUES (?, ?, ?)")
          .run(repo.url, repo.poll_interval || 60, repo.is_monorepo || 0);
        repoIdMap.set(repo.url, Number(result.lastInsertRowid));
      }

      const repoId = repoIdMap.get(repo.url)!;

      for (const proj of repo.projects || []) {
        let existingProj = db.query("SELECT id FROM projects WHERE name = ?").get(proj.name) as any;
        let projectId: number;

        if (existingProj && conflictStrategy === "skip") {
          projectId = existingProj.id;
        } else if (existingProj && conflictStrategy === "overwrite") {
          db.query("UPDATE projects SET repo_id = ?, path = ?, dockerfile_path = ?, container_port = ? WHERE id = ?")
            .run(repoId, proj.path || ".", proj.dockerfile_path || "Dockerfile", proj.container_port || 3000, existingProj.id);
          // Clear existing branches/vars/blades for overwrite
          db.query("DELETE FROM project_branches WHERE project_id = ?").run(existingProj.id);
          db.query("DELETE FROM project_vars WHERE project_id = ?").run(existingProj.id);
          db.query("DELETE FROM project_blades WHERE project_id = ?").run(existingProj.id);
          projectId = existingProj.id;
        } else {
          const result = db.query("INSERT INTO projects (repo_id, name, path, dockerfile_path, container_port) VALUES (?, ?, ?, ?, ?)")
            .run(repoId, proj.name, proj.path || ".", proj.dockerfile_path || "Dockerfile", proj.container_port || 3000);
          projectId = Number(result.lastInsertRowid);
        }

        if (!(existingProj && conflictStrategy === "skip")) {
          for (const br of proj.branches || []) {
            db.query("INSERT OR IGNORE INTO project_branches (project_id, branch, port) VALUES (?, ?, ?)")
              .run(projectId, br.branch, br.port);
          }
          for (const v of proj.vars || []) {
            db.query("INSERT INTO project_vars (project_id, key, value, scope) VALUES (?, ?, ?, ?)")
              .run(projectId, v.key, v.value, v.scope || "global");
          }
          for (const bladeName of proj.blade_names || []) {
            const bladeId = bladeMap.get(bladeName);
            if (bladeId) {
              db.query("INSERT OR IGNORE INTO project_blades (project_id, blade_id) VALUES (?, ?)")
                .run(projectId, bladeId);
            }
          }
        }
      }
    }

    for (const route of config.routes || []) {
      const proj = db.query("SELECT id FROM projects WHERE name = ?").get(route.project_name) as any;
      if (!proj) continue;

      let existingRoute = db.query("SELECT id FROM routes WHERE domain = ?").get(route.domain) as any;

      if (existingRoute && conflictStrategy === "skip") continue;

      if (existingRoute) {
        db.query("DELETE FROM upstreams WHERE route_id = ?").run(existingRoute.id);
        db.query("UPDATE routes SET project_id = ? WHERE id = ?").run(proj.id, existingRoute.id);
      } else {
        const result = db.query("INSERT INTO routes (domain, project_id) VALUES (?, ?)").run(route.domain, proj.id);
        existingRoute = { id: Number(result.lastInsertRowid) };
      }

      for (const up of route.upstreams || []) {
        const bladeId = bladeMap.get(up.blade_name);
        if (bladeId) {
          db.query("INSERT INTO upstreams (route_id, blade_id, port, weight) VALUES (?, ?, ?, ?)")
            .run(existingRoute.id, bladeId, up.port, up.weight || 1);
        }
      }
    }

    for (const s of config.settings || []) {
      if (EXCLUDED_SETTINGS.includes(s.key)) continue;
      db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?")
        .run(s.key, s.value, s.value);
    }

    db.exec("COMMIT");
    return { ok: true };
  } catch (e: any) {
    db.exec("ROLLBACK");
    return { ok: false, error: e.message };
  }
}

export async function handleConfigRoutes(req: Request, path: string): Promise<Response | null> {
  if (req.method === "GET" && path === "/api/config/export") {
    return Response.json(exportConfig());
  }

  if (req.method === "POST" && path === "/api/config/import") {
    const body = await req.json() as {
      config: any;
      mode: "preview" | "apply";
      conflictStrategy?: "skip" | "overwrite";
    };

    const strategy = body.conflictStrategy || "skip";
    const validation = validateConfig(body.config, strategy);

    if (body.mode === "preview" || !validation.valid) {
      return Response.json(validation);
    }

    const result = applyConfig(body.config, strategy);
    if (!result.ok) {
      return Response.json({ ...validation, valid: false, errors: [result.error] }, { status: 500 });
    }

    return Response.json({ ...validation, applied: true });
  }

  return null;
}
