import type { AnswerSheetQuestion } from "../../types";
import { isSingleMarkdownFillBlankQuestion } from "./answerSheet";

export function moveAnswerSheetQuestion<T extends { id: string }>(
  questions: T[],
  questionId: string,
  offset: -1 | 1,
): T[] {
  const source = questions.findIndex((question) => question.id === questionId);
  const destination = source + offset;
  if (source < 0 || destination < 0 || destination >= questions.length) return questions;
  const next = [...questions];
  [next[source], next[destination]] = [next[destination], next[source]];
  return next;
}

export function getAnswerSheetQuestionMeta(question: AnswerSheetQuestion): string {
  if (question.type === "fill_blank") {
    if (isSingleMarkdownFillBlankQuestion(question)) return `${question.points} 分`;
    const points = question.blanks.reduce((total, blank) => total + blank.points, 0);
    return `${points} 分 · 旧版填空`;
  }
  return `${question.points} 分 · ${question.options.length} 个选项`;
}
