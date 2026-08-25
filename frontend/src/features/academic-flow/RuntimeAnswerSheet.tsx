import type {
  AcademicFlowNode,
  AnswerSheetGrade,
  AnswerSheetPrivateAnswer,
  AnswerSheetQuestion,
} from "../../types";
import { AnswerSheetMarkdown } from "./AnswerSheetMarkdown";

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
  if (!config) return null;
  const answers = asRecord(payload.answers);
  const update = (questionId: string, answer: Record<string, unknown>, fieldId?: string) => {
    onChange?.({ ...answers, [questionId]: answer }, fieldId ?? questionId);
  };
  return (
    <div className={`runtime-answer-sheet${readonly ? " is-readonly" : ""}`}>
      {config.questions.map((question, index) => {
        const answer = asRecord(answers[question.id]);
        return (
          <section className="runtime-answer-question" key={question.id}>
            <header>
              <strong>第 {index + 1} 题</strong>
              <span>{questionLabel(question)} · {questionPoints(question)} 分</span>
              {question.required ? <em>必答</em> : null}
            </header>
            {question.type === "fill_blank" ? (
              <FillQuestion
                answer={answer}
                errors={errors}
                instanceId={instanceId}
                onChange={(blankValues, fieldId) => update(question.id, { blankValues }, fieldId)}
                question={question}
                readonly={readonly}
              />
            ) : (
              <>
                <AnswerSheetMarkdown instanceId={instanceId}>{question.content}</AnswerSheetMarkdown>
                <fieldset disabled={readonly}>
                  {question.options.map((option) => {
                    const checked = question.type === "single_choice"
                      ? answer.selectedOptionId === option.id
                      : Array.isArray(answer.selectedOptionIds) && answer.selectedOptionIds.includes(option.id);
                    return (
                      <label className={checked ? "is-selected" : ""} key={option.id}>
                        <input
                          checked={checked}
                          name={`runtime-answer-${question.id}`}
                          type={question.type === "single_choice" ? "radio" : "checkbox"}
                          onChange={(event) => {
                            if (question.type === "single_choice") {
                              update(question.id, { selectedOptionId: option.id });
                              return;
                            }
                            const current = Array.isArray(answer.selectedOptionIds)
                              ? answer.selectedOptionIds.filter((value): value is string => typeof value === "string")
                              : [];
                            update(question.id, {
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
            {errors[question.id] ? <p className="runtime-field-error" role="alert">{errors[question.id]}</p> : null}
          </section>
        );
      })}
    </div>
  );
}

export function AnswerSheetGradeResult({
  grade,
  node,
}: {
  grade: AnswerSheetGrade;
  node: AcademicFlowNode;
}) {
  const results = new Map(grade.questionResults?.map((result) => [result.questionId, result]) ?? []);
  return (
    <section className={`answer-sheet-grade ${grade.passed ? "is-passed" : "is-failed"}`}>
      <header>
        <div><strong>{grade.score}</strong><span> / {grade.maxScore} 分</span></div>
        <em>{grade.passed ? "已达到及格要求" : `未达到 ${grade.passingScore} 分的及格要求`}</em>
      </header>
      {grade.questionResults?.length ? (
        <ol>
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
          <ol>{node.answerSheet?.questions.map((question, index) => (
            <li key={question.id}>第 {index + 1} 题：{formatStandardAnswer(question, grade.standardAnswers?.[question.id])}</li>
          ))}</ol>
        </div>
      ) : null}
    </section>
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
  question: Extract<AnswerSheetQuestion, { type: "fill_blank" }>;
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
    ? question.blanks.reduce((total, blank) => total + blank.points, 0)
    : question.points;
}

function questionLabel(question: AnswerSheetQuestion): string {
  if (question.type === "single_choice") return "单选题";
  if (question.type === "multiple_choice") return "多选题";
  return "填空题";
}

function formatStandardAnswer(
  question: AnswerSheetQuestion,
  answer: AnswerSheetPrivateAnswer | undefined,
): string {
  if (!answer) return "未提供";
  if (question.type === "single_choice" && answer.type === "single_choice") {
    return question.options.find((option) => option.id === answer.correctOptionId)?.content ?? answer.correctOptionId;
  }
  if (question.type === "multiple_choice" && answer.type === "multiple_choice") {
    return answer.correctOptionIds.map((id) => question.options.find((option) => option.id === id)?.content ?? id).join("；");
  }
  if (question.type === "fill_blank" && answer.type === "fill_blank") {
    return question.blanks.map((blank) => answer.blanks[blank.id]?.acceptedAnswers.join(" / ") ?? "").join("；");
  }
  return "未提供";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValues(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
