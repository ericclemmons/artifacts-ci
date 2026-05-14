import { type } from "arktype";
import type { ArtifactsBuild, PagesBuild, WorkersBuild } from "../slip-plane/ProjectAgent";

export type QueuedBuildEvent =
  | ({ product: "pages" } & PagesBuild)
  | ({ product: "workers-builds" } & WorkersBuild)
  | ({ product: "artifacts" } & ArtifactsBuild);

export const PagesBuildEvent = type({
  product: "'pages'",
  accountId: "string",
  projectName: "string",
  deploymentId: "string",
});

export const WorkersBuildEvent = type({
  product: "'workers-builds'",
  accountId: "string",
  projectId: "string",
  triggerId: "string",
  buildId: "string",
});

export const ArtifactsBuildEvent = type({
  product: "'artifacts'",
  accountId: "string",
  projectId: "string",
  namespace: "string",
  repo: "string",
  artifactsRemote: "string",
  artifactsToken: "string",
  commitSha: "string|null",
});

export const BuildEvent = type.or(PagesBuildEvent, WorkersBuildEvent, ArtifactsBuildEvent);

export function validateBuildEvent(value: unknown): QueuedBuildEvent {
  return BuildEvent.assert(value) as QueuedBuildEvent;
}
