import type {
  FormField,
  FormFieldConfig,
  FormFieldOption,
  FormFieldType,
} from "../../types";

export const OTHER_OPTION_ID = "other";

export type NormalizedFormField = FormField & {
  answerKey: string;
  legacy: boolean;
};

export function normalizeFormFields(fields: FormFieldConfig[]): NormalizedFormField[] {
  return fields.map((field, index) =>
    typeof field === "string"
      ? {
          answerKey: field,
          id: `legacy-${index}`,
          label: field,
          legacy: true,
          required: true,
          type: "text",
        }
      : {
          ...field,
          answerKey: field.id,
          legacy: false,
          options: field.options?.map((option) => ({ ...option })),
        },
  );
}

export function upgradeFormFields(fields: FormFieldConfig[]): FormField[] {
  return fields.map((field, index) =>
    typeof field === "string"
      ? { id: `legacy-${index}`, label: field, required: true, type: "text" }
      : { ...field, options: field.options?.map((option) => ({ ...option })) },
  );
}

export function createFormField(type: FormFieldType): FormField {
  const common = {
    id: createStableId("field"),
    label: "新增字段",
    required: true,
    type,
  };
  if (type === "radio" || type === "checkbox") {
    return {
      ...common,
      allowOther: false,
      options: [createFormOption("选项 1"), createFormOption("选项 2")],
    };
  }
  return common;
}

export function createFormOption(label = "新增选项"): FormFieldOption {
  return { id: createStableId("option"), label };
}

export function validateFormFieldConfig(
  fields: FormFieldConfig[],
): Record<string, string[]> {
  const normalized = normalizeFormFields(fields);
  const errors: Record<string, string[]> = {};
  const ids = new Set<string>();
  const labels = new Map<string, boolean>();
  const addError = (fieldId: string, message: string) => {
    const current = errors[fieldId] ?? [];
    if (!current.includes(message)) errors[fieldId] = [...current, message];
  };

  for (const field of normalized) {
    const label = field.label.trim();
    if (!label) addError(field.id, "字段标题不能为空");
    const previousLegacy = labels.get(label);
    if (label && previousLegacy !== undefined && (!field.legacy || !previousLegacy)) {
      addError(field.id, "字段标题不能重复");
    }
    if (label) labels.set(label, previousLegacy === undefined ? field.legacy : previousLegacy && field.legacy);

    if (ids.has(field.id)) {
      addError(field.id, "字段标识无效或重复");
    }
    if (!field.legacy) {
      if (!field.id || field.id === OTHER_OPTION_ID) {
        addError(field.id || `invalid-${Object.keys(errors).length}`, "字段标识无效或重复");
      }
    }
    ids.add(field.id);

    if (field.type === "textarea") {
      validateRange(field.id, field.minLength, field.maxLength, "字符数", addError);
    }
    if (field.type !== "radio" && field.type !== "checkbox") continue;

    const options = field.options ?? [];
    if (options.length < 2) addError(field.id, "至少需要两个普通选项");
    const optionIds = new Set<string>();
    const optionLabels = new Set<string>();
    for (const option of options) {
      const optionLabel = option.label.trim();
      if (!option.id || option.id === OTHER_OPTION_ID || optionIds.has(option.id)) {
        addError(field.id, "选项标识无效或重复");
      }
      if (!optionLabel) addError(field.id, "选项标题不能为空");
      if (optionLabel && optionLabels.has(optionLabel)) addError(field.id, "选项标题不能重复");
      optionIds.add(option.id);
      if (optionLabel) optionLabels.add(optionLabel);
    }
    if (field.type === "checkbox") {
      validateRange(
        field.id,
        field.minSelections,
        field.maxSelections,
        "选择数",
        addError,
      );
      const effectiveMinimum = Math.max(field.minSelections ?? 0, field.required ? 1 : 0);
      if (field.maxSelections !== undefined && effectiveMinimum > field.maxSelections) {
        addError(field.id, "最少选择数不能大于最多选择数");
      }
      const optionCount = options.length + (field.allowOther ? 1 : 0);
      if (effectiveMinimum > optionCount) {
        addError(field.id, "最少选择数不能超过可选项总数");
      }
      if (field.maxSelections !== undefined && field.maxSelections > optionCount) {
        addError(field.id, "最多选择数不能超过可选项总数");
      }
    }
  }
  return errors;
}

export function validateFormAnswers(
  fields: FormFieldConfig[],
  payload: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of normalizeFormFields(fields)) {
    const rawValue = payload[field.answerKey];
    if (field.type === "text" || field.type === "textarea") {
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (rawValue !== undefined && typeof rawValue !== "string") {
        errors[field.id] = "填写内容格式无效";
      } else if (field.required && !value) {
        errors[field.id] = "此项为必填项";
      } else if (field.type === "textarea" && value) {
        const length = Array.from(value).length;
        if (field.minLength !== undefined && length < field.minLength) {
          errors[field.id] = `至少填写 ${field.minLength} 个字符`;
        } else if (field.maxLength !== undefined && length > field.maxLength) {
          errors[field.id] = `最多填写 ${field.maxLength} 个字符`;
        }
      }
      continue;
    }

    if (field.type === "radio") {
      const answer = asRecord(rawValue);
      const selected = answer?.selectedOptionId;
      const validIds = new Set(field.options?.map((option) => option.id) ?? []);
      const valid = typeof selected === "string"
        && (validIds.has(selected) || (field.allowOther && selected === OTHER_OPTION_ID));
      if (rawValue !== undefined && (!answer || (selected !== undefined && selected !== null && !valid))) {
        errors[field.id] = "选择内容无效";
      } else if (field.required && !valid) {
        errors[field.id] = "请选择一项";
      } else if (selected === OTHER_OPTION_ID && !asTrimmedString(answer?.otherText)) {
        errors[field.id] = "请填写“其他”内容";
      }
      continue;
    }

    const answer = asRecord(rawValue);
    const rawSelected = answer?.selectedOptionIds;
    const selected = Array.isArray(rawSelected)
      ? rawSelected
      : [];
    const validIds = new Set(field.options?.map((option) => option.id) ?? []);
    const unique = new Set(selected);
    const hasInvalid = selected.some((value) =>
      typeof value !== "string"
      || (!validIds.has(value) && !(field.allowOther && value === OTHER_OPTION_ID))
    );
    if (rawValue !== undefined && (
      !answer
      || !Array.isArray(rawSelected)
      || hasInvalid
      || selected.length !== unique.size
    )) {
      errors[field.id] = "选择内容无效";
      continue;
    }
    const count = unique.size;
    if (!count && field.required) {
      errors[field.id] = "请至少选择一项";
      continue;
    }
    if (!count) continue;
    const minimum = Math.max(field.minSelections ?? 0, field.required ? 1 : 0);
    if (count < minimum) {
      errors[field.id] = `请至少选择 ${minimum} 项`;
    } else if (field.maxSelections !== undefined && count > field.maxSelections) {
      errors[field.id] = `最多选择 ${field.maxSelections} 项`;
    } else if (unique.has(OTHER_OPTION_ID) && !asTrimmedString(answer?.otherText)) {
      errors[field.id] = "请填写“其他”内容";
    }
  }
  return errors;
}

export function formatFormAnswer(field: NormalizedFormField, value: unknown): string {
  if (field.type === "text" || field.type === "textarea") {
    return typeof value === "string" && value.trim() ? value : "未填写";
  }
  const answer = asRecord(value);
  const optionLabels = new Map(field.options?.map((option) => [option.id, option.label]) ?? []);
  const rawSelected = answer?.selectedOptionIds;
  const selectedIds = field.type === "radio"
    ? typeof answer?.selectedOptionId === "string" ? [answer.selectedOptionId] : []
    : Array.isArray(rawSelected)
      ? rawSelected.filter((item): item is string => typeof item === "string")
      : [];
  const labels = selectedIds.flatMap((optionId) => {
    if (optionId === OTHER_OPTION_ID) {
      const otherText = asTrimmedString(answer?.otherText);
      return otherText ? [`其他：${otherText}`] : ["其他"];
    }
    const label = optionLabels.get(optionId);
    return label ? [label] : [];
  });
  return labels.length ? labels.join("、") : "未选择";
}

function validateRange(
  fieldId: string,
  minimum: number | undefined,
  maximum: number | undefined,
  label: string,
  addError: (fieldId: string, message: string) => void,
) {
  if (minimum !== undefined && (!Number.isInteger(minimum) || minimum < 0)) {
    addError(fieldId, `最少${label}必须是非负整数`);
  }
  if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 0)) {
    addError(fieldId, `最多${label}必须是非负整数`);
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    addError(fieldId, `最少${label}不能大于最多${label}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createStableId(prefix: "field" | "option") {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${value}`;
}
