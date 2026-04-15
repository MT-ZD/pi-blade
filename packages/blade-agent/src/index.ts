import { BLADE_AGENT_PORT, MASTER_HOSTNAME, MASTER_PORT } from "@pi-blade/shared";
import type { DeployRequest, RollbackRequest, RegisterRequest } from "@pi-blade/shared";
import { pullImage, startContainer, stopAndRemove, listContainers } from "./docker.ts";
import { collectMetrics } from "./metrics.ts";
import { getState, setIdentity, trackDeploy, getPreviousTag, getMasterUrl } from "./state.ts";

const hostnameProc = Bun.spawn(["hostname"], { stdout: "pipe" });
const hostname = (await new Response(hostnameProc.stdout).text()).trim();
const name = hostname.replace(".local", "");
setIdentity(name, hostname);

async function handleDeploy(req: Request): Promise<Response> {
  const body = (await req.json()) as DeployRequest;

  try {
    await stopAndRemove(body.projectName);
    await pullImage(body.registryHost, body.projectName, body.imageTag);
    await startContainer({
      name: body.projectName,
      image: body.projectName,
      tag: body.imageTag,
      registry: body.registryHost,
      port: body.port,
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
    containers,
  });
}

async function handleMetrics(): Promise<Response> {
  const metrics = await collectMetrics();
  return Response.json(metrics);
}

async function registerWithMaster() {
  const state = getState();
  const body: RegisterRequest = { name: state.name, hostname: state.hostname };

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
    if (method === "GET" && url.pathname === "/status") return handleStatus();
    if (method === "GET" && url.pathname === "/metrics") return handleMetrics();

    return new Response("not found", { status: 404 });
  },
});

console.log(`Blade agent "${name}" running on port ${BLADE_AGENT_PORT}`);
registerWithMaster();
