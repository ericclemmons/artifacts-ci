import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type DeployParams = {
  namespace: string;
  repo: string;
  artifactsRemote: string;
  pushedAt: string;
};

export class DeployWorkflow extends WorkflowEntrypoint<Env, DeployParams> {
  async run(event: WorkflowEvent<DeployParams>, step: WorkflowStep) {
    const accepted = await step.do("record accepted push", async () => ({
      ...event.payload,
      status: "accepted",
    }));

    const checkout = await step.do("checkout artifacts repo", async () =>
      streamFromLines([
        `repo=${accepted.namespace}/${accepted.repo}`,
        `remote=${accepted.artifactsRemote}`,
        "next phase: clone this repo into a Sandbox workspace",
      ]),
    );

    const install = await step.do("install dependencies", async () =>
      streamFromLines([
        "pnpm install",
        "next phase: run this command inside the checked-out Sandbox workspace",
      ]),
    );

    const build = await step.do("build project", async () =>
      streamFromLines(["pnpm build", "next phase: stream stdout/stderr from Sandbox execStream"]),
    );

    const deploy = await step.do("deploy project", async () =>
      streamFromLines([
        "pnpx wrangler deploy",
        "next phase: inject Cloudflare credentials via Sandbox outbound handlers",
      ]),
    );

    return {
      ...accepted,
      status: "planned",
      steps: {
        checkout: await new Response(checkout).text(),
        install: await new Response(install).text(),
        build: await new Response(build).text(),
        deploy: await new Response(deploy).text(),
      },
    };
  }
}

function streamFromLines(lines: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }

      controller.close();
    },
  });
}
