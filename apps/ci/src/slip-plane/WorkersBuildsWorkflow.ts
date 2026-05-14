import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { ProjectAgent, WorkersBuild } from "./ProjectAgent";

type WorkersBuildsWorkflowPayload = WorkersBuild & { workflowId: string; createdAt: string };

export class WorkersBuildsWorkflow extends AgentWorkflow<
  ProjectAgent,
  WorkersBuildsWorkflowPayload
> {
  async run(event: AgentWorkflowEvent<WorkersBuildsWorkflowPayload>, step: AgentWorkflowStep) {
    await step.waitForEvent("wait for dispatch", {
      type: "dispatch",
    });

    const result = await step.do(
      "handoff to Workers Builds",
      { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
      async () => ({
        status: "dry-run",
        url: `https://localhost:7445/api/v4/accounts/${event.payload.accountId}/builds/triggers/${event.payload.triggerId}/builds`,
        message: "Workers Builds handoff is scaffolded but not wired for this demo yet.",
      }),
    );

    await step.reportComplete(result);
    return result;
  }
}
