type Subscriber = (line: string) => void;

interface BuildLog {
  lines: string[];
  subscribers: Set<Subscriber>;
  finished: boolean;
  abortController?: AbortController;
}

const logs = new Map<string, BuildLog>();

export function createLog(key: string): AbortController {
  const ac = new AbortController();
  logs.set(key, { lines: [], subscribers: new Set(), finished: false, abortController: ac });
  return ac;
}

export function abortBuild(key: string): boolean {
  const log = logs.get(key);
  if (!log || log.finished) return false;
  log.abortController?.abort();
  return true;
}

export function appendLog(key: string, line: string) {
  const log = logs.get(key);
  if (!log) return;
  log.lines.push(line);
  for (const sub of log.subscribers) {
    sub(line);
  }
}

export function finishLog(key: string) {
  const log = logs.get(key);
  if (!log) return;
  log.finished = true;
  for (const sub of log.subscribers) {
    sub("\n__DONE__");
  }
  log.subscribers.clear();
  // Keep log around for 10 min for late viewers
  setTimeout(() => logs.delete(key), 10 * 60 * 1000);
}

export function getLog(key: string): BuildLog | undefined {
  return logs.get(key);
}

export function subscribe(key: string, cb: Subscriber): () => void {
  const log = logs.get(key);
  if (!log) return () => {};
  log.subscribers.add(cb);
  return () => log.subscribers.delete(cb);
}

// Build a log key from project+imageTag
export function logKey(projectName: string, imageTag: string) {
  return `${projectName}:${imageTag}`;
}

export function getActiveLogs(): { key: string; finished: boolean }[] {
  const result: { key: string; finished: boolean }[] = [];
  for (const [key, log] of logs) {
    result.push({ key, finished: log.finished });
  }
  return result;
}
