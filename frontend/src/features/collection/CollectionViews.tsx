import type { ReactNode } from "react";

import type { DraftStudent, Stats, Student, StudentAccount } from "../../types";

export function SettingsView({
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

export function StatsView({ stats, students }: { stats: Stats; students: Student[] }) {
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

export function FillView({
  activeUser,
  fileNamePattern,
  onFileChange,
  onSubmit,
  onSubmitterChange,
  selectedFile,
  submitter,
}: {
  activeUser: StudentAccount | null;
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
        {activeUser && (
          <p className="login-note">
            当前登录：{activeUser.name}（{activeUser.studentNo}）
          </p>
        )}
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

function SettingsCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="settings-card">
      <h2>{title}</h2>
      {children}
    </section>
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
