import { WorkflowEntrypoint } from "cloudflare:workers";

export class CIWorkflow extends WorkflowEntrypoint {
  /**
   * @param {import("cloudflare:workers").WorkflowEvent<WorkflowPayload>} _event
   * @param {import("cloudflare:workers").WorkflowStep} step
   */
  async run(_event, step) {
    await step.do("Install dependencies", async () => {
      await this.env.SANDBOX.exec("corepack enable pnpm");
      await this.env.SANDBOX.exec("pnpm install");
    });

    await step.do("Check", () => this.env.SANDBOX.exec("pnpm exec vp check --fix"));

    await step.do("Test", () => this.env.SANDBOX.exec("pnpm exec vp test"));

    await step.do("Build", () => this.env.SANDBOX.exec("pnpm exec vp build"));

    return await step.do("Deploy", () => this.env.SANDBOX.exec("pnpx wrangler deploy"));
  }
}
