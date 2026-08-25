import type { AnswerSheetQuestion } from "../../types";

const answerSheetHeadingPattern = /^\s{0,3}#{1,2}[ \t]+/gm;

export function toggleExpandedQuestion(
  currentQuestionId: string | null,
  questionId: string,
): string | null {
  return currentQuestionId === questionId ? null : questionId;
}

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
    const points = question.blanks.reduce((total, blank) => total + blank.points, 0);
    return `${points} 分 · ${question.blanks.length} 个填空`;
  }
  return `${question.points} 分 · ${question.options.length} 个选项`;
}

export function getAnswerSheetQuestionExcerpt(question: AnswerSheetQuestion): string {
  const excerpt = question.content
    .replace(answerSheetHeadingPattern, "")
    .replace(/\s+/g, " ")
    .trim();
  return excerpt || "未填写题干";
}
