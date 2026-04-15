import { MASTER_HOSTNAME, MASTER_PORT } from "@pi-blade/shared";

interface BladeState {
  name: string;
  hostname: string;
  deployedImages: Map<string, string[]>;
}

const state: BladeState = {
  name: "",
  hostname: "",
  deployedImages: new Map(),
};

export function getState(): BladeState {
  return state;
}

export function setIdentity(name: string, hostname: string) {
  state.name = name;
  state.hostname = hostname;
}

export function trackDeploy(projectName: string, imageTag: string, maxKept = 5) {
  const tags = state.deployedImages.get(projectName) || [];
  tags.push(imageTag);
  if (tags.length > maxKept) tags.shift();
  state.deployedImages.set(projectName, tags);
}

export function getPreviousTag(projectName: string): string | null {
  const tags = state.deployedImages.get(projectName) || [];
  return tags.length >= 2 ? tags[tags.length - 2] : null;
}

export function getMasterUrl(): string {
  return `http://${MASTER_HOSTNAME}:${MASTER_PORT}`;
}
