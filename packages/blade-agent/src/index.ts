import { BLADE_AGENT_PORT, MASTER_HOSTNAME, MASTER_PORT, getVersion, getVersionShort, clearVersionCache } from "@pi-blade/shared";
import type { DeployRequest, RollbackRequest, RegisterRequest } from "@pi-blade/shared";
import { pullImage, startContainer, stopAndRemove, listContainers, checkContainerHealth } from "./docker.ts";
import { collectMetrics } from "./metrics.ts";
import { getState, setIdentity, trackDeploy, getPreviousTag, getMasterUrl } from "./state.ts";

const hostnameProc = Bun.spawn(["hostname"], { stdout: "pipe" });
const hostname = (await new Response(hostnameProc.stdout).text()).trim();
const name = hostname.replace(".local", "");
setIdentity(name, hostname);

async function handleDeploy(req: Request): Promise<Response> {
  const body = (await req.json()) as DeployRequest;

  try {
    const imgName = body.imageName || body.projectName;
    await stopAndRemove(body.projectName);
    await pullImage(body.registryHost, imgName, body.imageTag);
    await startContainer({
      name: body.projectName,
      image: imgName,
      tag: body.imageTag,
      registry: body.registryHost,
      port: body.port,
      containerPort: body.containerPort,
      extraPorts: body.extraPorts,
      envVars: body.envVars,
    });
    trackDeploy(body.projectName, body.imageTag);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

async function handleRollback(req: Request): Promise<Response> {
  const body = (await req.json()) as RollbackRequest;
  const previousTag = body.imageTag || getPreviousTag(body.projectName);

  if (!previousTag) {
    return Response.json({ ok: false, error: "no previous image to rollback to" }, { status: 400 });
  }

  try {
    const state = getState();
    await stopAndRemove(body.projectName);
    await startContainer({
      name: body.projectName,
      image: body.projectName,
      tag: previousTag,
      registry: `${MASTER_HOSTNAME}:5000`,
      port: 0,
      envVars: {},
    });
    return Response.json({ ok: true, rolledBackTo: previousTag });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

async function handleStatus(): Promise<Response> {
  const state = getState();
  const containers = await listContainers();
  return Response.json({
    name: state.name,
    hostname: state.hostname,
    version: getVersion(),
    containers,
  });
}

async function handleVersion(): Promise<Response> {
  return Response.json({ version: getVersion(), short: getVersionShort() });
}

async function handleUpdate(): Promise<Response> {
  const installDir = "/opt/pi-blade";
  try {
    const pull = Bun.spawn(["git", "pull", "origin", "master"], {
      cwd: installDir, stdout: "pipe", stderr: "pipe",
    });
    await new Response(pull.stdout).text();
    const pullCode = await pull.exited;
    if (pullCode !== 0) {
      const err = await new Response(pull.stderr).text();
      return Response.json({ ok: false, error: `git pull failed: ${err}` }, { status: 500 });
    }

    const install = Bun.spawn(["bun", "install"], {
      cwd: installDir, stdout: "pipe", stderr: "pipe",
    });
    await install.exited;

    clearVersionCache();

    setTimeout(() => {
      Bun.spawn(["sudo", "systemctl", "restart", "pi-blade-agent"], {
        stdout: "ignore", stderr: "ignore",
      });
    }, 1000);

    return Response.json({ ok: true, message: "updated, restarting..." });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

async function handleMetrics(): Promise<Response> {
  const metrics = await collectMetrics();
  return Response.json(metrics);
}

async function registerWithMaster() {
  const state = getState();
  const body: RegisterRequest = { name: state.name, hostname: state.hostname, version: getVersion() };

  try {
    await fetch(`${getMasterUrl()}/api/blades/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log(`Registered with master as "${state.name}"`);
  } catch {
    console.log("Master not reachable, will retry on next cycle");
  }
}

const server = Bun.serve({
  port: BLADE_AGENT_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    if (method === "POST" && url.pathname === "/deploy") return handleDeploy(req);
    if (method === "POST" && url.pathname === "/rollback") return handleRollback(req);
    if (method === "POST" && url.pathname === "/update") return handleUpdate();
    if (method === "GET" && url.pathname === "/status") return handleStatus();
    if (method === "GET" && url.pathname === "/version") return handleVersion();
    if (method === "GET" && url.pathname === "/metrics") return handleMetrics();

    if (method === "GET" && url.pathname.startsWith("/health/")) {
      const container = decodeURIComponent(url.pathname.slice(8));
      const port = url.searchParams.get("port") ? parseInt(url.searchParams.get("port")!) : undefined;
      const health = await checkContainerHealth(container, port);
      return Response.json(health);
    }

    if (method === "GET" && url.pathname.startsWith("/logs/")) {
      const container = decodeURIComponent(url.pathname.slice(6));
      const tail = url.searchParams.get("tail") || "200";
      try {
        const proc = Bun.spawn(["docker", "logs", "--tail", tail, container], {
          stdout: "pipe", stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        await proc.exited;
        return Response.json({ logs: stdout + stderr });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`Blade agent "${name}" running on port ${BLADE_AGENT_PORT}`);
registerWithMaster();
