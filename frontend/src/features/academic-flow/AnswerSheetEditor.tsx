import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";

import type {
  AnswerSheetConfig,
  AnswerSheetPrivateAnswer,
  AnswerSheetPrivateKey,
  AnswerSheetQuestion,
  AnswerSheetQuestionType,
} from "../../types";
import {
  answerSheetMaxScore,
  createAnswerSheetQuestion,
  createPrivateAnswer,
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
  const errors = validateAnswerSheetAuthoring(config, gradingKey);
  const maximum = answerSheetMaxScore(config);
  const questionIdKey = config.questions.map((question) => question.id).join("|");
  const [dragOverQuestionId, setDragOverQuestionId] = useState<string | null>(null);
  const [dragQuestionId, setDragQuestionId] = useState<string | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<AnswerSheetMenuTarget | null>(null);

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
      ...config,
      questions: config.questions.map((question) => (
        question.id === questionId ? nextQuestion : question
      )),
    }, gradingKey);
  };

  const updateAnswer = (questionId: string, answer: AnswerSheetPrivateAnswer) => {
    onChange(config, {
      ...gradingKey,
      answers: { ...gradingKey.answers, [questionId]: answer },
    });
  };

  const changeQuestionType = (question: AnswerSheetQuestion, type: AnswerSheetQuestionType) => {
    if (question.type === type) return;
    const replacement = {
      ...createAnswerSheetQuestion(type),
      content: question.content,
      id: question.id,
    } as AnswerSheetQuestion;
    onChange({
      ...config,
      questions: config.questions.map((item) => item.id === question.id ? replacement : item),
    }, {
      ...gradingKey,
      answers: { ...gradingKey.answers, [question.id]: createPrivateAnswer(replacement) },
    });
  };

  const addQuestion = (type: AnswerSheetQuestionType) => {
    const question = createAnswerSheetQuestion(type);
    onChange({ ...config, questions: [...config.questions, question] }, {
      ...gradingKey,
      answers: { ...gradingKey.answers, [question.id]: createPrivateAnswer(question) },
    });
    setExpandedQuestionId(question.id);
    setOpenMenu(null);
  };

  const removeQuestion = (questionId: string) => {
    const answers = { ...gradingKey.answers };
    delete answers[questionId];
    onChange({
      ...config,
      questions: config.questions.filter((question) => question.id !== questionId),
    }, { ...gradingKey, answers });
    setExpandedQuestionId((current) => current === questionId ? null : current);
    setOpenMenu(null);
  };

  const moveQuestion = (questionId: string, offset: -1 | 1) => {
    const questions = moveAnswerSheetQuestion(config.questions, questionId, offset);
    if (questions === config.questions) return;
    onChange({ ...config, questions }, gradingKey);
    setOpenMenu(null);
  };

  const dropQuestion = (event: DragEvent<HTMLElement>, targetQuestionId: string) => {
    event.preventDefault();
    if (!dragQuestionId || dragQuestionId === targetQuestionId) {
      setDragOverQuestionId(null);
      return;
    }
    const source = config.questions.findIndex((question) => question.id === dragQuestionId);
    const target = config.questions.findIndex((question) => question.id === targetQuestionId);
    if (source >= 0 && target >= 0) {
      onChange({ ...config, questions: reorderItem(config.questions, source, target) }, gradingKey);
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
            value={config.gradingPolicy.passingScore}
            onChange={(event) => onChange({
              ...config,
              gradingPolicy: {
                ...config.gradingPolicy,
                passingScore: Number(event.target.value),
              },
            }, gradingKey)}
          />
        </label>
        <label>
          <span>作答次数</span>
          <select
            disabled={disabled}
            value={config.gradingPolicy.maxAttempts ?? "unlimited"}
            onChange={(event) => onChange({
              ...config,
              gradingPolicy: {
                ...config.gradingPolicy,
                maxAttempts: event.target.value === "unlimited" ? null : Number(event.target.value),
              },
            }, gradingKey)}
          >
            <option value="unlimited">截止前不限</option>
            {[1, 2, 3, 5, 10].map((value) => <option key={value} value={value}>{value} 次</option>)}
          </select>
        </label>
        <label>
          <span>反馈</span>
          <select
            disabled={disabled}
            value={config.gradingPolicy.feedback}
            onChange={(event) => onChange({
              ...config,
              gradingPolicy: {
                ...config.gradingPolicy,
                feedback: event.target.value as AnswerSheetConfig["gradingPolicy"]["feedback"],
              },
            }, gradingKey)}
          >
            <option value="score_only">仅显示总分</option>
            <option value="question_result">显示逐题结果</option>
            <option value="full_after_deadline">截止后显示标准答案</option>
          </select>
        </label>
      </div>
      {errors._policy?.map((message) => <p className="answer-sheet-editor-error" key={message}>{message}</p>)}
      {config.gradingPolicy.feedback === "full_after_deadline" && !deadlineAt ? (
        <p className="answer-sheet-editor-error">“截止后显示标准答案”需要先在节点定时设置中填写截止时间。</p>
      ) : null}

      <div className="answer-sheet-question-list">
        {config.questions.map((question, index) => {
          const expanded = expandedQuestionId === question.id;
          const privateAnswer = gradingKey.answers[question.id] ?? createPrivateAnswer(question);
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
                <strong className="answer-sheet-question-index">第 {index + 1} 题</strong>
                <select
                  aria-label={`第 ${index + 1} 题题型`}
                  disabled={disabled}
                  value={question.type}
                  onChange={(event) => changeQuestionType(
                    question,
                    event.target.value as AnswerSheetQuestionType,
                  )}
                >
                  <option value="single_choice">单项选择题</option>
                  <option value="multiple_choice">多项选择题</option>
                  <option value="fill_blank">填空题</option>
                </select>
                <div
                  aria-controls={`answer-sheet-question-${question.id}`}
                  aria-expanded={expanded}
                  className="answer-sheet-question-meta-toggle"
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
                  <small>{getAnswerSheetQuestionMeta(question)}</small>
                  {questionErrors.length ? <span className="answer-sheet-error-badge">需修正</span> : null}
                  <span aria-hidden="true" className={`answer-sheet-chevron${expanded ? " expanded" : ""}`}>
                    <svg viewBox="0 0 16 16"><path d="m3.5 6 4.5 4 4.5-4" /></svg>
                  </span>
                </div>
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
                <CompactActionMenu
                  ariaLabel={`第 ${index + 1} 题操作`}
                  disabled={disabled}
                  items={[
                    { disabled: index === 0, label: "上移", onSelect: () => moveQuestion(question.id, -1) },
                    { disabled: index === config.questions.length - 1, label: "下移", onSelect: () => moveQuestion(question.id, 1) },
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
                  <MarkdownBlurEditor
                    disabled={disabled}
                    onChange={(content) => updateQuestion(question.id, { ...question, content })}
                    placeholder="输入 Markdown 题干"
                    value={question.content}
                  />

                  {question.type === "fill_blank" ? (
                    <FillBlankEditor
                      answer={privateAnswer}
                      disabled={disabled}
                      onAnswerChange={(answer) => updateAnswer(question.id, answer)}
                      onMenuChange={setOpenMenu}
                      onQuestionChange={(next) => updateQuestion(question.id, next)}
                      openMenu={openMenu}
                      question={question}
                    />
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
      {config.questions.length === 0 ? <p className="muted-line">该答题卡暂无题目。</p> : null}
    </section>
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
    const id = createId("option");
    onQuestionChange({ ...question, options: [...question.options, { id, content: "新增选项" }] });
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
              compact
              disabled={disabled}
              placeholder={`输入选项 ${index + 1}`}
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
        <label className="answer-sheet-points">
          分值
          <input
            disabled={disabled}
            min="1"
            type="number"
            value={question.points}
            onChange={(event) => onQuestionChange({ ...question, points: Number(event.target.value) })}
          />
        </label>
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
  onQuestionChange: (question: Extract<AnswerSheetQuestion, { type: "fill_blank" }>) => void;
  openMenu: AnswerSheetMenuTarget | null;
  question: Extract<AnswerSheetQuestion, { type: "fill_blank" }>;
}) {
  const blankAnswers = answer.type === "fill_blank" ? answer.blanks : {};
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
              <textarea disabled={disabled} value={privateBlank.acceptedAnswers.join("\n")} onChange={(event) => updateBlankAnswer(blank.id, {
                ...privateBlank,
                acceptedAnswers: event.target.value.split("\n"),
              })} />
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
        onAnswerChange({ type: "fill_blank", blanks: { ...blankAnswers, [id]: { acceptedAnswers: ["请输入答案"], caseSensitive: false } } });
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
