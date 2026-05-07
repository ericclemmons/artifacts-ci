import { getSandbox, parseSSEStream } from "@cloudflare/sandbox";
import type { DirectoryBackup, ExecEvent, StreamOptions } from "@cloudflare/sandbox";
import { env } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";
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

export class DeployWorkflow extends WorkflowEntrypoint<Env, DeployParams> {
  async run(event: WorkflowEvent<DeployParams>, step: WorkflowStep) {
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

    const actions = await step.do(
      "Run GitHub Actions",
      { retries: { limit: 0, delay: 0 } },
      async () => {
        try {
          await runSandboxCommand(event.payload.runId, sandboxName, "cd /workspace/repo");

          return await runSandboxCommand(
            event.payload.runId,
            sandboxName,
            getRunnerCommand(env.CI_RUNNER),
            {
              cwd: "/workspace/repo",
              env: {
                CLOUDFLARE_API_BASE_URL: "http://cloudflare-api.sandbox/client/v4",
                CLOUDFLARE_ACCOUNT_ID: envPlaceholders.CLOUDFLARE_ACCOUNT_ID,
                CLOUDFLARE_API_TOKEN: envPlaceholders.CLOUDFLARE_API_TOKEN,
                GITHUB_REPOSITORY: `${queued.namespace}/${queued.repo}`,
                GITHUB_REPO: `${queued.namespace}/${queued.repo}`,
                GITHUB_SHA: queued.commitSha ?? "",
                XDG_CACHE_HOME: "/workspace/.cache",
                npm_config_store_dir: "/workspace/.cache/pnpm-store",
              },
            },
          );
        } finally {
          await saveSandboxCache(sandboxName);
        }
      },
    );

    const deploy = await step.do(
      "Deploy to Cloudflare",
      { retries: { limit: 0, delay: 0 } },
      async () =>
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
    await closeRunLog(runId);
    throw error;
  }
}

type SandboxCommandOptions = StreamOptions & { env?: Record<string, string> };

const CACHE_BACKUP_KEY = "sandbox-cache:v1";
const CACHE_DIR = "/workspace/.cache";

async function restoreSandboxCache(runId: string, sandboxName: string) {
  const value = await env.CACHE_BACKUPS.get(CACHE_BACKUP_KEY);

  if (!value) {
    await appendRunLog(runId, "cache: miss");
    return "miss";
  }

  const backup = JSON.parse(value) as DirectoryBackup;

  try {
    await getSandbox(env.Sandbox, sandboxName).restoreBackup(backup);
    await appendRunLog(runId, `cache: restored ${backup.id}`);
    return backup.id;
  } catch (error) {
    await appendRunLog(runId, `cache: restore failed ${getErrorMessage(error)}`);
    await env.CACHE_BACKUPS.delete(CACHE_BACKUP_KEY);
    return "restore-failed";
  }
}

async function saveSandboxCache(sandboxName: string) {
  try {
    const sandbox = getSandbox(env.Sandbox, sandboxName);
    await sandbox.exec(`mkdir -p ${CACHE_DIR}`);
    const backup = await sandbox.createBackup({
      dir: CACHE_DIR,
      localBucket: true,
      name: CACHE_BACKUP_KEY,
    });
    await env.CACHE_BACKUPS.put(CACHE_BACKUP_KEY, JSON.stringify(backup));
  } catch {
    // Cache is best effort while local backup support is experimental.
  }
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

function getRunnerCommand(runner: string | undefined) {
  return runner === "act" ? "artifacts-ci-act" : "artifacts-ci-agent-ci";
}
