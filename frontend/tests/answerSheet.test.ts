import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER,
  createAnswerSheetOption,
  createAnswerSheetQuestion,
  createPrivateAnswer,
  createDefaultAnswerSheet,
  validateAnswerSheetAuthoring,
  validateAnswerSheetSubmission,
} from "../src/features/academic-flow/answerSheet.ts";
import {
  fromStandardMathMarkdown,
  toStandardMathMarkdown,
} from "../src/features/academic-flow/answerSheetMarkdown.ts";
import { getAnswerSheetPublishIssue } from "../src/features/academic-flow/answerSheetPublishPreflight.ts";
import {
  getAnswerSheetQuestionMeta,
  moveAnswerSheetQuestion,
  toggleExpandedQuestion,
} from "../src/features/academic-flow/answerSheetEditorState.ts";
import {
  resolveMarkdownEditorMode,
  resolveMarkdownValueOnEdit,
} from "../src/features/academic-flow/markdownBlurEditor.ts";
import { restrictBasicMarkdownTree } from "../src/features/academic-flow/basicAnswerSheetMarkdown.ts";
import type { AcademicFlowNode } from "../src/types.ts";

test("new answer sheet keeps authoring prompts out of business content", () => {
  const { config, key } = createDefaultAnswerSheet();

  assert.equal(config.schemaVersion, "1.0");
  assert.equal(config.questions.length, 1);
  const question = config.questions[0];
  assert.equal(question.type, "single_choice");
  if (question.type !== "single_choice") return;
  assert.equal(question.content, "");
  assert.deepEqual(question.options.map((option) => option.content), ["", ""]);
  assert.equal(key.answers[question.id]?.type, "single_choice");
  assert.equal(createAnswerSheetOption().content, "");
});

test("single choice requires exactly one existing private answer", () => {
  const { config, key } = createDefaultAnswerSheet();
  const questionId = config.questions[0].id;
  config.questions[0].content = "太阳从哪一方向升起？";
  if (config.questions[0].type === "single_choice") {
    config.questions[0].options[0].content = "东方";
    config.questions[0].options[1].content = "西方";
  }
  delete key.answers[questionId];

  assert.deepEqual(validateAnswerSheetAuthoring(config, key), {
    [questionId]: ["请选择唯一正确答案"],
  });
});

test("fill blank prompt is UI-only and does not count as an answer", () => {
  const { config, key } = createDefaultAnswerSheet();
  const question = createAnswerSheetQuestion("fill_blank");
  assert.equal(question.type, "fill_blank");
  if (question.type !== "fill_blank") return;
  config.questions = [question];
  key.answers = { [question.id]: createPrivateAnswer(question) };

  const answer = key.answers[question.id];
  assert.ok(answer);
  if (!answer) return;
  assert.equal(answer.type, "fill_blank");
  if (answer.type !== "fill_blank") return;
  assert.deepEqual(answer.blanks[question.blanks[0].id].acceptedAnswers, [""]);
  assert.match(validateAnswerSheetAuthoring(config, key)[question.id]?.join("；") ?? "", /至少需要一个答案/);

  answer.blanks[question.blanks[0].id].acceptedAnswers = [ANSWER_SHEET_BLANK_ANSWER_PLACEHOLDER];
  assert.match(validateAnswerSheetAuthoring(config, key)[question.id]?.join("；") ?? "", /至少需要一个答案/);
});

test("strict submission reports every unanswered required question", () => {
  const { config } = createDefaultAnswerSheet();
  const questionId = config.questions[0].id;

  assert.deepEqual(validateAnswerSheetSubmission(config, {}, true), {
    [questionId]: "请选择一项",
  });
});

test("strict submission accepts a cleared optional question", () => {
  const { config } = createDefaultAnswerSheet();
  const question = config.questions[0];
  question.required = false;

  assert.deepEqual(validateAnswerSheetSubmission(config, {
    answers: { [question.id]: { selectedOptionId: "" } },
  }, true), {});
});

test("custom math delimiters round-trip without changing code", () => {
  const source = "速度 $$v=t^2$$。\n\n$$$$\n\\int_0^1 x dx\n$$$$\n\n`$$code$$`";
  const standard = "速度 $v=t^2$。\n\n$$\n\\int_0^1 x dx\n$$\n\n`$$code$$`";

  assert.equal(toStandardMathMarkdown(source), standard);
  assert.equal(fromStandardMathMarkdown(standard), source);
});

test("markdown editor shows source only while focused", () => {
  assert.equal(resolveMarkdownEditorMode({ disabled: false, focused: true }), "source");
  assert.equal(resolveMarkdownEditorMode({ disabled: false, focused: false }), "preview");
  assert.equal(resolveMarkdownEditorMode({ disabled: true, focused: true }), "preview");
});

test("markdown editor clears only configured legacy placeholders on edit", () => {
  assert.equal(resolveMarkdownValueOnEdit("请输入题干", ["请输入题干"]), "");
  assert.equal(resolveMarkdownValueOnEdit("选项 1", ["选项 1", "选项 2", "新增选项"]), "");
  assert.equal(resolveMarkdownValueOnEdit("真实题干", ["请输入题干"]), "真实题干");
  assert.equal(resolveMarkdownValueOnEdit("", ["请输入题干"]), "");
});

test("answer sheet markdown keeps approved basic formatting and downgrades the rest", () => {
  const tree = {
    type: "root",
    children: [
      { type: "heading", depth: 2, children: [{ type: "text", value: "章节" }] },
      { type: "heading", depth: 3, children: [{ type: "strong", children: [{ type: "text", value: "普通文本" }] }] },
      {
        type: "paragraph",
        children: [
          { type: "strong", children: [{ type: "text", value: "重点" }] },
          { type: "emphasis", children: [{ type: "text", value: "强调" }] },
          { type: "link", url: "https://example.com", children: [{ type: "text", value: "链接文字" }] },
          { type: "delete", children: [{ type: "text", value: "删除线文字" }] },
          { type: "image", alt: "题图", url: "asset://image" },
        ],
      },
      {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: "提示" }] }],
      },
      {
        type: "list",
        ordered: false,
        children: [{
          type: "listItem",
          checked: true,
          children: [{ type: "paragraph", children: [{ type: "text", value: "任务文字" }] }],
        }],
      },
      {
        type: "table",
        align: [null, "right"],
        children: [{
          type: "tableRow",
          children: [
            { type: "tableCell", children: [{ type: "strong", children: [{ type: "text", value: "项目" }] }] },
            { type: "tableCell", children: [{ type: "inlineMath", value: "v" }] },
          ],
        }],
      },
      { type: "code", lang: "python", value: "print(1)" },
      { type: "math", value: "x^2" },
      { type: "thematicBreak" },
      { type: "html", value: "<b>HTML</b>" },
    ],
  };

  restrictBasicMarkdownTree(tree);

  assert.deepEqual(tree.children, [
    { type: "heading", depth: 2, children: [{ type: "text", value: "章节" }] },
    { type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: "普通文本" }] }] },
    {
      type: "paragraph",
      children: [
        { type: "strong", children: [{ type: "text", value: "重点" }] },
        { type: "emphasis", children: [{ type: "text", value: "强调" }] },
        { type: "text", value: "链接文字" },
        { type: "text", value: "删除线文字" },
        { type: "text", value: "题图" },
      ],
    },
    {
      type: "blockquote",
      children: [{ type: "paragraph", children: [{ type: "text", value: "提示" }] }],
    },
    {
      type: "list",
      ordered: false,
      children: [{
        type: "listItem",
        children: [{ type: "paragraph", children: [{ type: "text", value: "任务文字" }] }],
      }],
    },
    {
      type: "table",
      align: [null, "right"],
      children: [{
        type: "tableRow",
        children: [
          { type: "tableCell", children: [{ type: "strong", children: [{ type: "text", value: "项目" }] }] },
          { type: "tableCell", children: [{ type: "inlineMath", value: "v" }] },
        ],
      }],
    },
    { type: "code", lang: "python", value: "print(1)" },
    { type: "math", value: "x^2" },
  ]);
});

test("answer sheet publish issue identifies the exact invalid question", () => {
  const { config, key } = createDefaultAnswerSheet();
  const questionId = config.questions[0].id;
  config.questions[0].content = "太阳从哪一方向升起？";
  if (config.questions[0].type === "single_choice") {
    config.questions[0].options[0].content = "东方";
    config.questions[0].options[1].content = "西方";
  }
  delete key.answers[questionId];
  const node = {
    answerSheet: config,
    deadlineAt: null,
    id: "answer-sheet-1",
    kind: "answer_sheet",
    title: "课堂测验",
  } as AcademicFlowNode;

  assert.deepEqual(
    getAnswerSheetPublishIssue([node], { [node.id]: key }),
    {
      message: "答题卡“课堂测验”第 1 题：请选择唯一正确答案",
      nodeId: node.id,
    },
  );
});

test("publishable answer sheet does not produce a preflight issue", () => {
  const { config, key } = createDefaultAnswerSheet();
  config.questions[0].content = "太阳从哪一方向升起？";
  if (config.questions[0].type === "single_choice") {
    config.questions[0].options[0].content = "东方";
    config.questions[0].options[1].content = "西方";
  }
  const node = {
    answerSheet: config,
    deadlineAt: null,
    id: "answer-sheet-1",
    kind: "answer_sheet",
    title: "课堂测验",
  } as AcademicFlowNode;

  assert.equal(getAnswerSheetPublishIssue([node], { [node.id]: key }), null);
});

test("answer sheet accordion toggles only the selected question", () => {
  assert.equal(toggleExpandedQuestion(null, "question-1"), "question-1");
  assert.equal(toggleExpandedQuestion("question-1", "question-2"), "question-2");
  assert.equal(toggleExpandedQuestion("question-2", "question-2"), null);
});

test("answer sheet question menu moves a stable question by one position", () => {
  const questions = [
    { id: "question-1" },
    { id: "question-2" },
    { id: "question-3" },
  ];

  assert.deepEqual(
    moveAnswerSheetQuestion(questions, "question-2", -1).map((question) => question.id),
    ["question-2", "question-1", "question-3"],
  );
  assert.equal(moveAnswerSheetQuestion(questions, "question-1", -1), questions);
});

test("answer sheet summary reports compact type-specific metadata", () => {
  const { config } = createDefaultAnswerSheet();
  assert.equal(getAnswerSheetQuestionMeta(config.questions[0]), "1 分 · 2 个选项");

  const fill = createAnswerSheetQuestion("fill_blank");
  assert.equal(getAnswerSheetQuestionMeta(fill), "1 分 · 1 个填空");
});
