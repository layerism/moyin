import { useState, type ReactNode } from "react";

import { advancedTypes, questionTypes } from "../../data/mockData";
import {
  matchRosterColumns,
  parseRosterHeaders,
  type RosterColumns,
} from "../../utils/roster";

type EditorQuestion = {
  id: string;
  kind: string;
  required?: boolean;
  title: string;
};

const defaultQuestions: EditorQuestion[] = [
  { id: "default-name", kind: "姓名", required: true, title: "姓名" },
  { id: "default-student-no", kind: "学号", required: true, title: "学号" },
];

export function EditView() {
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
        id: `${kind}-${Date.now()}`,
        kind,
        title: kind,
      },
    ]);
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
            <input className="title-input" aria-label="收集表标题" placeholder="请输入标题" />
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
              body={renderQuestionBody(question.kind)}
              index={String(index + 1).padStart(2, "0")}
              key={question.id}
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

function renderQuestionBody(kind: string) {
  if (kind === "姓名") {
    return <input aria-label="姓名示例" placeholder="待填写人输入姓名" />;
  }
  if (kind === "学号") {
    return <input aria-label="学号示例" placeholder="待填写人输入学号" />;
  }
  if (kind === "问答题") {
    return <textarea placeholder="待填写人输入文字回答" rows={3} />;
  }
  if (kind === "单选题") {
    return (
      <div className="option-stack">
        {["选项 A", "选项 B", "选项 C"].map((option) => (
          <label key={option}>
            <input name="single-demo" type="radio" />
            {option}
          </label>
        ))}
      </div>
    );
  }
  if (kind === "多选题") {
    return (
      <div className="option-stack">
        {["选项 A", "选项 B", "选项 C"].map((option) => (
          <label key={option}>
            <input type="checkbox" />
            {option}
          </label>
        ))}
      </div>
    );
  }
  if (kind === "时间题") {
    return <input type="datetime-local" />;
  }
  if (kind === "图片题") {
    return <input accept="image/*" type="file" />;
  }
  if (kind === "文件题") {
    return <input type="file" />;
  }
  if (kind === "下拉选择") {
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
  if (kind === "签名题") {
    return <div className="signature-box">签名区域</div>;
  }
  if (kind === "多级选项") {
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
  if (kind === "量表题") {
    return (
      <div className="scale-row">
        <span>低</span>
        <input max="5" min="1" type="range" />
        <span>高</span>
      </div>
    );
  }
  if (kind === "评分题") {
    return (
      <div className="rating-row">
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score}>
            <input name="rating-demo" type="radio" />
            {score}
          </label>
        ))}
      </div>
    );
  }
  if (kind === "表格题") {
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
  if (kind === "矩阵题") {
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
              <input name="matrix-demo" type="radio" />
            </td>
            <td>
              <input name="matrix-demo" type="radio" />
            </td>
            <td>
              <input name="matrix-demo" type="radio" />
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
  if (kind === "分节标题") {
    return <p className="section-title-preview">分节说明文字</p>;
  }
  return <input placeholder="待填写人输入内容" />;
}

function QuestionCard({
  body,
  index,
  required = false,
  title,
}: {
  body: ReactNode;
  index: string;
  required?: boolean;
  title: string;
}) {
  return (
    <section className="question-card">
      <h3>
        {required && <span>*</span>}
        {index} {title}
      </h3>
      <div className="question-body">{body}</div>
    </section>
  );
}
