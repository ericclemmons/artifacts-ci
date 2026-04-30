import { ContainerProxy, Sandbox as BaseSandbox } from "@cloudflare/sandbox";
import { env } from "cloudflare:workers";
import { proxyCloudflareApiRequest } from "./utils/proxyCloudflareApiRequest";

export { ContainerProxy };

type ArtifactsGitParams = {
  remote: string;
  token: string;
};

export class Sandbox extends BaseSandbox<Env> {
  enableInternet = true;
}

Sandbox.outboundByHost = {
  "api.cloudflare.com": (request: Request) => proxyCloudflareApiRequest(request),
  "artifacts.sandbox": (request: Request, env: Env) => proxyArtifactsRequest(request, env),
  "cloudflare-api.sandbox": (request: Request) => proxyCloudflareApiRequest(request),
};

export async function putArtifactsGitParams(
  namespace: string,
  repo: string,
  params: ArtifactsGitParams,
) {
  await env.REPO_TOKENS.put(checkoutKey(namespace, repo), JSON.stringify(params), {
    expirationTtl: 60,
  });
}

export async function deleteArtifactsGitParams(namespace: string, repo: string) {
  await env.REPO_TOKENS.delete(checkoutKey(namespace, repo));
}

async function proxyArtifactsRequest(request: Request, env: Env) {
  const sourceUrl = new URL(request.url);
  const route = parseCheckoutPath(sourceUrl.pathname);

  if (!route) {
    return new Response("Unsupported Artifacts checkout path.\n", { status: 404 });
  }

  const params = await getArtifactsGitParams(env.REPO_TOKENS, route.namespace, route.repo);
  const upstreamUrl = new URL(params.remote + route.suffix);
  upstreamUrl.search = sourceUrl.search;

  const upstreamRequest = new Request(upstreamUrl, request);
  upstreamRequest.headers.set("Authorization", `Bearer ${params.token}`);
  upstreamRequest.headers.delete("Host");
  upstreamRequest.headers.delete("Content-Length");

  return fetch(upstreamRequest, { redirect: "manual" });
}

async function getArtifactsGitParams(kv: KVNamespace, namespace: string, repo: string) {
  const params = await kv.get<ArtifactsGitParams>(checkoutKey(namespace, repo), "json");

  if (params) {
    return params;
  }

  throw new Error("Missing Artifacts outbound parameters");
}

function parseCheckoutPath(pathname: string) {
  const match = pathname.match(/^\/([^/]+)\/([^/]+\.git)(\/.*)?$/);

  if (!match) {
    return null;
  }

  return {
    namespace: match[1],
    repo: match[2].slice(0, -".git".length),
    suffix: match[3] ?? "",
  };
}

function checkoutKey(namespace: string, repo: string) {
  return `${namespace}/${repo}`;
}
