import assert from "node:assert/strict";
import test from "node:test";

import {
  hasFormFieldSettings,
  normalizeFormFields,
  upgradeFormFields,
  validateFormAnswers,
  validateFormFieldConfig,
} from "../src/features/academic-flow/formFields.ts";

test("only fields with extra settings are expandable", () => {
  assert.equal(hasFormFieldSettings("text"), false);
  assert.equal(hasFormFieldSettings("textarea"), true);
  assert.equal(hasFormFieldSettings("radio"), true);
  assert.equal(hasFormFieldSettings("checkbox"), true);
});

const optionalFields = [
  { id: "text", label: "姓名", required: false, type: "text" as const },
  {
    id: "radio",
    label: "方向",
    options: [
      { id: "a", label: "学术" },
      { id: "b", label: "实践" },
    ],
    required: false,
    type: "radio" as const,
  },
  {
    id: "checkbox",
    label: "材料",
    options: [
      { id: "a", label: "论文" },
      { id: "b", label: "附件" },
    ],
    required: false,
    type: "checkbox" as const,
  },
];

test("normalizes historical optional fields as required", () => {
  assert.deepEqual(
    normalizeFormFields(optionalFields).map((field) => field.required),
    [true, true, true],
  );
  assert.deepEqual(
    upgradeFormFields(optionalFields).map((field) => field.required),
    [true, true, true],
  );
});

test("rejects empty answers for historical optional fields", () => {
  assert.deepEqual(validateFormAnswers(optionalFields, {}), {
    text: "此项为必填项",
    radio: "请选择一项",
    checkbox: "请至少选择一项",
  });
});

test("requires at least one checkbox selection", () => {
  const fields = [{ ...optionalFields[2], maxSelections: 0 }];
  assert.deepEqual(validateFormFieldConfig(fields), {
    checkbox: ["最少选择数不能大于最多选择数"],
  });
});
