import { useState, type FormEvent } from "react";

import { authApi, type AuthIdentity } from "./authApi";

export function StudentPasswordChangeForm({
  identity,
  onChanged,
  onLogout,
}: {
  identity: AuthIdentity;
  onChanged: (identity: AuthIdentity) => Promise<void> | void;
  onLogout: () => Promise<void> | void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位");
      return;
    }
    if (newPassword === "123") {
      setError("新密码不能与初始密码相同");
      return;
    }
    if (newPassword !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      await onChanged(await authApi.changeStudentPassword(newPassword));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改密码失败");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onLogout();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "退出登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="student-password-change-form" onSubmit={submit}>
      <header>
        <h2>设置新密码</h2>
        <p>管理员已重置你的密码。完成改密后才能继续访问流程。</p>
      </header>
      <div className="student-password-change-identity">
        <strong>{identity.name}</strong>
        <span>{identity.studentNo}</span>
      </div>
      <p className="student-password-change-preserved">
        已填写的流程、草稿、提交、成绩和文件均已保留。
      </p>
      <label>
        <span>新密码</span>
        <input
          autoComplete="new-password"
          disabled={submitting}
          minLength={8}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
      </label>
      <label>
        <span>确认新密码</span>
        <input
          autoComplete="new-password"
          disabled={submitting}
          minLength={8}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
      </label>
      <p className="student-password-change-error" role="alert">{error}</p>
      <button className="primary-action student-password-change-submit" disabled={submitting} type="submit">
        {submitting ? "处理中" : "确认修改"}
      </button>
      <button
        className="student-password-change-logout"
        disabled={submitting}
        onClick={() => void logout()}
        type="button"
      >
        退出登录
      </button>
    </form>
  );
}
