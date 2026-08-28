import type {
  AnswerSheetConfig,
  AnswerSheetLegacyFillBlankQuestion,
  AnswerSheetPrivateAnswer,
  AnswerSheetPrivateKey,
  AnswerSheetQuestion,
  AnswerSheetQuestionType,
  AnswerSheetSelectionQuestion,
  AnswerSheetSingleMarkdownFillBlankQuestion,
} from "../../types";

export const ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER = "请输入答案";

export type AnswerSheetAuthoring = {
  config: AnswerSheetConfig;
  key: AnswerSheetPrivateKey;
};

export function createAnswerSheetOption(): AnswerSheetSelectionQuestion["options"][number] {
  return { content: "", id: createStableId("option") };
}

export function createDefaultAnswerSheet(): AnswerSheetAuthoring {
  const question = createAnswerSheetQuestion("single_choice") as AnswerSheetSelectionQuestion;
  return {
    config: {
      gradingPolicy: {
        feedback: "question_result",
        maxAttempts: null,
        passingScore: question.points,
      },
      questions: [question],
      schemaVersion: "2.0",
    },
    key: {
      answers: {
        [question.id]: {
          correctOptionId: question.options[0].id,
          type: "single_choice",
        },
      },
      graderVersion: "answer-sheet-v2",
      schemaVersion: "2.0",
    },
  };
}

export function createAnswerSheetQuestion(type: AnswerSheetQuestionType): AnswerSheetQuestion {
  const id = createStableId("question");
  if (type === "fill_blank") {
    return {
      content: "",
      format: "single_markdown_exact",
      id,
      points: 1,
      required: true,
      type,
    };
  }
  return {
    content: "",
    id,
    options: [
      createAnswerSheetOption(),
      createAnswerSheetOption(),
    ],
    points: 1,
    required: true,
    type,
  };
}

export function createPrivateAnswer(question: AnswerSheetQuestion): AnswerSheetPrivateAnswer {
  if (question.type === "single_choice") {
    return { correctOptionId: question.options[0]?.id ?? "", type: question.type };
  }
  if (question.type === "multiple_choice") {
    return {
      correctOptionIds: question.options[0] ? [question.options[0].id] : [],
      mode: "exact_set",
      type: question.type,
    };
  }
  if (isSingleMarkdownFillBlankQuestion(question)) {
    return {
      answerMarkdown: "",
      format: "single_markdown_exact",
      type: question.type,
    };
  }
  return {
    blanks: Object.fromEntries(question.blanks.map((blank) => [
      blank.id,
      { acceptedAnswers: [""], caseSensitive: false },
    ])),
    type: question.type,
  };
}

export function answerSheetMaxScore(config: AnswerSheetConfig): number {
  return config.questions.reduce((total, question) => total + (
    question.type === "fill_blank"
      ? isSingleMarkdownFillBlankQuestion(question)
        ? question.points
        : question.blanks.reduce((sum, blank) => sum + blank.points, 0)
      : question.points
  ), 0);
}

export function isSingleMarkdownFillBlankQuestion(
  question: AnswerSheetQuestion,
): question is AnswerSheetSingleMarkdownFillBlankQuestion {
  return question.type === "fill_blank"
    && "format" in question
    && question.format === "single_markdown_exact";
}

export function upgradeAnswerSheetAuthoring(
  config: AnswerSheetConfig,
  key: AnswerSheetPrivateKey,
): AnswerSheetAuthoring {
  const answers = { ...key.answers };
  let changed = config.schemaVersion !== "2.0"
    || key.schemaVersion !== "2.0"
    || key.graderVersion !== "answer-sheet-v2";
  const questions = config.questions.map((question) => {
    if (question.type !== "fill_blank" || isSingleMarkdownFillBlankQuestion(question)) {
      return question;
    }
    const answer = answers[question.id];
    const upgraded = upgradeLegacyFillBlankQuestion(question, answer);
    if (!upgraded) return question;
    answers[question.id] = upgraded.answer;
    changed = true;
    return upgraded.question;
  });
  if (!changed) return { config, key };
  return {
    config: { ...config, questions, schemaVersion: "2.0" },
    key: {
      ...key,
      answers,
      graderVersion: "answer-sheet-v2",
      schemaVersion: "2.0",
    },
  };
}

export function validateAnswerSheetAuthoring(
  config: AnswerSheetConfig,
  key: AnswerSheetPrivateKey,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const add = (id: string, message: string) => {
    const current = errors[id] ?? [];
    if (!current.includes(message)) errors[id] = [...current, message];
  };
  const ids = new Set<string>();
  if (!config.questions.length) add("_questions", "至少需要一道题");
  for (const question of config.questions) {
    if (!question.id || ids.has(question.id)) add(question.id || "_questions", "题目标识无效或重复");
    ids.add(question.id);
    if (!question.content.trim()) add(question.id, "题干不能为空");
    if (hasExternalMarkdownImage(question.content)) add(question.id, "图片必须使用题图上传按钮插入");
    const privateAnswer = key.answers[question.id];
    if (question.type === "single_choice") {
      validateSelectionQuestion(question, add);
      if (
        privateAnswer?.type !== "single_choice"
        || !question.options.some((option) => option.id === privateAnswer.correctOptionId)
      ) {
        add(question.id, "请选择唯一正确答案");
      }
      continue;
    }
    if (question.type === "multiple_choice") {
      validateSelectionQuestion(question, add);
      if (
        privateAnswer?.type !== "multiple_choice"
        || !privateAnswer.correctOptionIds.length
        || privateAnswer.correctOptionIds.some((optionId) =>
          !question.options.some((option) => option.id === optionId)
        )
      ) {
        add(question.id, "请至少选择一个正确答案");
      }
      continue;
    }
    if (isSingleMarkdownFillBlankQuestion(question)) {
      validateSingleMarkdownFillQuestion(question, privateAnswer, add);
    } else {
      validateLegacyFillQuestion(question, privateAnswer, add);
    }
  }
  for (const questionId of Object.keys(key.answers)) {
    if (!ids.has(questionId)) add(questionId, "标准答案对应的题目不存在");
  }
  const maximum = answerSheetMaxScore(config);
  if (
    !Number.isInteger(config.gradingPolicy.passingScore)
    || config.gradingPolicy.passingScore < 0
    || config.gradingPolicy.passingScore > maximum
  ) {
    add("_policy", "及格分必须是 0 到总分之间的整数");
  }
  const attempts = config.gradingPolicy.maxAttempts;
  if (attempts !== null && (!Number.isInteger(attempts) || attempts < 1 || attempts > 99)) {
    add("_policy", "作答次数必须为 1 到 99");
  }
  return errors;
}

export function validateAnswerSheetSubmission(
  config: AnswerSheetConfig,
  payload: Record<string, unknown>,
  strict: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const rawAnswers = asRecord(payload.answers) ?? payload;
  const questionIds = new Set(config.questions.map((question) => question.id));
  for (const answerId of Object.keys(rawAnswers)) {
    if (!questionIds.has(answerId)) errors[answerId] = "题目标识无效";
  }
  for (const question of config.questions) {
    const answer = asRecord(rawAnswers[question.id]);
    if (!answer) {
      if (strict && question.required) errors[question.id] = requiredMessage(question);
      continue;
    }
    if (question.type === "single_choice") {
      const selected = answer.selectedOptionId;
      if ((selected === undefined || selected === null || selected === "") && (!strict || !question.required)) {
        continue;
      }
      if (!question.options.some((option) => option.id === selected)) {
        errors[question.id] = "请选择一项";
      }
      continue;
    }
    if (question.type === "multiple_choice") {
      const selected = answer.selectedOptionIds;
      if (Array.isArray(selected) && !selected.length && (!strict || !question.required)) {
        continue;
      }
      if (
        !Array.isArray(selected)
        || !selected.length
        || new Set(selected).size !== selected.length
        || selected.some((value) =>
          typeof value !== "string" || !question.options.some((option) => option.id === value)
        )
      ) {
        errors[question.id] = "请至少选择一项";
      }
      continue;
    }
    if (isSingleMarkdownFillBlankQuestion(question)) {
      const answerMarkdown = answer.answerMarkdown;
      if (
        typeof answerMarkdown !== "string"
        || (strict && question.required && !answerMarkdown.trim())
      ) {
        errors[question.id] = "请输入答案";
      }
      continue;
    }
    const values = asRecord(answer.blankValues);
    if (
      values
      && (!strict || !question.required)
      && question.blanks.every((blank) => (
        typeof values[blank.id] === "string" && !(values[blank.id] as string).trim()
      ))
    ) {
      continue;
    }
    for (const blank of question.blanks) {
      if (typeof values?.[blank.id] !== "string" || !(values[blank.id] as string).trim()) {
        errors[`${question.id}:${blank.id}`] = "请填写此空";
      }
    }
  }
  return errors;
}

function validateSelectionQuestion(
  question: AnswerSheetSelectionQuestion,
  add: (id: string, message: string) => void,
) {
  if (!Number.isInteger(question.points) || question.points <= 0) {
    add(question.id, "分值必须是正整数");
  }
  if (question.options.length < 2) add(question.id, "至少需要两个选项");
  const optionIds = new Set<string>();
  for (const option of question.options) {
    if (!option.id || optionIds.has(option.id)) add(question.id, "选项标识无效或重复");
    if (!option.content.trim()) add(question.id, "选项内容不能为空");
    if (hasExternalMarkdownImage(option.content)) add(question.id, "选项图片必须使用教师上传的题图");
    optionIds.add(option.id);
  }
}

function validateSingleMarkdownFillQuestion(
  question: AnswerSheetSingleMarkdownFillBlankQuestion,
  privateAnswer: AnswerSheetPrivateAnswer | undefined,
  add: (id: string, message: string) => void,
) {
  if (!Number.isInteger(question.points) || question.points <= 0) {
    add(question.id, "分值必须是正整数");
  }
  if (
    privateAnswer?.type !== "fill_blank"
    || !("format" in privateAnswer)
    || privateAnswer.format !== "single_markdown_exact"
    || !privateAnswer.answerMarkdown.trim()
  ) {
    add(question.id, "请输入标准答案");
  }
}

function validateLegacyFillQuestion(
  question: AnswerSheetLegacyFillBlankQuestion,
  privateAnswer: AnswerSheetPrivateAnswer | undefined,
  add: (id: string, message: string) => void,
) {
  if (!question.blanks.length) add(question.id, "至少需要一个填空");
  const markers = [...question.content.matchAll(/\[\[blank:([A-Za-z0-9_-]+)\]\]/g)]
    .map((match) => match[1]);
  const blankIds = new Set<string>();
  for (const blank of question.blanks) {
    if (!blank.id || blankIds.has(blank.id)) add(question.id, "填空标识无效或重复");
    if (!Number.isInteger(blank.points) || blank.points <= 0) add(question.id, "填空分值必须是正整数");
    const marker = `[[blank:${blank.id}]]`;
    if (question.content.split(marker).length !== 2) add(question.id, "题干标记必须与填空配置一一对应");
    blankIds.add(blank.id);
    const acceptedAnswers = privateAnswer?.type === "fill_blank" && "blanks" in privateAnswer
      ? privateAnswer.blanks[blank.id]?.acceptedAnswers
      : undefined;
    const hasAcceptedAnswer = acceptedAnswers?.some((value) => (
      value.trim() && value.trim() !== ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER
    )) ?? false;
    const hasPlaceholder = acceptedAnswers?.some(
      (value) => value.trim() === ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER,
    ) ?? false;
    if (!hasAcceptedAnswer || hasPlaceholder) {
      add(question.id, `填空 ${blank.id} 至少需要一个答案`);
    }
  }
  if (markers.length !== new Set(markers).size || markers.some((id) => !blankIds.has(id))) {
    add(question.id, "题干标记必须与填空配置一一对应");
  }
}

function requiredMessage(question: AnswerSheetQuestion): string {
  if (question.type === "single_choice") return "请选择一项";
  if (question.type === "multiple_choice") return "请至少选择一项";
  return isSingleMarkdownFillBlankQuestion(question) ? "请输入答案" : "请完成所有填空";
}

function upgradeLegacyFillBlankQuestion(
  question: AnswerSheetLegacyFillBlankQuestion,
  answer: AnswerSheetPrivateAnswer | undefined,
): {
  answer: AnswerSheetPrivateAnswer;
  question: AnswerSheetSingleMarkdownFillBlankQuestion;
} | null {
  if (question.blanks.length !== 1 || answer?.type !== "fill_blank" || !("blanks" in answer)) {
    return null;
  }
  const blank = question.blanks[0];
  const blankAnswer = answer.blanks[blank.id];
  if (!blankAnswer || blankAnswer.caseSensitive || Object.keys(answer.blanks).length !== 1) {
    return null;
  }
  const acceptedAnswers = blankAnswer.acceptedAnswers.filter((value) => (
    value.trim() && value.trim() !== ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER
  ));
  if (acceptedAnswers.length) return null;
  const marker = `[[blank:${blank.id}]]`;
  const markers = [...question.content.matchAll(/\[\[blank:([A-Za-z0-9_-]+)\]\]/g)];
  if (markers.length !== 1 || markers[0][1] !== blank.id) return null;
  const legacyPlaceholder = `请输入题干，并在需要作答的位置保留 ${marker}。`;
  return {
    answer: {
      answerMarkdown: "",
      format: "single_markdown_exact",
      type: "fill_blank",
    },
    question: {
      content: question.content === legacyPlaceholder ? "" : question.content.replace(marker, ""),
      format: "single_markdown_exact",
      id: question.id,
      points: blank.points,
      required: question.required,
      type: "fill_blank",
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function createStableId(prefix: "blank" | "option" | "question"): string {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${value}`;
}

function hasExternalMarkdownImage(value: string): boolean {
  return [...value.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?[^)]*\)/g)]
    .some((match) => !/^asset:\/\/[A-Za-z0-9-]+$/.test(match[1]));
}
