import { env } from "cloudflare:workers";

const DEFAULT_BRANCH = "main";

const remoteByRepo = new Map<string, string>();

export async function ensureRepo(repoName: string) {
  try {
    const repo = await env.ARTIFACTS.get(repoName);
    const token = await repo.createToken("write");
    const remote =
      (await (repo.remote as unknown as Promise<string | undefined>)) ?? remoteByRepo.get(repoName);

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
