export interface Blade {
  id: number;
  name: string;
  hostname: string;
  status: "online" | "offline" | "degraded";
  registeredAt: string;
}

export interface Repo {
  id: number;
  url: string;
  branch: string;
  pollInterval: number;
  isMonorepo: boolean;
}

export interface Project {
  id: number;
  repoId: number;
  name: string;
  path: string;
  dockerfilePath: string;
  envGroupId: number | null;
}

export interface Deploy {
  id: number;
  projectId: number;
  imageTag: string;
  commitSha: string | null;
  bladeId: number;
  status: "pending" | "building" | "pushing" | "deploying" | "running" | "failed" | "rolled_back";
  timestamp: string;
  log: string | null;
}

export interface Route {
  id: number;
  domain: string;
  projectId: number;
}

export interface Upstream {
  id: number;
  routeId: number;
  bladeId: number;
  port: number;
  weight: number;
}

export interface EnvGroup {
  id: number;
  name: string;
  environment: string;
}

export interface EnvVar {
  id: number;
  envGroupId: number;
  key: string;
  value: string;
}

export interface Alert {
  id: number;
  type: "blade_down" | "deploy_failed" | "high_usage";
  bladeId: number | null;
  message: string;
  discordSent: boolean;
  timestamp: string;
}

export interface BladeMetrics {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  containers: ContainerMetrics[];
  timestamp: string;
}

export interface ContainerMetrics {
  containerId: string;
  name: string;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

export interface DeployRequest {
  projectName: string;
  imageTag: string;
  registryHost: string;
  port: number;
  envVars: Record<string, string>;
}

export interface RollbackRequest {
  projectName: string;
  imageTag: string;
}

export interface RegisterRequest {
  name: string;
  hostname: string;
}

export interface BladeStatus {
  name: string;
  hostname: string;
  containers: ContainerStatus[];
}

export interface ContainerStatus {
  id: string;
  name: string;
  image: string;
  state: string;
  port: number;
}
