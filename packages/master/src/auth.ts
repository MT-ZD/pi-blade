import { createHmac, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./db.ts";

const PUBLIC_PATHS = ["/api/auth/login", "/api/version", "/setup/blade"];
const AGENT_PATHS = ["/api/blades/register"];
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret(): string {
  const db = getDb();
  let row = db.query("SELECT value FROM settings WHERE key = 'token_secret'").get() as any;
  if (!row) {
    const secret = randomBytes(32).toString("hex");
    db.query("INSERT INTO settings (key, value) VALUES ('token_secret', ?)").run(secret);
    return secret;
  }
  return row.value;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

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

export function createSession(): string {
  const expiry = Date.now() + TOKEN_MAX_AGE_MS;
  const payload = `${expiry}`;
  return `${payload}.${sign(payload)}`;
}

export function validateToken(token: string): boolean {
  const dotIdx = token.indexOf(".");
  if (dotIdx < 1) return false;

  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  if (sign(payload) !== sig) return false;

  const expiry = parseInt(payload);
  if (isNaN(expiry) || Date.now() > expiry) return false;

  return true;
}

export function destroySession(_token: string) {
  // Stateless tokens — logout handled client-side by clearing cookie
}

export function checkAuth(req: Request, path: string): Response | null {
  if (!isAuthEnabled()) return null;
  if (isPublicPath(path)) return null;

  const auth = req.headers.get("Authorization");
  let token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    const url = new URL(req.url);
    token = url.searchParams.get("token");
  }

  if (!token || !validateToken(token)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
