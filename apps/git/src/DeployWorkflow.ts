import { getSandbox, parseSSEStream } from "@cloudflare/sandbox";
import type { ExecEvent, StreamOptions } from "@cloudflare/sandbox";
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

    const sandboxName = getSandboxName(
      queued.namespace,
      queued.repo,
      queued.commitSha,
      event.payload.runId,
    );

    const checkout = await step.do("checkout artifacts repo", async () => {
      const cloneRemote = `http://artifacts.sandbox/${queued.namespace}/${queued.repo}.git`;

      await appendRunLog(event.payload.runId, `artifacts remote ${cloneRemote}`);
      await putArtifactsGitParams(queued.namespace, queued.repo, {
        remote: event.payload.artifactsRemote,
        token: event.payload.artifactsToken,
      });

      const output = await runSandboxCommand(
        event.payload.runId,
        "checkout",
        sandboxName,
        getCheckoutCommand(cloneRemote, queued.commitSha),
      );

      await deleteArtifactsGitParams(queued.namespace, queued.repo);

      return output;
    });

    const install = await step.do("install dependencies", async () =>
      runSandboxCommand(
        event.payload.runId,
        "install",
        sandboxName,
        "cd /workspace/repo && npm install --loglevel=info --foreground-scripts",
      ),
    );

    const lint = await step.do("lint project", async () =>
      runSandboxCommand(
        event.payload.runId,
        "lint",
        sandboxName,
        "cd /workspace/repo && npm run lint --if-present",
      ),
    );

    const test = await step.do("test project", async () =>
      runSandboxCommand(
        event.payload.runId,
        "test",
        sandboxName,
        "cd /workspace/repo && npm run test --if-present",
      ),
    );

    const buildProject = await step.do("build project", async () =>
      runSandboxCommand(
        event.payload.runId,
        "build",
        sandboxName,
        "cd /workspace/repo && npm run build",
      ),
    );

    const deploy = await step.do("deploy project", { retries: { limit: 0, delay: 0 } }, async () =>
      runSandboxCommand(
        event.payload.runId,
        "deploy",
        sandboxName,
        "cd /workspace/repo && npx --yes wrangler deploy",
        [],
        {
          env: {
            CLOUDFLARE_API_BASE_URL: "http://cloudflare-api.sandbox/client/v4",
            CLOUDFLARE_ACCOUNT_ID: envPlaceholders.CLOUDFLARE_ACCOUNT_ID,
            CLOUDFLARE_API_TOKEN: envPlaceholders.CLOUDFLARE_API_TOKEN,
          },
        },
      ),
    );

    const cleanup = await step.do("destroy sandbox", async () => {
      await appendRunLog(event.payload.runId, "$ cleanup");
      await getSandbox(env.Sandbox, sandboxName).destroy();
      await appendRunLog(event.payload.runId, "cleanup completed");
    });

    await closeRunLog(event.payload.runId);

    return {
      ...queued,
      status: "planned",
      steps: {
        checkout,
        install,
        lint,
        test,
        build: buildProject,
        deploy,
        cleanup,
      },
    };
  }
}

async function runSandboxCommand(
  runId: string,
  label: string,
  sandboxName: string,
  command: string,
  redactions: string[] = [],
  options?: StreamOptions,
) {
  await appendRunLog(runId, `$ ${label}`);

  try {
    const sandbox = getSandbox(env.Sandbox, sandboxName);
    const stream = await sandbox.execStream(command, options);
    const output: string[] = [];
    let exitCode = 0;

    for await (const event of parseSSEStream<ExecEvent>(stream)) {
      if (event.type === "stdout" || event.type === "stderr") {
        const data = redact(event.data ?? "", redactions);
        output.push(data);
        await appendRunLog(runId, data);
      }

      if (event.type === "complete") {
        exitCode = event.exitCode ?? 0;
      }

      if (event.type === "error") {
        throw new Error(redact(event.error ?? "Sandbox command failed", redactions));
      }
    }

    if (exitCode !== 0) {
      throw new Error(`Command failed with exit code ${exitCode}: ${command}`);
    }

    await appendRunLog(runId, `${label} completed`);

    return output.join("");
  } catch (error) {
    await appendRunLog(runId, `${label} failed: ${getErrorMessage(error)}`);
    await closeRunLog(runId);
    throw error;
  }
}

function redact(value: string, redactions: string[]) {
  return redactions.reduce((redacted, secret) => redacted.replaceAll(secret, "<redacted>"), value);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

function getSandboxName(namespace: string, repo: string, commitSha: string | null, runId: string) {
  return `${namespace}-${repo}-${commitSha?.slice(0, 12) ?? runId}`;
}

function getCheckoutCommand(remote: string, commitSha: string | null) {
  const checkout = commitSha ? ` && cd /workspace/repo && git checkout ${commitSha}` : "";
  return `rm -rf /workspace/repo && git clone "${remote}" /workspace/repo${checkout}`;
}
