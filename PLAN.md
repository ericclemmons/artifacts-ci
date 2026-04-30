**MVP Plan**

**Updated Direction**

- Existing Vite+ monorepo is the starting point.
- Use Vite+ (`vp`) inside apps and packages for package management, checks, tests, builds, and one-off binaries.
- Use Portless monorepo mode for local Worker dev orchestration.
- Primary demo: `git push <environment>`, not UI.
- Backing repo is Artifacts; enhanced remote points at our Git Worker.
- Default namespace today: `production`, but this should not be treated as the deployment environment model.
- Current Git remote shape: `https://git.localhost/production/<repo>.git`.
- Open direction: model deployment environments explicitly so remotes can be `production`, `preview`, `staging`, etc., instead of a generic `cloudflare` remote.
- Decision: environment is not the same as Artifacts namespace; one repo exists everywhere, and environment changes deploy behavior such as `wrangler deploy --env <environment>`.
- Two-worker split: `apps/git` is the thin Git push facade; `apps/ci` is the primary application.
- Keep helpers local in app `utils` until complexity justifies package extraction.
- No DB initially; defer R2/Agents/UI until push path works.

**Current Status**

- `apps/ci` creates or reuses Artifacts repos and returns setup commands.
- `apps/git` proxies Git smart HTTP to Artifacts using local Git config headers.
- Done: Workflows, Sandbox, RunLog Agent, KV checkout credentials, and deploy secrets moved to `apps/ci`; `apps/git` talks to CI through a Service Binding.
- `git push cloudflare` has been validated locally with side-band output, but environment-specific remotes should replace or wrap this before productizing.
- Accepted pushes create a durable Workflow instance and print a run URL.
- Accepted pushes parse the pushed commit SHA from `git-receive-pack` and run CI in a SHA-scoped Sandbox.
- Workflow is scaffolded into checkout/install/build/deploy steps with `ReadableStream`-friendly placeholders for future Sandbox output.
- Sandbox SDK is wired into `apps/git` with the minimal container Dockerfile and Worker binding.
- Sandbox CI checkout/install/lint/test/build is validated locally, and Wrangler can build the Sandbox container with Docker.
- Local `ci` and `git` dev Workers start cleanly after stopping stale `portless` wrappers; no `--force` script change is needed right now.
- Local Sandbox runtime is validated on Docker Desktop without the arm64 `proxy-everything` image override from cloudflare/sandbox-sdk#522.
- Push-time Workflow log streaming is implemented through a per-run Agent and SSE endpoint.

**Monorepo Changes**

- Add `apps/git` as Wrangler Worker for Git smart HTTP.
- Add `apps/ci` only as minimal repo/setup command generator.
- Done: keep `apps/git` simple and stateless aside from Git request parsing/proxying and side-band streaming.
- Done: move primary product bindings and ownership to `apps/ci`: Artifacts repo setup, Workflows, Sandbox, RunLog Agent, KV checkout credentials, run UI, SSE streams, and deploy secrets.
- Done: after Artifacts accepts a push, `apps/git` calls `env.CI.fetch(...)` to create the run, then streams run logs back from `apps/ci` to Git side-band while the connection is alive.
- Make workspace "wrangler-y" with app-level Wrangler configs and dev scripts.
- Root dev orchestration should use Portless monorepo mode; root verification should use Vite+ recursive tasks.
- App/package scripts should use Vite+ commands such as `vp check`, `vp test`, `vp build`, `vp exec`, and `vp dlx` instead of package-manager-specific commands.
- Use Portless for local URLs: `https://git.localhost` and `https://ci.localhost`.
- Keep existing `packages/utils`; do not add new packages unless tests/complexity warrant it.

**Phase 0B: Workspace Orchestration**

- Goal: make root workspace commands simple while app/package commands stay Vite+ native.
- Use root `portless` for local dev so only workspace packages with `dev` scripts start.
- Use Vite+ recursive root scripts for `build`, `lint`, `test`, and `check`.
- Ensure `vp run dev` starts `apps/ci` and `apps/git` with stable hostnames and ports.
- Ensure focused tasks remain available, e.g. `vp run ci#dev`, `vp run git#dev`, `vp run ci#build`, and `vp run git#build`.
- Update README command examples after the final root orchestration shape is chosen.

**Phase 1: Git Worker + Side-Band**

- Done: implement receive-pack discovery and push routes in `apps/git`.
- Done: proxy incoming Git smart-HTTP traffic to Artifacts Git protocol.
- Done: forward the user's Artifacts token from local git config.
- Done: append side-band progress after successful receive-pack, Heroku/GitHub style.
- Done: print synthetic CI lines and a run URL from `git push cloudflare`.
- Done: validate `git push cloudflare` updates Artifacts and shows our output.

**Phase 1 Setup Command**

- Done: generate copyable config from `apps/ci`.
- Done: add remote: `git remote add cloudflare https://git.localhost/production/<repo>.git`.
- Done: add auth header: `git config --local --add http.https://git.localhost/.extraHeader "Authorization: Bearer <ARTIFACTS_TOKEN>"`.
- Done: add Artifacts remote header: `git config --local --add http.https://git.localhost/.extraHeader "X-Artifacts-Remote: <ARTIFACTS_REMOTE>"`.
- Done: configure no-refspec UX: `git config --local remote.cloudflare.push HEAD`.
- Done: validate plain `git push cloudflare` on current Git.
- Next: decide whether setup should create environment remotes like `production`, `preview`, and `staging` instead of `cloudflare`.

**Phase 1B: isomorphic-git Spike**

- Use Cloudflare's isomorphic-git example as reference, not a hard requirement.
- Test if it helps Worker-side pushes for notes/log artifacts.
- Keep smart-HTTP proxy primary unless isomorphic-git can cleanly help external push handling.

**Phase 1C: Environment Remotes**

- Goal: make environments first-class in the Git UX.
- Current UX: one remote named `cloudflare` points at `/production/<repo>.git` and pushes `HEAD`.
- Candidate UX A: create remotes named by environment, e.g. `git push production`, `git push staging`, `git push preview`.
- Candidate UX B: keep remote `cloudflare`, but use refspecs or branch mapping, e.g. `git push cloudflare main:production`, `git push cloudflare branch:preview`.
- Candidate UX C: create both, with `cloudflare` as an alias/default and environment remotes for explicit deploys.
- Prefer candidate UX A unless Git remote-name conflicts or multi-provider ergonomics argue otherwise; it matches how users think about deploy targets.
- Decision: Artifacts namespace should not equal environment. Keep repo storage independent from deployment target.
- Environment should be stored in CI run metadata and passed to deploy command construction.
- Production deploy command remains `wrangler deploy` or equivalent default-env command.
- Non-production deploy command should become `wrangler deploy --env <environment>` or the project-specific equivalent.
- Decide if `preview` is a shared environment, per-branch environment, or per-push ephemeral deployment.
- Setup script should eventually emit environment-aware commands, including `remote.<environment>.push HEAD` for no-refspec pushes.
- Run metadata should include `environment` separately from `namespace` so UI, logs, Access policies, and deploy behavior can evolve independently.

**Phase 2: Repo Creation**

- Decision: explicit `apps/ci` create flow is primary, because setup needs the repo remote and token before Git can push.
- Done: implement `apps/ci` repo create/reuse flow for copyable setup and token retrieval.
- Done: use `env.ARTIFACTS.create(repo, { setDefaultBranch: "main" })` where appropriate.
- Done: return repo remote, default token, Cloudflare Git remote, and exact setup commands from `apps/ci`.
- Deferred: lazy create on first push is not needed for MVP and conflicts with token-first setup.

**Phase 3: Workflow Trigger**

- Done: create a Workflow instance after Artifacts accepts a receive-pack push.
- Done: print Workflow/run URL through side-band immediately.
- Deferred: derive repo/ref/commit from receive-pack data or Artifacts fetch.
- Next validation: confirm Ctrl-C after Workflow creation does not stop the Workflow.

**Phase 4: Sandbox CI Echo**

- Done: add Sandbox SDK dependency, minimal `Dockerfile`, container binding, Agent/Durable Object binding, and migration.
- Done: Workflow clones through a static virtual Sandbox remote and Worker-side outbound handler: `http://artifacts.sandbox/<namespace>/<repo>.git`.
- Done: short-lived Artifacts checkout credentials are stored in KV for the outbound handler so the Sandbox never sees the token.
- Done: CI used npm commands initially: `npm install`, `npm run lint --if-present`, `npm run test --if-present`, and `npm run build`.
- Current deploy mode: throw `NonRetryableError("deploy: Not implemented")` after CI so CD can be implemented separately.
- Done: stream available command output to git side-band while connection is alive.
- Done: capture run log output in a per-run Agent with `/runs/:id/stream` SSE replay.
- Done: `wrangler deploy --dry-run` for `apps/git` builds the Sandbox container when Docker is running.
- Done: fresh `ci.localhost` and `git.localhost` dev processes are healthy, and `git push cloudflare` still succeeds from a clean process state.
- Done: local Sandbox Workflow execution without `MINIFLARE_CONTAINER_EGRESS_IMAGE`, using Docker Desktop.
- Deferred: package-backed push validates deploy through an Agent CI workflow and returns the deployed URL.

**Phase 5: CI, then CD**

- Done: make checkout real with KV-backed Worker-side Artifacts credential injection.
- Done: parse pushed commit SHA from receive-pack and checkout that exact SHA in the Sandbox.
- Done: run npm-based CI in Sandbox: install, lint, test, and build.
- Done: add outbound credential injection for Cloudflare API using Worker-side deploy secrets and Wrangler `CLOUDFLARE_API_BASE_URL` pointed at `http://cloudflare-api.sandbox/client/v4`.
- Done: replace deploy placeholder with `npx --yes wrangler deploy` and no Workflow retries for the deploy step.
- Done: replace hard-coded Sandbox install/lint/test/deploy sequence with `npx --yes @redwoodjs/agent-ci run --all`.
- Done: preserve Wrangler-generated asset upload JWTs while replacing only the Sandbox placeholder API token.
- Done: smoke validation curls `https://git-push-cf.ericclemmons.workers.dev` after deploy.
- Deferred: deployment deletion is intentionally out of scope for now because Git ref-delete mapping is too dangerous.

**Phase 6: Runs UI and Logs**

- Done: add `https://ci.localhost/runs/:id` UI for server-streamed live run logs.
- Done: expose `/runs/:id/stream` for raw SSE replay.
- Done: move the RunLog Agent and SSE source from `apps/git` to `apps/ci` so `ci` owns all run state.
- Keep all Workflow/Sandbox output in the run log stream so Git side-band and UI show the same events.
- Done: add ANSI color support in Git side-band and styled browser log output without changing raw log storage.
- Tail Workers are observability/debug option, not product state initially.

**Phase 6B: App Boundary Refactor**

- Goal: `apps/git` is only the public Git smart-HTTP interface for `git push cloudflare`.
- Goal: `apps/ci` is the primary product application and owns protected UI/API state.
- Done: move bindings from `apps/git` to `apps/ci`: `DEPLOY_WORKFLOW`, `Sandbox`, `RunLog`, `REPO_TOKENS`, Cloudflare deploy secrets, and Sandbox container config.
- Done: add an internal CI API that `apps/git` can call after a successful receive-pack push, passing namespace, repo, Artifacts remote/token, commit SHA, and push metadata.
- Done: have `apps/ci` create the Workflow instance, append initial run events, and expose the canonical `/runs/:id` and `/runs/:id/stream` routes.
- Done: have `apps/git` subscribe to `apps/ci` run stream for side-band output instead of talking directly to RunLog.
- Keep `apps/git` outside Cloudflare Access unless Git clients can reliably provide Access credentials.
- Lock `apps/ci` behind Cloudflare Access when deployed; provide internal service-to-service access for `apps/git` to create runs and stream logs.
- Decision: service-to-service calls use Service Bindings, e.g. `env.CI.fetch(...)`, so public `https://ci...` can be Access-protected without blocking `git push`.

**Phase 7: Cloudflare Deploy Button**

- Add an official Cloudflare "Deploy to Cloudflare" button for onboarding/templates.
- Reference: https://developers.cloudflare.com/workers/platform/deploy-buttons/
- Keep Deploy Button support separate from push-driven `npx --yes wrangler deploy` inside Sandbox.
- Include the GitHub push/publish path as part of this phase so the public template repo can be used by Deploy to Cloudflare.
- Decide whether the deploy button points at this monorepo directly or a separate template repo extracted from it.
- Monorepo concern: deploy must provision two Workers, `apps/ci` and `apps/git`, each with its own Wrangler config, bindings, migrations, container/Sandbox config, and the `git -> ci` Service Binding.
- Confirm whether Cloudflare Deploy Button can handle this monorepo/two-worker shape directly; if not, document a bootstrap script or GitHub Actions workflow that runs the required `vp run ci#deploy` and `vp run git#deploy` sequence.
- Ensure deploy docs cover required secrets, custom domains/routes, and the Access setup gap because Wrangler deploy does not configure Access applications.

**Phase 7B: GitHub Actions Example**

- Add a GitHub Actions example for repos that want hosted CI alongside or before push-driven deploys.
- Reference Vite+ CI guidance: https://viteplus.dev/guide/ci#github-actions
- Use `redwoodjs/agent-ci` as the example CI action: https://github.com/redwoodjs/agent-ci
- Done: treat `agent-ci` as the execution backend for pushed repos instead of duplicating lint/test/build in the Sandbox Workflow.
- Support GitHub Actions replacing the Sandbox `wrangler deploy` step when credentials and environment targeting are configured there.
- Show a minimal workflow that installs dependencies, runs checks/tests/build, and optionally deploys or reports status back through this project.
- Decide later how `apps/ci` represents externally executed steps in run logs and status, e.g. linked GitHub check runs vs. mirrored log output.
- Keep this as documentation/example scope unless product requirements demand first-class GitHub App or OAuth integration.

**Phase 8: Access/Auth Later**

- Lock `apps/ci` behind Cloudflare Access when deployed.
- Keep `apps/git` separately pushable unless Git works cleanly with Access token headers.
- Spike Access auth with `cloudflared access token` and Git `http.extraHeader: cf-access-token`.
- If Access works for Git, consider merging `ci` and `git` behind hostname/path policies.

**Validation Gates**

- A: `https://git.localhost` receives Git smart-HTTP traffic through Portless.
- B: `apps/ci` explicitly creates/reuses `/production/<repo>.git` and returns setup commands.
- C: Worker forwards push to Artifacts successfully.
- D: `git push cloudflare` works without explicit branch after setup.
- E: Git client displays side-band text and run URL.
- F: Push creates durable Workflow exactly once.
- G: Ctrl-C after Workflow creation does not stop run.
- H: Sandbox clones Artifacts repo and runs pnpm commands.
- I: `npx --yes wrangler deploy` prints deployed URL with injected credentials.
- J: `/runs/:id/stream` replays live Workflow/Sandbox output as SSE.
- K: `apps/git` can trigger CI runs through `apps/ci` without owning Workflow/Sandbox/RunLog bindings.
- L: deployed `apps/ci` is protected by Cloudflare Access while `git push cloudflare` still works through `apps/git`.
- M: setup supports environment-aware Git remotes or an explicit equivalent for `production`, `staging`, and `preview`.

**Unresolved Questions**

- Can Git + Cloudflare Access token headers make a single protected worker viable?
- Should the default Git remote be named `production` instead of `cloudflare`?
- How should environment remotes map to one shared Artifacts repo URL without conflating storage namespace and deploy target?
- Is `preview` one shared remote or dynamically generated per branch/push?
- How much run log output can the per-run Agent hold before R2 or a SQL-backed message table becomes necessary?
- Should `git push` wait for the full CI run by default, or switch to a shorter attach window plus URL for longer deploys?
