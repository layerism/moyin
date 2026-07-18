import { useEffect, useState } from "react";

import type { AuthIdentity, StudentFlowSummary } from "./authApi";
import { authApi } from "./authApi";

export function StudentAccountPage({
  identity,
  onLogout,
  onOpenFlow,
}: {
  identity: AuthIdentity;
  onLogout: () => void;
  onOpenFlow: (flowId: string) => Promise<void>;
}) {
  const [flows, setFlows] = useState<StudentFlowSummary[]>([]);
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

  return (
    <main className="student-account-page">
      <header>
        <div><span className="oa-brand-mark">OA</span><strong>学生流程中心</strong></div>
        <div><span>{identity.name}</span><small>{identity.studentNo}</small><button onClick={onLogout}>退出登录</button></div>
      </header>
      <section className="student-account-main">
        <div className="student-account-heading">
          <p>个人账户</p>
          <h1>我的填写流程</h1>
          <span>这里展示所有包含你的已发布 OA 流程。</span>
        </div>
        {notice ? <p className="role-auth-error">{notice}</p> : null}
        <div className="student-account-list">
          {flows.map((flow) => (
            <button
              disabled={openingFlowId !== null}
              key={flow.flowId}
              onClick={() => void openFlow(flow.flowId)}
            >
              <span>
                <strong>{flow.name}</strong>
                <small>
                  {flow.lastActiveAt
                    ? `最近访问：${new Date(flow.lastActiveAt).toLocaleString("zh-CN")}`
                    : "尚未开始"}
                </small>
              </span>
              <em>
                {openingFlowId === flow.flowId
                  ? "正在进入"
                  : flow.status === "completed"
                    ? "已完成"
                    : flow.status === "not_started"
                      ? "待开始"
                      : "进行中"}
              </em>
            </button>
          ))}
          {flows.length === 0 ? <div className="student-account-empty">暂无可填写的 OA 流程</div> : null}
        </div>
      </section>
    </main>
  );
}
