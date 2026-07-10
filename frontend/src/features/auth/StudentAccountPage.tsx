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
  onOpenFlow: (instanceId: string) => void;
}) {
  const [flows, setFlows] = useState<StudentFlowSummary[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    authApi.studentFlows().then(setFlows).catch((reason: Error) => setNotice(reason.message));
  }, []);

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
          <span>通过教师分享链接加入的流程将在此持续保存。</span>
        </div>
        {notice ? <p className="role-auth-error">{notice}</p> : null}
        <div className="student-account-list">
          {flows.map((flow) => (
            <button key={flow.id} onClick={() => onOpenFlow(flow.id)}>
              <span><strong>{flow.name}</strong><small>最近访问：{new Date(flow.lastActiveAt).toLocaleString("zh-CN")}</small></span>
              <em>{flow.status === "completed" ? "已完成" : "进行中"}</em>
            </button>
          ))}
          {flows.length === 0 ? <div className="student-account-empty">暂无流程，请通过教师提供的分享链接进入。</div> : null}
        </div>
      </section>
    </main>
  );
}
