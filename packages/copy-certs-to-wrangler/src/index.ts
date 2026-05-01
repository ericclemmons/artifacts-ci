#!/usr/bin/env node
// See README.md for why this exists and when it is a no-op.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const target = path.resolve(process.argv[2] ?? ".wrangler/docker-extra-ca.crt");
const sources = [
  process.env.DOCKER_EXTRA_CA_CERTS,
  path.join(
    os.homedir(),
    ".local/share/cloudflare-warp-certs/CloudflareRootCertificateCombined.pem",
  ),
];

for (const source of sources) {
  if (!source || !existsSync(source)) continue;

  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`Using extra Docker CA bundle from ${source}`);
  process.exit(0);
}
