export type GitRoute = {
  namespace: string;
  repo: string;
  suffix: string;
};

export function parseGitRoute(pathname: string): GitRoute | null {
  const match = pathname.match(/^\/([^/]+)\/(.+?\.git)(\/.*)?$/);

  if (!match) {
    return null;
  }

  const [, namespace, repoWithSuffix, suffix = ""] = match;

  return {
    namespace,
    repo: repoWithSuffix.slice(0, -".git".length),
    suffix,
  };
}

export function isGitServiceRoute(request: Request, url: URL, suffix: string) {
  if (request.method === "GET" && suffix === "/info/refs") {
    const service = url.searchParams.get("service");
    return service === "git-receive-pack" || service === "git-upload-pack";
  }

  if (request.method === "POST") {
    return suffix === "/git-receive-pack" || suffix === "/git-upload-pack";
  }

  return false;
}
