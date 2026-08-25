import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultAnswerSheet,
  validateAnswerSheetAuthoring,
  validateAnswerSheetSubmission,
} from "../src/features/academic-flow/answerSheet.ts";
import {
  fromStandardMathMarkdown,
  toStandardMathMarkdown,
} from "../src/features/academic-flow/answerSheetMarkdown.ts";

test("new answer sheet has stable publishable structural defaults", () => {
  const { config, key } = createDefaultAnswerSheet();

  assert.equal(config.schemaVersion, "1.0");
  assert.equal(config.questions.length, 1);
  assert.equal(key.answers[config.questions[0].id]?.type, "single_choice");
});

test("single choice requires exactly one existing private answer", () => {
  const { config, key } = createDefaultAnswerSheet();
  const questionId = config.questions[0].id;
  delete key.answers[questionId];

  assert.deepEqual(validateAnswerSheetAuthoring(config, key), {
    [questionId]: ["请选择唯一正确答案"],
  });
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
