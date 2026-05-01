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

RUN apk add --no-cache nodejs npm git tar act squashfs-tools && \
  if command -v corepack >/dev/null 2>&1; then corepack enable pnpm; else npm install -g pnpm@10.33.2; fi

RUN mkdir -p /workspace && chmod 1777 /workspace

RUN printf '#!/bin/sh\n\
  set -eu\n\
  dockerd-entrypoint.sh dockerd --iptables=false --ip6tables=false --exec-opt native.cgroupdriver=cgroupfs &\n\
  until docker version >/dev/null 2>&1; do sleep 0.2; done\n\
  echo "Docker is ready"\n\
  wait\n' > /home/rootless/boot-docker-for-dind.sh && chmod +x /home/rootless/boot-docker-for-dind.sh

ENTRYPOINT ["/sandbox"]
CMD ["/home/rootless/boot-docker-for-dind.sh"]
