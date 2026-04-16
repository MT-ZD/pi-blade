import { MASTER_PORT, getVersion, getVersionShort } from "@pi-blade/shared";
import { handleBladeRoutes } from "./routes/blades.ts";
import { handleRepoRoutes } from "./routes/repos.ts";
import { handleProjectRoutes } from "./routes/projects.ts";
import { handleRoutingRoutes } from "./routes/routing.ts";
import { handleEnvRoutes } from "./routes/envs.ts";
import { handleDeployRoutes } from "./routes/deploys.ts";
import { handleAlertRoutes } from "./routes/alerts.ts";
import { handleActionRoutes } from "./routes/actions.ts";
import { startPoller } from "./services/git-poller.ts";
import { startMonitor } from "./services/monitor.ts";
import { startUpdater } from "./services/updater.ts";
import { checkAuth, verifyPassword, createSession, destroySession, isAuthEnabled, setPassword } from "./auth.ts";

const handlers = [
  handleBladeRoutes,
  handleRepoRoutes,
  handleProjectRoutes,
  handleRoutingRoutes,
  handleEnvRoutes,
  handleDeployRoutes,
  handleAlertRoutes,
  handleActionRoutes,
];

const server = Bun.serve({
  port: MASTER_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/setup/blade") {
      const script = Bun.file("../../scripts/setup-blade.sh");
      return new Response(script, {
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (path === "/api/version") {
      return Response.json({ version: getVersion(), short: getVersionShort() });
    }

    if (req.method === "GET" && path === "/api/auth/status") {
      return Response.json({ enabled: isAuthEnabled() });
    }

    if (req.method === "POST" && path === "/api/auth/login") {
      const body = await req.json() as { password: string };
      if (!verifyPassword(body.password)) {
        return Response.json({ error: "invalid password" }, { status: 401 });
      }
      const token = createSession();
      return Response.json({ ok: true, token });
    }

    if (req.method === "POST" && path === "/api/auth/logout") {
      const auth = req.headers.get("Authorization");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token) destroySession(token);
      return Response.json({ ok: true });
    }

    if (req.method === "PUT" && path === "/api/auth/password") {
      const authCheck = checkAuth(req, path);
      if (authCheck) return authCheck;
      const body = await req.json() as { password: string };
      setPassword(body.password);
      return Response.json({ ok: true });
    }

    // Auth check for all other API routes
    const authResponse = checkAuth(req, path);
    if (authResponse) return authResponse;

    for (const handler of handlers) {
      const response = await handler(req, path);
      if (response) return response;
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`Pi-Blade master running on port ${MASTER_PORT}`);
startPoller();
startMonitor();
startUpdater();
