import { execSync } from "child_process";

let cached: string | null = null;

export function getVersion(): string {
  if (cached) return cached;
  try {
    cached = execSync("git rev-parse HEAD", {
      cwd: "/opt/pi-blade",
      encoding: "utf8",
    }).trim();
  } catch {
    cached = "unknown";
  }
  return cached;
}

export function getVersionShort(): string {
  return getVersion().slice(0, 12);
}

export function clearVersionCache() {
  cached = null;
}
