const DEFAULT_NAMESPACE = "production";
const GIT_BASE_URL = "https://git.localhost";

type RepoCredentials = {
  remote: string | undefined;
  token: string;
};

export function createRepoSetup(name: string, repo: RepoCredentials) {
  return {
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
  };
}
