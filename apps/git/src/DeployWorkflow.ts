import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { appendRunLog, closeRunLog } from "./utils/runLog";

type DeployParams = {
  runId: string;
  namespace: string;
  repo: string;
  artifactsRemote: string;
  artifactsToken: string;
  pushedAt: string;
};

export class DeployWorkflow extends WorkflowEntrypoint<Env, DeployParams> {
  async run(event: WorkflowEvent<DeployParams>, step: WorkflowStep) {
    const queued = await step.do("record queued run", async () => ({
      namespace: event.payload.namespace,
      repo: event.payload.repo,
      artifactsRemote: event.payload.artifactsRemote,
      pushedAt: event.payload.pushedAt,
      status: "queued",
    }));

    const checkout = await step.do("checkout artifacts repo", async () => {
      const cloneCommand = [
        "git clone",
        quoteShell(queued.artifactsRemote),
        "/workspace/repo",
      ].join(" ");

      return notImplemented(event.payload.runId, "checkout", cloneCommand);
    });

    const install = await step.do("install dependencies", async () =>
      notImplemented(event.payload.runId, "install", "pnpm install"),
    );

    const build = await step.do("build project", async () =>
      notImplemented(event.payload.runId, "build", "pnpm build"),
    );

    const deploy = await step.do("deploy project", async () =>
      notImplemented(event.payload.runId, "deploy", "pnpx wrangler --version"),
    );

    await closeRunLog(event.payload.runId);

    return {
      ...queued,
      status: "planned",
      steps: {
        checkout,
        install,
        build,
        deploy,
      },
    };
  }
}

async function notImplemented(runId: string, label: string, command: string) {
  await appendRunLog(runId, `$ ${label}`);
  await appendRunLog(runId, command);
  await appendRunLog(runId, `${label} not implemented`);
  await closeRunLog(runId);

  throw new NonRetryableError(`${label}: Not implemented`);
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
