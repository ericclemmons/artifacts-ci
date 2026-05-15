import { Agent, callable, getAgentByName } from "agents";
import { produce } from "immer";
import type { BuildRef, ProjectAgent } from "./ProjectAgent";

type SchedulerState = {
  capacity: number;
  pending: BuildRef[];
  active: BuildRef[];
};

export class SchedulerAgent extends Agent<Env, SchedulerState> {
  initialState: SchedulerState = { capacity: 1, pending: [], active: [] };

  async onStart() {
    await this.scheduleEvery(30, "refreshCapacity");
  }

  async refreshCapacity() {
    // Demo placeholder. This will poll available pre-warmed capacity later.
    // this.setState({ ...this.state, capacity: 1 });
    await this.reconcileActiveWorkflows();
    await this.dispatch();
  }

  async reconcileActiveWorkflows() {
    const completed: string[] = [];

    for (const build of this.state.active) {
      const project = await getAgentByName<Env, ProjectAgent>(
        this.env.ProjectAgent,
        `${build.accountId}:${build.projectId}`,
      );
      const status = await project.getLiveWorkflowStatus(build.workflowId);
      console.log("SchedulerAgent active workflow status", {
        workflowId: build.workflowId,
        workflowName: build.workflowName,
        status: status.status,
        live: status.live,
      });

      if (!status.live) completed.push(build.workflowId);
    }

    if (completed.length === 0) return;

    this.setState(
      produce(this.state, (draft) => {
        draft.active = draft.active.filter((build) => !completed.includes(build.workflowId));
        draft.capacity += completed.length;
      }),
    );
  }

  @callable()
  async completeWorkflow(workflowId: string) {
    const wasActive = this.state.active.some((build) => build.workflowId === workflowId);

    if (!wasActive) return;

    this.setState(
      produce(this.state, (draft) => {
        draft.active = draft.active.filter((build) => build.workflowId !== workflowId);
        draft.capacity += 1;
      }),
    );
    await this.dispatch();
  }

  @callable()
  async setCapacity(capacity: number) {
    this.setState(
      produce(this.state, (draft) => {
        draft.capacity = Math.max(0, Math.floor(capacity));
      }),
    );
    await this.dispatch();
  }

  async enqueue(build: BuildRef) {
    this.setState(
      produce(this.state, (draft) => {
        draft.pending.push(build);
      }),
    );
    await this.dispatch();
  }

  @callable()
  async dispatch() {
    while (this.state.capacity > 0 && this.state.pending.length > 0) {
      const [build, ...pending] = this.state.pending;
      if (!build) return;

      this.setState(
        produce(this.state, (draft) => {
          draft.capacity -= 1;
          draft.pending = pending;
          draft.active.push(build);
        }),
      );

      const project = await getAgentByName<Env, ProjectAgent>(
        this.env.ProjectAgent,
        `${build.accountId}:${build.projectId}`,
      );
      await project.dispatch(build.workflowId);
    }
  }
}
