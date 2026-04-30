import { getUpstream, withArtifactsAuth } from "./utils/artifactsProxy";
import { cleanRepoName } from "./utils/cleanRepoName";
import { isGitServiceRoute, parseGitRoute } from "./utils/gitRoute";
import { wantsSideBand } from "./utils/gitProtocol";
import { getRequestBody } from "./utils/getRequestBody";
import { withPushProgress } from "./utils/withPushProgress";

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
        upstreamResponse,
        { ...route, repo: repoName, remote: upstream.remote, token: upstream.token },
        supportsSideBand,
        body,
        env.CI,
      );
    }

    return upstreamResponse;
  },
} satisfies ExportedHandler<Env>;
