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

export function createRepoSetupScript(name: string, repo: RepoCredentials) {
  const cloudflareRemote = `${GIT_BASE_URL}/${DEFAULT_NAMESPACE}/${name}.git`;

  if (!repo.remote) {
    return [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `echo ${quoteShell(`Artifacts remote is unavailable for ${DEFAULT_NAMESPACE}/${name}.`)} >&2`,
      "exit 1",
      "",
    ].join("\n");
  }

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    `git remote remove cloudflare >/dev/null 2>&1 || true`,
    `git remote add cloudflare ${quoteShell(cloudflareRemote)}`,
    `git config --local --replace-all http.${GIT_BASE_URL}/.extraHeader ${quoteShell(`Authorization: Bearer ${repo.token}`)}`,
    `git config --local --add http.${GIT_BASE_URL}/.extraHeader ${quoteShell(`X-Artifacts-Remote: ${repo.remote}`)}`,
    `git config --local remote.cloudflare.push HEAD`,
    "",
    `echo ${quoteShell(`Configured cloudflare remote for ${DEFAULT_NAMESPACE}/${name}.`)}`,
    `echo ${quoteShell("Run: git push cloudflare")}`,
    "",
  ].join("\n");
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
