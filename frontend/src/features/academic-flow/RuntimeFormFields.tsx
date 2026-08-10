import type { FormFieldConfig } from "../../types";
import {
  formatFormAnswer,
  normalizeFormFields,
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
              <div
                className="runtime-form-field-options is-radio"
                onBlur={() => onBlur(field.id)}
              >
                {(field.options ?? []).map((option) => (
                  <label key={option.id}>
                    <input
                      aria-describedby={error ? errorId : undefined}
                      checked={selectedRadio === option.id}
                      name={`runtime-field-${field.id}`}
                      type="radio"
                      onChange={() => onUpdate(field.answerKey, {
                        otherText: null,
                        selectedOptionId: option.id,
                      }, field.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            ) : null}

            {field.type === "checkbox" ? (
              <div
                className="runtime-form-field-options is-checkbox"
                onBlur={() => onBlur(field.id)}
              >
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
                      ), field.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
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

function checkboxAnswer(
  optionIds: string[],
  current: Set<string>,
  changedId: string,
  checked: boolean,
) {
  const next = new Set(current);
  if (checked) next.add(changedId);
  else next.delete(changedId);
  const selectedOptionIds = optionIds.filter((optionId) => next.has(optionId));
  return {
    otherText: null,
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
