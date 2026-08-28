import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";

import type {
  AnswerSheetConfig,
  AnswerSheetLegacyFillBlankQuestion,
  AnswerSheetPrivateAnswer,
  AnswerSheetPrivateKey,
  AnswerSheetQuestion,
  AnswerSheetQuestionType,
} from "../../types";
import {
  ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER,
  answerSheetMaxScore,
  createAnswerSheetOption,
  createAnswerSheetQuestion,
  createPrivateAnswer,
  isSingleMarkdownFillBlankQuestion,
  upgradeAnswerSheetAuthoring,
  validateAnswerSheetAuthoring,
} from "./answerSheet";
import {
  getAnswerSheetQuestionMeta,
  moveAnswerSheetQuestion,
  toggleExpandedQuestion,
} from "./answerSheetEditorState";
import { MarkdownBlurEditor } from "./MarkdownBlurEditor";
import { reorderItem } from "./reorder";

type AnswerSheetMenuTarget =
  | { kind: "question"; questionId: string }
  | { kind: "option"; optionId: string; questionId: string }
  | { blankId: string; kind: "blank"; questionId: string };

type ActionMenuItem = {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
};

const LEGACY_QUESTION_PLACEHOLDERS = ["请输入题干"] as const;
const LEGACY_OPTION_PLACEHOLDERS = ["选项 1", "选项 2", "新增选项"] as const;

const questionTypeLabels: Record<AnswerSheetQuestionType, string> = {
  fill_blank: "填空",
  multiple_choice: "多选",
  single_choice: "单选",
};

export function AnswerSheetEditor({
  config,
  deadlineAt,
  disabled,
  gradingKey,
  onChange,
}: {
  config: AnswerSheetConfig;
  deadlineAt?: string | null;
  disabled: boolean;
  gradingKey: AnswerSheetPrivateKey;
  onChange: (config: AnswerSheetConfig, gradingKey: AnswerSheetPrivateKey) => void;
}) {
  const authoring = disabled
    ? { config, key: gradingKey }
    : upgradeAnswerSheetAuthoring(config, gradingKey);
  const activeConfig = authoring.config;
  const activeKey = authoring.key;
  const errors = validateAnswerSheetAuthoring(activeConfig, activeKey);
  const maximum = answerSheetMaxScore(activeConfig);
  const questionIdKey = activeConfig.questions.map((question) => question.id).join("|");
  const [dragOverQuestionId, setDragOverQuestionId] = useState<string | null>(null);
  const [dragQuestionId, setDragQuestionId] = useState<string | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<AnswerSheetMenuTarget | null>(null);

  useEffect(() => {
    if (disabled || (activeConfig === config && activeKey === gradingKey)) return;
    onChange(activeConfig, activeKey);
  }, [activeConfig, activeKey, config, disabled, gradingKey, onChange]);

  useEffect(() => {
    const questionIds = new Set(questionIdKey ? questionIdKey.split("|") : []);
    setExpandedQuestionId((current) => current && questionIds.has(current) ? current : null);
    setOpenMenu((current) => current && questionIds.has(current.questionId) ? current : null);
    setDragQuestionId((current) => current && questionIds.has(current) ? current : null);
    setDragOverQuestionId((current) => current && questionIds.has(current) ? current : null);
  }, [questionIdKey]);

  useEffect(() => {
    if (!openMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-answer-sheet-menu]")) return;
      setOpenMenu(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!disabled) return;
    setDragOverQuestionId(null);
    setDragQuestionId(null);
    setOpenMenu(null);
  }, [disabled]);

  const updateQuestion = (questionId: string, nextQuestion: AnswerSheetQuestion) => {
    onChange({
      ...activeConfig,
      questions: activeConfig.questions.map((question) => (
        question.id === questionId ? nextQuestion : question
      )),
    }, activeKey);
  };

  const updateAnswer = (questionId: string, answer: AnswerSheetPrivateAnswer) => {
    onChange(activeConfig, {
      ...activeKey,
      answers: { ...activeKey.answers, [questionId]: answer },
    });
  };

  const addQuestion = (type: AnswerSheetQuestionType) => {
    const question = createAnswerSheetQuestion(type);
    onChange({ ...activeConfig, questions: [...activeConfig.questions, question] }, {
      ...activeKey,
      answers: { ...activeKey.answers, [question.id]: createPrivateAnswer(question) },
    });
    setExpandedQuestionId(question.id);
    setOpenMenu(null);
  };

  const removeQuestion = (questionId: string) => {
    const answers = { ...activeKey.answers };
    delete answers[questionId];
    onChange({
      ...activeConfig,
      questions: activeConfig.questions.filter((question) => question.id !== questionId),
    }, { ...activeKey, answers });
    setExpandedQuestionId((current) => current === questionId ? null : current);
    setOpenMenu(null);
  };

  const moveQuestion = (questionId: string, offset: -1 | 1) => {
    const questions = moveAnswerSheetQuestion(activeConfig.questions, questionId, offset);
    if (questions === activeConfig.questions) return;
    onChange({ ...activeConfig, questions }, activeKey);
    setOpenMenu(null);
  };

  const dropQuestion = (event: DragEvent<HTMLElement>, targetQuestionId: string) => {
    event.preventDefault();
    if (!dragQuestionId || dragQuestionId === targetQuestionId) {
      setDragOverQuestionId(null);
      return;
    }
    const source = activeConfig.questions.findIndex((question) => question.id === dragQuestionId);
    const target = activeConfig.questions.findIndex((question) => question.id === targetQuestionId);
    if (source >= 0 && target >= 0) {
      onChange({ ...activeConfig, questions: reorderItem(activeConfig.questions, source, target) }, activeKey);
    }
    setDragOverQuestionId(null);
    setDragQuestionId(null);
  };

  return (
    <section className="answer-sheet-editor">
      <header className="answer-sheet-editor-heading">
        <div className="answer-sheet-heading-summary">
          <strong>答题卡</strong>
          <small>Markdown、数学与自动判分</small>
          <span>总分 {maximum}</span>
        </div>
        <div className="answer-sheet-add-actions">
          <button disabled={disabled} onClick={() => addQuestion("single_choice")} type="button">添加单选题</button>
          <button disabled={disabled} onClick={() => addQuestion("multiple_choice")} type="button">添加多选题</button>
          <button disabled={disabled} onClick={() => addQuestion("fill_blank")} type="button">添加填空题</button>
        </div>
      </header>

      <div className="answer-sheet-policy">
        <label>
          <span>及格分</span>
          <input
            disabled={disabled}
            max={maximum}
            min="0"
            type="number"
            value={activeConfig.gradingPolicy.passingScore}
            onChange={(event) => onChange({
              ...activeConfig,
              gradingPolicy: {
                ...activeConfig.gradingPolicy,
                passingScore: Number(event.target.value),
              },
            }, activeKey)}
          />
        </label>
        <label>
          <span>作答次数</span>
          <select
            disabled={disabled}
            value={activeConfig.gradingPolicy.maxAttempts ?? "unlimited"}
            onChange={(event) => onChange({
              ...activeConfig,
              gradingPolicy: {
                ...activeConfig.gradingPolicy,
                maxAttempts: event.target.value === "unlimited" ? null : Number(event.target.value),
              },
            }, activeKey)}
          >
            <option value="unlimited">截止前不限</option>
            {[1, 2, 3, 5, 10].map((value) => <option key={value} value={value}>{value} 次</option>)}
          </select>
        </label>
        <label>
          <span>反馈</span>
          <select
            disabled={disabled}
            value={activeConfig.gradingPolicy.feedback}
            onChange={(event) => onChange({
              ...activeConfig,
              gradingPolicy: {
                ...activeConfig.gradingPolicy,
                feedback: event.target.value as AnswerSheetConfig["gradingPolicy"]["feedback"],
              },
            }, activeKey)}
          >
            <option value="score_only">仅显示总分</option>
            <option value="question_result">显示逐题结果</option>
            <option value="full_after_deadline">截止后显示标准答案</option>
          </select>
        </label>
      </div>
      {errors._policy?.map((message) => <p className="answer-sheet-editor-error" key={message}>{message}</p>)}
      {activeConfig.gradingPolicy.feedback === "full_after_deadline" && !deadlineAt ? (
        <p className="answer-sheet-editor-error">“截止后显示标准答案”需要先在节点定时设置中填写截止时间。</p>
      ) : null}

      <div className="answer-sheet-question-list">
        {activeConfig.questions.map((question, index) => {
          const expanded = expandedQuestionId === question.id;
          const singleMarkdownFill = isSingleMarkdownFillBlankQuestion(question);
          const privateAnswer = activeKey.answers[question.id] ?? createPrivateAnswer(question);
          const questionErrors = errors[question.id] ?? [];
          const questionMenuOpen = openMenu?.kind === "question"
            && openMenu.questionId === question.id;
          return (
            <article
              className={`answer-sheet-question-editor${expanded ? " is-expanded" : ""}${
                questionErrors.length ? " has-errors" : ""
              }${dragOverQuestionId === question.id ? " is-drag-over" : ""}`}
              key={question.id}
              onDragOver={(event) => {
                if (!dragQuestionId || disabled) return;
                event.preventDefault();
                setDragOverQuestionId(question.id);
              }}
              onDrop={(event) => dropQuestion(event, question.id)}
            >
              <div className="answer-sheet-question-summary">
                <QuestionReorderHandle
                  disabled={disabled}
                  dragging={dragQuestionId === question.id}
                  index={index}
                  onDragEnd={() => {
                    setDragOverQuestionId(null);
                    setDragQuestionId(null);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", question.id);
                    setDragQuestionId(question.id);
                    setOpenMenu(null);
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                    event.preventDefault();
                    moveQuestion(question.id, event.key === "ArrowUp" ? -1 : 1);
                  }}
                />
                <div
                  aria-controls={`answer-sheet-question-${question.id}`}
                  aria-expanded={expanded}
                  className="answer-sheet-question-toggle"
                  onClick={() => {
                    setExpandedQuestionId((current) => toggleExpandedQuestion(current, question.id));
                    setOpenMenu(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setExpandedQuestionId((current) => toggleExpandedQuestion(current, question.id));
                    setOpenMenu(null);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <strong className="answer-sheet-question-index">第 {index + 1} 题</strong>
                  <span className="answer-sheet-question-meta">
                    <small>
                      {questionTypeLabels[question.type]} · {getAnswerSheetQuestionMeta(question)}
                    </small>
                    {questionErrors.length ? <span className="answer-sheet-error-badge">需修正</span> : null}
                    <span aria-hidden="true" className={`answer-sheet-chevron${expanded ? " expanded" : ""}`}>
                      <svg viewBox="0 0 16 16"><path d="m3.5 6 4.5 4 4.5-4" /></svg>
                    </span>
                  </span>
                </div>
                <CompactActionMenu
                  ariaLabel={`第 ${index + 1} 题操作`}
                  disabled={disabled}
                  items={[
                    { disabled: index === 0, label: "上移", onSelect: () => moveQuestion(question.id, -1) },
                    { disabled: index === activeConfig.questions.length - 1, label: "下移", onSelect: () => moveQuestion(question.id, 1) },
                    { danger: true, label: "删除题目", onSelect: () => removeQuestion(question.id) },
                  ]}
                  onOpenChange={(open) => setOpenMenu(open
                    ? { kind: "question", questionId: question.id }
                    : null)}
                  open={questionMenuOpen}
                />
              </div>

              {expanded ? (
                <div className="answer-sheet-question-content" id={`answer-sheet-question-${question.id}`}>
                  <div className="answer-sheet-question-settings">
                    {"points" in question ? (
                      <label className="answer-sheet-question-points">
                        <span>分值</span>
                        <input
                          disabled={disabled}
                          min="1"
                          type="number"
                          value={question.points}
                          onChange={(event) => updateQuestion(
                            question.id,
                            { ...question, points: Number(event.target.value) },
                          )}
                        />
                      </label>
                    ) : null}
                    <label className="answer-sheet-required">
                      <input
                        checked={question.required}
                        disabled={disabled}
                        type="checkbox"
                        onChange={(event) => updateQuestion(
                          question.id,
                          { ...question, required: event.target.checked },
                        )}
                      />
                      必答
                    </label>
                  </div>
                  <div className="answer-sheet-question-markdown">
                    <MarkdownBlurEditor
                      clearOnEditValues={question.type === "fill_blank" ? [] : LEGACY_QUESTION_PLACEHOLDERS}
                      disabled={disabled}
                      onChange={(content) => updateQuestion(question.id, { ...question, content })}
                      placeholder={singleMarkdownFill ? "请输入题干" : question.type === "fill_blank" ? "输入 Markdown 题干" : "请输入题干"}
                      value={question.content}
                    />
                  </div>

                  {question.type === "fill_blank" ? (
                    singleMarkdownFill ? (
                      <SingleMarkdownFillBlankEditor
                        answer={privateAnswer}
                        disabled={disabled}
                        onAnswerChange={(answer) => updateAnswer(question.id, answer)}
                      />
                    ) : (
                      <FillBlankEditor
                        answer={privateAnswer}
                        disabled={disabled}
                        onAnswerChange={(answer) => updateAnswer(question.id, answer)}
                        onMenuChange={setOpenMenu}
                        onQuestionChange={(next) => updateQuestion(question.id, next)}
                        openMenu={openMenu}
                        question={question}
                      />
                    )
                  ) : (
                    <SelectionEditor
                      answer={privateAnswer}
                      disabled={disabled}
                      onAnswerChange={(answer) => updateAnswer(question.id, answer)}
                      onMenuChange={setOpenMenu}
                      onQuestionChange={(next) => updateQuestion(question.id, next)}
                      openMenu={openMenu}
                      question={question}
                    />
                  )}
                  {questionErrors.map((message) => (
                    <p className="answer-sheet-editor-error" key={message}>{message}</p>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {errors._questions?.map((message) => <p className="answer-sheet-editor-error" key={message}>{message}</p>)}
      {activeConfig.questions.length === 0 ? <p className="muted-line">该答题卡暂无题目。</p> : null}
    </section>
  );
}

function SingleMarkdownFillBlankEditor({
  answer,
  disabled,
  onAnswerChange,
}: {
  answer: AnswerSheetPrivateAnswer;
  disabled: boolean;
  onAnswerChange: (answer: AnswerSheetPrivateAnswer) => void;
}) {
  const answerMarkdown = answer.type === "fill_blank" && "answerMarkdown" in answer
    ? answer.answerMarkdown
    : "";
  return (
    <div className="answer-sheet-single-answer-editor">
      <div className="answer-sheet-single-answer-heading">
        <strong>标准答案</strong>
        <span>去除首尾空白后精确匹配</span>
      </div>
      <MarkdownBlurEditor
        disabled={disabled}
        onChange={(value) => onAnswerChange({
          answerMarkdown: value,
          format: "single_markdown_exact",
          type: "fill_blank",
        })}
        placeholder="请输入标准答案"
        value={answerMarkdown}
      />
    </div>
  );
}

function SelectionEditor({
  answer,
  disabled,
  onAnswerChange,
  onMenuChange,
  onQuestionChange,
  openMenu,
  question,
}: {
  answer: AnswerSheetPrivateAnswer;
  disabled: boolean;
  onAnswerChange: (answer: AnswerSheetPrivateAnswer) => void;
  onMenuChange: (target: AnswerSheetMenuTarget | null) => void;
  onQuestionChange: (question: Extract<AnswerSheetQuestion, { type: "single_choice" | "multiple_choice" }>) => void;
  openMenu: AnswerSheetMenuTarget | null;
  question: Extract<AnswerSheetQuestion, { type: "single_choice" | "multiple_choice" }>;
}) {
  const addOption = () => {
    onQuestionChange({ ...question, options: [...question.options, createAnswerSheetOption()] });
  };
  return (
    <div className="answer-sheet-option-editor">
      <div className="answer-sheet-option-heading">
        <strong>选项与正确答案</strong>
        <span>{question.options.length} 项</span>
      </div>
      {question.options.map((option, index) => {
        const checked = answer.type === "single_choice"
          ? answer.correctOptionId === option.id
          : answer.type === "multiple_choice" && answer.correctOptionIds.includes(option.id);
        const menuOpen = openMenu?.kind === "option"
          && openMenu.questionId === question.id
          && openMenu.optionId === option.id;
        return (
          <div className="answer-sheet-option-row" key={option.id}>
            <input
              aria-label={`选项 ${index + 1} 为正确答案`}
              checked={checked}
              disabled={disabled}
              name={`answer-${question.id}`}
              type={question.type === "single_choice" ? "radio" : "checkbox"}
              onChange={(event) => {
                if (question.type === "single_choice") {
                  onAnswerChange({ type: "single_choice", correctOptionId: option.id });
                  return;
                }
                const current = answer.type === "multiple_choice" ? answer.correctOptionIds : [];
                onAnswerChange({
                  type: "multiple_choice",
                  mode: "exact_set",
                  correctOptionIds: event.target.checked
                    ? [...current, option.id]
                    : current.filter((id) => id !== option.id),
                });
              }}
            />
            <MarkdownBlurEditor
              clearOnEditValues={LEGACY_OPTION_PLACEHOLDERS}
              compact
              disabled={disabled}
              placeholder={`选项 ${index + 1}`}
              value={option.content}
              onChange={(content) => onQuestionChange({
                ...question,
                options: question.options.map((item) => item.id === option.id ? { ...item, content } : item),
              })}
            />
            <CompactActionMenu
              ariaLabel={`选项 ${index + 1} 操作`}
              disabled={disabled || question.options.length <= 2}
              items={[{
                danger: true,
                label: "删除选项",
                onSelect: () => {
                  const options = question.options.filter((item) => item.id !== option.id);
                  onQuestionChange({ ...question, options });
                  if (checked) onAnswerChange(createPrivateAnswer({ ...question, options }));
                },
              }]}
              onOpenChange={(open) => onMenuChange(open
                ? { kind: "option", optionId: option.id, questionId: question.id }
                : null)}
              open={menuOpen}
            />
          </div>
        );
      })}
      <div className="answer-sheet-selection-footer">
        <button disabled={disabled} onClick={addOption} type="button">添加选项</button>
      </div>
    </div>
  );
}

function FillBlankEditor({
  answer,
  disabled,
  onAnswerChange,
  onMenuChange,
  onQuestionChange,
  openMenu,
  question,
}: {
  answer: AnswerSheetPrivateAnswer;
  disabled: boolean;
  onAnswerChange: (answer: AnswerSheetPrivateAnswer) => void;
  onMenuChange: (target: AnswerSheetMenuTarget | null) => void;
  onQuestionChange: (question: AnswerSheetLegacyFillBlankQuestion) => void;
  openMenu: AnswerSheetMenuTarget | null;
  question: AnswerSheetLegacyFillBlankQuestion;
}) {
  const blankAnswers = answer.type === "fill_blank" && "blanks" in answer ? answer.blanks : {};
  const updateBlankAnswer = (
    blankId: string,
    value: { acceptedAnswers: string[]; caseSensitive: boolean },
  ) => onAnswerChange({ type: "fill_blank", blanks: { ...blankAnswers, [blankId]: value } });

  return (
    <div className="answer-sheet-blank-editor">
      <div className="answer-sheet-option-heading">
        <strong>填空与标准答案</strong>
        <span>{question.blanks.length} 空</span>
      </div>
      {question.blanks.map((blank, index) => {
        const privateBlank = blankAnswers[blank.id] ?? { acceptedAnswers: [""], caseSensitive: false };
        const hasLegacyPlaceholder = privateBlank.acceptedAnswers.length === 1
          && privateBlank.acceptedAnswers[0].trim() === ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER;
        const menuOpen = openMenu?.kind === "blank"
          && openMenu.questionId === question.id
          && openMenu.blankId === blank.id;
        return (
          <div className="answer-sheet-blank-row" key={blank.id}>
            <code title="在题干 Markdown 中移动此标记">{`[[blank:${blank.id}]]`}</code>
            <label>分值 <input disabled={disabled} min="1" type="number" value={blank.points} onChange={(event) => onQuestionChange({
              ...question,
              blanks: question.blanks.map((item) => item.id === blank.id ? { ...item, points: Number(event.target.value) } : item),
            })} /></label>
            <label className="answer-sheet-accepted-answers">
              可接受答案（每行一个）
              <textarea
                disabled={disabled}
                placeholder={ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER}
                value={hasLegacyPlaceholder ? "" : privateBlank.acceptedAnswers.join("\n")}
                onFocus={() => {
                  if (hasLegacyPlaceholder) {
                    updateBlankAnswer(blank.id, { ...privateBlank, acceptedAnswers: [""] });
                  }
                }}
                onChange={(event) => updateBlankAnswer(blank.id, {
                  ...privateBlank,
                  acceptedAnswers: event.target.value.split("\n"),
                })}
              />
            </label>
            <label className="answer-sheet-case-sensitive"><input checked={privateBlank.caseSensitive} disabled={disabled} type="checkbox" onChange={(event) => updateBlankAnswer(blank.id, { ...privateBlank, caseSensitive: event.target.checked })} /> 区分大小写</label>
            <CompactActionMenu
              ariaLabel={`第 ${index + 1} 空操作`}
              disabled={disabled || question.blanks.length <= 1}
              items={[{
                danger: true,
                label: "删除此空",
                onSelect: () => {
                  const blanks = question.blanks.filter((item) => item.id !== blank.id);
                  const nextAnswers = { ...blankAnswers };
                  delete nextAnswers[blank.id];
                  onQuestionChange({ ...question, blanks, content: question.content.replaceAll(`[[blank:${blank.id}]]`, "") });
                  onAnswerChange({ type: "fill_blank", blanks: nextAnswers });
                },
              }]}
              onOpenChange={(open) => onMenuChange(open
                ? { blankId: blank.id, kind: "blank", questionId: question.id }
                : null)}
              open={menuOpen}
            />
          </div>
        );
      })}
      <button className="answer-sheet-add-blank" disabled={disabled} onClick={() => {
        const id = createId("blank");
        onQuestionChange({ ...question, blanks: [...question.blanks, { id, points: 1 }], content: `${question.content} [[blank:${id}]]` });
        onAnswerChange({ type: "fill_blank", blanks: { ...blankAnswers, [id]: { acceptedAnswers: [""], caseSensitive: false } } });
      }} type="button">添加填空</button>
    </div>
  );
}

function QuestionReorderHandle({
  disabled,
  dragging,
  index,
  onDragEnd,
  onDragStart,
  onKeyDown,
}: {
  disabled: boolean;
  dragging: boolean;
  index: number;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={`拖拽第 ${index + 1} 题排序`}
      className={`answer-sheet-reorder-handle${dragging ? " dragging" : ""}`}
      disabled={disabled}
      draggable={!disabled}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
      title="拖拽排序；Alt + 方向键可逐题移动"
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 12 16">
        <circle cx="3" cy="3" r="1.2" />
        <circle cx="9" cy="3" r="1.2" />
        <circle cx="3" cy="8" r="1.2" />
        <circle cx="9" cy="8" r="1.2" />
        <circle cx="3" cy="13" r="1.2" />
        <circle cx="9" cy="13" r="1.2" />
      </svg>
    </button>
  );
}

function CompactActionMenu({
  ariaLabel,
  disabled,
  items,
  onOpenChange,
  open,
}: {
  ariaLabel: string;
  disabled: boolean;
  items: ActionMenuItem[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <div className="answer-sheet-action-menu-wrap" data-answer-sheet-menu>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className="answer-sheet-menu-trigger"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <circle cx="3" cy="8" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="13" cy="8" r="1.2" />
        </svg>
      </button>
      {open ? (
        <div aria-label={ariaLabel} className="answer-sheet-action-menu" role="menu">
          {items.map((item) => (
            <button
              className={item.danger ? "danger" : undefined}
              disabled={item.disabled}
              key={item.label}
              onClick={() => {
                item.onSelect();
                onOpenChange(false);
              }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function createId(prefix: "blank" | "option") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
}
