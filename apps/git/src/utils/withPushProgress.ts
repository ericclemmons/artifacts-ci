import { encodeSideBandProgress, getPushedCommitSha } from "./gitProtocol";

const PUSH_STREAM_TIMEOUT_MS = 15 * 60 * 1000;

export async function withPushProgress(
  response: Response,
  route: { namespace: string; repo: string; remote: string; token: string },
  supportsSideBand: boolean,
  requestBody: ArrayBuffer | undefined,
  ci: Fetcher,
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

  const commitSha = getPushedCommitSha(requestBody);
  const run = await createRun(ci, {
    namespace: route.namespace,
    repo: route.repo,
    artifactsRemote: route.remote,
    artifactsToken: route.token,
    commitSha,
    pushedAt: new Date().toISOString(),
  });

  if (!supportsSideBand) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return new Response(streamPushProgress(ci, run.runId, body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function createRun(
  ci: Fetcher,
  params: {
    namespace: string;
    repo: string;
    artifactsRemote: string;
    artifactsToken: string;
    commitSha: string | null;
    pushedAt: string;
  },
) {
  const response = await ci.fetch("https://ci.internal/internal/runs", {
    method: "POST",
    body: JSON.stringify(params),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`CI run creation failed: ${response.status} ${await response.text()}`);
  }

  return response.json<{ runId: string; runUrl: string }>();
}

function streamPushProgress(ci: Fetcher, runId: string, gitStatus: Uint8Array) {
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
          controller.enqueue(
            encodeSideBandProgress([formatPushLine("Cloudflare CI stream timed out")]),
          );
          finish();
        }
      }, PUSH_STREAM_TIMEOUT_MS);

      try {
        const response = await ci.fetch(`https://ci.internal/internal/runs/${runId}/stream`);

        for await (const event of readServerSentEvents(response.body)) {
          if (event.event === "close") {
            break;
          }

          for (const line of splitLines(event.data)) {
            if (closed) {
              break;
            }

            controller.enqueue(encodeSideBandProgress([formatPushLine(line)]));
          }
        }

        clearTimeout(timeout);
        finish();
      } catch (error) {
        clearTimeout(timeout);
        if (!closed) {
          controller.enqueue(
            encodeSideBandProgress([
              formatPushLine(`Cloudflare CI stream failed: ${getErrorMessage(error)}`),
            ]),
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

function formatPushLine(line: string) {
  if (line.startsWith("$ ")) {
    return `${ansi.bold}${ansi.blue}${line}${ansi.reset}`;
  }

  if (line.includes(" failed") || line.includes("failed:")) {
    return `${ansi.bold}${ansi.red}${line}${ansi.reset}`;
  }

  if (line.endsWith(" completed") || line === "Cloudflare CI accepted push") {
    return `${ansi.green}${line}${ansi.reset}`;
  }

  if (line.startsWith("run https://")) {
    return `${ansi.cyan}${line}${ansi.reset}`;
  }

  if (
    line.startsWith("repo ") ||
    line.startsWith("commit ") ||
    line.startsWith("artifacts remote ") ||
    line === "workflow trigger accepted"
  ) {
    return `${ansi.dim}${line}${ansi.reset}`;
  }

  if (line.startsWith("npm http fetch") || line.startsWith("npm info ")) {
    return `${ansi.dim}${line}${ansi.reset}`;
  }

  return line;
}

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
