import { useState } from "react";

import { advancedTypes, questionTypes } from "../../data/mockData";
import {
  matchRosterColumns,
  parseRosterHeaders,
  type RosterColumns,
} from "../../utils/roster";

type EditorQuestion = {
  content?: string;
  id: string;
  kind: string;
  options?: string[];
  required?: boolean;
  title: string;
};

const defaultQuestions: EditorQuestion[] = [
  { id: "default-name", kind: "姓名", required: true, title: "姓名" },
  { id: "default-student-no", kind: "学号", required: true, title: "学号" },
];

export function EditView({
  collectionTitle,
  onCollectionTitleChange,
}: {
  collectionTitle: string;
  onCollectionTitleChange: (title: string) => void;
}) {
  const [isRosterDialogOpen, setIsRosterDialogOpen] = useState(false);
  const [rosterFileName, setRosterFileName] = useState("");
  const [rosterColumns, setRosterColumns] = useState<RosterColumns>({
    班级: "",
    学号: "",
    姓名: "",
  });
  const [rosterError, setRosterError] = useState("");
  const [questions, setQuestions] = useState<EditorQuestion[]>(defaultQuestions);

  const addQuestion = (kind: string) => {
    setQuestions((current) => [
      ...current,
      {
        content: "",
        id: `${kind}-${Date.now()}`,
        kind,
        options: ["单选题", "多选题"].includes(kind) ? ["选项 A", "选项 B", "选项 C"] : undefined,
        title: kind,
      },
    ]);
  };

  const deleteQuestion = (id: string) => {
    setQuestions((current) => current.filter((question) => question.id !== id));
  };

  const updateQuestion = (id: string, value: Partial<EditorQuestion>) => {
    setQuestions((current) =>
      current.map((question) => (question.id === id ? { ...question, ...value } : question)),
    );
  };

  const updateQuestionOption = (id: string, optionIndex: number, value: string) => {
    setQuestions((current) =>
      current.map((question) => {
        if (question.id !== id) {
          return question;
        }
        return {
          ...question,
          options: (question.options ?? []).map((option, index) =>
            index === optionIndex ? value : option,
          ),
        };
      }),
    );
  };

  const addQuestionOption = (id: string) => {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              options: [...(question.options ?? []), `选项 ${(question.options ?? []).length + 1}`],
            }
          : question,
      ),
    );
  };

  const deleteQuestionOption = (id: string, optionIndex: number) => {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              options: (question.options ?? []).filter((_, index) => index !== optionIndex),
            }
          : question,
      ),
    );
  };

  const appendMarkdown = (id: string, token: string) => {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? { ...question, content: `${question.content ?? ""}${token}` }
          : question,
      ),
    );
  };

  const handleRosterFile = (file: File | null) => {
    if (!file) {
      return;
    }

    setRosterFileName(file.name);
    setRosterError("");
    void parseRosterHeaders(file)
      .then((headers) => setRosterColumns(matchRosterColumns(headers)))
      .catch(() => setRosterError("名单解析失败，请检查 Excel 表头"));
  };

  return (
    <main className="editor-layout">
      <aside className="question-panel">
        <div className="switcher">
          <button className="selected">添加问题</button>
          <button>大纲</button>
        </div>
        <QuestionGroup title="基础题型" items={questionTypes} onAdd={addQuestion} />
        <QuestionGroup title="高级题型" items={advancedTypes} onAdd={addQuestion} />
      </aside>

      <section className="canvas-area">
        <div className="form-canvas">
          <section className="hero-card">
            <input
              className="title-input"
              aria-label="收集表标题"
              placeholder="请输入标题"
              value={collectionTitle}
              onChange={(event) => onCollectionTitleChange(event.target.value)}
            />
          </section>
          <button
            className="roster-trigger"
            type="button"
            onClick={() => setIsRosterDialogOpen(true)}
          >
            学生名单采集
            <span>{rosterFileName ? "已上传名单" : "上传 Excel 名单"}</span>
          </button>

          {questions.map((question, index) => (
            <QuestionCard
              question={question}
              onAddOption={() => addQuestionOption(question.id)}
              onAppendMarkdown={(token) => appendMarkdown(question.id, token)}
              onContentChange={(content) => updateQuestion(question.id, { content })}
              index={String(index + 1).padStart(2, "0")}
              key={question.id}
              onDelete={() => deleteQuestion(question.id)}
              onDeleteOption={(optionIndex) => deleteQuestionOption(question.id, optionIndex)}
              onOptionChange={(optionIndex, value) =>
                updateQuestionOption(question.id, optionIndex, value)
              }
              required={question.required}
              title={question.title}
            />
          ))}
        </div>
        <div className="bottom-bar">
          <button>预览</button>
          <button className="primary">发布</button>
        </div>
      </section>

      {isRosterDialogOpen && (
        <RosterImportDialog
          error={rosterError}
          fileName={rosterFileName}
          columns={rosterColumns}
          onClose={() => setIsRosterDialogOpen(false)}
          onFileChange={handleRosterFile}
        />
      )}
    </main>
  );
}

function RosterImportDialog({
  columns,
  error,
  fileName,
  onClose,
  onFileChange,
}: {
  columns: RosterColumns;
  error: string;
  fileName: string;
  onClose: () => void;
  onFileChange: (file: File | null) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="rename-dialog roster-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>学生名单采集</h2>
        <p>上传 Excel 名单，系统按表头自动识别班级、学号、姓名。</p>
        <label className="roster-upload">
          <input
            accept=".xlsx,.csv"
            type="file"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
          选择 Excel 名单
        </label>
        <div className="roster-result">
          <strong>{fileName || "未选择文件"}</strong>
          {(["班级", "学号", "姓名"] as const).map((field) => (
            <span className={columns[field] ? "matched" : ""} key={field}>
              {field}：{columns[field] || "待识别"}
            </span>
          ))}
          {error && <em>{error}</em>}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}

function QuestionGroup({
  compact = false,
  items,
  onAdd,
  title,
}: {
  compact?: boolean;
  items: string[];
  onAdd: (kind: string) => void;
  title: string;
}) {
  return (
    <section className="question-group">
      <h3>{title}</h3>
      <div className={compact ? "type-grid compact" : "type-grid"}>
        {items.map((item) => (
          <button key={item} onClick={() => onAdd(item)} type="button">
            {item}
          </button>
        ))}
      </div>
    </section>
  );
}

function renderQuestionBody({
  onAddOption,
  onAppendMarkdown,
  onContentChange,
  onDeleteOption,
  onOptionChange,
  question,
}: {
  onAddOption: () => void;
  onAppendMarkdown: (token: string) => void;
  onContentChange: (content: string) => void;
  onDeleteOption: (optionIndex: number) => void;
  onOptionChange: (optionIndex: number, value: string) => void;
  question: EditorQuestion;
}) {
  if (question.kind === "姓名") {
    return <input aria-label="姓名示例" placeholder="待填写人输入姓名" />;
  }
  if (question.kind === "学号") {
    return <input aria-label="学号示例" placeholder="待填写人输入学号" />;
  }
  if (question.kind === "问答题") {
    return (
      <div className="markdown-editor">
        <div className="markdown-toolbar" aria-label="Markdown 编辑工具">
          <button type="button" onClick={() => onAppendMarkdown("**加粗文字**")}>
            B
          </button>
          <button type="button" onClick={() => onAppendMarkdown("*斜体文字*")}>
            I
          </button>
          <button type="button" onClick={() => onAppendMarkdown("\n## 小标题\n")}>
            H
          </button>
          <button type="button" onClick={() => onAppendMarkdown("[链接文字](https://)")}>
            Link
          </button>
          <button type="button" onClick={() => onAppendMarkdown("\n- 列表项\n")}>
            List
          </button>
          <button type="button" onClick={() => onAppendMarkdown("`代码`")}>
            Code
          </button>
        </div>
        <textarea
          placeholder="待填写人输入文字回答，支持基础 Markdown"
          rows={4}
          value={question.content ?? ""}
          onChange={(event) => onContentChange(event.target.value)}
        />
      </div>
    );
  }
  if (question.kind === "单选题") {
    return (
      <EditableOptions
        inputType="radio"
        name={question.id}
        onAddOption={onAddOption}
        onDeleteOption={onDeleteOption}
        onOptionChange={onOptionChange}
        options={question.options ?? []}
      />
    );
  }
  if (question.kind === "多选题") {
    return (
      <EditableOptions
        inputType="checkbox"
        name={question.id}
        onAddOption={onAddOption}
        onDeleteOption={onDeleteOption}
        onOptionChange={onOptionChange}
        options={question.options ?? []}
      />
    );
  }
  if (question.kind === "时间题") {
    return <input type="datetime-local" />;
  }
  if (question.kind === "图片题") {
    return <input accept="image/*" type="file" />;
  }
  if (question.kind === "文件题") {
    return <input type="file" />;
  }
  if (question.kind === "下拉选择") {
    return (
      <select defaultValue="">
        <option value="" disabled>
          请选择
        </option>
        <option>选项 A</option>
        <option>选项 B</option>
        <option>选项 C</option>
      </select>
    );
  }
  if (question.kind === "签名题") {
    return <div className="signature-box">签名区域</div>;
  }
  if (question.kind === "多级选项") {
    return (
      <div className="inline-controls">
        <select defaultValue="">
          <option value="" disabled>
            一级选项
          </option>
          <option>类别 A</option>
          <option>类别 B</option>
        </select>
        <select defaultValue="">
          <option value="" disabled>
            二级选项
          </option>
          <option>子项 1</option>
          <option>子项 2</option>
        </select>
      </div>
    );
  }
  if (question.kind === "量表题") {
    return (
      <div className="scale-row">
        <span>低</span>
        <input max="5" min="1" type="range" />
        <span>高</span>
      </div>
    );
  }
  if (question.kind === "评分题") {
    return (
      <div className="rating-row">
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score}>
            <input name={`rating-${question.id}`} type="radio" />
            {score}
          </label>
        ))}
      </div>
    );
  }
  if (question.kind === "表格题") {
    return (
      <table className="question-table">
        <tbody>
          <tr>
            <td>字段</td>
            <td>
              <input placeholder="填写内容" />
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
  if (question.kind === "矩阵题") {
    return (
      <table className="question-table">
        <thead>
          <tr>
            <th />
            <th>满意</th>
            <th>一般</th>
            <th>不满意</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>项目 A</td>
            <td>
              <input name={`matrix-${question.id}`} type="radio" />
            </td>
            <td>
              <input name={`matrix-${question.id}`} type="radio" />
            </td>
            <td>
              <input name={`matrix-${question.id}`} type="radio" />
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
  if (question.kind === "分节标题") {
    return <p className="section-title-preview">分节说明文字</p>;
  }
  return <input placeholder="待填写人输入内容" />;
}

function EditableOptions({
  inputType,
  name,
  onAddOption,
  onDeleteOption,
  onOptionChange,
  options,
}: {
  inputType: "checkbox" | "radio";
  name: string;
  onAddOption: () => void;
  onDeleteOption: (optionIndex: number) => void;
  onOptionChange: (optionIndex: number, value: string) => void;
  options: string[];
}) {
  return (
    <div className="option-stack">
      {options.map((option, index) => (
        <label key={`${name}-${index}`}>
          <input name={name} type={inputType} />
          <input
            className="option-text-input"
            value={option}
            onChange={(event) => onOptionChange(index, event.target.value)}
          />
          <button
            aria-label={`删除选项 ${index + 1}`}
            className="option-delete"
            type="button"
            onClick={() => onDeleteOption(index)}
          >
            ×
          </button>
        </label>
      ))}
      <button className="option-add" type="button" onClick={onAddOption}>
        + 添加选项
      </button>
    </div>
  );
}

function QuestionCard({
  index,
  onAddOption,
  onAppendMarkdown,
  onContentChange,
  onDelete,
  onDeleteOption,
  onOptionChange,
  question,
  required = false,
  title,
}: {
  index: string;
  onAddOption: () => void;
  onAppendMarkdown: (token: string) => void;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onDeleteOption: (optionIndex: number) => void;
  onOptionChange: (optionIndex: number, value: string) => void;
  question: EditorQuestion;
  required?: boolean;
  title: string;
}) {
  return (
    <section className="question-card">
      <div className="question-card-head">
        <h3>
          {required && <span>*</span>}
          {index} {title}
        </h3>
        <button aria-label={`删除 ${index} ${title}`} onClick={onDelete} type="button">
          ×
        </button>
      </div>
      <div className="question-body">
        {renderQuestionBody({
          onAddOption,
          onAppendMarkdown,
          onContentChange,
          onDeleteOption,
          onOptionChange,
          question,
        })}
      </div>
    </section>
  );
}
