# git-push-cf

Push a Git repo to Cloudflare, back it with Artifacts, and trigger a Workflow that runs commands in Cloudflare Sandbox.

## Development

Start local development:

```bash
pnpm dev
```

This runs the workspace dev tasks through `vp run dev`. If you want separate logs, run `vp run ci#dev` and `vp run git#dev` in separate terminals.

The local endpoints are:

- `https://ci.localhost` creates Artifacts repos and setup commands.
- `https://git.localhost` accepts Git smart-HTTP pushes.

## Smoke Test

This creates a throwaway Vite React app in `/tmp`, configures the Cloudflare Git remote, and pushes it.

```bash
cd $(mktemp -d)
vp create vite --no-interactive -- app --template react-ts --no-interactive
cd app
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

Expected output includes side-band status lines like:

```text
remote: Cloudflare CI accepted push
remote: repo production/git-push-cf-smoke-<timestamp>
remote: run https://ci.localhost/runs/<id>
remote: next: workflow trigger
```

If Git cannot verify the local Portless certificate, trust the Portless CA once in your shell startup file:

```bash
export GIT_SSL_CAINFO="$HOME/.portless/ca.pem"
```

In `apps/git` logs, these Sandbox startup messages are expected during local cold starts:

```text
Error checking if container is ready: Container is not listening to port 3000
Port 3000 is ready
```

The first line is Wrangler polling the Sandbox container API before it has finished booting. It is only a problem if `Port 3000 is ready` never appears or command execution errors follow it.

After the push, the Git Worker starts a Workflow that clones the Artifacts repo into Sandbox and runs:

```bash
pnpm install
pnpm build
pnpx wrangler --version
```

## Checks

Check everything is ready:

```bash
vp check
```

Run tests:

```bash
vp test
```

Build app type checks:

```bash
vp run git#build
vp run ci#build
```
