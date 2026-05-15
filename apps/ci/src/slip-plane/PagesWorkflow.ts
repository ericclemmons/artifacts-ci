import { AgentWorkflow } from "agents/workflows";
import { env } from "cloudflare:workers";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { PagesBuildInput, ProjectAgent } from "./ProjectAgent";

type PagesWorkflowPayload = PagesBuildInput & {
  workflowId: string;
  createdAt: string;
};

export class PagesWorkflow extends AgentWorkflow<ProjectAgent, PagesWorkflowPayload> {
  async run(event: AgentWorkflowEvent<PagesWorkflowPayload>, step: AgentWorkflowStep) {
    await step.waitForEvent("wait for dispatch", { type: "dispatch" });

    const deployment = await step.do(
      "create Pages deployment",
      {
        retries: { limit: 5, delay: "5 seconds", backoff: "exponential" },
        timeout: "1 hour",
      },
      async (ctx) => {
        if (ctx.attempt === 1) {
          throw new Error("Oops! DB got a little flakey there...");
        }

        if (ctx.attempt === 2) {
          throw new Error("Almost there, just ran into a DNS issue...");
        }

        const form = new FormData();
        if (event.payload.branch) form.set("branch", event.payload.branch);
        if (event.payload.commitHash) form.set("commit_hash", event.payload.commitHash);
        if (event.payload.commitMessage) form.set("commit_message", event.payload.commitMessage);

        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${event.payload.accountId}/pages/projects/${event.payload.projectName}/deployments`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
            body: [...form.keys()].length > 0 ? form : undefined,
          },
        );

        if (!response.ok) {
          throw new Error(
            `Pages deployment creation failed: ${response.status} ${await response.text()}`,
          );
        }

        return (await response.json()) as { result?: { id?: string } };
      },
    );

    const result = await step.do("handoff to Pages", async () => ({
      status: "accepted",
      deploymentId: deployment.result?.id ?? null,
    }));

    console.log("PagesWorkflow agent", this.agent);
    const { liveWorkflows } = await this.agent.removeLiveWorkflow(event.payload.workflowId);
    await step.mergeAgentState({ liveWorkflows });
    await step.reportComplete(result);
    return result;
  }
}
