import { Fragment, useEffect, useState } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
import type { WorkflowProgress, WorkflowProgressNode, WorkflowProgressStudent } from "./runtimeTypes";

function toLocalDateTimeInput(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function minimumExtensionValue(effectiveDeadline: string) {
  const floor = Math.max(Date.now(), new Date(effectiveDeadline).getTime());
  const nextMinute = Math.floor(floor / 60_000) * 60_000 + 60_000;
  return toLocalDateTimeInput(nextMinute);
}

export function TeacherProgressPanel({
  nodes: _nodes,
  onClose,
  versionId,
}: {
  nodes: AcademicFlowNode[];
  onClose: () => void;
  versionId: string;
}) {
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [notice, setNotice] = useState("");
  const [expandedInstanceId, setExpandedInstanceId] = useState<string | null>(null);
  const [savingExtension, setSavingExtension] = useState(false);
  const [extension, setExtension] = useState({
    deadline: "",
    nodeKey: "",
    reason: "批准个别延期",
  });

  const refresh = async () => {
    const value = await workflowApi.getProgress(versionId);
    setProgress(value);
  };

  useEffect(() => {
    void refresh().catch((reason: Error) => setNotice(reason.message));
  }, [versionId]);

  const clearExtension = () => {
    setExpandedInstanceId(null);
    setExtension({ deadline: "", nodeKey: "", reason: "批准个别延期" });
  };

  const toggleExtension = (student: WorkflowProgressStudent) => {
    if (expandedInstanceId === student.instanceId) {
      clearExtension();
      return;
    }
    const eligibleNodes = student.nodes.filter(
      (node) => node.status !== "approved" && node.effectiveDeadline,
    );
    setExpandedInstanceId(student.instanceId);
    setExtension({
      deadline: "",
      nodeKey: eligibleNodes[0]?.nodeKey ?? "",
      reason: "批准个别延期",
    });
  };

  const saveExtension = async (instanceId: string, currentNode: WorkflowProgressNode | undefined) => {
    if (!currentNode || !currentNode.effectiveDeadline) {
      setNotice("请选择可延期节点");
      return;
    }
    if (!extension.deadline) {
      setNotice("请选择新的截止时间");
      return;
    }
    const cleanReason = extension.reason.trim();
    if (!cleanReason) {
      setNotice("请填写延期原因");
      return;
    }
    const newDeadline = new Date(extension.deadline).getTime();
    const currentDeadline = new Date(currentNode.effectiveDeadline).getTime();
    if (!Number.isFinite(newDeadline) || newDeadline <= currentDeadline) {
      setNotice("新的截止时间必须晚于当前生效截止时间");
      return;
    }
    if (newDeadline <= Date.now()) {
      setNotice("新的截止时间必须晚于当前时间");
      return;
    }
    setSavingExtension(true);
    try {
      await workflowApi.setStudentDeadline(
        instanceId,
        currentNode.nodeKey,
        new Date(extension.deadline).toISOString(),
        cleanReason,
      );
      setNotice("个别学生延期已保存");
      clearExtension();
      try {
        await refresh();
      } catch (reason) {
        setNotice(`延期已保存，但进度刷新失败：${reason instanceof Error ? reason.message : "请求失败"}`);
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "延期失败");
    } finally {
      setSavingExtension(false);
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
        <section className="progress-table-wrap">
          <table className="progress-table">
            <thead>
              <tr><th>学生</th><th>状态</th><th>完成</th><th>逾期</th><th>最后活动</th><th>操作</th></tr>
            </thead>
            <tbody>
              {progress?.students.map((student) => {
                const isExpanded = expandedInstanceId === student.instanceId;
                const eligibleNodes = student.nodes.filter(
                  (node) => node.status !== "approved" && node.effectiveDeadline,
                );
                const currentNode = eligibleNodes.find((node) => node.nodeKey === extension.nodeKey);
                return (
                  <Fragment key={student.instanceId}>
                    <tr>
                      <td><strong>{student.name}</strong><small>{student.studentNo}</small></td>
                      <td>{student.status === "completed" ? "已完成" : "进行中"}</td>
                      <td>{student.approvedCount}/{student.totalCount}</td>
                      <td>{student.expiredCount}</td>
                      <td>{new Date(student.lastActiveAt).toLocaleString("zh-CN")}</td>
                      <td>
                        <button
                          aria-expanded={isExpanded}
                          className="progress-extension-trigger"
                          onClick={() => toggleExtension(student)}
                          type="button"
                        >
                          {isExpanded ? "收起" : "设置延期"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="student-extension-row">
                        <td colSpan={6}>
                          <section className="student-extension-card" aria-label={`${student.name}的延期设置`}>
                            <h3>个别节点延期</h3>
                            <p>{student.name}（{student.studentNo}）</p>
                            {eligibleNodes.length === 0 ? (
                              <p className="student-extension-empty">该学生当前没有可延期节点</p>
                            ) : (
                              <div className="student-extension-fields">
                                <label className="student-extension-field">
                                  <span>节点</span>
                                  <select
                                    value={extension.nodeKey}
                                    onChange={(event) => setExtension({ ...extension, nodeKey: event.target.value, deadline: "" })}
                                  >
                                    {eligibleNodes.map((node) => <option key={node.nodeKey} value={node.nodeKey}>{node.title}</option>)}
                                  </select>
                                </label>
                                <div className="student-extension-field">
                                  <span>当前生效截止时间</span>
                                  <output className="student-extension-deadline">
                                    {currentNode?.effectiveDeadline ? new Date(currentNode.effectiveDeadline).toLocaleString("zh-CN") : "未设置"}
                                  </output>
                                </div>
                                <label className="student-extension-field">
                                  <span>新截止时间</span>
                                  <input
                                    min={currentNode?.effectiveDeadline ? minimumExtensionValue(currentNode.effectiveDeadline) : undefined}
                                    type="datetime-local"
                                    value={extension.deadline}
                                    onChange={(event) => setExtension({ ...extension, deadline: event.target.value })}
                                  />
                                </label>
                                <label className="student-extension-field">
                                  <span>延期原因</span>
                                  <input
                                    maxLength={500}
                                    value={extension.reason}
                                    onChange={(event) => setExtension({ ...extension, reason: event.target.value })}
                                  />
                                </label>
                              </div>
                            )}
                            <div className="student-extension-actions">
                              <button className="student-extension-cancel" onClick={clearExtension} type="button">取消</button>
                              {eligibleNodes.length > 0 ? (
                                <button
                                  className="primary-action"
                                  disabled={savingExtension}
                                  onClick={() => void saveExtension(student.instanceId, currentNode)}
                                  type="button"
                                >
                                  {savingExtension ? "保存中…" : "保存延期"}
                                </button>
                              ) : null}
                            </div>
                          </section>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {progress?.students.length === 0 ? <tr><td colSpan={6}>尚无学生进入该流程</td></tr> : null}
            </tbody>
          </table>
        </section>
      </aside>
    </div>
  );
}
