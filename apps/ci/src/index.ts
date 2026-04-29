import { Hono } from "hono";
import { cleanRepoName } from "./utils/cleanRepoName";
import { createRepoSetup, createRepoSetupScript } from "./utils/createRepoSetup";
import { ensureRepo } from "./utils/ensureRepo";

const app = new Hono<{ Bindings: Env }>();

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

export default app;
