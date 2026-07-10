import { useState, type FormEvent } from "react";

import { authApi, type AuthIdentity, type AuthRole } from "./authApi";

export function AuthPortal({
  initialRole,
  mode,
  onAuthenticated,
  onNavigate,
}: {
  initialRole: AuthRole;
  mode: "login" | "register";
  onAuthenticated: (role: AuthRole, identity: AuthIdentity) => void;
  onNavigate: (mode: "forgot" | "login" | "register", role: AuthRole) => void;
}) {
  const [role, setRole] = useState<AuthRole>(initialRole);
  const [form, setForm] = useState({ confirm: "", identifier: "", name: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.identifier.trim() || form.password.length < 8) {
      setError(`请填写姓名、${role === "teacher" ? "工号" : "学号"}和至少 8 位密码`);
      return;
    }
    if (mode === "register" && form.password !== form.confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      const credentials = {
        identifier: form.identifier.trim(),
        name: form.name.trim(),
        password: form.password,
      };
      const identity =
        mode === "register"
          ? await authApi.register(role, credentials)
          : await authApi.login(role, credentials);
      onAuthenticated(role, identity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "认证失败");
    } finally {
      setSubmitting(false);
    }
  };

  const changeRole = (nextRole: AuthRole) => {
    setRole(nextRole);
    setForm({ confirm: "", identifier: "", name: "", password: "" });
    setError("");
  };

  return (
    <main className="role-auth-page">
      <section className="role-auth-brand">
        <span className="oa-brand-mark">OA</span>
        <p>教务流程采集平台</p>
        <h1>{mode === "register" ? "创建账户" : "欢迎登录"}</h1>
        <div>统一管理流程设计、材料填写、节点审核与进度追踪。</div>
      </section>
      <section className="role-auth-main">
        <div className="role-auth-card">
          <div className="role-segment" role="tablist" aria-label="账户身份">
            <button
              className={role === "teacher" ? "active" : ""}
              onClick={() => changeRole("teacher")}
              type="button"
            >
              教师
            </button>
            <button
              className={role === "student" ? "active" : ""}
              onClick={() => changeRole("student")}
              type="button"
            >
              学生
            </button>
          </div>
          <form onSubmit={submit}>
            <header>
              <h2>{role === "teacher" ? "教师" : "学生"}{mode === "register" ? "注册" : "登录"}</h2>
              <p>{role === "teacher" ? "进入流程设计与管理工作台" : "查看并继续个人填写流程"}</p>
            </header>
            <label>
              <span>姓名</span>
              <input
                autoComplete="name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label>
              <span>{role === "teacher" ? "工号" : "学号"}</span>
              <input
                autoComplete="username"
                value={form.identifier}
                onChange={(event) => setForm({ ...form, identifier: event.target.value })}
              />
            </label>
            <label>
              <span>密码</span>
              <input
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </label>
            {mode === "register" ? (
              <label>
                <span>确认密码</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={form.confirm}
                  onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                />
              </label>
            ) : null}
            <p className="role-auth-error" role="alert">{error}</p>
            <button className="primary-action role-auth-submit" disabled={submitting} type="submit">
              {submitting ? "处理中" : mode === "register" ? "注册并进入" : "登录"}
            </button>
            <div className="role-auth-links">
              <button type="button" onClick={() => onNavigate(mode === "login" ? "register" : "login", role)}>
                {mode === "login" ? "注册新账户" : "已有账户，返回登录"}
              </button>
              {mode === "login" ? (
                <button type="button" onClick={() => onNavigate("forgot", role)}>忘记密码</button>
              ) : null}
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

export function ForgotPasswordPlaceholder({
  onBack,
  role,
}: {
  onBack: () => void;
  role: AuthRole;
}) {
  return (
    <main className="forgot-placeholder-page">
      <section>
        <span className="oa-brand-mark">OA</span>
        <p>{role === "teacher" ? "教师账户" : "学生账户"}</p>
        <h1>密码找回功能待开发</h1>
        <div>当前暂不支持在线重置密码，请联系系统管理员处理。</div>
        <button className="primary-action" onClick={onBack}>返回登录</button>
      </section>
    </main>
  );
}
