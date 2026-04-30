import { Hono } from "hono";
import { cleanRepoName } from "./utils/cleanRepoName";
import { createRepoSetup, createRepoSetupScript } from "./utils/createRepoSetup";
import { ensureRepo } from "./utils/ensureRepo";

const app = new Hono<{ Bindings: Env }>();
const GIT_BASE_URL = "https://git.localhost";

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

  return new Response(renderRunPage(runId), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
});

app.get("/runs/:id/stream", async (context) => {
  const runId = encodeURIComponent(context.req.param("id"));
  const response = await fetch(`${GIT_BASE_URL}/runs/${runId}/stream`, {
    headers: { Accept: "text/event-stream" },
  });

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

function renderRunPage(runId: string) {
  const safeRunId = escapeHtml(runId);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Run ${safeRunId}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family:
          ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
        background: #070b12;
        color: #d7e2f0;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgb(29 78 216 / 0.24), transparent 34rem),
          #070b12;
      }

      main {
        box-sizing: border-box;
        width: min(100%, 72rem);
        margin: 0 auto;
        padding: 2rem 1rem;
      }

      header {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1rem;
        align-items: end;
        justify-content: space-between;
        margin-bottom: 1rem;
      }

      h1 {
        margin: 0;
        color: #f8fafc;
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: clamp(1.5rem, 5vw, 2.75rem);
        letter-spacing: -0.04em;
      }

      .meta {
        margin-top: 0.35rem;
        color: #8da2bd;
        font-size: 0.8125rem;
        word-break: break-all;
      }

      .status {
        border: 1px solid rgb(148 163 184 / 0.22);
        border-radius: 999px;
        padding: 0.4rem 0.65rem;
        background: rgb(15 23 42 / 0.72);
        color: #93c5fd;
        font-size: 0.8125rem;
      }

      #log {
        min-height: 24rem;
        margin: 0;
        overflow: auto;
        border: 1px solid rgb(148 163 184 / 0.18);
        border-radius: 1rem;
        padding: 0.9rem 0;
        background:
          linear-gradient(180deg, rgb(15 23 42 / 0.72), rgb(2 6 23 / 0.92)),
          rgb(2 6 23);
        box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 0.35);
        color: #dbeafe;
        font-size: 0.875rem;
        line-height: 1.5;
        white-space: pre;
      }

      .empty {
        color: #64748b;
      }

      .done {
        color: #86efac;
      }

      .error {
        color: #fca5a5;
      }

      .line {
        display: block;
        padding: 0 1rem;
      }

      .line:hover {
        background: rgb(148 163 184 / 0.08);
      }

      .step {
        margin: 0.6rem 0 0.25rem;
        padding-block: 0.35rem;
        background: rgb(37 99 235 / 0.12);
        color: #bfdbfe;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .meta-line {
        color: #93c5fd;
      }

      .muted-line {
        color: #7c8da5;
      }

      .success-line {
        color: #bbf7d0;
      }

      .error-line {
        color: #fecaca;
      }

      a {
        color: #bae6fd;
        text-decoration: underline;
        text-decoration-color: rgb(186 230 253 / 0.35);
        text-underline-offset: 0.2em;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Cloudflare CI Run</h1>
          <div class="meta">${safeRunId}</div>
        </div>
        <div class="status">server stream</div>
      </header>
      <pre id="log">`);

      try {
        const response = await fetch(`${GIT_BASE_URL}/runs/${encodeURIComponent(runId)}/stream`, {
          headers: { Accept: "text/event-stream" },
        });

        if (!response.ok) {
          write(
            `<span class="error">Run stream failed: ${response.status} ${escapeHtml(response.statusText)}</span>\n`,
          );
        } else {
          let wroteLog = false;

          for await (const event of readServerSentEvents(response.body)) {
            if (event.event === "close") {
              break;
            }

            for (const line of splitLines(event.data)) {
              wroteLog = true;
              write(renderLogLine(line));
            }
          }

          if (!wroteLog) {
            write(`<span class="empty">No logs received.</span>\n`);
          }

          write(`<span class="line done">Run stream closed.</span>\n`);
        }
      } catch (error) {
        write(
          `<span class="error">Run stream failed: ${escapeHtml(getErrorMessage(error))}</span>\n`,
        );
      }

      write(`</pre>
    </main>
  </body>
</html>`);
      controller.close();
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderLogLine(value: string) {
  const line = stripAnsi(value);
  const classes = ["line", getLineClass(line)].filter(Boolean).join(" ");
  return `<span class="${classes}">${linkify(escapeHtml(line))}</span>\n`;
}

function getLineClass(line: string) {
  if (line.startsWith("$ ")) {
    return "step";
  }

  if (line.includes(" failed") || line.includes("failed:")) {
    return "error-line";
  }

  if (line.endsWith(" completed") || line === "Cloudflare CI accepted push") {
    return "success-line";
  }

  if (
    line.startsWith("repo ") ||
    line.startsWith("commit ") ||
    line.startsWith("run ") ||
    line.startsWith("artifacts remote ") ||
    line === "workflow trigger accepted"
  ) {
    return "meta-line";
  }

  if (line.startsWith("npm http fetch") || line.startsWith("npm info ")) {
    return "muted-line";
  }

  return "";
}

function linkify(value: string) {
  return value.replace(
    /https:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" rel="noreferrer">${url}</a>`,
  );
}

function splitLines(value: string) {
  return value.split(/\r?\n/).filter(Boolean);
}

function stripAnsi(value: string) {
  return value.replace(ansiPattern, "");
}

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

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
