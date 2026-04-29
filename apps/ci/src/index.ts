import { Hono } from "hono";
import { cleanRepoName } from "./utils/cleanRepoName";
import { createRepoSetup } from "./utils/createRepoSetup";
import { ensureRepo } from "./utils/ensureRepo";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (context) => context.text("POST /repos { name } to create setup commands.\n"));

app.post("/repos", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { name?: string };
  const name = cleanRepoName(body.name ?? context.req.query("name") ?? "demo");
  const repo = await ensureRepo(name);

  return context.json(createRepoSetup(name, repo));
});

export default app;
