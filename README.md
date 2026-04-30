# git-push-cf

Push a Git repo to Cloudflare, back it with Artifacts, and trigger a Workflow that runs commands in Cloudflare Sandbox.

## Development

Start local development:

```bash
pnpm dev
```

This runs the `ci` and `git` Workers through Portless monorepo mode. Package `dev` scripts are plain `wrangler dev` commands; run them directly if you do not need Portless hostnames.

The local endpoints are:

- `https://ci.localhost` creates Artifacts repos and setup commands.
- `https://git.localhost` accepts Git smart-HTTP pushes.

`apps/ci/.env` must include deploy credentials for Agent CI workflows that deploy through Wrangler. The token needs Workers deploy permissions for the account.

## Smoke Test

Start local development first, then run the smoke fixture from another terminal:

```bash
pnpm dev
```

```bash
pnpm smoke examples/vite-plus
```

The smoke script copies the example into a temporary directory, creates the first Git commit, configures the Cloudflare remote from `https://ci.localhost/repos/<package-name>.sh`, and pushes the fixture to Cloudflare.

Expected output includes side-band status lines like:

```text
remote: 📦 production/vite-plus-example
remote: 🗒️ commit <sha>
remote: 🌐 https://ci.localhost/runs/<id>
remote: $ npx --yes @redwoodjs/agent-ci run --workflow .github/workflows/ci.yml
```

The repo name comes from the example's `package.json` `name` field. Set `SMOKE_KEEP=1` to keep the temporary workspace for debugging.

If Git cannot verify the local Portless certificate, trust the Portless CA once in your shell startup file:

```bash
export GIT_SSL_CAINFO="$HOME/.portless/ca.pem"
```

After the push, the Git Worker starts a Workflow that clones the Artifacts repo into Sandbox and runs the repo's GitHub Actions workflow through Agent CI:

```bash
git clone <artifacts-remote> /workspace/repo
npx --yes @redwoodjs/agent-ci run --workflow .github/workflows/ci.yml
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
