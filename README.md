# artifacts-ci

Push a Git repo to Cloudflare, back it with Artifacts, and trigger a Workflow that runs commands in Cloudflare Sandbox.

## Development

Start local development:

```bash
pnpm dev
```

This runs the `ci`, `git`, and local Docker proxy apps. The Docker proxy provides the Unix socket needed for local Sandbox Docker-in-Docker.

The local endpoints are:

- `http://ci.localhost:8787` creates Artifacts repos and setup commands.
- `http://git.localhost:8788` accepts Git smart-HTTP pushes.

`apps/ci/.env` must include deploy credentials for Agent CI workflows that deploy through Wrangler. The token needs Workers deploy permissions for the account.

The Docker proxy forwards to the active Docker context socket, or `DOCKER_SOCKET` if set, and injects `HostConfig.Privileged=true` into local container creation requests.

## Smoke Test

Start local development first, then run the smoke fixture from another terminal:

```bash
pnpm dev
```

```bash
pnpm smoke examples/vite-plus
```

The smoke script copies the example into a temporary directory, creates the first Git commit, configures a timestamped Cloudflare remote, and pushes the fixture to Cloudflare.

Expected output includes side-band status lines like:

```text
remote: 📦 production/vite-plus-<timestamp>
remote: 🗒️ commit <sha>
remote: 🌐 http://ci.localhost:8787/runs/<id>
remote: $ act --action-offline-mode --pull=false -P ubuntu-latest=catthehacker/ubuntu:act-latest --container-options '--network=host'
```

After the push, the Git Worker starts a Workflow that clones the Artifacts repo into Sandbox and runs the repo's GitHub Actions workflow through `act`:

```bash
git clone <artifacts-remote> /workspace/repo
act --action-offline-mode --pull=false -P ubuntu-latest=catthehacker/ubuntu:act-latest --container-options '--network=host'
```

Wrangler may mint short-lived upload tokens while deploying static assets from workflow steps. The CI Worker keeps those Wrangler-generated tokens intact while replacing only the placeholder API token passed into the Sandbox.

## Checks

Check everything:

```bash
pnpm check
```

Run tests:

```bash
pnpm test
```

Build app type checks:

```bash
pnpm build
```
