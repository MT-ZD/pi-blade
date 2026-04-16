type GithubState = "pending" | "success" | "failure" | "error";

interface StatusParams {
  repoUrl: string;
  commitSha: string;
  state: GithubState;
  description: string;
  context?: string;
  token?: string | null;
}

export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export async function postCommitStatus({ repoUrl, commitSha, state, description, context = "pi-blade", token }: StatusParams) {
  if (!token) return;

  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) return;

  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/statuses/${commitSha}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ state, description, context }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[github] Status post failed (${res.status}): ${body}`);
    }
  } catch (e: any) {
    console.error(`[github] Failed to post commit status: ${e.message}`);
  }
}
