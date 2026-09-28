import { useEffect, useState } from "react";
import { WorkflowIcon } from "../home/WorkflowIcon";

import type { AuthIdentity, StudentFlowSummary } from "./authApi";
import { authApi } from "./authApi";
import { PasswordChangeButton, PhoneBindingButton } from "./SmsPasswordRecovery";

export function StudentAccountPage({
  identity,
  onLogout,
  onOpenFlow,
  onPasswordChanged,
}: {
  identity: AuthIdentity;
  onLogout: () => void;
  onOpenFlow: (flowId: string) => Promise<void>;
  onPasswordChanged: () => void;
}) {
  const [flows, setFlows] = useState<StudentFlowSummary[]>([]);
  const [newestFirst, setNewestFirst] = useState(true);
  const [notice, setNotice] = useState("");
  const [openingFlowId, setOpeningFlowId] = useState<string | null>(null);

  useEffect(() => {
    authApi.studentFlows().then(setFlows).catch((reason: Error) => setNotice(reason.message));
  }, []);

  const openFlow = async (flowId: string) => {
    setNotice("");
    setOpeningFlowId(flowId);
    try {
      await onOpenFlow(flowId);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "进入流程失败");
    } finally {
      setOpeningFlowId(null);
    }
  };

  const sortedFlows = [...flows].sort((a, b) => {
    if (!a.lastActiveAt) return b.lastActiveAt ? 1 : 0;
    if (!b.lastActiveAt) return -1;
    const difference = Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt);
    return newestFirst ? difference : -difference;
  });

  return (
    <main className="student-account-page">
      <header>
        <div><span className="oa-brand-mark">OA</span><strong>学生流程中心</strong></div>
        <div><span>{identity.name}</span><small>{identity.studentNo}</small><PhoneBindingButton role="student" /><PasswordChangeButton role="student" onChanged={onPasswordChanged} /><button onClick={onLogout}>退出登录</button></div>
      </header>
      <section className="student-account-main">
        <div className="student-account-heading">
          <p>个人账户</p>
          <h1>我的填写流程</h1>
          <span>这里展示所有包含你的已发布 OA 流程。</span>
        </div>
        {notice ? <p className="role-auth-error">{notice}</p> : null}
        <div className="student-flow-list-heading">
          <span>流程列表</span>
          <button type="button" onClick={() => setNewestFirst((value) => !value)}>
            最近访问 · {newestFirst ? "从新到旧 ↓" : "从旧到新 ↑"}
          </button>
        </div>
        <div className="student-account-list">
          {sortedFlows.map((flow) => (
            <button
              disabled={openingFlowId !== null}
              key={flow.flowId}
              onClick={() => void openFlow(flow.flowId)}
            >
              <span className="student-flow-icon"><WorkflowIcon name="flow" /></span>
              <strong className="student-flow-name" title={flow.name}>{flow.name}</strong>
              <span className="student-flow-time" title={flow.lastActiveAt ? `最近访问：${new Date(flow.lastActiveAt).toLocaleString("zh-CN")}` : "尚未访问"}>
                {flow.lastActiveAt ? <time dateTime={flow.lastActiveAt}>{new Date(flow.lastActiveAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time> : "尚未访问"}
              </span>
              <em className={`student-flow-status is-${flow.status}`}>
                {openingFlowId === flow.flowId
                  ? "正在进入"
                  : flow.status === "completed"
                    ? "已完成"
                    : flow.status === "not_started"
                      ? "待开始"
                      : "进行中"}
              </em>
              <span className="student-flow-chevron"><WorkflowIcon name="chevron" /></span>
            </button>
          ))}
          {flows.length === 0 ? <div className="student-account-empty">暂无可填写的 OA 流程</div> : null}
        </div>
      </section>
    </main>
  );
}
