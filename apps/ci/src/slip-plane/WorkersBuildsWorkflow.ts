import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { ProjectAgent, WorkersBuildInput } from "./ProjectAgent";

type WorkersBuildsWorkflowPayload = WorkersBuildInput & { workflowId: string; createdAt: string };

export class WorkersBuildsWorkflow extends AgentWorkflow<
  ProjectAgent,
  WorkersBuildsWorkflowPayload
> {
  async run(event: AgentWorkflowEvent<WorkersBuildsWorkflowPayload>, step: AgentWorkflowStep) {
    await step.waitForEvent("wait for dispatch", { type: "dispatch" });

    const branch = event.payload.branch ?? "main";

    const trigger = await step.do(
      "lookup Workers Builds trigger",
      { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "1 hour" },
      async () => ({
        // Works for https://localhost:7445/api/v4/accounts/da2f8f3e41d6b5018df12a58b417d918/builds/triggers/86db6056-bf95-413b-baf1-366aebdcb8d8/builds
        trigger_uuid: "86db6056-bf95-413b-baf1-366aebdcb8d8",
      }),
    );

    const result = await step.do(
      "handoff to Workers Builds",
      { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "1 hour" },
      async () => ({
        status: "dry-run",
        triggerId: trigger.trigger_uuid,
        branch,
        message: "Workers Builds API rejected demo credentials; keeping this as a dry-run handoff.",
      }),
    );

    console.log("WorkersBuildsWorkflow agent", this.agent);
    const { liveWorkflows } = await this.agent.removeLiveWorkflow(event.payload.workflowId);
    await step.mergeAgentState({ liveWorkflows });
    await step.reportComplete(result);
    return result;
  }
}
