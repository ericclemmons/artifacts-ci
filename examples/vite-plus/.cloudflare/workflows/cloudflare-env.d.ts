type WorkflowStepOptions = {
  retries?: {
    limit: number;
    delay: number | string;
  };
};

type WorkflowSandbox = {
  exec(command: string, options?: SandboxCommandOptions): Promise<string>;
};

type SandboxCommandOptions = {
  cwd?: string;
  env?: Record<string, string>;
};

type WorkflowPayload = {
  repoDir?: string;
};

type WorkflowEnv = {
  SANDBOX: WorkflowSandbox;
  CONTAINER: WorkflowSandbox;
  COMMAND_RUNNER: WorkflowSandbox;
};

declare module "cloudflare:workers" {
  export abstract class WorkflowEntrypoint<Env = WorkflowEnv, Params = WorkflowPayload> {
    protected env: Env;
    run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }

  export type WorkflowEvent<Params = unknown> = {
    payload: Params;
    timestamp: Date;
    instanceId: string;
  };

  export type WorkflowStep = {
    do<Result>(name: string, callback: () => Result | Promise<Result>): Promise<Result>;
    do<Result>(
      name: string,
      options: WorkflowStepOptions,
      callback: () => Result | Promise<Result>,
    ): Promise<Result>;
  };
}
