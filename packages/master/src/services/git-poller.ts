import { getDb } from "../db.ts";
import { buildAndDeploy } from "./builder.ts";
import { sshEnvForRepo, cleanupSshKey } from "../lib/ssh.ts";

// Track commits per project (not per repo), since each project has its own branch
const lastKnownCommits = new Map<number, string>();

async function getLatestCommit(url: string, branch: string, env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(["git", "ls-remote", url, `refs/heads/${branch}`], {
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : undefined,
  });
  const output = await new Response(proc.stdout).text();
  return output.split("\t")[0] || "";
}

async function getChangedPaths(repoDir: string, oldCommit: string, newCommit: string): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "diff", "--name-only", oldCommit, newCommit],
    { cwd: repoDir, stdout: "pipe" }
  );
  const output = await new Response(proc.stdout).text();
  return output.trim().split("\n").filter(Boolean);
}

async function pollProject(project: any, repo: any, sshEnv?: Record<string, string>) {
  const latestCommit = await getLatestCommit(repo.url, project.branch, sshEnv);
  if (!latestCommit) return;

  const previousCommit = lastKnownCommits.get(project.id);
  if (previousCommit === latestCommit) return;

  console.log(`[poller] Change detected for "${project.name}" on ${project.branch}: ${latestCommit.slice(0, 8)}`);
  lastKnownCommits.set(project.id, latestCommit);

  if (!previousCommit) return;

  if (repo.is_monorepo) {
    const repoDir = `/tmp/pi-blade-repos/${repo.id}-${project.branch}`;
    const cloneProc = Bun.spawn(["git", "clone", "--bare", "--branch", project.branch, repo.url, repoDir], {
      stdout: "pipe",
      stderr: "pipe",
      env: sshEnv ? { ...process.env, ...sshEnv } : undefined,
    });
    await cloneProc.exited;

    const changedPaths = await getChangedPaths(repoDir, previousCommit, latestCommit);
    const affected = changedPaths.some((p) => p.startsWith(project.path));

    Bun.spawn(["rm", "-rf", repoDir], { stdout: "ignore", stderr: "ignore" });

    if (!affected) return;
  }

  console.log(`[poller] Triggering build for "${project.name}"`);
  await buildAndDeploy(project, repo, latestCommit);
}

export function startPoller() {
  console.log("[poller] Started");

  const poll = async () => {
    const db = getDb();
    const projects = db.query(`
      SELECT p.*, r.url as repo_url, r.is_monorepo, r.ssh_key, r.id as rid
      FROM projects p
      JOIN repos r ON r.id = p.repo_id
    `).all() as any[];

    for (const project of projects) {
      const repo = { id: project.rid, url: project.repo_url, is_monorepo: project.is_monorepo, ssh_key: project.ssh_key };
      const sshEnv = sshEnvForRepo(repo);
      try {
        await pollProject(project, repo, sshEnv);
      } catch (e: any) {
        console.error(`[poller] Error polling "${project.name}": ${e.message}`);
      } finally {
        cleanupSshKey(repo.id);
      }
    }
  };

  poll();
  setInterval(poll, 30_000);
}
