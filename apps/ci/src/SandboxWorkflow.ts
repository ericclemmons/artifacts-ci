import { getSandbox, parseSSEStream } from "@cloudflare/sandbox";
import type { DirectoryBackup, ExecEvent, StreamOptions } from "@cloudflare/sandbox";
import {
  createDynamicWorkflowEntrypoint,
  type WorkflowRunner,
  wrapWorkflowBinding,
} from "@cloudflare/dynamic-workflows";
import {
  env,
  exports as workersExports,
  WorkerEntrypoint,
  WorkflowEntrypoint,
} from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { deleteArtifactsGitParams, putArtifactsGitParams } from "./Sandbox";
import { envPlaceholders } from "./utils/proxyCloudflareApiRequest";
import { appendRunLog, closeRunLog } from "./utils/runLog";

type DeployParams = {
  runId: string;
  namespace: string;
  repo: string;
  artifactsRemote: string;
  artifactsToken: string;
  commitSha: string | null;
  pushedAt: string;
};

type WorkflowRunnerEnv = Env & {
  ARTIFACTS_CI_RUNNER?: string;
  RepositoryWorkflow: Workflow<RepositoryWorkflowParams>;
  WorkflowLoader: WorkerLoader;
};

type WorkflowCommandRunnerProps = {
  runId: string;
  sandboxName: string;
  cwd?: string;
  env?: Record<string, string>;
};

type RepositoryWorkflowParams = DeployParams & { repoDir: string; sandboxName: string };

export class WorkflowCommandRunner extends WorkerEntrypoint<Env, WorkflowCommandRunnerProps> {
  async exec(command: string, options?: SandboxCommandOptions) {
    return runSandboxCommand(this.ctx.props.runId, this.ctx.props.sandboxName, command, {
      cwd: this.ctx.props.cwd,
      ...options,
      env: { ...this.ctx.props.env, ...options?.env },
    });
  }
}

export const RepositoryWorkflow = createDynamicWorkflowEntrypoint<
  WorkflowRunnerEnv,
  RepositoryWorkflowParams
>(async ({ env, metadata }) => {
  const runId = metadata.runId;
  const sandboxName = metadata.sandboxName;

  if (typeof runId !== "string" || typeof sandboxName !== "string") {
    throw new Error("Repository workflow metadata must include runId and sandboxName");
  }

  return loadRepositoryWorkflow(env, runId, sandboxName);
});

export class SandboxWorkflow extends WorkflowEntrypoint<Env, DeployParams> {
  async run(event: WorkflowEvent<DeployParams>, step: WorkflowStep) {
    const runner = (this.env as WorkflowRunnerEnv).ARTIFACTS_CI_RUNNER ?? "actions";
    const queued = await step.do("record queued run", async () => ({
      namespace: event.payload.namespace,
      repo: event.payload.repo,
      artifactsRemote: event.payload.artifactsRemote,
      commitSha: event.payload.commitSha,
      pushedAt: event.payload.pushedAt,
      status: "queued",
    }));

    const sandboxName = getSandboxName(event.payload.runId);

    const cache = await step.do("restore sandbox cache", async () =>
      restoreSandboxCache(event.payload.runId, sandboxName),
    );

    const checkout = await step.do("checkout artifacts repo", async () => {
      const cloneRemote = `http://artifacts.sandbox/${queued.namespace}/${queued.repo}.git`;

      await putArtifactsGitParams(queued.namespace, queued.repo, {
        remote: event.payload.artifactsRemote,
        token: event.payload.artifactsToken,
      });

      const output = await runSandboxCommand(
        event.payload.runId,
        sandboxName,
        getCheckoutCommand(cloneRemote, queued.commitSha),
      );

      await deleteArtifactsGitParams(queued.namespace, queued.repo);

      return output;
    });

    const actions =
      runner === "workflows"
        ? await runRepositoryWorkflow(this.env as WorkflowRunnerEnv, event, step, sandboxName)
        : await step.do("Run GitHub Actions", { retries: { limit: 0, delay: 0 } }, async () => {
            try {
              await runSandboxCommand(event.payload.runId, sandboxName, "cd /workspace/repo");

              return await runSandboxCommand(
                event.payload.runId,
                sandboxName,
                "artifacts-ci-runner",
                {
                  cwd: "/workspace/repo",
                  env: getRunnerEnv(queued),
                },
              );
            } finally {
              await saveSandboxCache(event.payload.runId, sandboxName);
            }
          });

    if (typeof actions === "string" && !didActionsPass(actions)) {
      await appendRunLog(event.payload.runId, "failed: GitHub Actions failed");
      await closeRunLog(event.payload.runId);
      throw new Error("GitHub Actions failed");
    }

    const deploy =
      runner === "workflows"
        ? "skipped: workflow-owned deployment"
        : await step.do("Deploy to Cloudflare", { retries: { limit: 0, delay: 0 } }, async () =>
            runSandboxCommand(event.payload.runId, sandboxName, "pnpm deploy", {
              cwd: "/workspace/repo",
              env: {
                CLOUDFLARE_API_BASE_URL: "http://cloudflare-api.sandbox/client/v4",
                CLOUDFLARE_ACCOUNT_ID: envPlaceholders.CLOUDFLARE_ACCOUNT_ID,
                CLOUDFLARE_API_TOKEN: envPlaceholders.CLOUDFLARE_API_TOKEN,
              },
            }),
          );

    const cleanup = await step.do("destroy sandbox", async () => {
      await appendRunLog(event.payload.runId, "$ cleanup");
      await getSandbox(env.Sandbox, sandboxName).destroy();
    });

    await closeRunLog(event.payload.runId);

    return {
      ...queued,
      status: "planned",
      steps: {
        checkout,
        actions,
        cache,
        deploy,
        cleanup,
      },
    };
  }
}

async function runRepositoryWorkflow(
  env: WorkflowRunnerEnv,
  event: WorkflowEvent<DeployParams>,
  step: WorkflowStep,
  sandboxName: string,
) {
  await appendRunLog(event.payload.runId, "workflow: starting .cloudflare/workflows/ci.js");

  try {
    const workflow = wrapWorkflowBinding(
      { runId: event.payload.runId, sandboxName },
      { bindingName: "RepositoryWorkflow" },
    ) as Workflow<RepositoryWorkflowParams>;
    const instance = await workflow.create({
      id: `${event.payload.runId}-repository-workflow`,
      params: {
        ...event.payload,
        repoDir: "/workspace/repo",
        sandboxName,
      },
    });
    const result = await waitForWorkflow(step, instance);
    await saveSandboxCache(event.payload.runId, sandboxName);
    return result ?? "passed";
  } catch (error) {
    await saveSandboxCache(event.payload.runId, sandboxName);
    await appendRunLog(
      event.payload.runId,
      `failed: Cloudflare Workflow failed: ${getErrorMessage(error)}`,
    );
    await closeRunLog(event.payload.runId);
    throw error;
  }
}

async function loadRepositoryWorkflow(
  env: WorkflowRunnerEnv,
  runId: string,
  sandboxName: string,
): Promise<WorkflowRunner<RepositoryWorkflowParams>> {
  const source = await readSandboxFile(sandboxName, "/workspace/repo/.cloudflare/workflows/ci.js");
  const exports = workersExports as unknown as {
    WorkflowCommandRunner(init: { props: WorkflowCommandRunnerProps }): Fetcher;
  };
  const commandRunner = exports.WorkflowCommandRunner({
    props: {
      runId,
      sandboxName,
      cwd: "/workspace/repo",
      env: getCloudflareEnv(),
    },
  });
  const stub = env.WorkflowLoader.get(`workflow:${runId}`, () => ({
    compatibilityDate: "2026-04-28",
    compatibilityFlags: ["nodejs_compat"],
    mainModule: "ci.js",
    modules: {
      "ci.js": { js: source },
    },
    env: {
      SANDBOX: commandRunner,
      CONTAINER: commandRunner,
      COMMAND_RUNNER: commandRunner,
    },
    globalOutbound: null,
  }));

  return stub.getEntrypoint("CIWorkflow") as unknown as WorkflowRunner<RepositoryWorkflowParams>;
}

async function waitForWorkflow(step: WorkflowStep, instance: WorkflowInstance) {
  for (let attempt = 1; attempt <= 300; attempt++) {
    const status = await instance.status();

    if (status.status === "complete") {
      return status.output ?? "passed";
    }

    if (status.status === "errored" || status.status === "terminated") {
      throw new Error(status.error?.message ?? `Repository workflow ${status.status}`);
    }

    await step.sleep(`wait for repository workflow ${attempt}`, "1 second");
  }

  throw new Error("Timed out waiting for repository workflow");
}

async function readSandboxFile(sandboxName: string, filePath: string) {
  const result = await getSandbox(env.Sandbox, sandboxName).exec(`cat "${filePath}"`);

  if (result.exitCode !== 0) {
    throw new Error(`Could not read ${filePath}: ${result.stderr}`);
  }

  return result.stdout;
}

function getRunnerEnv(queued: { namespace: string; repo: string; commitSha: string | null }) {
  return {
    ...getCloudflareEnv(),
    GITHUB_REPOSITORY: `${queued.namespace}/${queued.repo}`,
    GITHUB_REPO: `${queued.namespace}/${queued.repo}`,
    GITHUB_SHA: queued.commitSha ?? "",
    XDG_CACHE_HOME: "/workspace/.cache",
    npm_config_store_dir: "/workspace/.cache/pnpm-store",
  };
}

function getCloudflareEnv() {
  return {
    CLOUDFLARE_API_BASE_URL: "http://cloudflare-api.sandbox/client/v4",
    CLOUDFLARE_ACCOUNT_ID: envPlaceholders.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: envPlaceholders.CLOUDFLARE_API_TOKEN,
    WRANGLER_SEND_ERROR_REPORTS: "false",
    WRANGLER_SEND_METRICS: "false",
  };
}

async function runSandboxCommand(
  runId: string,
  sandboxName: string,
  command: string,
  options?: SandboxCommandOptions,
) {
  await appendRunLog(runId, `$ ${command}`);

  try {
    const sandbox = getSandbox(env.Sandbox, sandboxName);
    const stream = await sandbox.execStream(command, options);
    const output: string[] = [];
    let exitCode = 0;

    for await (const event of parseSSEStream<ExecEvent>(stream)) {
      if (event.type === "stdout" || event.type === "stderr") {
        const data = event.data ?? "";
        output.push(data);
        await appendRunLog(runId, data);
      }

      if (event.type === "complete") {
        exitCode = event.exitCode ?? 0;
      }

      if (event.type === "error") {
        throw new Error(event.error ?? "Sandbox command failed");
      }
    }

    if (exitCode !== 0) {
      throw new Error(
        `Run ${runId} failed in sandbox ${sandboxName} with exit code ${exitCode}: ${command}`,
      );
    }

    return output.join("");
  } catch (error) {
    await appendRunLog(runId, `failed: ${getErrorMessage(error)}`);
    await appendRunLog(runId, `debug: last command: ${command}`);
    const instanceId = await getSandboxInstanceId(sandboxName);
    await appendRunLog(runId, "💻 Connect to this Sandbox to debug:");
    await appendRunLog(runId, `$ pnpx wrangler containers ssh ${instanceId}`);
    await closeRunLog(runId);
    throw error;
  }
}

async function getSandboxInstanceId(sandboxName: string) {
  try {
    const result = await getSandbox(env.Sandbox, sandboxName).exec(
      "curl -fsS http://metadata.sandbox",
    );

    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Best effort debug hint; fall back to the stable Sandbox name.
  }

  return sandboxName;
}

type SandboxCommandOptions = StreamOptions & { env?: Record<string, string> };

const CACHE_BACKUP_PREFIX = "sandbox-cache:v1";
const CACHE_DIRS = ["/home/runner/.cache", "/home/runner/.local/share/pnpm", "/workspace/.cache"];

async function restoreSandboxCache(runId: string, sandboxName: string) {
  const restored: string[] = [];
  const missed: string[] = [];

  for (const dir of CACHE_DIRS) {
    const key = getCacheBackupKey(dir);
    const value = await env.CacheBackups.get(key);

    if (!value) {
      missed.push(dir);
      continue;
    }

    const backup = JSON.parse(value) as DirectoryBackup;

    try {
      await getSandbox(env.Sandbox, sandboxName).restoreBackup(backup);
      restored.push(`${dir}:${backup.id}`);
    } catch (error) {
      await appendRunLog(runId, `cache: restore failed ${dir}: ${getErrorMessage(error)}`);
      await env.CacheBackups.delete(key);
    }
  }

  if (restored.length > 0) await appendRunLog(runId, `cache: restored ${restored.join(", ")}`);
  if (missed.length > 0) await appendRunLog(runId, `cache: miss ${missed.join(", ")}`);

  return { restored, missed };
}

async function saveSandboxCache(runId: string, sandboxName: string) {
  const sandbox = getSandbox(env.Sandbox, sandboxName);

  for (const dir of CACHE_DIRS) {
    try {
      await sandbox.exec(`mkdir -p ${dir}`);
      const backup = await sandbox.createBackup({
        dir,
        localBucket: true,
        name: getCacheBackupKey(dir),
      });

      await env.CacheBackups.put(getCacheBackupKey(dir), JSON.stringify(backup));
      console.log("Sandbox cache saved", { runId, dir, backupId: backup.id });
    } catch (error) {
      console.warn("Sandbox cache save failed", { runId, dir, error: getErrorMessage(error) });
    }
  }
}

function getCacheBackupKey(dir: string) {
  return `${CACHE_BACKUP_PREFIX}:${dir.replaceAll("/", ":")}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

function getSandboxName(runId: string) {
  return `run-${runId}`;
}

function getCheckoutCommand(remote: string, commitSha: string | null) {
  const checkout = commitSha
    ? ` && cd /workspace/repo && git -c advice.detachedHead=false checkout ${commitSha}`
    : "";
  return `rm -rf /workspace/repo && git clone "${remote}" /workspace/repo${checkout}`;
}

function didActionsPass(output: string) {
  const agentCiRunFinish = [...output.matchAll(/^\{"event":"run\.finish".*\}$/gm)].at(-1)?.[0];

  if (agentCiRunFinish) {
    return agentCiRunFinish.includes('"status":"passed"');
  }

  return !/\b(Job failed|Job completed with result: Failed|Status:\s+✗|"status":"failed")\b/.test(
    output,
  );
}
