import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { ProjectAgent, PagesBuild } from "./ProjectAgent";

type PagesWorkflowPayload = PagesBuild & { workflowId: string; createdAt: string };

export class PagesWorkflow extends AgentWorkflow<ProjectAgent, PagesWorkflowPayload> {
  async run(event: AgentWorkflowEvent<PagesWorkflowPayload>, step: AgentWorkflowStep) {
    await step.waitForEvent("wait for dispatch", {
      type: "dispatch",
    });

    const result = await step.do(
      "handoff to Pages",
      { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "1 hour" },
      async (ctx) => {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${event.payload.accountId}/pages/projects/${event.payload.projectName}/deployments/${event.payload.deploymentId}/retry`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Pages retry failed: ${response.status} ${await response.text()}`);
        }

        return { status: "accepted", response: await response.text() };
      },
    );

    await step.reportComplete(result);
    return result;
  }
}
