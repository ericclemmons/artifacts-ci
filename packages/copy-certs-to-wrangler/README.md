# copy-certs-to-wrangler

Copies a local extra CA bundle into Wrangler's ignored state directory.

The CI Sandbox Docker image imports that bundle before installing Alpine packages.

## Why

Some environments intercept outbound TLS and re-sign certificates with a locally installed root CA.

Host tools may already trust that CA.

Docker builds do not automatically inherit the host trust store.

Without this package, the Sandbox Docker build can fail during `apk add` with TLS errors.

## Who Needs This

Use this only if local `pnpm dev` fails while building the Sandbox image with certificate errors such as:

```text
TLS: server certificate not trusted
self-signed certificate in certificate chain
```

Most external contributors and non-intercepting networks do not need it.

For them, this tool is a no-op.

## Usage

`apps/ci` runs this automatically from `predev`:

```bash
copy-certs-to-wrangler
```

By default it writes:

```text
.wrangler/docker-extra-ca.crt
```

That path is ignored by git.

To use a custom CA bundle:

```bash
DOCKER_EXTRA_CA_CERTS=/path/to/company-root.pem pnpm dev
```

If no custom bundle is provided, it opportunistically checks the common Cloudflare WARP cert path:

```text
~/.local/share/cloudflare-warp-certs/CloudflareRootCertificateCombined.pem
```

If neither file exists, it exits successfully without doing anything.

## Contract

This package only prepares ignored local Wrangler state.

It does not commit certificates.

It does not change production behavior.

It does not require WARP or Cloudflare-specific tooling to be installed.
