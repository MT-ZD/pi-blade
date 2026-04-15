import { writeFileSync, unlinkSync } from "fs";
import { decrypt } from "./crypto.ts";

export function sshEnvForRepo(repo: { id: number; ssh_key?: string | null }): Record<string, string> | undefined {
  if (!repo.ssh_key) return undefined;

  const keyPath = `/tmp/pi-blade-ssh-${repo.id}`;
  const key = decrypt(repo.ssh_key);
  writeFileSync(keyPath, key, { mode: 0o600 });

  return {
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`,
  };
}

export function cleanupSshKey(repoId: number) {
  try {
    unlinkSync(`/tmp/pi-blade-ssh-${repoId}`);
  } catch {}
}
