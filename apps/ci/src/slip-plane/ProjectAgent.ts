import { Agent, callable, getAgentByName } from "agents";
import { produce } from "immer";
import { ArtifactsBuild, PagesBuild, WorkersBuild } from "../utils/buildEvent";
import { appendRunLog, resetRunLog } from "../utils/runLog";
import type {
  ArtifactsBuild as ArtifactsBuildInput,
  PagesBuild as PagesBuildInput,
  WorkersBuild as WorkersBuildInput,
} from "../utils/buildEvent";
import type { SchedulerAgent } from "./SchedulerAgent";

export type BuildRef = {
  workflowId: string;
  workflowName: "DeployWorkflow" | "PagesWorkflow" | "WorkersBuildsWorkflow";
  accountId: string;
  projectId: string;
  createdAt: string;
  status: "queued" | "dispatched";
};

type ProjectState = {
  liveWorkflows: BuildRef[];
};

export class ProjectAgent extends Agent<Env, ProjectState> {
  initialState: ProjectState = { liveWorkflows: [] };

  async onStart() {
    await this.syncLiveWorkflows();
  }

  async onConnect() {
    await this.syncLiveWorkflows();
  }

  @callable()
  async syncLiveWorkflows() {
    const liveWorkflows = [];
    const completedWorkflowIds = [];

    for (const workflow of this.state.liveWorkflows) {
      const status = await this.getWorkflowStatus(workflow.workflowName, workflow.workflowId);

      if (
        status.status === "queued" ||
        status.status === "running" ||
        status.status === "waiting"
      ) {
        liveWorkflows.push(workflow);
      } else {
        completedWorkflowIds.push(workflow.workflowId);
      }
    }

    this.setState({ ...this.state, liveWorkflows });

    if (completedWorkflowIds.length > 0) {
      const scheduler = await getAgentByName<Env, SchedulerAgent>(this.env.SchedulerAgent, "free");
      await Promise.all(
        completedWorkflowIds.map((workflowId) => scheduler.completeWorkflow(workflowId)),
      );
    }

    return { liveWorkflows };
  }

  @callable()
  async enqueuePagesBuild(input: unknown) {
    const event = PagesBuild.assert(input);
    await this.syncLiveWorkflows();
    const workflowId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await this.runWorkflow(
      "PagesWorkflow",
      { ...event, workflowId, createdAt },
      { id: workflowId },
    );
    await this.trackAndSchedule({
      workflowId,
      workflowName: "PagesWorkflow",
      accountId: event.accountId,
      projectId: event.projectName,
      createdAt,
      status: "queued",
    });

    return { workflowId };
  }

  @callable()
  async enqueueWorkersBuild(input: unknown) {
    const event = WorkersBuild.assert(input);
    await this.syncLiveWorkflows();
    const workflowId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await this.runWorkflow(
      "WorkersBuildsWorkflow",
      { ...event, workflowId, createdAt },
      { id: workflowId },
    );
    await this.trackAndSchedule({
      workflowId,
      workflowName: "WorkersBuildsWorkflow",
      accountId: event.accountId,
      projectId: event.projectId,
      createdAt,
      status: "queued",
    });

    return { workflowId };
  }

  @callable()
  async enqueueArtifactsBuild(input: unknown) {
    const event = ArtifactsBuild.assert(input);
    await this.syncLiveWorkflows();
    const runId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await resetRunLog(runId);
    await appendRunLog(runId, `📦 ${event.namespace}/${event.repo}`);
    await appendRunLog(runId, `🗒️ commit ${event.commitSha ?? "unknown"}`);

    await this.runWorkflow(
      "DeployWorkflow",
      {
        runId,
        namespace: event.namespace,
        repo: event.repo,
        artifactsRemote: event.artifactsRemote,
        artifactsToken: event.artifactsToken,
        commitSha: event.commitSha,
        pushedAt: createdAt,
      },
      { id: workflowId },
    );
    await this.trackAndSchedule({
      workflowId,
      workflowName: "DeployWorkflow",
      accountId: event.accountId,
      projectId: event.projectId,
      createdAt,
      status: "queued",
    });

    return { workflowId, runId };
  }

  async dispatch(workflowId: string) {
    const build = this.state.liveWorkflows.find((item) => item.workflowId === workflowId);

    if (!build) return false;

    this.setState(
      produce(this.state, (draft) => {
        const liveWorkflow = draft.liveWorkflows.find((item) => item.workflowId === workflowId);
        if (liveWorkflow) liveWorkflow.status = "dispatched";
      }),
    );

    await this.sendWorkflowEvent(build.workflowName, workflowId, { type: "dispatch", payload: {} });
    return true;
  }

  async removeLiveWorkflow(workflowId: string) {
    const liveWorkflows = this.state.liveWorkflows.filter(
      (workflow) => workflow.workflowId !== workflowId,
    );
    this.setState({ ...this.state, liveWorkflows });
    const scheduler = await getAgentByName<Env, SchedulerAgent>(this.env.SchedulerAgent, "free");
    await scheduler.completeWorkflow(workflowId);
    return { liveWorkflows };
  }

  async getLiveWorkflowStatus(workflowId: string) {
    const workflow = this.state.liveWorkflows.find((item) => item.workflowId === workflowId);

    if (!workflow) return { live: false as const, status: "missing" };

    const status = await this.getWorkflowStatus(workflow.workflowName, workflow.workflowId);
    const live =
      status.status === "queued" || status.status === "running" || status.status === "waiting";
    return { live, status: status.status };
  }

  private async trackAndSchedule(build: BuildRef) {
    this.setState(
      produce(this.state, (draft) => {
        draft.liveWorkflows.push(build);
      }),
    );

    const scheduler = await getAgentByName<Env, SchedulerAgent>(this.env.SchedulerAgent, "free");
    await scheduler.enqueue(build);
  }
}

export type { ArtifactsBuildInput, PagesBuildInput, WorkersBuildInput };
