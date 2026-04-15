import { getDb } from "../db.ts";
import { buildAndDeploy } from "./builder.ts";

const lastKnownCommits = new Map<number, string>();

async function getLatestCommit(url: string, branch: string): Promise<string> {
  const proc = Bun.spawn(["git", "ls-remote", url, `refs/heads/${branch}`], {
    stdout: "pipe",
    stderr: "pipe",
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

async function pollRepo(repo: any) {
  const latestCommit = await getLatestCommit(repo.url, repo.branch);
  if (!latestCommit) return;

  const previousCommit = lastKnownCommits.get(repo.id);
  if (previousCommit === latestCommit) return;

  console.log(`[poller] Change detected in repo ${repo.url}: ${latestCommit.slice(0, 8)}`);
  lastKnownCommits.set(repo.id, latestCommit);

  if (!previousCommit) return;

  const db = getDb();
  const projects = db.query(
    "SELECT * FROM projects WHERE repo_id = ?"
  ).all(repo.id) as any[];

  if (repo.is_monorepo && previousCommit) {
    const repoDir = `/tmp/pi-blade-repos/${repo.id}`;
    const cloneProc = Bun.spawn(["git", "clone", "--bare", repo.url, repoDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await cloneProc.exited;

    const changedPaths = await getChangedPaths(repoDir, previousCommit, latestCommit);

    for (const project of projects) {
      const affected = changedPaths.some((p) => p.startsWith(project.path));
      if (affected) {
        console.log(`[poller] Project "${project.name}" affected, triggering build`);
        await buildAndDeploy(project, repo, latestCommit);
      }
    }
  } else {
    for (const project of projects) {
      console.log(`[poller] Triggering build for "${project.name}"`);
      await buildAndDeploy(project, repo, latestCommit);
    }
  }
}

export function startPoller() {
  console.log("[poller] Started");

  const poll = async () => {
    const db = getDb();
    const repos = db.query("SELECT * FROM repos").all() as any[];

    for (const repo of repos) {
      try {
        await pollRepo(repo);
      } catch (e: any) {
        console.error(`[poller] Error polling ${repo.url}: ${e.message}`);
      }
    }
  };

  poll();
  setInterval(poll, 30_000);
}
