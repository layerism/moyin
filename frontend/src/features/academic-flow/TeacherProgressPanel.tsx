import { useEffect, useState } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
import type { WorkflowProgress } from "./runtimeTypes";

export function TeacherProgressPanel({
  nodes,
  onClose,
  onDeadlineChange,
  versionId,
}: {
  nodes: AcademicFlowNode[];
  onClose: () => void;
  onDeadlineChange: (nodeId: string, deadlineAt: string) => void;
  versionId: string;
}) {
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [notice, setNotice] = useState("");
  const [extension, setExtension] = useState({
    deadline: "",
    instanceId: "",
    nodeKey: nodes[0]?.id ?? "",
    reason: "批准个别延期",
  });

  const refresh = () => {
    workflowApi.getProgress(versionId).then(setProgress).catch((reason: Error) => setNotice(reason.message));
  };

  useEffect(refresh, [versionId]);

  const saveGlobalDeadline = async (node: AcademicFlowNode, value: string) => {
    if (!value) return;
    const deadlineAt = new Date(value).toISOString();
    try {
      await workflowApi.setGlobalDeadline(versionId, node.id, deadlineAt, "教师调整统一截止时间");
      onDeadlineChange(node.id, deadlineAt);
      setNotice(`${node.title} 截止时间已更新`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "更新失败");
    }
  };

  const saveExtension = async () => {
    if (!extension.instanceId || !extension.nodeKey || !extension.deadline) {
      setNotice("请选择学生、节点和延期时间");
      return;
    }
    try {
      await workflowApi.setStudentDeadline(
        extension.instanceId,
        extension.nodeKey,
        new Date(extension.deadline).toISOString(),
        extension.reason,
      );
      setNotice("个别学生延期已保存");
      refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "延期失败");
    }
  };

  return (
    <div className="inspector-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="teacher-progress-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>流程运行管理</span>
            <h2>学生填写进度</h2>
          </div>
          <button aria-label="关闭进度面板" onClick={onClose}>×</button>
        </header>
        <p className="progress-notice">{notice}</p>
        <section className="deadline-editor-list">
          <h3>节点统一截止时间</h3>
          {nodes.map((node) => (
            <label key={node.id}>
              <span>{node.title}</span>
              <input
                defaultValue={node.deadlineAt ? toLocalDateTime(node.deadlineAt) : ""}
                onBlur={(event) => void saveGlobalDeadline(node, event.target.value)}
                type="datetime-local"
              />
            </label>
          ))}
        </section>
        <section className="student-extension-editor">
          <h3>个别学生延期</h3>
          <select value={extension.instanceId} onChange={(event) => setExtension({ ...extension, instanceId: event.target.value })}>
            <option value="">选择学生</option>
            {progress?.students.map((student) => (
              <option key={student.instanceId} value={student.instanceId}>
                {student.studentNo} {student.name}
              </option>
            ))}
          </select>
          <select value={extension.nodeKey} onChange={(event) => setExtension({ ...extension, nodeKey: event.target.value })}>
            {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
          </select>
          <input type="datetime-local" value={extension.deadline} onChange={(event) => setExtension({ ...extension, deadline: event.target.value })} />
          <input value={extension.reason} onChange={(event) => setExtension({ ...extension, reason: event.target.value })} />
          <button className="primary-action" onClick={() => void saveExtension()}>保存延期</button>
        </section>
        <section className="progress-table-wrap">
          <table className="progress-table">
            <thead><tr><th>学生</th><th>状态</th><th>完成</th><th>逾期</th><th>最后活动</th></tr></thead>
            <tbody>
              {progress?.students.map((student) => (
                <tr key={student.instanceId}>
                  <td><strong>{student.name}</strong><small>{student.studentNo}</small></td>
                  <td>{student.status === "completed" ? "已完成" : "进行中"}</td>
                  <td>{student.approvedCount}/{student.totalCount}</td>
                  <td>{student.expiredCount}</td>
                  <td>{new Date(student.lastActiveAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
              {progress?.students.length === 0 ? <tr><td colSpan={5}>尚无学生进入该流程</td></tr> : null}
            </tbody>
          </table>
        </section>
      </aside>
    </div>
  );
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
