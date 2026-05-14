export { ArtifactsWorkflow } from "./DeployWorkflow";
export { RunLog } from "./RunLog";
export { ContainerProxy, Sandbox } from "./Sandbox";
export { ProjectAgent } from "./slip-plane/ProjectAgent";
export { SchedulerAgent } from "./slip-plane/SchedulerAgent";
export { PagesWorkflow } from "./slip-plane/PagesWorkflow";
export { WorkersBuildsWorkflow } from "./slip-plane/WorkersBuildsWorkflow";

import { getAgentByName } from "agents";
import { agentsMiddleware } from "hono-agents";
import { Hono } from "hono";
import { cleanRepoName } from "./utils/cleanRepoName";
import { createRepoSetup, createRepoSetupScript } from "./utils/createRepoSetup";
import { ensureRepo } from "./utils/ensureRepo";
import {
  ArtifactsBuildEvent,
  PagesBuildEvent,
  validateBuildEvent,
  WorkersBuildEvent,
  type QueuedBuildEvent,
} from "./utils/buildEvent";
import { appendRunLog, resetRunLog } from "./utils/runLog";
import { readServerSentEvents, splitLines } from "./utils/serverSentEvents";

const app = new Hono<{ Bindings: Env }>();
const CI_BASE_URL = "http://ci.localhost:8787";

type CreateRunRequest = {
  namespace?: string;
  repo?: string;
  artifactsRemote?: string;
  artifactsToken?: string;
  commitSha?: string | null;
  pushedAt?: string;
};

app.use("/agents/*", agentsMiddleware());

app.get("/", (context) => {
  const { origin } = new URL(context.req.url);
  return context.text(`Artifacts CI

Create a repository setup script:
  curl -fsSL "${origin}/repos/demo.sh"

Create setup commands as JSON:
  curl -sS -X POST "${origin}/repos" \\
    -H 'content-type: application/json' \\
    -d '{"name":"demo"}'

Use Agent RPC for the slip-plane demo:
  agent: ProjectAgent
  name: demo-account:demo-project
  method: enqueuePagesBuild({ accountId: "<account>", projectName: "<project>", deploymentId: "<deployment>" })

Set demo scheduler capacity:
  agent: SchedulerAgent
  name: free
  method: setCapacity(1)

Run logs:
  ${origin}/runs/<run-id>
`);
});

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

  const runId = crypto.randomUUID();
  const workflowId = `${runId}-${crypto.randomUUID()}`;
  const runUrl = `${CI_BASE_URL}/runs/${runId}`;

  await resetRunLog(runId);
  await appendRunLog(runId, `📦 ${namespace}/${repo}`);
  await appendRunLog(runId, `🗒️ commit ${body.commitSha ?? "unknown"}`);
  await appendRunLog(runId, `🌐 ${runUrl}`);

  await context.env.DeployWorkflow.create({
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

export default {
  fetch: app.fetch,
  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        const event = validateBuildEvent(msg.body);
        const projectId = event.product === "pages" ? event.projectName : event.projectId;

        const project = await getAgentByName(env.ProjectAgent, `${event.accountId}:${projectId}`);
        if (PagesBuildEvent.allows(event)) await project.enqueuePagesBuild(event);
        if (WorkersBuildEvent.allows(event)) await project.enqueueWorkersBuild(event);
        if (ArtifactsBuildEvent.allows(event)) await project.enqueueArtifactsBuild(event);
        msg.ack();
      } catch (error) {
        console.error("build ingress failed", error);
        throw error;
      }
    }
  },
} satisfies ExportedHandler<Env, QueuedBuildEvent>;

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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
