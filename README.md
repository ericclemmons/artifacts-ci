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

`apps/ci/.env` must include deploy credentials for the Sandbox `wrangler deploy` step. The token needs Workers deploy permissions for the account.

## Smoke Test

This creates a throwaway Vite React app in `/tmp`, configures the Cloudflare Git remote, and pushes it.

```bash
cd $(mktemp -d)
vp create vite --no-interactive -- git-push-cf --template react-ts --no-interactive
cd git-push-cf
```

Create the first commit. Vite scaffolding does not create one for us.

```bash
git init -b main
git add .
git commit -m "Initial Vite app"
```

Configure the `cloudflare` remote. The script creates/reuses the Artifacts repo, mints a token, and writes the required Git config headers locally.

```bash
repo="git-push-cf-smoke-$(date +%s)"
curl -ksSf "https://ci.localhost/repos/$repo.sh" | bash
```

Push to Cloudflare:

```bash
git push cloudflare
```

Confirm the deployed smoke site responds:

```bash
curl -fsS https://git-push-cf.ericclemmons.workers.dev >/dev/null
```

Expected output includes side-band status lines like:

```text
remote: 📦 production/git-push-cf-smoke-<timestamp>
remote: 🗒️ commit <sha>
remote: 🌐 https://ci.localhost/runs/<id>
remote: $ npm install
```

If Git cannot verify the local Portless certificate, trust the Portless CA once in your shell startup file:

```bash
export GIT_SSL_CAINFO="$HOME/.portless/ca.pem"
```

After the push, the Git Worker starts a Workflow that clones the Artifacts repo into Sandbox and runs CI:

```bash
git clone <artifacts-remote> /workspace/repo
npm install
npm run lint --if-present
npm run test --if-present
npx --yes wrangler deploy
```

Wrangler may mint short-lived upload tokens while deploying static assets. The Git Worker keeps those Wrangler-generated tokens intact while replacing only the placeholder API token passed into the Sandbox.

## Checks

Check everything:

```bash
vp run check
```

Run tests:

```bash
vp run test
```

Build app type checks:

```bash
vp run build
```
