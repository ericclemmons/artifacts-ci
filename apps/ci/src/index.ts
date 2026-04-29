import { Hono } from "hono";

const DEFAULT_BRANCH = "main";
const DEFAULT_NAMESPACE = "production";
const GIT_BASE_URL = "https://git.localhost";
const remoteByRepo = new Map<string, string>();

const app = new Hono<{ Bindings: Env }>();

app.get("/", (context) => context.text("POST /repos { name } to create setup commands.\n"));

app.post("/repos", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { name?: string };
  const name = cleanRepoName(body.name ?? context.req.query("name") ?? "demo");
  const repo = await ensureRepo(context.env, name);

  return context.json({
    namespace: DEFAULT_NAMESPACE,
    repo: name,
    artifactsRemote: repo.remote,
    artifactsToken: repo.token,
    cloudflareRemote: `${GIT_BASE_URL}/${DEFAULT_NAMESPACE}/${name}.git`,
    commands: [
      `git remote add cloudflare ${GIT_BASE_URL}/${DEFAULT_NAMESPACE}/${name}.git`,
      `git config --local --add http.${GIT_BASE_URL}/.extraHeader "Authorization: Bearer ${repo.token}"`,
      `git config --local --add http.${GIT_BASE_URL}/.extraHeader "X-Artifacts-Remote: ${repo.remote}"`,
      "git config --local remote.cloudflare.push HEAD",
      "git push cloudflare",
    ],
  });
});

export default app;

async function ensureRepo(env: Env, repoName: string) {
  try {
    const repo = await env.ARTIFACTS.get(repoName);
    const token = await repo.createToken("write");
    const remote = repo.remote ?? remoteByRepo.get(repoName);

    if (remote) {
      remoteByRepo.set(repoName, remote);
    }

    return { remote, token: token.plaintext };
  } catch (error) {
    try {
      const created = await env.ARTIFACTS.create(repoName, {
        setDefaultBranch: DEFAULT_BRANCH,
      });

      remoteByRepo.set(repoName, created.remote);

      return { remote: created.remote, token: created.token };
    } catch {
      throw error;
    }
  }
}

function cleanRepoName(value: string) {
  const name = value.trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(
      "Repo names must start with a letter or digit and contain only letters, digits, '.', '_', or '-'.",
    );
  }

  return name;
}
