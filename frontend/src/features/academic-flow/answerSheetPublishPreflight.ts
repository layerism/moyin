import type { AcademicFlowNode, AnswerSheetPrivateKey } from "../../types";

import { validateAnswerSheetAuthoring } from "./answerSheet";

export type AnswerSheetPublishIssue = {
  message: string;
  nodeId: string;
};

export function getAnswerSheetPublishIssue(
  nodes: AcademicFlowNode[],
  answerSheetKeys: Record<string, AnswerSheetPrivateKey>,
): AnswerSheetPublishIssue | null {
  for (const node of nodes) {
    if (node.kind !== "answer_sheet") continue;
    const prefix = `答题卡“${node.title || "未命名答题卡"}”`;
    if (!node.answerSheet) {
      return { message: `${prefix}缺少题目配置`, nodeId: node.id };
    }
    const key = answerSheetKeys[node.id];
    if (!key) {
      return { message: `${prefix}缺少标准答案配置`, nodeId: node.id };
    }
    if (node.answerSheet.gradingPolicy.feedback === "full_after_deadline" && !node.deadlineAt) {
      return {
        message: `${prefix}选择了“截止后显示标准答案”，请先设置截止时间`,
        nodeId: node.id,
      };
    }

    const errors = validateAnswerSheetAuthoring(node.answerSheet, key);
    const orderedErrorIds = [
      ...node.answerSheet.questions.map((question) => question.id),
      "_questions",
      "_policy",
    ];
    const errorId = orderedErrorIds.find((id) => errors[id]?.length);
    if (!errorId) continue;
    const questionIndex = node.answerSheet.questions.findIndex(
      (question) => question.id === errorId,
    );
    const location = questionIndex >= 0 ? `第 ${questionIndex + 1} 题：` : "：";
    return {
      message: `${prefix}${location}${errors[errorId][0]}`,
      nodeId: node.id,
    };
  }
  return null;
}
