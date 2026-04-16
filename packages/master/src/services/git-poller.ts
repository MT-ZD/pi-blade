import { getDb } from "../db.ts";
import { buildAndDeploy } from "./builder.ts";
import { sshEnvForRepo, cleanupSshKey } from "../lib/ssh.ts";

// Track commits per project+branch combo
const lastKnownCommits = new Map<string, string>();

function commitKey(projectId: number, branch: string) {
  return `${projectId}:${branch}`;
}

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

async function pollProjectBranch(project: any, branch: string, repo: any, sshEnv?: Record<string, string>) {
  const latestCommit = await getLatestCommit(repo.url, branch, sshEnv);
  if (!latestCommit) return;

  const key = commitKey(project.id, branch);
  const previousCommit = lastKnownCommits.get(key);
  if (previousCommit === latestCommit) return;

  console.log(`[poller] Change detected for "${project.name}" on ${branch}: ${latestCommit.slice(0, 8)}`);
  lastKnownCommits.set(key, latestCommit);

  if (!previousCommit) return;

  if (repo.is_monorepo) {
    const repoDir = `/tmp/pi-blade-repos/${repo.id}-${branch}`;
    const cloneProc = Bun.spawn(["git", "clone", "--bare", "--branch", branch, repo.url, repoDir], {
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

  console.log(`[poller] Triggering build for "${project.name}" branch ${branch}`);
  await buildAndDeploy(project, repo, latestCommit, branch);
}

export function startPoller() {
  console.log("[poller] Started");

  const poll = async () => {
    const db = getDb();
    // Get all project+branch combos with repo info
    const entries = db.query(`
      SELECT p.*, pb.branch, r.url as repo_url, r.is_monorepo, r.ssh_key, r.github_token, r.id as rid
      FROM projects p
      JOIN project_branches pb ON pb.project_id = p.id
      JOIN repos r ON r.id = p.repo_id
    `).all() as any[];

    // Group by repo to reuse SSH env
    const byRepo = new Map<number, { repo: any; items: any[] }>();
    for (const e of entries) {
      const repo = { id: e.rid, url: e.repo_url, is_monorepo: e.is_monorepo, ssh_key: e.ssh_key, github_token: e.github_token };
      if (!byRepo.has(repo.id)) byRepo.set(repo.id, { repo, items: [] });
      byRepo.get(repo.id)!.items.push(e);
    }

    for (const [, { repo, items }] of byRepo) {
      const sshEnv = sshEnvForRepo(repo);
      try {
        for (const entry of items) {
          try {
            await pollProjectBranch(entry, entry.branch, repo, sshEnv);
          } catch (e: any) {
            console.error(`[poller] Error polling "${entry.name}" branch ${entry.branch}: ${e.message}`);
          }
        }
      } finally {
        cleanupSshKey(repo.id);
      }
    }
  };

  poll();
  setInterval(poll, 30_000);
}
