import type { ContainerStatus, ContainerMetrics } from "@pi-blade/shared";

async function run(args: string[]): Promise<string> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`docker ${args.join(" ")} failed: ${stderr}`);
  }
  return output.trim();
}

export async function pullImage(registry: string, image: string, tag: string): Promise<void> {
  const fullImage = `${registry}/${image}:${tag}`;
  await run(["pull", fullImage]);
}

export async function startContainer(opts: {
  name: string;
  image: string;
  tag: string;
  registry: string;
  port: number;
  containerPort?: number;
  extraPorts?: { hostPort: number; containerPort: number }[];
  volumes?: { hostPath: string; containerPath: string; readonly?: boolean }[];
  envVars: Record<string, string>;
}): Promise<string> {
  const fullImage = `${opts.registry}/${opts.image}:${opts.tag}`;
  const cPort = opts.containerPort || opts.port;
  const args: string[] = [
    "run",
    "-d",
    "--name", opts.name,
    "--restart", "unless-stopped",
    "--label", "pi-blade=true",
    "-p", `${opts.port}:${cPort}`,
  ];

  for (const ep of opts.extraPorts || []) {
    args.push("-p", `${ep.hostPort}:${ep.containerPort}`);
  }

  for (const v of opts.volumes || []) {
    const spec = `${v.hostPath}:${v.containerPath}${v.readonly ? ':ro' : ''}`;
    args.push("-v", spec);
  }

  for (const [key, value] of Object.entries(opts.envVars)) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(fullImage);
  return await run(args);
}

export async function stopAndRemove(name: string): Promise<void> {
  try {
    await run(["stop", name]);
  } catch {
    // container might not be running
  }
  try {
    await run(["rm", name]);
  } catch {
    // container might not exist
  }
}

export async function listContainers(): Promise<ContainerStatus[]> {
  const output = await run([
    "ps",
    "--filter", "label=pi-blade",
    "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Ports}}",
  ]);

  if (!output) return [];

  return output.split("\n").map((line) => {
    const [id, name, image, state, ports] = line.split("\t");
    const portMatch = ports?.match(/:(\d+)->/);
    return {
      id,
      name,
      image,
      state,
      port: portMatch ? parseInt(portMatch[1]) : 0,
    };
  });
}

export async function getContainerMetrics(): Promise<ContainerMetrics[]> {
  const output = await run([
    "stats",
    "--no-stream",
    "--format", "{{.ID}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}",
  ]);

  if (!output) return [];

  return output.split("\n").map((line) => {
    const [containerId, name, cpu, mem, net] = line.split("\t");

    const cpuPercent = parseFloat(cpu?.replace("%", "") || "0");

    const memParts = mem?.split(" / ") || ["0MiB", "0MiB"];
    const memoryUsageMb = parseMem(memParts[0]);
    const memoryLimitMb = parseMem(memParts[1]);

    const netParts = net?.split(" / ") || ["0B", "0B"];
    const networkRxBytes = parseBytes(netParts[0]);
    const networkTxBytes = parseBytes(netParts[1]);

    return {
      containerId,
      name,
      cpuPercent,
      memoryUsageMb,
      memoryLimitMb,
      networkRxBytes,
      networkTxBytes,
    };
  });
}

export interface ContainerHealth {
  name: string;
  running: boolean;
  restartCount: number;
  uptime: string;
  exitCode: number | null;
  httpStatus: number | null;
  healthy: boolean;
}

export async function checkContainerHealth(name: string, port?: number): Promise<ContainerHealth> {
  const result: ContainerHealth = {
    name,
    running: false,
    restartCount: 0,
    uptime: '',
    exitCode: null,
    httpStatus: null,
    healthy: false,
  };

  try {
    const inspect = await run([
      "inspect", name,
      "--format", "{{.State.Running}}\t{{.RestartCount}}\t{{.State.Status}}\t{{.State.ExitCode}}\t{{.State.StartedAt}}",
    ]);
    const [running, restarts, status, exitCode, startedAt] = inspect.split("\t");
    result.running = running === "true";
    result.restartCount = parseInt(restarts) || 0;
    result.exitCode = parseInt(exitCode) ?? null;

    if (result.running && startedAt) {
      const ms = Date.now() - new Date(startedAt).getTime();
      const mins = Math.floor(ms / 60000);
      if (mins < 60) result.uptime = `${mins}m`;
      else if (mins < 1440) result.uptime = `${Math.floor(mins / 60)}h ${mins % 60}m`;
      else result.uptime = `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
    }
  } catch {
    return result;
  }

  // HTTP health check if port provided and container running
  if (result.running && port) {
    try {
      const res = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(5000),
      });
      result.httpStatus = res.status;
    } catch {
      result.httpStatus = 0; // connection refused / timeout
    }
  }

  result.healthy = result.running && result.restartCount < 5 &&
    (result.httpStatus === null || (result.httpStatus >= 200 && result.httpStatus < 500));

  return result;
}

function parseMem(s: string): number {
  s = s.trim();
  if (s.endsWith("GiB")) return parseFloat(s) * 1024;
  if (s.endsWith("MiB")) return parseFloat(s);
  if (s.endsWith("KiB")) return parseFloat(s) / 1024;
  return parseFloat(s);
}

function parseBytes(s: string): number {
  s = s.trim();
  if (s.endsWith("GB")) return parseFloat(s) * 1e9;
  if (s.endsWith("MB")) return parseFloat(s) * 1e6;
  if (s.endsWith("KB") || s.endsWith("kB")) return parseFloat(s) * 1e3;
  if (s.endsWith("B")) return parseFloat(s);
  return parseFloat(s);
}
