import { getDb } from "../db.ts";
import { REGISTRY_PORT, BLADE_AGENT_PORT } from "@pi-blade/shared";
import type { DeployRequest } from "@pi-blade/shared";
import { sendDiscordAlert } from "../routes/alerts.ts";
import { postCommitStatus } from "./github.ts";
import { sshEnvForRepo, cleanupSshKey } from "../lib/ssh.ts";

const REGISTRY = `localhost:${REGISTRY_PORT}`;

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

export async function buildAndDeploy(project: any, repo: any, commitSha: string) {
  const db = getDb();
  const imageTag = commitSha.slice(0, 12);
  const imageName = `${REGISTRY}/${project.name}:${imageTag}`;
  const cloneDir = `/tmp/pi-blade-build/${project.name}-${imageTag}`;

  const blades = db.query(`
    SELECT b.*, pb.port FROM project_blades pb
    JOIN blades b ON b.id = pb.blade_id
    WHERE pb.project_id = ? AND b.status = 'online'
  `).all(project.id) as any[];

  if (blades.length === 0) {
    console.log(`[builder] No online blades for project "${project.name}", skipping`);
    return;
  }

  for (const blade of blades) {
    db.query(`
      INSERT INTO deploys (project_id, image_tag, commit_sha, blade_id, status)
      VALUES (?1, ?2, ?3, ?4, 'building')
    `).run(project.id, imageTag, commitSha, blade.id);
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
    console.log(`[builder] Cloning ${repo.url} for "${project.name}"`);
    await runCmd(["git", "clone", "--depth", "1", "--branch", repo.branch, repo.url, cloneDir], { env: sshEnv });

    const buildContext = `${cloneDir}/${project.path}`;
    const dockerfilePath = `${buildContext}/${project.dockerfile_path}`;

    console.log(`[builder] Building ${imageName}`);
    await runCmd(["docker", "build", "-t", imageName, "-f", dockerfilePath, buildContext]);

    console.log(`[builder] Pushing ${imageName}`);
    await runCmd(["docker", "push", imageName]);

    db.query(`
      UPDATE deploys SET status = 'pushing'
      WHERE image_tag = ? AND project_id = ?
    `).run(imageTag, project.id);

    let envVars: Record<string, string> = {};
    if (project.env_group_id) {
      const vars = db.query(
        "SELECT key, value FROM env_vars WHERE env_group_id = ?"
      ).all(project.env_group_id) as any[];
      envVars = Object.fromEntries(vars.map((v: any) => [v.key, v.value]));
    }

    let allBladesSucceeded = true;

    for (const blade of blades) {
      try {
        console.log(`[builder] Deploying to ${blade.name}`);
        db.query(`
          UPDATE deploys SET status = 'deploying'
          WHERE image_tag = ? AND project_id = ? AND blade_id = ?
        `).run(imageTag, project.id, blade.id);

        const deployReq: DeployRequest = {
          projectName: project.name,
          imageTag,
          registryHost: REGISTRY,
          port: blade.port,
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

        db.query(`
          UPDATE deploys SET status = 'running'
          WHERE image_tag = ? AND project_id = ? AND blade_id = ?
        `).run(imageTag, project.id, blade.id);

        console.log(`[builder] Deployed "${project.name}" to ${blade.name}`);
      } catch (e: any) {
        allBladesSucceeded = false;
        console.error(`[builder] Failed to deploy to ${blade.name}: ${e.message}`);
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
    console.error(`[builder] Build failed for "${project.name}": ${e.message}`);
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
  } finally {
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
    body: JSON.stringify({ projectName: project.name, imageTag }),
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
