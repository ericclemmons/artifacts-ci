import { env } from "cloudflare:workers";

export const envPlaceholders = {
  CLOUDFLARE_ACCOUNT_ID: "$$CLOUDFLARE_ACCOUNT_ID$$",
  CLOUDFLARE_API_TOKEN: "$$CLOUDFLARE_API_TOKEN$$",
};

export function proxyCloudflareApiRequest(request: Request) {
  const upstreamUrl = new URL(request.url);
  upstreamUrl.protocol = "https:";
  upstreamUrl.hostname = "api.cloudflare.com";
  upstreamUrl.pathname = upstreamUrl.pathname.replaceAll(
    envPlaceholders.CLOUDFLARE_ACCOUNT_ID,
    env.CLOUDFLARE_ACCOUNT_ID,
  );

  const upstreamRequest = new Request(upstreamUrl, request);
  const authorization = upstreamRequest.headers.get("Authorization");

  if (!authorization || authorization === `Bearer ${envPlaceholders.CLOUDFLARE_API_TOKEN}`) {
    upstreamRequest.headers.set("Authorization", `Bearer ${cleanSecret(env.CLOUDFLARE_API_TOKEN)}`);
  }

  upstreamRequest.headers.delete("Host");
  upstreamRequest.headers.delete("X-Auth-Email");
  upstreamRequest.headers.delete("X-Auth-Key");
  upstreamRequest.headers.delete("X-Auth-User-Service-Key");

  return fetch(upstreamRequest);
}

function cleanSecret(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}
