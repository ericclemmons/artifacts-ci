import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import {
  cleanRepoName,
  encodeSideBandProgress,
  insertBeforeFlush,
  wantsSideBand,
} from "./git-protocol";

const DEFAULT_NAMESPACE = "production";
const CI_BASE_URL = "https://ci.localhost";

type DeployParams = {
  namespace: string;
  repo: string;
  pushedAt: string;
};

export class DeployWorkflow extends WorkflowEntrypoint<Env, DeployParams> {
  async run(event: WorkflowEvent<DeployParams>, step: WorkflowStep) {
    return step.do("record accepted push", async () => ({
      ...event.payload,
      status: "accepted",
      message: "Sandbox deploy pipeline will run in the next phase.",
    }));
  }
}

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
    const upstream = getUpstream(request.headers, route.namespace, repoName);

    if (!upstream.ok) {
      return new Response(upstream.message, { status: upstream.status });
    }

    const upstreamUrl = new URL(upstream.remote + route.suffix);
    upstreamUrl.search = url.search;

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: withArtifactsAuth(request.headers, upstream.token),
      body,
      redirect: "manual",
    });

    if (route.suffix === "/git-receive-pack" && request.method === "POST") {
      return withPushProgress(
        env,
        upstreamResponse,
        { ...route, repo: repoName },
        supportsSideBand,
      );
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

function withArtifactsAuth(headers: Headers, token: string) {
  const next = new Headers(headers);

  next.set("Authorization", `Bearer ${token}`);
  next.delete("X-Artifacts-Remote");
  next.delete("Host");
  next.delete("Content-Length");

  return next;
}

function getBearerToken(headers: Headers) {
  const authorization = headers.get("Authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function getUpstream(headers: Headers, namespace: string, repoName: string) {
  const token = getBearerToken(headers);
  const remote = headers.get("X-Artifacts-Remote") ?? undefined;

  if (!token) {
    return {
      ok: false as const,
      status: 401,
      message: "Missing Artifacts token. Run the setup command from https://ci.localhost first.\n",
    };
  }

  if (!isExpectedRemote(remote, namespace, repoName)) {
    return {
      ok: false as const,
      status: 400,
      message:
        "Missing or invalid X-Artifacts-Remote header. Run the setup command from https://ci.localhost first.\n",
    };
  }

  return { ok: true as const, remote, token };
}

function isExpectedRemote(remote: string | undefined, namespace: string, repoName: string) {
  if (!remote?.startsWith("https://")) {
    return false;
  }

  try {
    const url = new URL(remote);
    return url.pathname === `/git/${namespace}/${repoName}.git`;
  } catch {
    return false;
  }
}

async function withPushProgress(
  env: Env,
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

  const runId = crypto.randomUUID();
  await env.DEPLOY_WORKFLOW.create({
    id: runId,
    params: {
      namespace: route.namespace,
      repo: route.repo,
      pushedAt: new Date().toISOString(),
    },
  });

  const progress = encodeSideBandProgress([
    "Cloudflare CI accepted push",
    `repo ${route.namespace}/${route.repo}`,
    `run ${CI_BASE_URL}/runs/${runId}`,
    "next: workflow trigger",
  ]);

  return new Response(insertBeforeFlush(body, progress), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
