import { getDb } from "../db.ts";
import { encrypt } from "../lib/crypto.ts";
import { sshEnvForRepo, cleanupSshKey } from "../lib/ssh.ts";

export async function handleRepoRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/repos") {
    const repos = db.query("SELECT * FROM repos ORDER BY id").all() as any[];
    return Response.json(repos.map((r) => ({ ...r, ssh_key: undefined, has_ssh_key: !!r.ssh_key })));
  }

  if (req.method === "POST" && path === "/api/repos") {
    const body = await req.json() as {
      url: string;
      branch?: string;
      pollInterval?: number;
      isMonorepo?: boolean;
      sshKey?: string;
    };
    const result = db.query(`
      INSERT INTO repos (url, branch, poll_interval, is_monorepo, ssh_key)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).run(
      body.url,
      body.branch || "main",
      body.pollInterval || 60,
      body.isMonorepo ? 1 : 0,
      body.sshKey ? encrypt(body.sshKey) : null,
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
      sshKey?: string | null;
    };
    const existing = db.query("SELECT * FROM repos WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    let sshKey = existing.ssh_key;
    if (body.sshKey !== undefined) {
      sshKey = body.sshKey ? encrypt(body.sshKey) : null;
    }

    db.query(`
      UPDATE repos SET url = ?1, branch = ?2, poll_interval = ?3, is_monorepo = ?4, ssh_key = ?5
      WHERE id = ?6
    `).run(
      body.url ?? existing.url,
      body.branch ?? existing.branch,
      body.pollInterval ?? existing.poll_interval,
      body.isMonorepo !== undefined ? (body.isMonorepo ? 1 : 0) : existing.is_monorepo,
      sshKey,
      id,
    );
    return Response.json({ ok: true });
  }

  if (req.method === "POST" && path.match(/^\/api\/repos\/\d+\/generate-key$/)) {
    const id = parseInt(path.split("/")[3]);
    const existing = db.query("SELECT * FROM repos WHERE id = ?").get(id) as any;
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    const keyPath = `/tmp/pi-blade-keygen-${id}`;
    const proc = Bun.spawn(
      ["ssh-keygen", "-t", "ed25519", "-f", keyPath, "-N", "", "-C", `pi-blade-deploy-${id}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;

    const privateKey = await Bun.file(keyPath).text();
    const publicKey = await Bun.file(`${keyPath}.pub`).text();

    db.query("UPDATE repos SET ssh_key = ? WHERE id = ?").run(encrypt(privateKey), id);

    await Bun.spawn(["rm", "-f", keyPath, `${keyPath}.pub`], { stdout: "pipe" }).exited;

    return Response.json({ publicKey: publicKey.trim() });
  }

  if (req.method === "GET" && path.match(/^\/api\/repos\/\d+\/public-key$/)) {
    const id = parseInt(path.split("/")[3]);
    const repo = db.query("SELECT ssh_key FROM repos WHERE id = ?").get(id) as any;
    if (!repo?.ssh_key) return Response.json({ error: "no key configured" }, { status: 404 });

    const { decrypt } = await import("../lib/crypto.ts");
    const keyPath = `/tmp/pi-blade-pubkey-${id}`;
    const { writeFileSync, unlinkSync } = await import("fs");
    writeFileSync(keyPath, decrypt(repo.ssh_key), { mode: 0o600 });

    const proc = Bun.spawn(["ssh-keygen", "-y", "-f", keyPath], { stdout: "pipe", stderr: "pipe" });
    const publicKey = await new Response(proc.stdout).text();
    await proc.exited;
    try { unlinkSync(keyPath); } catch {}

    return Response.json({ publicKey: publicKey.trim() });
  }

  if (req.method === "GET" && path.match(/^\/api\/repos\/\d+\/detect-projects$/)) {
    const id = parseInt(path.split("/")[3]);
    const repo = db.query("SELECT * FROM repos WHERE id = ?").get(id) as any;
    if (!repo) return Response.json({ error: "not found" }, { status: 404 });

    const cloneDir = `/tmp/pi-blade-detect-${id}-${Date.now()}`;
    const sshEnv = sshEnvForRepo(repo);
    try {
      const cloneProc = Bun.spawn(
        ["git", "clone", "--depth", "1", "--branch", repo.branch, repo.url, cloneDir],
        { stdout: "pipe", stderr: "pipe", env: sshEnv ? { ...process.env, ...sshEnv } : undefined },
      );
      const cloneCode = await cloneProc.exited;
      if (cloneCode !== 0) {
        const err = await new Response(cloneProc.stderr).text();
        return Response.json({ error: `clone failed: ${err.trim()}` }, { status: 500 });
      }

      // Find all Dockerfiles
      const findProc = Bun.spawn(
        ["find", cloneDir, "-name", "Dockerfile", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const findOut = await new Response(findProc.stdout).text();
      await findProc.exited;

      const dockerfiles = findOut.trim().split("\n").filter(Boolean);
      const projects = dockerfiles.map((df) => {
        const rel = df.replace(cloneDir + "/", "");
        const dir = rel.includes("/") ? rel.substring(0, rel.lastIndexOf("/")) : ".";
        const parts = dir.split("/");
        const name = dir === "." ? repo.url.split("/").pop()?.replace(".git", "") || "app" : parts[parts.length - 1];
        return { name, path: dir, dockerfilePath: rel.substring(dir === "." ? 0 : dir.length + 1) };
      });

      return Response.json(projects);
    } finally {
      Bun.spawn(["rm", "-rf", cloneDir], { stdout: "ignore", stderr: "ignore" });
      cleanupSshKey(repo.id);
    }
  }

  if (req.method === "GET" && path.match(/^\/api\/repos\/\d+\/test$/)) {
    const id = parseInt(path.split("/")[3]);
    const repo = db.query("SELECT * FROM repos WHERE id = ?").get(id) as any;
    if (!repo) return Response.json({ error: "not found" }, { status: 404 });

    const sshEnv = sshEnvForRepo(repo);
    try {
      const proc = Bun.spawn(["git", "ls-remote", "--exit-code", repo.url, `refs/heads/${repo.branch}`], {
        stdout: "pipe",
        stderr: "pipe",
        env: sshEnv ? { ...process.env, ...sshEnv } : undefined,
      });
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      if (code === 0) {
        return Response.json({ ok: true });
      }
      return Response.json({ ok: false, error: stderr.trim() || `exit code ${code}` });
    } catch (e: any) {
      return Response.json({ ok: false, error: e.message });
    } finally {
      cleanupSshKey(repo.id);
    }
  }

  if (req.method === "DELETE" && path.match(/^\/api\/repos\/\d+$/)) {
    const id = parseInt(path.split("/").pop()!);
    db.query("DELETE FROM repos WHERE id = ?").run(id);
    return Response.json({ ok: true });
  }

  return null;
}
