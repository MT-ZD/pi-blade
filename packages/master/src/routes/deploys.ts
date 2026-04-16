import { getDb } from "../db.ts";
import { getLog, subscribe, logKey, getActiveLogs, abortBuild } from "../lib/build-log.ts";
import { postCommitStatus } from "../services/github.ts";
import { decrypt } from "../lib/crypto.ts";

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

  if (req.method === "GET" && path.match(/^\/api\/deploys\/\d+$/) && !path.includes("project")) {
    const id = parseInt(path.split("/").pop()!);
    const deploy = db.query(`
      SELECT d.*, p.name as project_name, p.container_port, b.name as blade_name, b.hostname as blade_hostname, b.id as blade_id,
             r.url as repo_url
      FROM deploys d
      JOIN projects p ON p.id = d.project_id
      JOIN blades b ON b.id = d.blade_id
      JOIN repos r ON r.id = p.repo_id
      WHERE d.id = ?
    `).get(id);
    if (!deploy) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(deploy);
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

  // POST /api/deploys/:id/github-status — force update GitHub commit status
  if (req.method === "POST" && path.match(/^\/api\/deploys\/\d+\/github-status$/)) {
    const id = parseInt(path.split("/")[3]);
    const deploy = db.query(`
      SELECT d.*, p.name as project_name, r.url as repo_url, r.github_token
      FROM deploys d
      JOIN projects p ON p.id = d.project_id
      JOIN repos r ON r.id = p.repo_id
      WHERE d.id = ?
    `).get(id) as any;
    if (!deploy) return Response.json({ error: "not found" }, { status: 404 });
    if (!deploy.github_token) return Response.json({ error: "no GitHub token configured for this repo" }, { status: 400 });
    if (!deploy.commit_sha) return Response.json({ error: "no commit SHA on this deploy" }, { status: 400 });

    const token = decrypt(deploy.github_token);
    const stateMap: Record<string, "pending" | "success" | "failure" | "error"> = {
      building: "pending", pushing: "pending", deploying: "pending",
      running: "success", failed: "failure", aborted: "failure", superseded: "success",
    };
    const state = stateMap[deploy.status] || "error";
    const description = state === "success"
      ? `Deployed "${deploy.project_name}" (${deploy.image_tag})`
      : state === "pending"
        ? `Building "${deploy.project_name}"...`
        : `Deploy of "${deploy.project_name}" ${deploy.status}`;

    await postCommitStatus({
      repoUrl: deploy.repo_url,
      commitSha: deploy.commit_sha,
      state,
      description,
      context: `pi-blade/${deploy.project_name}`,
      token,
    });

    return Response.json({ ok: true, state });
  }

  // POST /api/builds/:projectName/:imageTag/abort — abort a build
  if (req.method === "POST" && path.match(/^\/api\/builds\/.+\/.+\/abort$/)) {
    const parts = path.split("/");
    const projectName = decodeURIComponent(parts[3]);
    const imageTag = decodeURIComponent(parts[4]);
    const key = logKey(projectName, imageTag);
    const ok = abortBuild(key);

    // Fallback: if no live build found, mark stuck deploys as aborted in DB
    if (!ok) {
      db.query(`
        UPDATE deploys SET status = 'aborted', log = 'Aborted (no live build found — build may have been running on old code)'
        WHERE image_tag = ? AND status IN ('building', 'pushing', 'deploying')
      `).run(imageTag);
    }

    return Response.json({ ok: true });
  }

  // GET /api/builds/active — list active/recent build logs
  if (req.method === "GET" && path === "/api/builds/active") {
    return Response.json(getActiveLogs());
  }

  // GET /api/deploys/:id/log — get stored log
  if (req.method === "GET" && path.match(/^\/api\/deploys\/\d+\/log$/)) {
    const id = parseInt(path.split("/")[3]);
    const deploy = db.query("SELECT log FROM deploys WHERE id = ?").get(id) as any;
    if (!deploy) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ log: deploy.log || "" });
  }

  // GET /api/builds/:projectName/:imageTag/logs — SSE live log stream
  if (req.method === "GET" && path.match(/^\/api\/builds\/.+\/.+\/logs$/)) {
    const parts = path.split("/");
    const projectName = decodeURIComponent(parts[3]);
    const imageTag = decodeURIComponent(parts[4]);
    const key = logKey(projectName, imageTag);

    const log = getLog(key);

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const send = (data: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {}
        };

        // Send existing lines
        if (log) {
          for (const line of log.lines) {
            send(line);
          }
          if (log.finished) {
            send("__DONE__");
            controller.close();
            return;
          }
        }

        // Subscribe to new lines
        const unsub = subscribe(key, (line) => {
          if (line.includes("__DONE__")) {
            send("__DONE__");
            try { controller.close(); } catch {}
            unsub();
          } else {
            send(line);
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  return null;
}
