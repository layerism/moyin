import type {
  FormField,
  FormFieldConfig,
  FormFieldType,
} from "../../types";
import {
  createFormField,
  createFormOption,
  normalizeFormFields,
  upgradeFormFields,
  validateFormFieldConfig,
} from "./formFields";

const fieldTypeLabels: Record<FormFieldType, string> = {
  checkbox: "多项选择",
  radio: "单项选择",
  text: "单行文本",
  textarea: "多行文本",
};
const fieldTypeOrder: FormFieldType[] = ["text", "textarea", "radio", "checkbox"];

export function FormFieldEditor({
  disabled,
  fields,
  onChange,
}: {
  disabled: boolean;
  fields: FormFieldConfig[];
  onChange: (fields: FormField[]) => void;
}) {
  const displayedFields = normalizeFormFields(fields);
  const errors = validateFormFieldConfig(fields);

  const updateField = (index: number, patch: Partial<FormField>) => {
    const next = upgradeFormFields(fields);
    next[index] = normalizeFieldSettings({ ...next[index], ...patch });
    onChange(next);
  };

  const moveField = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= fields.length) return;
    const next = upgradeFormFields(fields);
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const updateOption = (fieldIndex: number, optionIndex: number, label: string) => {
    const field = upgradeFormFields(fields)[fieldIndex];
    const options = [...(field.options ?? [])];
    options[optionIndex] = { ...options[optionIndex], label };
    updateField(fieldIndex, { options });
  };

  const moveOption = (fieldIndex: number, optionIndex: number, offset: -1 | 1) => {
    const field = upgradeFormFields(fields)[fieldIndex];
    const options = [...(field.options ?? [])];
    const target = optionIndex + offset;
    if (target < 0 || target >= options.length) return;
    [options[optionIndex], options[target]] = [options[target], options[optionIndex]];
    updateField(fieldIndex, { options });
  };

  return (
    <div className="form-field-editor">
      <div className="section-heading">
        <h3>采集用户信息</h3>
        <div className="form-field-add-actions">
          {fieldTypeOrder.map((type) => (
            <button
              disabled={disabled}
              key={type}
              onClick={() => onChange([...upgradeFormFields(fields), createFormField(type)])}
              type="button"
            >
              + {fieldTypeLabels[type]}
            </button>
          ))}
        </div>
      </div>

      {displayedFields.map((field, fieldIndex) => (
        <section className="form-field-card" key={field.id}>
          <div className="form-field-card-header">
            <strong>{fieldTypeLabels[field.type]}</strong>
            <div>
              <button
                aria-label="字段上移"
                disabled={disabled || fieldIndex === 0}
                onClick={() => moveField(fieldIndex, -1)}
                type="button"
              >↑</button>
              <button
                aria-label="字段下移"
                disabled={disabled || fieldIndex === displayedFields.length - 1}
                onClick={() => moveField(fieldIndex, 1)}
                type="button"
              >↓</button>
              <button
                disabled={disabled}
                onClick={() => onChange(upgradeFormFields(fields).filter((_, index) => index !== fieldIndex))}
                type="button"
              >删除</button>
            </div>
          </div>

          <div className="form-field-base-settings">
            <label>
              <span>字段标题</span>
              <input
                disabled={disabled}
                value={field.label}
                onChange={(event) => updateField(fieldIndex, { label: event.target.value })}
              />
            </label>
            <label>
              <span>字段类型</span>
              <select
                disabled={disabled}
                value={field.type}
                onChange={(event) => updateField(fieldIndex, {
                  type: event.target.value as FormFieldType,
                })}
              >
                <option value="text">单行文本</option>
                <option value="textarea">多行文本</option>
                <option value="radio">单项选择</option>
                <option value="checkbox">多项选择</option>
              </select>
            </label>
            <label className="form-field-required">
              <input
                checked={field.required}
                disabled={disabled}
                onChange={(event) => updateField(fieldIndex, { required: event.target.checked })}
                type="checkbox"
              />
              <span>必填</span>
            </label>
          </div>

          {field.type === "textarea" ? (
            <div className="form-field-type-settings two-column">
              <NumberSetting
                disabled={disabled}
                label="最少字符数"
                onChange={(minLength) => updateField(fieldIndex, { minLength })}
                value={field.minLength}
              />
              <NumberSetting
                disabled={disabled}
                label="最多字符数"
                onChange={(maxLength) => updateField(fieldIndex, { maxLength })}
                value={field.maxLength}
              />
            </div>
          ) : null}

          {field.type === "radio" || field.type === "checkbox" ? (
            <div className="form-field-type-settings">
              <div className="form-field-option-list">
                <strong>选项</strong>
                {(field.options ?? []).map((option, optionIndex) => (
                  <div className="form-field-option-row" key={option.id}>
                    <input
                      disabled={disabled}
                      value={option.label}
                      onChange={(event) => updateOption(fieldIndex, optionIndex, event.target.value)}
                    />
                    <button
                      aria-label="选项上移"
                      disabled={disabled || optionIndex === 0}
                      onClick={() => moveOption(fieldIndex, optionIndex, -1)}
                      type="button"
                    >↑</button>
                    <button
                      aria-label="选项下移"
                      disabled={disabled || optionIndex === (field.options?.length ?? 0) - 1}
                      onClick={() => moveOption(fieldIndex, optionIndex, 1)}
                      type="button"
                    >↓</button>
                    <button
                      disabled={disabled}
                      onClick={() => updateField(fieldIndex, {
                        options: (field.options ?? []).filter((_, index) => index !== optionIndex),
                      })}
                      type="button"
                    >删除</button>
                  </div>
                ))}
                <button
                  disabled={disabled}
                  onClick={() => updateField(fieldIndex, {
                    options: [...(field.options ?? []), createFormOption()],
                  })}
                  type="button"
                >+ 添加选项</button>
              </div>
              <label className="form-field-other-toggle">
                <input
                  checked={Boolean(field.allowOther)}
                  disabled={disabled}
                  onChange={(event) => updateField(fieldIndex, { allowOther: event.target.checked })}
                  type="checkbox"
                />
                <span>允许填写“其他”内容</span>
              </label>
              {field.type === "checkbox" ? (
                <div className="two-column">
                  <NumberSetting
                    disabled={disabled}
                    label="最少选择数"
                    onChange={(minSelections) => updateField(fieldIndex, { minSelections })}
                    value={field.minSelections}
                  />
                  <NumberSetting
                    disabled={disabled}
                    label="最多选择数"
                    onChange={(maxSelections) => updateField(fieldIndex, { maxSelections })}
                    value={field.maxSelections}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {(errors[field.id] ?? []).map((message) => (
            <p className="form-field-error" key={message}>{message}</p>
          ))}
        </section>
      ))}
      {displayedFields.length === 0 ? <p className="muted-line">该节点暂无用户信息字段。</p> : null}
    </div>
  );
}

function NumberSetting({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: number | undefined) => void;
  value: number | undefined;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        disabled={disabled}
        min="0"
        step="1"
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(
          event.target.value === "" ? undefined : Number(event.target.value),
        )}
      />
    </label>
  );
}

function normalizeFieldSettings(field: FormField): FormField {
  if (field.type === "text") {
    return {
      id: field.id,
      label: field.label,
      required: field.required,
      type: field.type,
    };
  }
  if (field.type === "textarea") {
    return {
      id: field.id,
      label: field.label,
      maxLength: field.maxLength,
      minLength: field.minLength,
      required: field.required,
      type: field.type,
    };
  }
  const options = field.options?.length
    ? field.options
    : [createFormOption("选项 1"), createFormOption("选项 2")];
  if (field.type === "radio") {
    return {
      allowOther: Boolean(field.allowOther),
      id: field.id,
      label: field.label,
      options,
      required: field.required,
      type: field.type,
    };
  }
  return {
    allowOther: Boolean(field.allowOther),
    id: field.id,
    label: field.label,
    maxSelections: field.maxSelections,
    minSelections: field.minSelections,
    options,
    required: field.required,
    type: field.type,
  };
}
