export { DeployWorkflow } from "./DeployWorkflow";
export { RunLog } from "./RunLog";
export { ContainerProxy, Sandbox } from "./Sandbox";

import { getAgentByName } from "agents";
import { Hono } from "hono";
import { cleanRepoName } from "./utils/cleanRepoName";
import { createRepoSetup, createRepoSetupScript } from "./utils/createRepoSetup";
import { ensureRepo } from "./utils/ensureRepo";
import { appendRunLog, resetRunLog } from "./utils/runLog";

const app = new Hono<{ Bindings: Env }>();
const CI_BASE_URL = "https://ci.localhost";

type CreateRunRequest = {
  namespace?: string;
  repo?: string;
  artifactsRemote?: string;
  artifactsToken?: string;
  commitSha?: string | null;
  pushedAt?: string;
};

app.get("/", (context) => context.text("POST /repos { name } to create setup commands.\n"));

app.post("/repos", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { name?: string };
  const name = cleanRepoName(body.name ?? context.req.query("name") ?? "demo");
  const repo = await ensureRepo(name);

  return context.json(createRepoSetup(name, repo));
});

app.get("/repos/*", async (context) => {
  const match = new URL(context.req.url).pathname.match(/^\/repos\/([^/]+)\.sh$/);

  if (!match) {
    return context.notFound();
  }

  const name = cleanRepoName(decodeURIComponent(match[1]));
  const repo = await ensureRepo(name);

  return context.text(createRepoSetupScript(name, repo), 200, {
    "Content-Type": "text/x-shellscript; charset=utf-8",
  });
});

app.get("/runs/:id", (context) => {
  const runId = context.req.param("id");

  return new Response(streamRunText(runId, context.env), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Encoding": "identity",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.get("/runs/:id/stream", (context) => {
  const runId = context.req.param("id");

  return new Response(streamRunText(runId, context.env), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Encoding": "identity",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.post("/internal/runs", async (context) => {
  const body = (await context.req.json<CreateRunRequest>().catch(() => ({}))) as CreateRunRequest;
  const namespace = body.namespace ?? "";
  const repo = body.repo ? cleanRepoName(body.repo) : "";

  if (!namespace || !repo || !body.artifactsRemote || !body.artifactsToken) {
    return context.text("Missing run parameters\n", 400);
  }

  const runId = body.commitSha ?? crypto.randomUUID();
  const workflowId = `${runId}-${crypto.randomUUID()}`;
  const runUrl = `${CI_BASE_URL}/runs/${runId}`;

  await resetRunLog(runId);
  await appendRunLog(runId, `📦 ${namespace}/${repo}`);
  await appendRunLog(runId, `🗒️ commit ${body.commitSha ?? "unknown"}`);
  await appendRunLog(runId, `🌐 ${runUrl}`);

  await context.env.DEPLOY_WORKFLOW.create({
    id: workflowId,
    params: {
      runId,
      namespace,
      repo,
      artifactsRemote: body.artifactsRemote,
      artifactsToken: body.artifactsToken,
      commitSha: body.commitSha ?? null,
      pushedAt: body.pushedAt ?? new Date().toISOString(),
    },
  });
  return context.json({ runId, runUrl });
});

app.get("/internal/runs/:id/stream", async (context) => {
  const runLog = await getAgentByName(context.env.RunLog, context.req.param("id"));
  return runLog.fetch("https://run-log.local/stream");
});

app.get("/internal/runs/:id", async (context) => {
  const runLog = await getAgentByName(context.env.RunLog, context.req.param("id"));
  const response = await runLog.fetch("https://run-log.local/stream");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream",
    },
  });
});

export default app;

function streamRunText(runId: string, env: Env) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      try {
        const runLog = await getAgentByName(env.RunLog, runId);
        const response = await runLog.fetch("https://run-log.local/stream");

        if (!response.ok) {
          write(`Run stream failed: ${response.status} ${response.statusText}\n`);
        } else {
          for await (const event of readServerSentEvents(response.body)) {
            if (event.event === "close") {
              break;
            }

            for (const line of splitLines(event.data)) {
              write(`${line}\n`);
            }
          }
        }
      } catch (error) {
        write(`Run stream failed: ${getErrorMessage(error)}\n`);
      }

      controller.close();
    },
  });
}

function splitLines(value: string) {
  return value.split(/\r?\n/).filter(Boolean);
}

async function* readServerSentEvents(body: ReadableStream<Uint8Array> | null) {
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      yield parseServerSentEvent(part);
    }

    if (done) {
      if (buffer) {
        yield parseServerSentEvent(buffer);
      }

      break;
    }
  }
}

function parseServerSentEvent(value: string) {
  const event = { event: "message", data: "" };

  for (const line of value.split("\n")) {
    if (line.startsWith("event: ")) {
      event.event = line.slice("event: ".length);
    }

    if (line.startsWith("data: ")) {
      event.data += `${line.slice("data: ".length)}\n`;
    }
  }

  event.data = event.data.trimEnd();
  return event;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
