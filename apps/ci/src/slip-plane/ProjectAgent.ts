import { Agent, callable, getAgentByName } from "agents";
import { produce } from "immer";
import { appendRunLog, resetRunLog } from "../utils/runLog";
import type { SchedulerAgent } from "./SchedulerAgent";

export type PagesBuild = {
  accountId: string;
  projectName: string;
  deploymentId: string;
};

export type WorkersBuild = {
  accountId: string;
  projectId: string;
  triggerId: string;
  buildId: string;
};

export type ArtifactsBuild = {
  accountId: string;
  projectId: string;
  namespace: string;
  repo: string;
  artifactsRemote: string;
  artifactsToken: string;
  commitSha: string | null;
};

export type BuildRef = {
  workflowId: string;
  workflowName: "DeployWorkflow" | "PagesWorkflow" | "WorkersBuildsWorkflow";
  accountId: string;
  projectId: string;
  createdAt: string;
};

type ProjectState = {
  liveWorkflows: BuildRef[];
};

export class ProjectAgent extends Agent<Env, ProjectState> {
  initialState: ProjectState = { liveWorkflows: [] };

  @callable()
  async enqueuePagesBuild(event: PagesBuild) {
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
    });

    return { workflowId };
  }

  @callable()
  async enqueueWorkersBuild(event: WorkersBuild) {
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
    });

    return { workflowId };
  }

  @callable()
  async enqueueArtifactsBuild(event: ArtifactsBuild) {
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
    });

    return { workflowId, runId };
  }

  async dispatch(workflowId: string) {
    const build = this.state.liveWorkflows.find((item) => item.workflowId === workflowId);

    if (!build) return false;

    this.setState(
      produce(this.state, (draft) => {
        draft.liveWorkflows = draft.liveWorkflows.filter((item) => item.workflowId !== workflowId);
      }),
    );

    await this.sendWorkflowEvent(build.workflowName, workflowId, { type: "dispatch", payload: {} });
    return true;
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
