import { getDb } from "../db.ts";
import { REGISTRY_PORT, BLADE_AGENT_PORT } from "@pi-blade/shared";
import type { DeployRequest } from "@pi-blade/shared";
import { sendDiscordAlert } from "../routes/alerts.ts";
import { postCommitStatus } from "./github.ts";
import { sshEnvForRepo, cleanupSshKey } from "../lib/ssh.ts";
import { createLog, appendLog, finishLog, logKey } from "../lib/build-log.ts";

const REGISTRY = `localhost:${REGISTRY_PORT}`;

class BuildAbortedError extends Error {
  constructor() { super("Build aborted"); this.name = "BuildAbortedError"; }
}

async function runCmdWithLog(
  cmd: string[],
  key: string,
  signal: AbortSignal,
  opts?: { cwd?: string; env?: Record<string, string> },
): Promise<string> {
  if (signal.aborted) throw new BuildAbortedError();

  const label = cmd[0] === "git" ? cmd.slice(0, 3).join(" ") : cmd.slice(0, 2).join(" ");
  appendLog(key, `$ ${cmd.join(" ")}`);

  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.cwd,
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
  });

  // Kill process on abort
  const onAbort = () => { try { proc.kill(); } catch {} };
  signal.addEventListener("abort", onAbort, { once: true });

  const streamLines = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) appendLog(key, line);
      }
    }
    if (buf.trim()) appendLog(key, buf);
  };

  await Promise.all([
    streamLines(proc.stdout as ReadableStream),
    streamLines(proc.stderr as ReadableStream),
  ]);

  signal.removeEventListener("abort", onAbort);

  const exitCode = await proc.exited;

  if (signal.aborted) throw new BuildAbortedError();

  if (exitCode !== 0) {
    appendLog(key, `[ERROR] ${label} exited with code ${exitCode}`);
    throw new Error(`${cmd.join(" ")} failed (exit ${exitCode})`);
  }
  return "";
}

async function runCmd(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.cwd,
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${cmd.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

export async function buildAndDeploy(project: any, repo: any, commitSha: string, branch?: string) {
  const db = getDb();
  const deployBranch = branch || "main";
  const imageTag = commitSha.slice(0, 12);
  const imageName = `${REGISTRY}/${project.name.toLowerCase()}:${imageTag}`;
  const cloneDir = `/tmp/pi-blade-build/${project.name}-${imageTag}`;
  const key = logKey(project.name, imageTag);

  const ac = createLog(key);
  const signal = ac.signal;
  appendLog(key, `=== Build started: ${project.name} @ ${deployBranch} (${imageTag}) ===`);

  // Get branch config for port
  const branchConfig = db.query(
    "SELECT port FROM project_branches WHERE project_id = ? AND branch = ?"
  ).get(project.id, deployBranch) as any;
  const hostPort = branchConfig?.port || 8080;

  const blades = db.query(`
    SELECT b.* FROM project_blades pb
    JOIN blades b ON b.id = pb.blade_id
    WHERE pb.project_id = ? AND b.status = 'online'
  `).all(project.id) as any[];

  if (blades.length === 0) {
    appendLog(key, "No online blades, skipping");
    finishLog(key);
    return;
  }

  const deployIds: number[] = [];
  for (const blade of blades) {
    const result = db.query(`
      INSERT INTO deploys (project_id, image_tag, commit_sha, branch, blade_id, status)
      VALUES (?1, ?2, ?3, ?4, ?5, 'building')
    `).run(project.id, imageTag, commitSha, deployBranch, blade.id);
    deployIds.push(Number(result.lastInsertRowid));
  }

  await postCommitStatus({
    repoUrl: repo.url,
    commitSha,
    state: "pending",
    description: `Building "${project.name}"...`,
    context: `pi-blade/${project.name}`,
  });

  const sshEnv = sshEnvForRepo(repo);
  try {
    appendLog(key, `Cloning ${repo.url} branch ${deployBranch}...`);
    await runCmdWithLog(["git", "clone", "--depth", "1", "--branch", deployBranch, repo.url, cloneDir], key, signal, { env: sshEnv });

    const buildContext = `${cloneDir}/${project.path}`;
    const dockerfilePath = `${buildContext}/${project.dockerfile_path}`;

    appendLog(key, `Building image ${imageName}...`);
    await runCmdWithLog(["docker", "build", "-t", imageName, "-f", dockerfilePath, buildContext], key, signal);

    appendLog(key, `Pushing ${imageName}...`);
    await runCmdWithLog(["docker", "push", imageName], key, signal);

    db.query(`
      UPDATE deploys SET status = 'pushing'
      WHERE image_tag = ? AND project_id = ?
    `).run(imageTag, project.id);

    // Merge global vars + branch-specific vars (branch overrides global)
    const allVars = db.query(
      "SELECT key, value, scope FROM project_vars WHERE project_id = ? AND (scope = 'global' OR scope = ?) ORDER BY scope ASC"
    ).all(project.id, deployBranch) as any[];
    const envVars: Record<string, string> = {};
    for (const v of allVars) {
      envVars[v.key] = v.value;
    }

    let allBladesSucceeded = true;

    for (const blade of blades) {
      try {
        appendLog(key, `Deploying to ${blade.name}...`);
        db.query(`
          UPDATE deploys SET status = 'deploying'
          WHERE image_tag = ? AND project_id = ? AND blade_id = ?
        `).run(imageTag, project.id, blade.id);

        const containerName = `${project.name.toLowerCase()}-${deployBranch.replace(/\//g, "-")}`;
        const deployReq: DeployRequest = {
          projectName: containerName,
          imageTag,
          registryHost: REGISTRY,
          imageName: project.name.toLowerCase(),
          port: hostPort,
          containerPort: project.container_port || 3000,
          envVars,
        };

        const res = await fetch(`http://${blade.hostname}:${BLADE_AGENT_PORT}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deployReq),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "deploy failed");
        }

        // Mark previous running deploys for this branch+blade as superseded
        db.query(`
          UPDATE deploys SET status = 'superseded'
          WHERE project_id = ? AND blade_id = ? AND branch = ? AND status = 'running'
        `).run(project.id, blade.id, deployBranch);

        db.query(`
          UPDATE deploys SET status = 'running'
          WHERE image_tag = ? AND project_id = ? AND blade_id = ?
        `).run(imageTag, project.id, blade.id);

        appendLog(key, `✓ Deployed to ${blade.name}`);
      } catch (e: any) {
        allBladesSucceeded = false;
        appendLog(key, `✗ Failed on ${blade.name}: ${e.message}`);
        db.query(`
          UPDATE deploys SET status = 'failed', log = ?
          WHERE image_tag = ? AND project_id = ? AND blade_id = ?
        `).run(e.message, imageTag, project.id, blade.id);

        db.query(`
          INSERT INTO alerts (type, blade_id, message) VALUES ('deploy_failed', ?, ?)
        `).run(blade.id, `Deploy of "${project.name}" failed on ${blade.name}: ${e.message}`);

        await sendDiscordAlert(`Deploy of "${project.name}" failed on ${blade.name}: ${e.message}`);
      }
    }

    const status = allBladesSucceeded ? "success" : "partial failure";
    appendLog(key, `=== Build ${status} ===`);

    await postCommitStatus({
      repoUrl: repo.url,
      commitSha,
      state: allBladesSucceeded ? "success" : "failure",
      description: allBladesSucceeded
        ? `Deployed "${project.name}" to ${blades.length} blade(s)`
        : `Deploy of "${project.name}" failed on some blades`,
      context: `pi-blade/${project.name}`,
    });
  } catch (e: any) {
    if (e instanceof BuildAbortedError || signal.aborted) {
      appendLog(key, `=== Build ABORTED ===`);
      db.query(`
        UPDATE deploys SET status = 'aborted', log = 'Aborted by user'
        WHERE image_tag = ? AND project_id = ? AND status IN ('building', 'pushing', 'deploying')
      `).run(imageTag, project.id);
    } else {
      appendLog(key, `=== Build FAILED: ${e.message} ===`);
      db.query(`
        UPDATE deploys SET status = 'failed', log = ?
        WHERE image_tag = ? AND project_id = ?
      `).run(e.message, imageTag, project.id);

      db.query(`
        INSERT INTO alerts (type, message) VALUES ('deploy_failed', ?)
      `).run(`Build failed for "${project.name}": ${e.message}`);

      await sendDiscordAlert(`Build failed for "${project.name}": ${e.message}`);

      await postCommitStatus({
        repoUrl: repo.url,
        commitSha,
        state: "failure",
        description: `Build failed for "${project.name}"`,
        context: `pi-blade/${project.name}`,
      });
    }
  } finally {
    // Save full log to DB
    const { getLog } = await import("../lib/build-log.ts");
    const log = getLog(key);
    if (log) {
      const fullLog = log.lines.join("\n");
      db.query(
        "UPDATE deploys SET log = ? WHERE image_tag = ? AND project_id = ?"
      ).run(fullLog, imageTag, project.id);
    }
    finishLog(key);
    await runCmd(["rm", "-rf", cloneDir]).catch(() => {});
    cleanupSshKey(repo.id);
  }
}

export async function triggerRollback(projectId: number, bladeId: number, imageTag: string) {
  const db = getDb();
  const blade = db.query("SELECT * FROM blades WHERE id = ?").get(bladeId) as any;
  if (!blade) throw new Error("blade not found");

  const project = db.query("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) throw new Error("project not found");

  const res = await fetch(`http://${blade.hostname}:${BLADE_AGENT_PORT}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectName: project.name.toLowerCase(), imageTag, imageName: project.name.toLowerCase() }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "rollback failed");
  }

  db.query(`
    INSERT INTO deploys (project_id, image_tag, blade_id, status)
    VALUES (?1, ?2, ?3, 'running')
  `).run(projectId, imageTag, bladeId);

  return { ok: true };
}
