import { MASTER_PORT } from "@pi-blade/shared";
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
