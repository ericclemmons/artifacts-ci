import { env } from "cloudflare:workers";
import { encodeSideBandProgress } from "./gitProtocol";
import { appendRunLog, getRunLog } from "./runLog";

const CI_BASE_URL = "https://ci.localhost";
const PUSH_STREAM_TIMEOUT_MS = 15 * 60 * 1000;

export async function withPushProgress(
  response: Response,
  route: { namespace: string; repo: string; remote: string; token: string },
  supportsSideBand: boolean,
) {
  const headers = new Headers(response.headers);
  const body = new Uint8Array(await response.arrayBuffer());

  headers.delete("Content-Length");

  if (!response.ok) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const runId = crypto.randomUUID();
  await appendRunLog(runId, "Cloudflare CI accepted push");
  await appendRunLog(runId, `repo ${route.namespace}/${route.repo}`);
  await appendRunLog(runId, `run ${CI_BASE_URL}/runs/${runId}`);

  await env.DEPLOY_WORKFLOW.create({
    id: runId,
    params: {
      runId,
      namespace: route.namespace,
      repo: route.repo,
      artifactsRemote: route.remote,
      artifactsToken: route.token,
      pushedAt: new Date().toISOString(),
    },
  });
  await appendRunLog(runId, "workflow trigger accepted");

  if (!supportsSideBand) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return new Response(streamPushProgress(runId, body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function streamPushProgress(runId: string, gitStatus: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const finish = () => {
        if (closed) {
          return;
        }

        closed = true;
        controller.enqueue(gitStatus);
        controller.close();
      };

      const timeout = setTimeout(() => {
        if (!closed) {
          controller.enqueue(encodeSideBandProgress(["Cloudflare CI stream timed out"]));
          finish();
        }
      }, PUSH_STREAM_TIMEOUT_MS);

      try {
        const response = await getRunLog(runId).fetch("https://run-log.local/stream");

        for await (const event of readServerSentEvents(response.body)) {
          if (event.event === "close") {
            break;
          }

          for (const line of splitLines(event.data)) {
            if (closed) {
              break;
            }

            controller.enqueue(encodeSideBandProgress([line]));
          }
        }

        clearTimeout(timeout);
        finish();
      } catch (error) {
        clearTimeout(timeout);
        if (!closed) {
          controller.enqueue(
            encodeSideBandProgress([`Cloudflare CI stream failed: ${getErrorMessage(error)}`]),
          );
          finish();
        }
      }
    },
  });
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

function splitLines(value: string) {
  return value.split(/\r?\n/).filter(Boolean);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
