import { type } from "arktype";

export const PagesBuild = type({
  accountId: "string",
  projectName: "string",
  "branch?": "string",
  "commitHash?": "string",
  "commitMessage?": "string",
});

export const WorkersBuild = type({
  accountId: "string",
  projectId: "string",
  "triggerId?": "string",
  "branch?": "string",
  "commitHash?": "string",
});

export const ArtifactsBuild = type({
  accountId: "string",
  projectId: "string",
  namespace: "string",
  repo: "string",
  artifactsRemote: "string",
  artifactsToken: "string",
  commitSha: "string|null",
});

export const PagesBuildEvent = type({
  product: "'pages'",
}).and(PagesBuild);

export const WorkersBuildEvent = type({
  product: "'workers-builds'",
}).and(WorkersBuild);

export const ArtifactsBuildEvent = type({
  product: "'artifacts'",
}).and(ArtifactsBuild);

export const BuildEvent = type.or(PagesBuildEvent, WorkersBuildEvent, ArtifactsBuildEvent);

export type PagesBuild = typeof PagesBuild.infer;
export type WorkersBuild = typeof WorkersBuild.infer;
export type ArtifactsBuild = typeof ArtifactsBuild.infer;
export type QueuedBuildEvent = typeof BuildEvent.infer;

export function validateBuildEvent(value: unknown): QueuedBuildEvent {
  return BuildEvent.assert(value) as QueuedBuildEvent;
}
