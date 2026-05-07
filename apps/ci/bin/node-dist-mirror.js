/**
 * Local HTTP mirror for Node.js distribution files used by Vite+.
 *
 * Why this exists:
 * - `artifacts-ci-act` runs GitHub Actions in a nested Docker container.
 * - Some corporate TLS interception setups require a local root CA.
 * - Most tools honor the CA bundle env vars passed by `artifacts-ci-act`.
 * - Vite+'s native Node downloader appears to use a TLS path that does not.
 *
 * This server keeps TLS at the Sandbox container layer, where the CA bundle is
 * installed, and exposes `nodejs.org/dist` to the nested job container over
 * local HTTP. This should be removable if Vite+'s downloader starts honoring
 * system/explicit CA bundles in intercepted-TLS environments.
 */
const http = require("node:http");
const https = require("node:https");

const host = process.env.NODE_DIST_MIRROR_HOST ?? "127.0.0.1";
const port = Number(process.env.NODE_DIST_MIRROR_PORT ?? 18080);

const server = http.createServer((request, response) => {
  /**
   * `VP_NODE_DIST_MIRROR` points Vite+ at `/dist` on this server.
   * Forward the request path as-is to nodejs.org so URLs stay compatible.
   */
  const upstream = https.request(
    {
      hostname: "nodejs.org",
      path: request.url,
      method: request.method,
      headers: { "user-agent": "artifacts-ci-node-dist-mirror" },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    response.writeHead(502, { "content-type": "text/plain" });
    response.end(error.stack ?? error.message);
  });

  request.pipe(upstream);
});

server.listen(port, host);
