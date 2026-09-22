import type { AcademicProcess } from "../../types";
import type { ServerFlow } from "./api";

export function mapServerFlow(flow: ServerFlow): AcademicProcess {
  return {
    answerSheetKeys: flow.answerSheetKeys ?? {},
    createdAt: new Date(flow.createdAt).toLocaleString("zh-CN"),
    description: flow.description,
    draftConfig: {
      edges: flow.draftConfig.edges ?? [],
      nodes: flow.draftConfig.nodes ?? [],
    },
    edges: flow.config.edges ?? [],
    hasUnpublishedChanges: flow.hasUnpublishedChanges,
    groupId: flow.groupId ?? null,
    id: flow.id,
    name: flow.name,
    nodes: flow.config.nodes ?? [],
    published: flow.status === "published",
    publishedNodeIds: flow.publishedNodeIds,
    publishedVersionId: flow.publishedVersionId ?? undefined,
    publishedVersionNo: flow.publishedVersionNo ?? undefined,
    serverId: flow.id,
  };
}
