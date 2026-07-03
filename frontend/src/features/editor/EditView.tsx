import { useState, type ReactNode } from "react";

import { advancedTypes, commonTypes, questionTypes } from "../../data/mockData";
import {
  matchRosterColumns,
  parseRosterHeaders,
  type RosterColumns,
} from "../../utils/roster";

export function EditView() {
  const [isRosterDialogOpen, setIsRosterDialogOpen] = useState(false);
  const [rosterFileName, setRosterFileName] = useState("");
  const [rosterColumns, setRosterColumns] = useState<RosterColumns>({
    班级: "",
    学号: "",
    姓名: "",
  });
  const [rosterError, setRosterError] = useState("");

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
        <QuestionGroup title="基础题型" items={questionTypes} />
        <QuestionGroup title="高级题型" items={advancedTypes} />
        <QuestionGroup title="常用题库" items={commonTypes} compact />
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

          <QuestionCard
            index="01"
            title="姓名"
            required
            body={<input aria-label="姓名示例" placeholder="待填写人输入姓名" />}
          />
          <QuestionCard
            index="02"
            title="学号"
            required
            body={<input aria-label="学号示例" placeholder="待填写人输入学号" />}
          />
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
  title,
}: {
  compact?: boolean;
  items: string[];
  title: string;
}) {
  return (
    <section className="question-group">
      <h3>{title}</h3>
      <div className={compact ? "type-grid compact" : "type-grid"}>
        {items.map((item) => (
          <button key={item}>{item}</button>
        ))}
      </div>
    </section>
  );
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
