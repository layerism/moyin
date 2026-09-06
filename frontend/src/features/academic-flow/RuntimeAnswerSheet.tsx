import { useEffect, useRef, useState } from "react";

import type {
  AcademicFlowNode,
  AnswerSheetGrade,
  AnswerSheetLegacyFillBlankQuestion,
  AnswerSheetPrivateAnswer,
  AnswerSheetQuestion,
} from "../../types";
import { isSingleMarkdownFillBlankQuestion } from "./answerSheet";
import { AnswerSheetMarkdown } from "./AnswerSheetMarkdown";
import { MarkdownBlurEditor } from "./MarkdownBlurEditor";

export function RuntimeAnswerSheet({
  errors,
  instanceId,
  node,
  onChange,
  payload,
  readonly,
}: {
  errors: Record<string, string>;
  instanceId: string;
  node: AcademicFlowNode;
  onChange?: (answers: Record<string, unknown>, fieldId?: string) => void;
  payload: Record<string, unknown>;
  readonly: boolean;
}) {
  const config = node.answerSheet;
  const questions = config?.questions ?? [];
  const answers = asRecord(payload.answers);
  const questionCount = questions.length;
  const [activeStep, setActiveStep] = useState(0);
  const activeContentRef = useRef<HTMLElement>(null);
  const activeQuestion = activeStep < questionCount ? questions[activeStep] : null;
  const activeAnswer = activeQuestion ? asRecord(answers[activeQuestion.id]) : {};
  const firstErrorId = Object.keys(errors)[0] ?? "";
  const firstErrorQuestionIndex = firstErrorId
    ? questions.findIndex((question) => isQuestionErrorId(question.id, firstErrorId))
    : -1;

  useEffect(() => {
    setActiveStep((current) => Math.min(current, questionCount));
  }, [questionCount]);

  useEffect(() => {
    if (firstErrorQuestionIndex < 0) return;
    setActiveStep(firstErrorQuestionIndex);
    window.requestAnimationFrame(() => activeContentRef.current?.focus());
  }, [firstErrorId, firstErrorQuestionIndex]);

  if (!config) return null;

  const update = (questionId: string, answer: Record<string, unknown>, fieldId?: string) => {
    onChange?.({ ...answers, [questionId]: answer }, fieldId ?? questionId);
  };
  const moveToStep = (step: number) => {
    setActiveStep(Math.max(0, Math.min(step, questionCount)));
    window.requestAnimationFrame(() => activeContentRef.current?.focus());
  };

  return (
    <div className={`runtime-answer-sheet${readonly ? " is-readonly" : ""}`}>
      {activeQuestion ? (
          <section className="runtime-answer-question" key={activeQuestion.id} ref={activeContentRef} tabIndex={-1}>
            <header>
              <strong>第 {activeStep + 1} 题</strong>
              <span>{questionLabel(activeQuestion)} · {questionPoints(activeQuestion)} 分</span>
              <em>必答</em>
            </header>
            {activeQuestion.type === "fill_blank" ? (
              isSingleMarkdownFillBlankQuestion(activeQuestion) ? (
                <SingleMarkdownFillQuestion
                  answer={activeAnswer}
                  instanceId={instanceId}
                  onChange={(answerMarkdown) => update(activeQuestion.id, { answerMarkdown })}
                  question={activeQuestion}
                  readonly={readonly}
                />
              ) : (
                <FillQuestion
                  answer={activeAnswer}
                  errors={errors}
                  instanceId={instanceId}
                  onChange={(blankValues, fieldId) => update(activeQuestion.id, { blankValues }, fieldId)}
                  question={activeQuestion}
                  readonly={readonly}
                />
              )
            ) : (
              <>
                <AnswerSheetMarkdown instanceId={instanceId}>{activeQuestion.content}</AnswerSheetMarkdown>
                <fieldset disabled={readonly}>
                  {activeQuestion.options.map((option) => {
                    const checked = activeQuestion.type === "single_choice"
                      ? activeAnswer.selectedOptionId === option.id
                      : Array.isArray(activeAnswer.selectedOptionIds) && activeAnswer.selectedOptionIds.includes(option.id);
                    return (
                      <label className={checked ? "is-selected" : ""} key={option.id}>
                        <input
                          checked={checked}
                          name={`runtime-answer-${activeQuestion.id}`}
                          type={activeQuestion.type === "single_choice" ? "radio" : "checkbox"}
                          onChange={(event) => {
                            if (activeQuestion.type === "single_choice") {
                              update(activeQuestion.id, { selectedOptionId: option.id });
                              return;
                            }
                            const current = Array.isArray(activeAnswer.selectedOptionIds)
                              ? activeAnswer.selectedOptionIds.filter((value): value is string => typeof value === "string")
                              : [];
                            update(activeQuestion.id, {
                              selectedOptionIds: event.target.checked
                                ? [...current, option.id]
                                : current.filter((id) => id !== option.id),
                            });
                          }}
                        />
                        <AnswerSheetMarkdown instanceId={instanceId}>{option.content}</AnswerSheetMarkdown>
                      </label>
                    );
                  })}
                </fieldset>
              </>
            )}
            {errors[activeQuestion.id] ? <p className="runtime-field-error" role="alert">{errors[activeQuestion.id]}</p> : null}
          </section>
      ) : (
        <section className="runtime-answer-overview" ref={activeContentRef} tabIndex={-1}>
          <header>
            <strong>答题概览</strong>
            <span>点击题号可返回检查，不会展示其他题目的正文。</span>
          </header>
          {questionCount > 0 ? (
            <ol>
              {questions.map((question, index) => {
                const answered = isQuestionAnswered(question, asRecord(answers[question.id]));
                const hasError = Object.keys(errors).some((errorId) => isQuestionErrorId(question.id, errorId));
                return (
                  <li key={question.id}>
                    <button
                      className={hasError ? "has-error" : answered ? "is-answered" : "is-unanswered"}
                      onClick={() => moveToStep(index)}
                      type="button"
                    >
                      <span>第 {index + 1} 题</span>
                      <small>{questionLabel(question)}</small>
                      <em>{hasError ? "需检查" : answered ? "已答" : "未答"}</em>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : <p>当前答题卡暂无题目。</p>}
        </section>
      )}

      {questionCount > 0 ? (
        <nav aria-label="答题卡题目切换" className="runtime-answer-navigation">
          <button disabled={activeStep === 0} onClick={() => moveToStep(activeStep - 1)} type="button">
            上一题
          </button>
          {activeQuestion ? (
            <button className="primary-action" onClick={() => moveToStep(activeStep + 1)} type="button">
              {activeStep === questionCount - 1 ? "完成答题" : "下一题"}
            </button>
          ) : (
            <button className="primary-action" onClick={() => moveToStep(0)} type="button">
              返回第一题
            </button>
          )}
        </nav>
      ) : null}
    </div>
  );
}

export function AnswerSheetGradeResult({
  completion,
  grade,
  node,
}: {
  completion?: {
    label: string;
    submittedAt: string;
  };
  grade: AnswerSheetGrade;
  node: AcademicFlowNode;
}) {
  const results = new Map(grade.questionResults?.map((result) => [result.questionId, result]) ?? []);
  return (
    <section className={`answer-sheet-grade ${grade.passed ? "is-passed" : "is-failed"}`}>
      <header>
        <div className="answer-sheet-grade-score">
          <span>得分</span>
          <strong>{grade.score}</strong>
          <small>/ {grade.maxScore} 分</small>
        </div>
        <em>{grade.passed ? "已达到及格要求" : `未达到 ${grade.passingScore} 分的及格要求`}</em>
      </header>
      {grade.questionResults?.length ? (
        <ol className="answer-sheet-grade-breakdown">
          {node.answerSheet?.questions.map((question, index) => {
            const result = results.get(question.id);
            return <li className={result?.correct ? "is-correct" : "is-wrong"} key={question.id}>
              <span>第 {index + 1} 题</span>
              <strong>{result?.awardedPoints ?? 0} / {result?.maxPoints ?? questionPoints(question)} 分</strong>
            </li>;
          })}
        </ol>
      ) : null}
      {grade.standardAnswers ? (
        <div className="answer-sheet-standard-answers">
          <strong>标准答案</strong>
          <ol>{node.answerSheet?.questions.map((question, index) => {
            const standardAnswers = formatStandardAnswers(question, grade.standardAnswers?.[question.id]);
            return (
              <li key={question.id}>
                <span>第 {index + 1} 题：</span>
                <ol className="answer-sheet-accepted-standard-list">
                  {standardAnswers.map((markdown, answerIndex) => (
                    <li key={`${question.id}-${answerIndex}`}>
                      <span>答案 {answerIndex + 1}</span>
                      <AnswerSheetMarkdown>{markdown}</AnswerSheetMarkdown>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}</ol>
        </div>
      ) : null}
      {completion ? (
        <footer className="answer-sheet-grade-completion">
          <strong>{completion.label}</strong>
          <span>提交时间：{completion.submittedAt}</span>
        </footer>
      ) : null}
    </section>
  );
}

function SingleMarkdownFillQuestion({
  answer,
  instanceId,
  onChange,
  question,
  readonly,
}: {
  answer: Record<string, unknown>;
  instanceId: string;
  onChange: (answerMarkdown: string) => void;
  question: Extract<AnswerSheetQuestion, { format: "single_markdown_exact" }>;
  readonly: boolean;
}) {
  return (
    <>
      <AnswerSheetMarkdown instanceId={instanceId}>{question.content}</AnswerSheetMarkdown>
      <div className="runtime-markdown-answer">
        <MarkdownBlurEditor
          disabled={readonly}
          onChange={onChange}
          placeholder="请输入 Markdown 答案"
          value={typeof answer.answerMarkdown === "string" ? answer.answerMarkdown : ""}
        />
      </div>
    </>
  );
}

function FillQuestion({
  answer,
  errors,
  instanceId,
  onChange,
  question,
  readonly,
}: {
  answer: Record<string, unknown>;
  errors: Record<string, string>;
  instanceId: string;
  onChange: (values: Record<string, string>, fieldId: string) => void;
  question: AnswerSheetLegacyFillBlankQuestion;
  readonly: boolean;
}) {
  const values = asRecord(answer.blankValues);
  const parts = question.content.split(/(\[\[blank:[A-Za-z0-9_-]+\]\])/g);
  return (
    <div className="runtime-fill-question">
      {parts.map((part, index) => {
        const blankId = part.match(/^\[\[blank:([A-Za-z0-9_-]+)\]\]$/)?.[1];
        if (!blankId) return part ? <AnswerSheetMarkdown instanceId={instanceId} key={index}>{part}</AnswerSheetMarkdown> : null;
        const fieldId = `${question.id}:${blankId}`;
        return (
          <span className="runtime-inline-blank" key={blankId}>
            <input
              aria-invalid={Boolean(errors[fieldId]) || undefined}
              disabled={readonly}
              value={typeof values[blankId] === "string" ? values[blankId] : ""}
              onChange={(event) => onChange({ ...stringValues(values), [blankId]: event.target.value }, fieldId)}
            />
            {errors[fieldId] ? <small role="alert">{errors[fieldId]}</small> : null}
          </span>
        );
      })}
    </div>
  );
}

function questionPoints(question: AnswerSheetQuestion): number {
  return question.type === "fill_blank"
    ? isSingleMarkdownFillBlankQuestion(question)
      ? question.points
      : question.blanks.reduce((total, blank) => total + blank.points, 0)
    : question.points;
}

function questionLabel(question: AnswerSheetQuestion): string {
  if (question.type === "single_choice") return "单选题";
  if (question.type === "multiple_choice") return "多选题";
  return "填空题";
}

export function countUnansweredQuestions(questions: AnswerSheetQuestion[], payload: Record<string, unknown>): number {
  const answers = asRecord(payload.answers);
  return questions.filter((question) => !isQuestionAnswered(question, asRecord(answers[question.id]))).length;
}

function isQuestionAnswered(question: AnswerSheetQuestion, answer: Record<string, unknown>): boolean {
  if (question.type === "single_choice") {
    return typeof answer.selectedOptionId === "string" && answer.selectedOptionId.length > 0;
  }
  if (question.type === "multiple_choice") {
    return Array.isArray(answer.selectedOptionIds) && answer.selectedOptionIds.length > 0;
  }
  if (isSingleMarkdownFillBlankQuestion(question)) {
    return typeof answer.answerMarkdown === "string" && answer.answerMarkdown.trim().length > 0;
  }
  const values = asRecord(answer.blankValues);
  return question.blanks.length > 0 && question.blanks.every((blank) => (
    typeof values[blank.id] === "string" && values[blank.id].trim().length > 0
  ));
}

function isQuestionErrorId(questionId: string, errorId: string): boolean {
  return errorId === questionId || errorId.startsWith(`${questionId}:`);
}

function formatStandardAnswers(
  question: AnswerSheetQuestion,
  answer: AnswerSheetPrivateAnswer | undefined,
): string[] {
  if (!answer) return ["未提供"];
  if (question.type === "single_choice" && answer.type === "single_choice") {
    return [question.options.find((option) => option.id === answer.correctOptionId)?.content ?? answer.correctOptionId];
  }
  if (question.type === "multiple_choice" && answer.type === "multiple_choice") {
    return [answer.correctOptionIds.map((id) => question.options.find((option) => option.id === id)?.content ?? id).join("；")];
  }
  if (question.type === "fill_blank" && answer.type === "fill_blank") {
    if (isSingleMarkdownFillBlankQuestion(question)) {
      if ("acceptedAnswerMarkdowns" in answer) return answer.acceptedAnswerMarkdowns;
      if ("answerMarkdown" in answer) return [answer.answerMarkdown];
      return ["未提供"];
    }
    if (!("blanks" in answer)) return ["未提供"];
    return [question.blanks.map((blank) => answer.blanks[blank.id]?.acceptedAnswers.join(" / ") ?? "").join("；")];
  }
  return ["未提供"];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValues(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
