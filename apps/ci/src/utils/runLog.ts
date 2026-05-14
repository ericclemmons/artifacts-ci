import { env } from "cloudflare:workers";

const RUN_LOG_BASE_URL = "https://run-log.local";

export async function appendRunLog(runId: string, line: string) {
  await getRunLog(runId).fetch(`${RUN_LOG_BASE_URL}/append`, {
    method: "POST",
    body: JSON.stringify({ line: line.trimEnd() }),
    headers: { "Content-Type": "application/json" },
  });
}

export async function resetRunLog(runId: string) {
  await getRunLog(runId).fetch(`${RUN_LOG_BASE_URL}/reset`, { method: "POST" });
}

export async function closeRunLog(runId: string) {
  await getRunLog(runId).fetch(`${RUN_LOG_BASE_URL}/close`, { method: "POST" });
}

export function getRunLog(runId: string) {
  const id = env.RunLog.idFromName(runId);
  return env.RunLog.get(id);
}
