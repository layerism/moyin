import type { AcademicProcess } from "../../types";

export type AcademicFlowStatus = {
  label: "草稿" | "已发布" | "已发布 · 有待发布修改";
  tone: "changed" | "draft" | "published";
};

export function getAcademicFlowStatus(
  process: Pick<AcademicProcess, "hasUnpublishedChanges" | "published">,
): AcademicFlowStatus {
  if (!process.published) {
    return { label: "草稿", tone: "draft" };
  }

  if (process.hasUnpublishedChanges) {
    return { label: "已发布 · 有待发布修改", tone: "changed" };
  }

  return { label: "已发布", tone: "published" };
}
