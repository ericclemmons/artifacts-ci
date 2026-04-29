import { encodeSideBandProgress, insertBeforeFlush } from "./gitProtocol";

const CI_BASE_URL = "https://ci.localhost";

export async function withPushProgress(
  env: Env,
  response: Response,
  route: { namespace: string; repo: string; remote: string; token: string },
  supportsSideBand: boolean,
) {
  const headers = new Headers(response.headers);
  const body = new Uint8Array(await response.arrayBuffer());

  headers.delete("Content-Length");

  if (!response.ok || !supportsSideBand) {
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
      artifactsRemote: route.remote,
      artifactsToken: route.token,
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
