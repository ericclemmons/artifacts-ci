export const envPlaceholders = {
  CLOUDFLARE_ACCOUNT_ID: "$$CLOUDFLARE_ACCOUNT_ID$$",
  CLOUDFLARE_API_TOKEN: "$$CLOUDFLARE_API_TOKEN$$",
};

export function proxyCloudflareApiRequest(request: Request, env: Env) {
  const accountId = cleanSecret(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = cleanSecret(env.CLOUDFLARE_API_TOKEN);

  if (!accountId || !apiToken) {
    throw new Error("Missing Cloudflare deploy credentials");
  }

  const upstreamUrl = new URL(request.url);
  upstreamUrl.protocol = "https:";
  upstreamUrl.hostname = "api.cloudflare.com";
  upstreamUrl.pathname = upstreamUrl.pathname
    .replaceAll(envPlaceholders.CLOUDFLARE_ACCOUNT_ID, accountId)
    .replaceAll(encodeURIComponent(envPlaceholders.CLOUDFLARE_ACCOUNT_ID), accountId);

  if (upstreamUrl.pathname.includes(envPlaceholders.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error("Cloudflare account placeholder was not replaced");
  }

  const upstreamRequest = new Request(upstreamUrl, request);
  const authorization = upstreamRequest.headers.get("Authorization");

  if (!authorization || authorization === `Bearer ${envPlaceholders.CLOUDFLARE_API_TOKEN}`) {
    upstreamRequest.headers.set("Authorization", `Bearer ${apiToken}`);
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
