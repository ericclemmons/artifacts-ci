# Roadmap

## Upcoming

- [ ] Speed up builds.
  - [ ] Cache Docker images and layers used by Sandbox and `act`.
  - [ ] Add branch-level dependency caching for package managers such as pnpm and npm.
- [ ] On failure, provide a link to the failed build terminal.
  - [ ] Reference: https://developers.cloudflare.com/sandbox/guides/browser-terminals/
- [ ] Convert the CI app to TanStack Start.
- [ ] Move deployment into the pushed repository workflow.
  - [ ] Remove the post-CI `wrangler deploy` step from `DeployWorkflow`.
  - [ ] Put deploy behavior in `examples/vite-plus/.github/workflows/ci.yml`.
- [ ] Support Agent CI as an alternative runner to `act`.
  - [ ] Reference: https://agent-ci.dev/

## Completed

- [x] Created a Vite+ workspace with root `pnpm` entry points for dev, build, lint, test, check, and smoke workflows.
- [x] Split the product into two Workers.
  - [x] `apps/ci` owns repo setup, run state, Workflows, Sandbox, and run logs.
  - [x] `apps/git` owns the Git smart-HTTP push interface.
- [x] Removed Portless from the default local dev path.
  - [x] Local CI endpoint: `http://ci.localhost:8787`.
  - [x] Local Git endpoint: `http://git.localhost:8788`.
- [x] Added a local Docker proxy for Sandbox Docker-in-Docker.
  - [x] The proxy forwards to the active Docker socket.
  - [x] The proxy injects privileged container creation for local Sandbox support.
- [x] Implemented repo setup through `apps/ci`.
  - [x] Creates or reuses Artifacts repos.
  - [x] Returns Git setup commands.
  - [x] Configures the `cloudflare` remote to push `HEAD` by default.
- [x] Implemented Git push proxying through `apps/git`.
  - [x] Parses Git smart-HTTP routes.
  - [x] Validates the `production` namespace.
  - [x] Proxies Git traffic to Artifacts with setup-provided auth headers.
- [x] Added push-triggered CI runs.
  - [x] Parses pushed commit SHA from `git-receive-pack`.
  - [x] Creates a durable Workflow instance after Artifacts accepts a push.
  - [x] Emits run information through Git side-band output.
- [x] Moved CI orchestration into `apps/ci`.
  - [x] `apps/git` calls `apps/ci` through a Service Binding after a successful push.
  - [x] `apps/ci` creates the Workflow and owns run metadata.
- [x] Added Sandbox checkout support.
  - [x] The Workflow clones the exact pushed commit into `/workspace/repo`.
  - [x] The Sandbox accesses Artifacts through a virtual local remote.
  - [x] Checkout credentials stay Worker-side and are injected through KV-backed proxying.
- [x] Added GitHub Actions execution through `act`.
  - [x] The Sandbox image includes Docker-in-Docker support.
  - [x] The Sandbox image includes an `artifacts-ci-act` wrapper for local runner defaults.
  - [x] The wrapper passes local CA configuration into nested `act` job containers when needed.
- [x] Added local certificate support for intercepted-TLS environments.
  - [x] `copy-certs-to-wrangler` copies a local extra CA bundle into ignored Wrangler state.
  - [x] The Sandbox Docker image imports `.wrangler/docker-extra-ca.crt` when present.
  - [x] Normal external contributors do not need this path and get a no-op.
- [x] Added a local Node dist mirror for nested CI jobs.
  - [x] Used by Vite+ Node runtime downloads in intercepted-TLS environments.
  - [x] Kept inside the Sandbox image through `artifacts-ci-act`.
- [x] Added run log streaming.
  - [x] Workflow and Sandbox output is stored in a per-run Agent.
  - [x] `/runs/:id` streams logs for browser viewing.
  - [x] `/runs/:id/stream` exposes raw SSE replay.
- [x] Added Sandbox cache backup and restore.
  - [x] Restores `/workspace/.cache` before checkout.
  - [x] Saves cache state after CI attempts.
  - [x] Uses local R2 binding support during development.
- [x] Added the Vite+ smoke fixture.
  - [x] Smoke pushes `examples/vite-plus` into Artifacts.
  - [x] The expected current endpoint is an intentional fixture `vp check` failure after setup, install, and runner execution succeed.

## Deferred

- [ ] Environment-aware Git remotes.
  - [ ] Current setup uses `cloudflare` pointing at the `production` namespace.
  - [ ] Future setup may emit remotes such as `production`, `staging`, and `preview`.
- [ ] Access-protected deployed CI onboarding.
  - [ ] Deployed `apps/ci` should be protected by Cloudflare Access.
  - [ ] `apps/git` should remain directly pushable unless Git clients can provide Access credentials reliably.
- [ ] Deploy Button support for templates and onboarding.
  - [ ] Reference: https://developers.cloudflare.com/workers/platform/deploy-buttons/
- [ ] External GitHub Actions integration.
  - [ ] Repos may use hosted GitHub Actions alongside or instead of pushed Sandbox execution.
  - [ ] Future UI can link to external check runs rather than mirroring all logs.

## Open Questions

- [ ] Should the default Git remote remain `cloudflare`, or should setup create environment remotes by default?
- [ ] How should environment remotes map to one shared Artifacts repo without conflating storage namespace and deploy target?
- [ ] Is `preview` a shared remote, a branch-scoped environment, or a per-push ephemeral deployment?
- [ ] How much run log output can the per-run Agent hold before R2 or SQL-backed log storage is needed?
- [ ] Should `git push` wait for the full CI run, or should it detach earlier and rely on run URLs?
