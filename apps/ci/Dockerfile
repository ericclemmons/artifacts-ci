# syntax=docker/dockerfile:1.7
# Docker-in-Docker Sandbox image based on Cloudflare's guide:
# https://developers.cloudflare.com/sandbox/guides/docker-in-docker/#create-a-docker-enabled-image
# Tracking local/prod DinD findings in:
# https://github.com/cloudflare/sandbox-sdk/issues/662
FROM docker:dind-rootless

USER root

COPY --from=docker.io/cloudflare/sandbox:0.9.2-musl /container-server/sandbox /sandbox
COPY --from=docker.io/cloudflare/sandbox:0.9.2-musl /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=docker.io/cloudflare/sandbox:0.9.2-musl /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=docker.io/cloudflare/sandbox:0.9.2-musl /bin/bash /bin/bash
COPY --from=docker.io/cloudflare/sandbox:0.9.2-musl /usr/lib/libreadline.so.8 /usr/lib/libreadline.so.8
COPY --from=docker.io/cloudflare/sandbox:0.9.2-musl /usr/lib/libreadline.so.8.2 /usr/lib/libreadline.so.8.2

# Optional local-only CA hook for environments that intercept TLS.
# This covers corporate WARP/Gateway-style setups.
# The source file lives in ignored .wrangler state.
# The source file is absent for normal external contributors.
RUN --mount=type=bind,source=.,target=/build-context \
  if [ -f /build-context/.wrangler/docker-extra-ca.crt ]; then \
    awk 'BEGIN { n = 0 } /-----BEGIN CERTIFICATE-----/ { n++ } n > 0 { print > sprintf("/usr/local/share/ca-certificates/docker-extra-%03d.crt", n) }' /build-context/.wrangler/docker-extra-ca.crt && \
    update-ca-certificates; \
  fi

RUN apk add --no-cache nodejs npm git tar act squashfs-tools && \
  if command -v corepack >/dev/null 2>&1; then corepack enable pnpm; else npm install -g pnpm@10.33.2; fi

RUN npm install -g @redwoodjs/agent-ci@0.15.0

# Agent CI does not currently expose a Linux job-container network mode option.
# In Sandbox, default bridge networking cannot reliably reach outbound HTTPS.
# Patch the pinned spike dependency so `AGENT_CI_DOCKER_NETWORK=host` works.
RUN node - <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(
  fs.realpathSync(require("node:child_process").execSync("npm root -g", { encoding: "utf8" }).trim()),
  "@redwoodjs/agent-ci/dist/runner/local-job.js",
);
const source = fs.readFileSync(file, "utf8");
const patches = [
  [
    "...(serviceCtx ? { NetworkMode: serviceCtx.networkName } : {}),",
    "...(process.env.AGENT_CI_DOCKER_NETWORK ? { NetworkMode: process.env.AGENT_CI_DOCKER_NETWORK } : serviceCtx ? { NetworkMode: serviceCtx.networkName } : {}),",
  ],
  [
    "Env: [...containerEnv, ...extraContainerOpts.env],",
    "Env: [...containerEnv, ...extraContainerOpts.env, ...(process.env.AGENT_CI_DOCKER_ENV ? process.env.AGENT_CI_DOCKER_ENV.split(',').filter(Boolean) : [])],",
  ],
  [
    "Binds: containerBinds,",
    "Binds: [...containerBinds, ...(process.env.AGENT_CI_DOCKER_BINDS ? process.env.AGENT_CI_DOCKER_BINDS.split(',').filter(Boolean) : [])],",
  ],
];
let next = source;
for (const [before, after] of patches) {
  if (!next.includes(before)) throw new Error(`Agent CI patch target not found: ${before}`);
  next = next.replace(before, after);
}
fs.writeFileSync(file, next);
EOF

# act runs job steps in a nested container.
# The Sandbox image trust store is not enough for that container.
# This wrapper adds Docker-in-Docker host networking from the Sandbox guide.
# This wrapper passes the local CA store through to the job container.
COPY bin/node-dist-mirror.js /usr/local/bin/node-dist-mirror.js
COPY bin/artifacts-ci-act /usr/local/bin/artifacts-ci-act
COPY bin/artifacts-ci-agent-ci /usr/local/bin/artifacts-ci-agent-ci
RUN chmod +x /usr/local/bin/artifacts-ci-act /usr/local/bin/artifacts-ci-agent-ci

RUN mkdir -p /workspace && chmod 1777 /workspace

RUN printf '#!/bin/sh\n\
  set -eu\n\
  dockerd-entrypoint.sh dockerd --iptables=false --ip6tables=false --exec-opt native.cgroupdriver=cgroupfs &\n\
  until docker version >/dev/null 2>&1; do sleep 0.2; done\n\
  echo "Docker is ready"\n\
  wait\n' > /home/rootless/boot-docker-for-dind.sh && chmod +x /home/rootless/boot-docker-for-dind.sh

ENTRYPOINT ["/sandbox"]
CMD ["/home/rootless/boot-docker-for-dind.sh"]
