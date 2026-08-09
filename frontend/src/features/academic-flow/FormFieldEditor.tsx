import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

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
import {
  getReorderDestination,
  getReorderPlacement,
  reorderItem,
} from "./reorder";
import type { ReorderPlacement } from "./reorder";

const fieldTypeLabels: Record<FormFieldType, string> = {
  checkbox: "多项选择",
  radio: "单项选择",
  text: "单行文本",
  textarea: "多行文本",
};
const fieldTypeOrder: FormFieldType[] = ["text", "textarea", "radio", "checkbox"];

type ActionMenuTarget =
  | { kind: "field"; fieldId: string }
  | { kind: "option"; fieldId: string; optionId: string };

type ActionMenuItem = {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
};

type DragList =
  | { kind: "field" }
  | { kind: "option"; fieldId: string };

type DragState = {
  active: boolean;
  list: DragList;
  placement: ReorderPlacement;
  pointerId: number;
  sourceIndex: number;
  startX: number;
  startY: number;
  targetIndex: number;
};

const pointerDragThreshold = 4;

function sameDragList(left: DragList, right: DragList): boolean {
  return left.kind === right.kind
    && (left.kind === "field" || (
      right.kind === "option" && left.fieldId === right.fieldId
    ));
}

function isSelectionType(type: FormFieldType): boolean {
  return type === "radio" || type === "checkbox";
}

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
  const [expandedSelectionFieldId, setExpandedSelectionFieldId] = useState<string | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<ActionMenuTarget | null>(null);
  const [editingTitleFieldId, setEditingTitleFieldId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const updateDragState = (next: DragState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  };

  useEffect(() => {
    const currentFields = normalizeFormFields(fields);
    setExpandedSelectionFieldId((current) =>
      current && currentFields.some(
        (field) => field.id === current && isSelectionType(field.type),
      )
        ? current
        : null,
    );
    setOpenActionMenu((current) => {
      if (!current) return null;
      const field = currentFields.find((item) => item.id === current.fieldId);
      if (!field) return null;
      if (current.kind === "field") return current;
      return field.options?.some((option) => option.id === current.optionId)
        ? current
        : null;
    });
    setEditingTitleFieldId((current) =>
      current && currentFields.some((field) => field.id === current) ? current : null,
    );
    const currentDrag = dragStateRef.current;
    if (currentDrag?.list.kind === "field" && currentDrag.sourceIndex >= currentFields.length) {
      updateDragState(null);
    } else if (currentDrag?.list.kind === "option") {
      const draggedField = currentFields.find(
        (field) => field.id === currentDrag.list.fieldId,
      );
      if (!draggedField || currentDrag.sourceIndex >= (draggedField.options?.length ?? 0)) {
        updateDragState(null);
      }
    }
  }, [fields]);

  useEffect(() => {
    if (!openActionMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-form-field-menu]")) return;
      setOpenActionMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenActionMenu(null);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openActionMenu]);

  useEffect(() => {
    if (disabled) {
      setOpenActionMenu(null);
      setEditingTitleFieldId(null);
      setEditingTitleValue("");
      updateDragState(null);
    }
  }, [disabled]);

  useEffect(() => () => {
    dragStateRef.current = null;
  }, []);

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

  const beginPointerReorder = (
    event: ReactPointerEvent<HTMLButtonElement>,
    list: DragList,
    sourceIndex: number,
  ) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    updateDragState({
      active: false,
      list,
      placement: "before",
      pointerId: event.pointerId,
      sourceIndex,
      startX: event.clientX,
      startY: event.clientY,
      targetIndex: sourceIndex,
    });
    setOpenActionMenu(null);
  };

  const updatePointerReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const active = current.active || Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    ) >= pointerDragThreshold;
    if (!active) return;
    event.preventDefault();

    const clearTarget = () => {
      if (!current.active || current.targetIndex !== current.sourceIndex) {
        updateDragState({
          ...current,
          active: true,
          placement: "before",
          targetIndex: current.sourceIndex,
        });
      }
    };
    const targetSelector = current.list.kind === "field"
      ? '[data-reorder-kind="field"]'
      : '[data-reorder-kind="option"]';
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(targetSelector);
    if (!target) {
      clearTarget();
      return;
    }
    const targetKind = target.dataset.reorderKind;
    const targetOwner = target.dataset.reorderOwner;
    const targetIndex = Number(target.dataset.reorderIndex);
    const targetList: DragList | null = targetKind === "field"
      ? { kind: "field" }
      : targetKind === "option" && targetOwner
        ? { kind: "option", fieldId: targetOwner }
        : null;
    if (!targetList || !sameDragList(current.list, targetList) || !Number.isInteger(targetIndex)) {
      clearTarget();
      return;
    }
    const rect = target.getBoundingClientRect();
    const placement = getReorderPlacement(event.clientY, rect.top, rect.height);
    if (
      current.active
      && current.targetIndex === targetIndex
      && current.placement === placement
    ) return;
    updateDragState({ ...current, active: true, placement, targetIndex });
  };

  const releasePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be released by the browser.
    }
  };

  const finishPointerReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    releasePointer(event);
    updateDragState(null);
    if (!current.active) return;

    if (current.list.kind === "field") {
      const nextFields = upgradeFormFields(fields);
      const destination = getReorderDestination(
        current.sourceIndex,
        current.targetIndex,
        current.placement,
        nextFields.length,
      );
      if (destination !== null) {
        onChange(reorderItem(nextFields, current.sourceIndex, destination));
      }
      return;
    }

    const fieldIndex = displayedFields.findIndex(
      (field) => field.id === current.list.fieldId,
    );
    if (fieldIndex < 0) return;
    const field = upgradeFormFields(fields)[fieldIndex];
    const options = field.options ?? [];
    const destination = getReorderDestination(
      current.sourceIndex,
      current.targetIndex,
      current.placement,
      options.length,
    );
    if (destination !== null) {
      updateField(fieldIndex, {
        options: reorderItem(options, current.sourceIndex, destination),
      });
    }
  };

  const cancelPointerReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    releasePointer(event);
    updateDragState(null);
  };

  const handleReorderKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    itemCount: number,
    move: (offset: -1 | 1) => void,
  ) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const offset = event.key === "ArrowUp" ? -1 : 1;
    const target = index + offset;
    if (target < 0 || target >= itemCount) return;
    event.preventDefault();
    move(offset);
  };

  const getDragClassName = (list: DragList, index: number) => {
    if (!dragState?.active || !sameDragList(dragState.list, list)) return "";
    if (dragState.sourceIndex === index) return " is-dragging";
    if (dragState.targetIndex !== index) return "";
    return ` drop-${dragState.placement}`;
  };

  const addField = (type: FormFieldType) => {
    const field = createFormField(type);
    onChange([...upgradeFormFields(fields), field]);
    if (isSelectionType(type)) setExpandedSelectionFieldId(field.id);
    setOpenActionMenu(null);
  };

  const changeFieldType = (fieldIndex: number, type: FormFieldType) => {
    const field = displayedFields[fieldIndex];
    updateField(fieldIndex, { type });
    if (isSelectionType(type)) {
      setExpandedSelectionFieldId(field.id);
    } else if (isSelectionType(field.type)) {
      setExpandedSelectionFieldId((current) => (current === field.id ? null : current));
    }
    setOpenActionMenu(null);
  };

  const deleteField = (fieldIndex: number, fieldId: string) => {
    onChange(upgradeFormFields(fields).filter((_, index) => index !== fieldIndex));
    setExpandedSelectionFieldId((current) => (current === fieldId ? null : current));
    setOpenActionMenu(null);
  };

  const beginTitleEditing = (field: FormField) => {
    if (disabled) return;
    setEditingTitleFieldId(field.id);
    setEditingTitleValue(field.label);
    setOpenActionMenu(null);
  };

  const commitTitleEditing = (fieldIndex: number, fieldId: string) => {
    if (editingTitleFieldId !== fieldId) return;
    updateField(fieldIndex, { label: editingTitleValue });
    setEditingTitleFieldId(null);
    setEditingTitleValue("");
  };

  const cancelTitleEditing = () => {
    setEditingTitleFieldId(null);
    setEditingTitleValue("");
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
              onClick={() => addField(type)}
              type="button"
            >
              + {fieldTypeLabels[type]}
            </button>
          ))}
        </div>
      </div>

      {displayedFields.map((field, fieldIndex) => {
        const fieldDragList: DragList = { kind: "field" };
        const selectionField = isSelectionType(field.type);
        const expanded = selectionField && expandedSelectionFieldId === field.id;
        const fieldErrors = errors[field.id] ?? [];
        const fieldMenuOpen = openActionMenu?.kind === "field"
          && openActionMenu.fieldId === field.id;
        const toggleSelectionField = () => {
          setExpandedSelectionFieldId(expanded ? null : field.id);
          setOpenActionMenu(null);
        };
        const fieldSettings = (
          <>
            {!selectionField ? (
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
                    onChange={(event) => changeFieldType(
                      fieldIndex,
                      event.target.value as FormFieldType,
                    )}
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
            ) : null}

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

            {selectionField ? (
              <div className="form-field-type-settings">
                <div className="form-field-option-list">
                  <div className="form-field-option-heading">
                    <strong>选项</strong>
                    <span>{field.options?.length ?? 0} 项</span>
                  </div>
                  {(field.options ?? []).map((option, optionIndex) => {
                    const optionDragList: DragList = { kind: "option", fieldId: field.id };
                    return (
                      <div
                        className={`form-field-option-row${getDragClassName(
                          optionDragList,
                          optionIndex,
                        )}`}
                        data-reorder-index={optionIndex}
                        data-reorder-kind="option"
                        data-reorder-owner={field.id}
                        key={option.id}
                      >
                        <span className="selection-option-order">
                          <ReorderHandle
                            ariaLabel={`拖拽选项 ${optionIndex + 1} 排序`}
                            disabled={disabled}
                            dragging={Boolean(
                              dragState?.active
                              && sameDragList(dragState.list, optionDragList)
                              && dragState.sourceIndex === optionIndex
                            )}
                            onKeyDown={(event) => handleReorderKeyDown(
                              event,
                              optionIndex,
                              field.options?.length ?? 0,
                              (offset) => moveOption(fieldIndex, optionIndex, offset),
                            )}
                            onPointerCancel={cancelPointerReorder}
                            onPointerDown={(event) => beginPointerReorder(
                              event,
                              optionDragList,
                              optionIndex,
                            )}
                            onPointerMove={updatePointerReorder}
                            onPointerUp={finishPointerReorder}
                          />
                          <span aria-hidden="true" className="selection-option-index">
                            {optionIndex + 1}
                          </span>
                        </span>
                        <input
                          aria-label={`选项 ${optionIndex + 1}`}
                          disabled={disabled}
                          value={option.label}
                          onChange={(event) => updateOption(
                            fieldIndex,
                            optionIndex,
                            event.target.value,
                          )}
                        />
                        <FieldActionMenu
                          ariaLabel={`选项操作 ${optionIndex + 1}`}
                          disabled={disabled}
                          items={[
                            {
                              danger: true,
                              label: "删除选项",
                              onSelect: () => updateField(fieldIndex, {
                                options: (field.options ?? []).filter(
                                  (_, index) => index !== optionIndex,
                                ),
                              }),
                            },
                          ]}
                          onOpenChange={(open) => setOpenActionMenu(open
                            ? { kind: "option", fieldId: field.id, optionId: option.id }
                            : null)}
                          open={openActionMenu?.kind === "option"
                            && openActionMenu.fieldId === field.id
                            && openActionMenu.optionId === option.id}
                        />
                      </div>
                    );
                  })}
                  <button
                    className="form-field-add-option"
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
                    onChange={(event) => updateField(fieldIndex, {
                      allowOther: event.target.checked,
                    })}
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

            {fieldErrors.map((message) => (
              <p className="form-field-error" key={message}>{message}</p>
            ))}
          </>
        );

        return (
          <section
            className={`form-field-card${selectionField ? " selection-field-card" : ""}${
              fieldErrors.length ? " has-errors" : ""
            }${getDragClassName(fieldDragList, fieldIndex)}`}
            data-reorder-index={fieldIndex}
            data-reorder-kind="field"
            key={field.id}
          >
            {selectionField ? (
              <div className="selection-field-summary">
                <div className="selection-field-summary-main">
                  <ReorderHandle
                    ariaLabel={`拖拽字段 ${field.label.trim() || "未命名字段"} 排序`}
                    disabled={disabled}
                    dragging={Boolean(
                      dragState?.active
                      && dragState.list.kind === "field"
                      && dragState.sourceIndex === fieldIndex
                    )}
                    onKeyDown={(event) => handleReorderKeyDown(
                      event,
                      fieldIndex,
                      displayedFields.length,
                      (offset) => moveField(fieldIndex, offset),
                    )}
                    onPointerCancel={cancelPointerReorder}
                    onPointerDown={(event) => beginPointerReorder(
                      event,
                      fieldDragList,
                      fieldIndex,
                    )}
                    onPointerMove={updatePointerReorder}
                    onPointerUp={finishPointerReorder}
                  />
                  <span className="selection-field-title-control">
                    {editingTitleFieldId === field.id ? (
                      <input
                        aria-label="字段标题"
                        autoFocus
                        disabled={disabled}
                        onBlur={() => commitTitleEditing(fieldIndex, field.id)}
                        onChange={(event) => setEditingTitleValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitTitleEditing(fieldIndex, field.id);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelTitleEditing();
                          }
                        }}
                        value={editingTitleValue}
                      />
                    ) : (
                      <button
                        className="selection-field-title-button"
                        disabled={disabled}
                        onClick={() => beginTitleEditing(field)}
                        title="点击修改字段标题"
                        type="button"
                      >{field.label.trim() || "未命名字段"}</button>
                    )}
                  </span>
                  <div
                    aria-controls={expanded ? `selection-field-content-${field.id}` : undefined}
                    aria-expanded={expanded}
                    className="selection-field-meta-toggle"
                    onClick={toggleSelectionField}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      toggleSelectionField();
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <small>
                      {fieldTypeLabels[field.type]} · {field.options?.length ?? 0} 个选项
                    </small>
                    {fieldErrors.length ? (
                      <span className="selection-field-error-badge">需修正</span>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={`selection-field-chevron${expanded ? " expanded" : ""}`}
                    >
                      <svg viewBox="0 0 16 16">
                        <path d="m3.5 6 4.5 4 4.5-4" />
                      </svg>
                    </span>
                  </div>
                  <label className="selection-field-summary-required">
                    <input
                      checked={field.required}
                      disabled={disabled}
                      onChange={(event) => updateField(fieldIndex, {
                        required: event.target.checked,
                      })}
                      type="checkbox"
                    />
                    <span>必填</span>
                  </label>
                </div>
                <FieldActionMenu
                  ariaLabel={`字段操作 ${field.label.trim() || "未命名字段"}`}
                  disabled={disabled}
                  items={[
                    {
                      danger: true,
                      label: "删除字段",
                      onSelect: () => deleteField(fieldIndex, field.id),
                    },
                  ]}
                  onOpenChange={(open) => setOpenActionMenu(open
                    ? { kind: "field", fieldId: field.id }
                    : null)}
                  open={fieldMenuOpen}
                />
              </div>
            ) : (
              <div className="form-field-card-header">
                <div className="form-field-card-title">
                  <ReorderHandle
                    ariaLabel={`拖拽字段 ${field.label.trim() || "未命名字段"} 排序`}
                    disabled={disabled}
                    dragging={Boolean(
                      dragState?.active
                      && dragState.list.kind === "field"
                      && dragState.sourceIndex === fieldIndex
                    )}
                    onKeyDown={(event) => handleReorderKeyDown(
                      event,
                      fieldIndex,
                      displayedFields.length,
                      (offset) => moveField(fieldIndex, offset),
                    )}
                    onPointerCancel={cancelPointerReorder}
                    onPointerDown={(event) => beginPointerReorder(
                      event,
                      fieldDragList,
                      fieldIndex,
                    )}
                    onPointerMove={updatePointerReorder}
                    onPointerUp={finishPointerReorder}
                  />
                  <strong>{fieldTypeLabels[field.type]}</strong>
                </div>
                <FieldActionMenu
                  ariaLabel={`字段操作 ${field.label.trim() || "未命名字段"}`}
                  disabled={disabled}
                  items={[
                    {
                      danger: true,
                      label: "删除字段",
                      onSelect: () => deleteField(fieldIndex, field.id),
                    },
                  ]}
                  onOpenChange={(open) => setOpenActionMenu(open
                    ? { kind: "field", fieldId: field.id }
                    : null)}
                  open={fieldMenuOpen}
                />
              </div>
            )}

            {selectionField ? (
              expanded ? (
                <div
                  className="selection-field-content"
                  id={`selection-field-content-${field.id}`}
                >
                  {fieldSettings}
                </div>
              ) : null
            ) : fieldSettings}
          </section>
        );
      })}
      {displayedFields.length === 0 ? <p className="muted-line">该节点暂无用户信息字段。</p> : null}
    </div>
  );
}

function ReorderHandle({
  ariaLabel,
  disabled,
  dragging,
  onKeyDown,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  ariaLabel: string;
  disabled: boolean;
  dragging: boolean;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={dragging}
      className={`form-field-reorder-handle${dragging ? " dragging" : ""}`}
      disabled={disabled}
      onKeyDown={onKeyDown}
      onLostPointerCapture={onPointerCancel}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="拖拽排序；Alt + 方向键可逐项移动"
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

function FieldActionMenu({
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
    <div className="form-field-action-menu-wrap" data-form-field-menu>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className="form-field-menu-trigger"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <circle cx="3" cy="8" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="13" cy="8" r="1.2" />
        </svg>
      </button>
      {open ? (
        <div
          className="form-field-action-menu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          {items.map((item) => (
            <button
              className={item.danger ? "danger" : undefined}
              disabled={disabled || item.disabled}
              key={item.label}
              onClick={() => {
                item.onSelect();
                onOpenChange(false);
              }}
              role="menuitem"
              type="button"
            >{item.label}</button>
          ))}
        </div>
      ) : null}
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
