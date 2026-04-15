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
  envVars: Record<string, string>;
}): Promise<string> {
  const fullImage = `${opts.registry}/${opts.name}:${opts.tag}`;
  const args: string[] = [
    "run",
    "-d",
    "--name", opts.name,
    "--restart", "unless-stopped",
    "-p", `${opts.port}:${opts.port}`,
  ];

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
