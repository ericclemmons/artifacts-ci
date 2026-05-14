import { env } from "cloudflare:workers";

const DEFAULT_BRANCH = "main";
const REPO_REMOTE_PREFIX = "remote:";

export async function ensureRepo(repoName: string) {
  let repo: ArtifactsRepo;

  try {
    repo = await env.Artifacts.get(repoName);
  } catch (error) {
    try {
      const created = await env.Artifacts.create(repoName, {
        setDefaultBranch: DEFAULT_BRANCH,
      });

      await putRepoRemote(repoName, created.remote);

      return { remote: created.remote, token: created.token };
    } catch {
      throw error;
    }
  }

  const token = await repo.createToken("write");
  const remote = await getRepoRemote(repoName, repo.remote);

  return { remote: remote ?? undefined, token: token.plaintext };
}

async function getRepoRemote(repoName: string, remote: unknown) {
  if (typeof remote === "string") {
    await putRepoRemote(repoName, remote);
    return remote;
  }

  const storedRemote = await env.RepoRemotes.get(repoRemoteKey(repoName));

  if (storedRemote) {
    return storedRemote;
  }

  const probeName = `remote-probe-${crypto.randomUUID()}`;
  const created = await env.Artifacts.create(probeName, { setDefaultBranch: DEFAULT_BRANCH });

  try {
    const probeRemote = created.remote.replace(`${probeName}.git`, `${repoName}.git`);
    await putRepoRemote(repoName, probeRemote);
    return probeRemote;
  } finally {
    await env.Artifacts.delete(probeName);
  }
}

async function putRepoRemote(repoName: string, remote: string) {
  await env.RepoRemotes.put(repoRemoteKey(repoName), remote);
}

function repoRemoteKey(repoName: string) {
  return `${REPO_REMOTE_PREFIX}${repoName}`;
}
