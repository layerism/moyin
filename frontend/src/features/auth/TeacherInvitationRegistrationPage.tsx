import { useEffect, useState, type FormEvent } from "react";

import type { AuthIdentity } from "./authApi";
import {
  teacherInvitationApi,
  type TeacherInvitationSummary,
} from "./teacherInvitationApi";

export function TeacherInvitationRegistrationPage({
  onAccepted,
  onTeacherLogin,
  token,
}: {
  onAccepted: (identity: AuthIdentity) => void;
  onTeacherLogin: () => void;
  token: string;
}) {
  const [invitation, setInvitation] = useState<TeacherInvitationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    teacherInvitationApi.get(token)
      .then((result) => {
        if (!cancelled) setInvitation(result);
      })
      .catch((reason: Error) => {
        if (!cancelled) setLoadError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError("");
    if (password.length < 8) {
      setSubmitError("密码至少需要 8 位");
      return;
    }
    if (password !== confirmation) {
      setSubmitError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      onAccepted(await teacherInvitationApi.accept(token, password));
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : "教师账号注册失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="role-auth-page">
      <section className="role-auth-brand">
        <span className="oa-brand-mark">OA</span>
        <p>教务流程采集平台</p>
        <h1>教师账号注册</h1>
        <div>使用超级管理员签发的一次性邀请完成账号设置。</div>
      </section>
      <section className="role-auth-main">
        <div className="role-auth-card teacher-invitation-card">
          {loading ? <div className="teacher-invitation-state">正在验证邀请链接</div> : null}
          {!loading && loadError ? (
            <div className="teacher-invitation-state is-error">
              <h2>邀请链接无效或已失效</h2>
              <p>{loadError}</p>
              <button className="primary-action" onClick={onTeacherLogin} type="button">
                返回教师登录
              </button>
            </div>
          ) : null}
          {!loading && invitation ? (
            <form onSubmit={submit}>
              <header>
                <h2>设置教师账号密码</h2>
                <p>姓名和工号已由超级管理员绑定，不可修改。</p>
              </header>
              <dl className="teacher-invitation-identity">
                <div><dt>姓名</dt><dd>{invitation.name}</dd></div>
                <div><dt>工号</dt><dd>{invitation.employeeNo}</dd></div>
                <div><dt>有效期至</dt><dd>{new Date(invitation.expiresAt).toLocaleString("zh-CN")}</dd></div>
              </dl>
              <label htmlFor="teacher-invitation-password">
                <span>密码</span>
                <input
                  autoComplete="new-password"
                  id="teacher-invitation-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <label htmlFor="teacher-invitation-confirmation">
                <span>确认密码</span>
                <input
                  autoComplete="new-password"
                  id="teacher-invitation-confirmation"
                  minLength={8}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  type="password"
                  value={confirmation}
                />
              </label>
              <p className="role-auth-error" role="alert">{submitError}</p>
              <button className="primary-action role-auth-submit" disabled={submitting} type="submit">
                {submitting ? "正在注册" : "注册并进入教师工作台"}
              </button>
              <button className="teacher-invitation-login-link" onClick={onTeacherLogin} type="button">
                已有教师账号，返回登录
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
