import { useMemo, useState, type ReactNode } from "react";

type Tab = "edit" | "stats" | "settings" | "fill";
type Source = "导入" | "临时添加";
type SubmitStatus = "未提交" | "已提交" | "已覆盖";
type CheckStatus = "-" | "待检查" | "检查中" | "检查成功" | "检查失败";

type Student = {
  name: string;
  studentNo: string;
  className: string;
  source: Source;
  submitStatus: SubmitStatus;
  checkStatus: CheckStatus;
  fileName?: string;
  submitCount: number;
};

type DraftStudent = {
  name: string;
  studentNo: string;
  className: string;
};

type Stats = {
  failed: number;
  overwritten: number;
  submitted: number;
  temporary: number;
  total: number;
  unsubmitted: number;
};

const questionTypes = [
  "问答题",
  "单选题",
  "多选题",
  "时间题",
  "图片题",
  "文件题",
  "下拉选择",
  "签名题",
];

const advancedTypes = ["多级选项", "量表题", "评分题", "表格题", "矩阵题", "分节标题"];
const commonTypes = ["姓名", "学号", "手机号", "班级"];

const initialStudents: Student[] = [
  {
    name: "张三",
    studentNo: "20240001",
    className: "2023软件5班",
    source: "导入",
    submitStatus: "已提交",
    checkStatus: "检查成功",
    fileName: "20240001-张三-DOCX材料.docx",
    submitCount: 1,
  },
  {
    name: "李四",
    studentNo: "20240002",
    className: "2023软件5班",
    source: "导入",
    submitStatus: "已覆盖",
    checkStatus: "检查中",
    fileName: "20240002-李四-DOCX材料.docx",
    submitCount: 2,
  },
  {
    name: "王五",
    studentNo: "20240003",
    className: "2023软件6班",
    source: "导入",
    submitStatus: "未提交",
    checkStatus: "-",
    submitCount: 0,
  },
  {
    name: "赵六",
    studentNo: "20249999",
    className: "临时",
    source: "临时添加",
    submitStatus: "未提交",
    checkStatus: "-",
    submitCount: 0,
  },
];

function makeFileName(pattern: string, student: Student, materialName: string) {
  return [
    ["学号", student.studentNo],
    ["姓名", student.name],
    ["班级", student.className],
    ["材料名称", materialName],
    ["提交时间", "20260703"],
  ].reduce((value, [token, replacement]) => value.split(token).join(replacement), pattern);
}

export function App() {
  const [tab, setTab] = useState<Tab>("edit");
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [fileNamePattern, setFileNamePattern] = useState("学号-姓名-材料名称.docx");
  const [deadline, setDeadline] = useState("2026-07-20 23:59");
  const [draftStudent, setDraftStudent] = useState<DraftStudent>({
    name: "",
    studentNo: "",
    className: "",
  });
  const [submitter, setSubmitter] = useState({ name: "李四", studentNo: "20240002" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("最近保存 12:28");

  const stats = useMemo(() => {
    const submitted = students.filter((student) => student.submitStatus !== "未提交").length;
    const overwritten = students.filter((student) => student.submitStatus === "已覆盖").length;
    const temporary = students.filter((student) => student.source === "临时添加").length;
    const failed = students.filter((student) => student.checkStatus === "检查失败").length;
    return {
      total: students.length,
      submitted,
      overwritten,
      temporary,
      unsubmitted: students.length - submitted,
      failed,
    };
  }, [students]);

  const addTemporaryStudent = () => {
    if (!draftStudent.name.trim() || !draftStudent.studentNo.trim()) {
      setNotice("请填写临时学生姓名和学号");
      return;
    }

    const exists = students.some((student) => student.studentNo === draftStudent.studentNo.trim());
    if (exists) {
      setNotice("该学号已在名单中");
      return;
    }

    setStudents((current) => [
      ...current,
      {
        name: draftStudent.name.trim(),
        studentNo: draftStudent.studentNo.trim(),
        className: draftStudent.className.trim() || "临时",
        source: "临时添加",
        submitStatus: "未提交",
        checkStatus: "-",
        submitCount: 0,
      },
    ]);
    setDraftStudent({ name: "", studentNo: "", className: "" });
    setNotice("已临时添加学生");
  };

  const submitForm = () => {
    const matched = students.find(
      (student) => student.name === submitter.name && student.studentNo === submitter.studentNo,
    );

    if (!matched) {
      setNotice("姓名与学号不在学生名单中");
      return;
    }

    if (!selectedFile) {
      setNotice("请先上传 DOCX 材料");
      return;
    }

    const materialName = selectedFile.name.replace(/\.docx$/i, "") || "DOCX材料";
    const renamedFile = makeFileName(fileNamePattern, matched, materialName);

    setStudents((current) =>
      current.map((student) => {
        if (student.studentNo !== matched.studentNo) {
          return student;
        }

        const nextCount = student.submitCount + 1;
        return {
          ...student,
          submitStatus: nextCount > 1 ? "已覆盖" : "已提交",
          checkStatus: "检查中",
          fileName: renamedFile,
          submitCount: nextCount,
        };
      }),
    );
    setNotice(`已提交并自动命名：${renamedFile}`);
    setTab("stats");
  };

  return (
    <div className="workspace">
      <TopBar notice={notice} />
      <nav className="tabs" aria-label="工作区">
        <button className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>
          编辑
        </button>
        <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
          统计
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          设置
        </button>
        <button className={tab === "fill" ? "active" : ""} onClick={() => setTab("fill")}>
          学生预览
        </button>
      </nav>

      {tab === "edit" && <EditView />}
      {tab === "stats" && <StatsView stats={stats} students={students} />}
      {tab === "settings" && (
        <SettingsView
          deadline={deadline}
          draftStudent={draftStudent}
          fileNamePattern={fileNamePattern}
          onAddStudent={addTemporaryStudent}
          onDeadlineChange={setDeadline}
          onDraftStudentChange={setDraftStudent}
          onFileNamePatternChange={setFileNamePattern}
          students={students}
        />
      )}
      {tab === "fill" && (
        <FillView
          fileNamePattern={fileNamePattern}
          onFileChange={setSelectedFile}
          onSubmit={submitForm}
          selectedFile={selectedFile}
          submitter={submitter}
          onSubmitterChange={setSubmitter}
        />
      )}
    </div>
  );
}

function TopBar({ notice }: { notice: string }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="home-dot" />
        <button className="chrome-button">⌂</button>
        <button className="chrome-button">+</button>
        <h1>密码学作业提交</h1>
        <span className="star">☆</span>
        <span className="folder">□</span>
        <span className="save-state">○ {notice}</span>
      </div>
      <div className="topbar-right">
        <button className="chrome-button">☰</button>
        <button className="avatar">卢</button>
      </div>
    </header>
  );
}

function EditView() {
  return (
    <main className="editor-layout">
      <aside className="question-panel">
        <div className="switcher">
          <button className="selected">添加问题</button>
          <button>大纲</button>
        </div>
        <div className="prompt-box">输入问题，自动匹配题型</div>
        <QuestionGroup title="基础题型" items={questionTypes} />
        <QuestionGroup title="高级题型" items={advancedTypes} />
        <QuestionGroup title="常用题库" items={commonTypes} compact />
      </aside>

      <section className="canvas-area">
        <div className="form-canvas">
          <section className="hero-card">
            <h2>密码学作业提交</h2>
            <p>添加描述：文字、图片或链接</p>
            <div className="hero-actions">
              <button>+ 定时和重复</button>
              <button className="roster-chip">参与名单：2023软件5-6班(94)</button>
              <button>+ 结束页</button>
            </div>
          </section>

          <section className="list-card roster-entry">
            <span>加入名单</span>
            <button>预览 ›</button>
          </section>

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
          <QuestionCard
            index="03"
            title="上传 DOCX 材料"
            required
            body={
              <div className="upload-box">
                <strong>+ 待填写人添加文件</strong>
                <span>文件要求：.docx；自动命名：学号-姓名-材料名称.docx</span>
              </div>
            }
          />
          <section className="ai-card">让 AI 文档助手帮你添加问题...</section>
          <button className="add-question">添加问题</button>
        </div>
        <div className="bottom-bar">
          <button>预览</button>
          <button className="primary">发布</button>
        </div>
      </section>
    </main>
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

function SettingsView({
  deadline,
  draftStudent,
  fileNamePattern,
  onAddStudent,
  onDeadlineChange,
  onDraftStudentChange,
  onFileNamePatternChange,
  students,
}: {
  deadline: string;
  draftStudent: DraftStudent;
  fileNamePattern: string;
  onAddStudent: () => void;
  onDeadlineChange: (value: string) => void;
  onDraftStudentChange: (value: DraftStudent) => void;
  onFileNamePatternChange: (value: string) => void;
  students: Student[];
}) {
  return (
    <main className="settings-page">
      <SettingsCard title="截止时间">
        <input value={deadline} onChange={(event) => onDeadlineChange(event.target.value)} />
      </SettingsCard>
      <SettingsCard title="固定提交规则">
        <p>仅学生名单内可填写；重复提交自动覆盖上一版。</p>
      </SettingsCard>
      <SettingsCard title="文件自动命名">
        <input
          value={fileNamePattern}
          onChange={(event) => onFileNamePatternChange(event.target.value)}
        />
        <small>可用变量：学号、姓名、班级、材料名称、提交时间</small>
      </SettingsCard>
      <SettingsCard title="学生名单">
        <div className="toolbar">
          <button>导入 Excel/CSV</button>
          <button>下载模板</button>
        </div>
        <div className="inline-form">
          <input
            placeholder="姓名"
            value={draftStudent.name}
            onChange={(event) =>
              onDraftStudentChange({ ...draftStudent, name: event.target.value })
            }
          />
          <input
            placeholder="学号"
            value={draftStudent.studentNo}
            onChange={(event) =>
              onDraftStudentChange({ ...draftStudent, studentNo: event.target.value })
            }
          />
          <input
            placeholder="班级"
            value={draftStudent.className}
            onChange={(event) =>
              onDraftStudentChange({ ...draftStudent, className: event.target.value })
            }
          />
          <button className="primary small" onClick={onAddStudent}>
            临时添加学生
          </button>
        </div>
        <StudentTable students={students} />
      </SettingsCard>
    </main>
  );
}

function SettingsCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="settings-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function StatsView({ stats, students }: { stats: Stats; students: Student[] }) {
  return (
    <main className="stats-page">
      <div className="stat-strip">
        <strong>名单 {stats.total} 人</strong>
        <span>临时 {stats.temporary}</span>
        <span>已提交 {stats.submitted}</span>
        <span>覆盖 {stats.overwritten}</span>
        <span>未提交 {stats.unsubmitted}</span>
        <span>检查失败 {stats.failed}</span>
      </div>
      <div className="stats-actions">
        <div>
          {["全部", "未提交", "已提交", "已覆盖", "检查失败"].map((filter, index) => (
            <button className={index === 0 ? "selected" : ""} key={filter}>
              {filter}
            </button>
          ))}
        </div>
        <div>
          <button>导出</button>
          <button className="primary small">批量提醒</button>
        </div>
      </div>
      <StudentTable showFiles students={students} />
    </main>
  );
}

function StudentTable({ showFiles = false, students }: { showFiles?: boolean; students: Student[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>姓名</th>
            <th>学号</th>
            <th>班级</th>
            <th>来源</th>
            <th>提交状态</th>
            <th>检查状态</th>
            {showFiles && <th>文件</th>}
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.studentNo}>
              <td>{student.name}</td>
              <td>{student.studentNo}</td>
              <td>{student.className}</td>
              <td>{student.source}</td>
              <td>
                <span className={`badge ${student.submitStatus === "未提交" ? "muted" : "ok"}`}>
                  {student.submitStatus}
                </span>
              </td>
              <td>{student.checkStatus}</td>
              {showFiles && <td>{student.fileName ?? "-"}</td>}
              <td>
                <button className="link-button">
                  {student.submitStatus === "未提交" ? "提醒" : "查看"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FillView({
  fileNamePattern,
  onFileChange,
  onSubmit,
  onSubmitterChange,
  selectedFile,
  submitter,
}: {
  fileNamePattern: string;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
  onSubmitterChange: (value: { name: string; studentNo: string }) => void;
  selectedFile: File | null;
  submitter: { name: string; studentNo: string };
}) {
  return (
    <main className="fill-page">
      <section className="fill-card">
        <h2>密码学作业提交</h2>
        <p>仅名单内学生可提交；重复提交将覆盖上一版。</p>
        <label>
          <span>*01 姓名</span>
          <input
            value={submitter.name}
            onChange={(event) => onSubmitterChange({ ...submitter, name: event.target.value })}
          />
        </label>
        <label>
          <span>*02 学号</span>
          <input
            value={submitter.studentNo}
            onChange={(event) =>
              onSubmitterChange({ ...submitter, studentNo: event.target.value })
            }
          />
        </label>
        <label>
          <span>*03 上传 DOCX 材料</span>
          <input
            accept=".docx"
            type="file"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
        <div className="file-hint">
          <strong>{selectedFile ? selectedFile.name : "未选择文件"}</strong>
          <span>提交后按规则命名：{fileNamePattern}</span>
        </div>
        <button className="primary submit" onClick={onSubmit}>
          提交
        </button>
      </section>
    </main>
  );
}
