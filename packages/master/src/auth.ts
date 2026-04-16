import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./db.ts";

const sessions = new Set<string>();

const PUBLIC_PATHS = ["/api/auth/login", "/api/version", "/setup/blade"];
const AGENT_PATHS = ["/api/blades/register"];

export function setPassword(password: string) {
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  db.query(`
    INSERT INTO settings (key, value) VALUES ('password_hash', ?1)
    ON CONFLICT(key) DO UPDATE SET value = ?1
  `).run(hash);
}

export function verifyPassword(password: string): boolean {
  const envPw = process.env.PI_BLADE_PASSWORD;
  if (envPw) return password === envPw;

  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = 'password_hash'").get() as any;
  if (!row?.value) return false;

  return bcrypt.compareSync(password, row.value);
}

export function isAuthEnabled(): boolean {
  if (process.env.PI_BLADE_PASSWORD) return true;
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = 'password_hash'").get() as any;
  return !!row?.value;
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.includes(path) || AGENT_PATHS.includes(path);
}

export function validateToken(token: string): boolean {
  return sessions.has(token);
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.add(token);
  return token;
}

export function destroySession(token: string) {
  sessions.delete(token);
}

export function checkAuth(req: Request, path: string): Response | null {
  if (!isAuthEnabled()) return null;
  if (isPublicPath(path)) return null;

  const auth = req.headers.get("Authorization");
  let token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  // SSE can't send headers — allow token as query param
  if (!token) {
    const url = new URL(req.url);
    token = url.searchParams.get("token");
  }

  if (!token || !validateToken(token)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
