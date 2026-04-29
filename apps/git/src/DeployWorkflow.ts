import { getSandbox, parseSSEStream } from "@cloudflare/sandbox";
import type { ExecEvent } from "@cloudflare/sandbox";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type DeployParams = {
  namespace: string;
  repo: string;
  artifactsRemote: string;
  artifactsToken: string;
  pushedAt: string;
};

export class DeployWorkflow extends WorkflowEntrypoint<Env, DeployParams> {
  async run(event: WorkflowEvent<DeployParams>, step: WorkflowStep) {
    const accepted = await step.do("record accepted push", async () => ({
      namespace: event.payload.namespace,
      repo: event.payload.repo,
      artifactsRemote: event.payload.artifactsRemote,
      pushedAt: event.payload.pushedAt,
      status: "accepted",
    }));

    const sandbox = getSandbox(this.env.Sandbox, `${accepted.namespace}-${accepted.repo}`);

    const cloneCommand = [
      "rm -rf /workspace/repo",
      `git -c http.extraHeader=${quoteShell(`Authorization: Bearer ${event.payload.artifactsToken}`)} clone ${quoteShell(accepted.artifactsRemote)} /workspace/repo`,
    ].join(" && ");

    const checkout = await step.do("checkout artifacts repo", async () =>
      runSandboxCommand(sandbox, cloneCommand),
    );

    const install = await step.do("install dependencies", async () =>
      runSandboxCommand(sandbox, "cd /workspace/repo && pnpm install"),
    );

    const build = await step.do("build project", async () =>
      runSandboxCommand(sandbox, "cd /workspace/repo && pnpm build"),
    );

    const deploy = await step.do("deploy project", async () =>
      runSandboxCommand(sandbox, "cd /workspace/repo && pnpx wrangler --version"),
    );

    return {
      ...accepted,
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

async function runSandboxCommand(sandbox: ReturnType<typeof getSandbox>, command: string) {
  const stream = await sandbox.execStream(command);
  const output: string[] = [];
  let exitCode = 0;

  for await (const event of parseSSEStream<ExecEvent>(stream)) {
    if (event.type === "stdout" || event.type === "stderr") {
      output.push(event.data ?? "");
    }

    if (event.type === "complete") {
      exitCode = event.exitCode ?? 0;
    }

    if (event.type === "error") {
      throw new Error(event.error ?? "Sandbox command failed");
    }
  }

  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command}`);
  }

  return output.join("");
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
