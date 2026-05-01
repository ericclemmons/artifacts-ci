# Roadmap

## Upcoming

- Speed up builds.
  - Cache Docker images and layers used by Sandbox and `act`.
  - Add branch-level dependency caching for package managers such as pnpm and npm.
- On failure, provide a link to the failed build terminal.
  - Reference: https://developers.cloudflare.com/sandbox/guides/browser-terminals/
- Convert the CI app to TanStack Start.
- Move deployment into the pushed repository workflow.
  - Remove the post-CI `wrangler deploy` step from `DeployWorkflow`.
  - Put deploy behavior in `examples/vite-plus/.github/workflows/ci.yml`.
- Support Agent CI as an alternative runner to `act`.
  - Reference: https://agent-ci.dev/

## Completed

- Created a Vite+ workspace with root `pnpm` entry points for dev, build, lint, test, check, and smoke workflows.
- Split the product into two Workers.
  - `apps/ci` owns repo setup, run state, Workflows, Sandbox, and run logs.
  - `apps/git` owns the Git smart-HTTP push interface.
- Removed Portless from the default local dev path.
  - Local CI endpoint: `http://ci.localhost:8787`.
  - Local Git endpoint: `http://git.localhost:8788`.
- Added a local Docker proxy for Sandbox Docker-in-Docker.
  - The proxy forwards to the active Docker socket.
  - The proxy injects privileged container creation for local Sandbox support.
- Implemented repo setup through `apps/ci`.
  - Creates or reuses Artifacts repos.
  - Returns Git setup commands.
  - Configures the `cloudflare` remote to push `HEAD` by default.
- Implemented Git push proxying through `apps/git`.
  - Parses Git smart-HTTP routes.
  - Validates the `production` namespace.
  - Proxies Git traffic to Artifacts with setup-provided auth headers.
- Added push-triggered CI runs.
  - Parses pushed commit SHA from `git-receive-pack`.
  - Creates a durable Workflow instance after Artifacts accepts a push.
  - Emits run information through Git side-band output.
- Moved CI orchestration into `apps/ci`.
  - `apps/git` calls `apps/ci` through a Service Binding after a successful push.
  - `apps/ci` creates the Workflow and owns run metadata.
- Added Sandbox checkout support.
  - The Workflow clones the exact pushed commit into `/workspace/repo`.
  - The Sandbox accesses Artifacts through a virtual local remote.
  - Checkout credentials stay Worker-side and are injected through KV-backed proxying.
- Added GitHub Actions execution through `act`.
  - The Sandbox image includes Docker-in-Docker support.
  - The Sandbox image includes an `artifacts-ci-act` wrapper for local runner defaults.
  - The wrapper passes local CA configuration into nested `act` job containers when needed.
- Added local certificate support for intercepted-TLS environments.
  - `copy-certs-to-wrangler` copies a local extra CA bundle into ignored Wrangler state.
  - The Sandbox Docker image imports `.wrangler/docker-extra-ca.crt` when present.
  - Normal external contributors do not need this path and get a no-op.
- Added a local Node dist mirror for nested CI jobs.
  - Used by Vite+ Node runtime downloads in intercepted-TLS environments.
  - Kept inside the Sandbox image through `artifacts-ci-act`.
- Added run log streaming.
  - Workflow and Sandbox output is stored in a per-run Agent.
  - `/runs/:id` streams logs for browser viewing.
  - `/runs/:id/stream` exposes raw SSE replay.
- Added Sandbox cache backup and restore.
  - Restores `/workspace/.cache` before checkout.
  - Saves cache state after CI attempts.
  - Uses local R2 binding support during development.
- Added the Vite+ smoke fixture.
  - Smoke pushes `examples/vite-plus` into Artifacts.
  - The expected current endpoint is an intentional fixture `vp check` failure after setup, install, and runner execution succeed.

## Deferred

- Environment-aware Git remotes.
  - Current setup uses `cloudflare` pointing at the `production` namespace.
  - Future setup may emit remotes such as `production`, `staging`, and `preview`.
- Access-protected deployed CI onboarding.
  - Deployed `apps/ci` should be protected by Cloudflare Access.
  - `apps/git` should remain directly pushable unless Git clients can provide Access credentials reliably.
- Deploy Button support for templates and onboarding.
  - Reference: https://developers.cloudflare.com/workers/platform/deploy-buttons/
- External GitHub Actions integration.
  - Repos may use hosted GitHub Actions alongside or instead of pushed Sandbox execution.
  - Future UI can link to external check runs rather than mirroring all logs.

## Open Questions

- Should the default Git remote remain `cloudflare`, or should setup create environment remotes by default?
- How should environment remotes map to one shared Artifacts repo without conflating storage namespace and deploy target?
- Is `preview` a shared remote, a branch-scoped environment, or a per-push ephemeral deployment?
- How much run log output can the per-run Agent hold before R2 or SQL-backed log storage is needed?
- Should `git push` wait for the full CI run, or should it detach earlier and rely on run URLs?
