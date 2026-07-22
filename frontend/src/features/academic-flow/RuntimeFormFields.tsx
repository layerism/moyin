import type { FormFieldConfig } from "../../types";
import {
  formatFormAnswer,
  normalizeFormFields,
  OTHER_OPTION_ID,
} from "./formFields";

export function RuntimeFormFields({
  errors,
  fields,
  onBlur,
  onUpdate,
  payload,
}: {
  errors: Record<string, string>;
  fields: FormFieldConfig[];
  onBlur: (fieldId: string) => void;
  onUpdate: (answerKey: string, value: unknown, fieldId: string) => void;
  payload: Record<string, unknown>;
}) {
  return (
    <div className="runtime-form-fields">
      {normalizeFormFields(fields).map((field) => {
        const error = errors[field.id];
        const errorId = `runtime-field-error-${field.id}`;
        const rawValue = payload[field.answerKey];
        const answer = asRecord(rawValue);
        const selectedRadio = typeof answer?.selectedOptionId === "string"
          ? answer.selectedOptionId
          : null;
        const selectedOptionIds = answer?.selectedOptionIds;
        const selectedCheckboxes = new Set(
          Array.isArray(selectedOptionIds)
            ? selectedOptionIds.filter((item): item is string => typeof item === "string")
            : [],
        );
        return (
          <div
            className={`runtime-form-field${error ? " is-invalid" : ""}`}
            data-form-field-id={field.id}
            key={field.id}
            tabIndex={-1}
          >
            <div className="runtime-form-field-label">
              <strong>{field.label}</strong>
              <span>{field.required ? "必填" : "选填"}</span>
            </div>

            {field.type === "text" ? (
              <input
                aria-describedby={error ? errorId : undefined}
                value={typeof rawValue === "string" ? rawValue : ""}
                onBlur={() => onBlur(field.id)}
                onChange={(event) => onUpdate(field.answerKey, event.target.value, field.id)}
              />
            ) : null}

            {field.type === "textarea" ? (
              <>
                <textarea
                  aria-describedby={error ? errorId : undefined}
                  value={typeof rawValue === "string" ? rawValue : ""}
                  onBlur={() => onBlur(field.id)}
                  onChange={(event) => onUpdate(field.answerKey, event.target.value, field.id)}
                />
                <small className="runtime-form-field-count">
                  {Array.from(typeof rawValue === "string" ? rawValue.trim() : "").length}
                  {field.maxLength !== undefined ? ` / ${field.maxLength}` : " 个字符"}
                  {field.minLength !== undefined ? `，至少 ${field.minLength}` : ""}
                </small>
              </>
            ) : null}

            {field.type === "radio" ? (
              <div className="runtime-form-field-select" onBlur={() => onBlur(field.id)}>
                <select
                  aria-describedby={error ? errorId : undefined}
                  value={selectedRadio ?? ""}
                  onChange={(event) => onUpdate(field.answerKey, {
                    otherText: event.target.value === OTHER_OPTION_ID ? "" : null,
                    selectedOptionId: event.target.value || null,
                  }, field.id)}
                >
                  <option value="">请选择</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                  {field.allowOther ? <option value={OTHER_OPTION_ID}>其他</option> : null}
                </select>
                {selectedRadio === OTHER_OPTION_ID ? (
                  <input
                    aria-label="其他内容"
                    placeholder="请填写其他内容"
                    type="text"
                    value={typeof answer?.otherText === "string" ? answer.otherText : ""}
                    onChange={(event) => onUpdate(field.answerKey, {
                      otherText: event.target.value,
                      selectedOptionId: OTHER_OPTION_ID,
                    }, field.id)}
                  />
                ) : null}
              </div>
            ) : null}

            {field.type === "checkbox" ? (
              <div className="runtime-form-field-options" onBlur={() => onBlur(field.id)}>
                {(field.options ?? []).map((option) => (
                  <label key={option.id}>
                    <input
                      checked={selectedCheckboxes.has(option.id)}
                      type="checkbox"
                      onChange={(event) => onUpdate(field.answerKey, checkboxAnswer(
                        field.options?.map((item) => item.id) ?? [],
                        selectedCheckboxes,
                        option.id,
                        event.target.checked,
                        answer?.otherText,
                      ), field.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
                {field.allowOther ? (
                  <ChoiceOther
                    checked={selectedCheckboxes.has(OTHER_OPTION_ID)}
                    onCheck={(checked) => onUpdate(field.answerKey, checkboxAnswer(
                      field.options?.map((item) => item.id) ?? [],
                      selectedCheckboxes,
                      OTHER_OPTION_ID,
                      checked,
                      answer?.otherText,
                    ), field.id)}
                    onText={(otherText) => onUpdate(field.answerKey, {
                      otherText,
                      selectedOptionIds: [...selectedCheckboxes],
                    }, field.id)}
                    text={selectedCheckboxes.has(OTHER_OPTION_ID) && typeof answer?.otherText === "string"
                      ? answer.otherText
                      : ""}
                  />
                ) : null}
                <small>
                  {selectionHint(field.minSelections, field.maxSelections, selectedCheckboxes.size)}
                </small>
              </div>
            ) : null}

            {error ? <p className="runtime-form-field-error" id={errorId}>{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ReadonlyFormFields({
  fields,
  payload,
}: {
  fields: FormFieldConfig[];
  payload: Record<string, unknown>;
}) {
  return (
    <section className="runtime-readonly-submission">
      {normalizeFormFields(fields).map((field) => (
        <div className="runtime-readonly-field" key={field.id}>
          <small>{field.label}</small>
          <strong>{formatFormAnswer(field, payload[field.answerKey])}</strong>
        </div>
      ))}
    </section>
  );
}

function ChoiceOther({
  checked,
  onCheck,
  onText,
  text,
}: {
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onText: (value: string) => void;
  text: string;
}) {
  return (
    <div className="runtime-form-field-other">
      <label>
        <input
          checked={checked}
          type="checkbox"
          onChange={(event) => onCheck(event.target.checked)}
        />
        <span>其他</span>
      </label>
      {checked ? (
        <input
          aria-label="其他内容"
          placeholder="请填写其他内容"
          value={text}
          onChange={(event) => onText(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function checkboxAnswer(
  optionIds: string[],
  current: Set<string>,
  changedId: string,
  checked: boolean,
  otherText: unknown,
) {
  const next = new Set(current);
  if (checked) next.add(changedId);
  else next.delete(changedId);
  const selectedOptionIds = optionIds.filter((optionId) => next.has(optionId));
  if (next.has(OTHER_OPTION_ID)) selectedOptionIds.push(OTHER_OPTION_ID);
  return {
    otherText: next.has(OTHER_OPTION_ID) && typeof otherText === "string" ? otherText : null,
    selectedOptionIds,
  };
}

function selectionHint(minimum: number | undefined, maximum: number | undefined, count: number) {
  const limit = minimum !== undefined && maximum !== undefined
    ? `请选择 ${minimum} 至 ${maximum} 项`
    : minimum !== undefined
      ? `请至少选择 ${minimum} 项`
      : maximum !== undefined
        ? `最多选择 ${maximum} 项`
        : "可选择多项";
  return `${limit}，当前已选 ${count} 项`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
