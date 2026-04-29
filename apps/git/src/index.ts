import {
  cleanRepoName,
  encodeSideBandProgress,
  insertBeforeFlush,
  wantsSideBand,
} from "./git-protocol";

const DEFAULT_BRANCH = "main";
const DEFAULT_NAMESPACE = "production";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = parseGitRoute(url.pathname);

    if (!route) {
      return new Response("Use /production/<repo>.git as a Git remote.\n", {
        status: 404,
      });
    }

    if (route.namespace !== DEFAULT_NAMESPACE) {
      return new Response(`Unknown namespace: ${route.namespace}\n`, { status: 404 });
    }

    const repoName = cleanRepoName(route.repo);

    if (!isGitServiceRoute(request, url, route.suffix)) {
      return new Response("Unsupported Git endpoint.\n", { status: 404 });
    }

    const body = await getRequestBody(request);
    const supportsSideBand =
      route.suffix === "/git-receive-pack" && request.method === "POST" && wantsSideBand(body);
    const credentials = await ensureRepo(env, repoName);
    const token = getBearerToken(request.headers) ?? credentials.token;
    const upstreamUrl = new URL(credentials.remote + route.suffix);
    upstreamUrl.search = url.search;

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: withArtifactsAuth(request.headers, token),
      body,
      redirect: "manual",
    });

    if (route.suffix === "/git-receive-pack" && request.method === "POST") {
      return withPushProgress(upstreamResponse, { ...route, repo: repoName }, supportsSideBand);
    }

    return upstreamResponse;
  },
} satisfies ExportedHandler<Env>;

function parseGitRoute(pathname: string) {
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

function isGitServiceRoute(request: Request, url: URL, suffix: string) {
  if (request.method === "GET" && suffix === "/info/refs") {
    const service = url.searchParams.get("service");
    return service === "git-receive-pack" || service === "git-upload-pack";
  }

  if (request.method === "POST") {
    return suffix === "/git-receive-pack" || suffix === "/git-upload-pack";
  }

  return false;
}

async function getRequestBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  return request.arrayBuffer();
}

async function ensureRepo(env: Env, repoName: string) {
  try {
    const repo = await env.ARTIFACTS.get(repoName);
    const token = await repo.createToken("write");
    return { remote: repo.remote, token: token.plaintext };
  } catch (error) {
    try {
      const created = await env.ARTIFACTS.create(repoName, {
        setDefaultBranch: DEFAULT_BRANCH,
      });

      return { remote: created.remote, token: created.token };
    } catch {
      throw error;
    }
  }
}

function withArtifactsAuth(headers: Headers, token: string) {
  const next = new Headers(headers);

  next.set("Authorization", `Bearer ${token}`);
  next.delete("Host");
  next.delete("Content-Length");

  return next;
}

function getBearerToken(headers: Headers) {
  const authorization = headers.get("Authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function withPushProgress(
  response: Response,
  route: { namespace: string; repo: string },
  supportsSideBand: boolean,
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

  if (!supportsSideBand) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const progress = encodeSideBandProgress([
    "Cloudflare CI accepted push",
    `repo ${route.namespace}/${route.repo}`,
    `run https://ci.localhost/runs/${crypto.randomUUID()}`,
    "next: workflow trigger",
  ]);

  return new Response(insertBeforeFlush(body, progress), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
