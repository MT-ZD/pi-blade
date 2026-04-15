import { getDb } from "../db.ts";

export async function handleAlertRoutes(req: Request, path: string): Promise<Response | null> {
  const db = getDb();

  if (req.method === "GET" && path === "/api/alerts") {
    const alerts = db.query(`
      SELECT a.*, b.name as blade_name
      FROM alerts a
      LEFT JOIN blades b ON b.id = a.blade_id
      ORDER BY a.timestamp DESC
      LIMIT 100
    `).all();
    return Response.json(alerts);
  }

  if (req.method === "GET" && path === "/api/settings/github-token") {
    const row = db.query("SELECT value FROM settings WHERE key = 'github_token'").get() as any;
    return Response.json({ configured: !!row?.value });
  }

  if (req.method === "PUT" && path === "/api/settings/github-token") {
    const body = await req.json() as { token: string };
    db.query(`
      INSERT INTO settings (key, value) VALUES ('github_token', ?1)
      ON CONFLICT(key) DO UPDATE SET value = ?1
    `).run(body.token);
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE" && path === "/api/settings/github-token") {
    db.query("DELETE FROM settings WHERE key = 'github_token'").run();
    return Response.json({ ok: true });
  }

  if (req.method === "GET" && path === "/api/settings/discord-webhook") {
    const row = db.query("SELECT value FROM settings WHERE key = 'discord_webhook'").get() as any;
    return Response.json({ url: row?.value || "" });
  }

  if (req.method === "PUT" && path === "/api/settings/discord-webhook") {
    const body = await req.json() as { url: string };
    db.query(`
      INSERT INTO settings (key, value) VALUES ('discord_webhook', ?1)
      ON CONFLICT(key) DO UPDATE SET value = ?1
    `).run(body.url);
    return Response.json({ ok: true });
  }

  return null;
}

export async function sendDiscordAlert(message: string) {
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = 'discord_webhook'").get() as any;
  if (!row?.value) return;

  try {
    await fetch(row.value, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `🚨 **Pi-Blade Alert**: ${message}` }),
    });
  } catch {
    console.error("Failed to send Discord alert");
  }
}
