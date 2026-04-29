**MVP Plan**

**Updated Direction**

- Existing Vite+ monorepo is the starting point.
- Primary demo: `git push cloudflare`, not UI.
- Backing repo is Artifacts; enhanced remote points at our Git Worker.
- Default namespace: `production`.
- Git remote shape: `https://git.localhost/production/<repo>.git`.
- Prefer two workers for clarity: `apps/git` and `apps/ci`.
- Keep helpers local in app `utils` until complexity justifies package extraction.
- No DB initially; defer R2/Agents/UI until push path works.

**Monorepo Changes**

- Add `apps/git` as Wrangler Worker for Git smart HTTP.
- Add `apps/ci` only as minimal repo/setup command generator.
- Make workspace "wrangler-y" with app-level Wrangler configs and dev scripts.
- Use Portless for local URLs: `https://git.localhost` and `https://ci.localhost`.
- Keep existing `packages/utils`; do not add new packages unless tests/complexity warrant it.

**Phase 1: Git Worker + Side-Band**

- Implement receive-pack discovery and push routes in `apps/git`.
- Proxy incoming Git smart-HTTP traffic to Artifacts Git protocol.
- Forward the user's Artifacts token from local git config.
- Append side-band progress after successful receive-pack, Heroku/GitHub style.
- Print synthetic CI lines and a run URL from `git push cloudflare`.
- Validate `git push cloudflare` updates Artifacts and shows our output.

**Phase 1 Setup Command**

- Generate copyable config from `apps/ci` or dev endpoint.
- Add remote: `git remote add cloudflare https://git.localhost/production/<repo>.git`.
- Add auth header: `git config --local --add http.https://git.localhost/.extraHeader "Authorization: Bearer <ARTIFACTS_TOKEN>"`.
- Configure no-refspec UX: `git config --local remote.cloudflare.push HEAD`.
- Validate plain `git push cloudflare` on current Git.

**Phase 1B: isomorphic-git Spike**

- Use Cloudflare's isomorphic-git example as reference, not a hard requirement.
- Test if it helps Worker-side pushes for notes/log artifacts.
- Keep smart-HTTP proxy primary unless isomorphic-git can cleanly help external push handling.

**Phase 2: Repo Creation**

- Implement lazy create on first push to `/production/<repo>.git` when the repo is missing.
- Implement explicit `apps/ci` create flow too, for copyable setup and token retrieval.
- Use `env.ARTIFACTS.create(repo, { setDefaultBranch: "main" })` where appropriate.
- Return repo remote, default token, and exact setup commands from `apps/ci`.
- If lazy create cannot happen at Git discovery time, create during receive-pack before forwarding.

**Phase 3: Workflow Trigger**

- After Artifacts accepts push, derive repo/ref/commit from receive-pack data or Artifacts fetch.
- Create a Workflow instance exactly once per accepted push.
- Print Workflow/run URL through side-band immediately.
- Confirm Ctrl-C after Workflow creation does not stop the Workflow.

**Phase 4: Sandbox CI Echo**

- Workflow uses Sandbox SDK + Artifacts pattern to clone the pushed repo.
- Assume `pnpm`; no package-manager detection.
- Run `pnpm install`, `pnpm build`, `pnpx wrangler --version`, then `echo pnpx wrangler deploy`.
- Stream available command output to git side-band while connection is alive.
- Capture enough Workflow output to debug without adding storage yet.

**Phase 5: Real Static Deploy**

- Add outbound credential injection for `api.cloudflare.com`.
- Store parent deploy token with `wrangler secret put`.
- Replace echo with `pnpx wrangler deploy`.
- Ensure Wrangler's deployed URL is visible in push output for user/agent.

**Phase 6: Logs Decision**

- First test Workflow `step.do()` ReadableStream output for larger Sandbox logs.
- Tail Workers are observability/debug option, not product state initially.
- Defer R2 or Agent broadcast until side-band + deploy work.
- Later UI can use Agents SDK/useAgent for run status.

**Phase 7: Access/Auth Later**

- Lock `apps/ci` behind Cloudflare Access when deployed.
- Keep `apps/git` separately pushable unless Git works cleanly with Access token headers.
- Spike Access auth with `cloudflared access token` and Git `http.extraHeader: cf-access-token`.
- If Access works for Git, consider merging `ci` and `git` behind hostname/path policies.

**Validation Gates**

- A: `https://git.localhost` receives Git smart-HTTP traffic through Portless.
- B: Worker lazily creates `/production/<repo>.git` when missing.
- C: Worker forwards push to Artifacts successfully.
- D: `git push cloudflare` works without explicit branch after setup.
- E: Git client displays side-band text and run URL.
- F: Push creates durable Workflow exactly once.
- G: Ctrl-C after Workflow creation does not stop run.
- H: Sandbox clones Artifacts repo and runs pnpm commands.
- I: `pnpx wrangler deploy` prints deployed URL with injected credentials.

**Unresolved Questions**

- Can Git + Cloudflare Access token headers make a single protected worker viable?
- How much Workflow log output can ReadableStream step state hold before R2/Agents become necessary?
