import { useState, type FormEvent } from "react";

import { AccountHistoryPicker } from "./AccountHistoryPicker";
import { authApi, type AuthIdentity, type AuthRole } from "./authApi";
import {
  forgetRememberedAccount,
  getRememberedAccounts,
  rememberLoginAccount,
  type RememberedLoginAccount,
} from "./rememberedAccount";

type AuthForm = {
  confirm: string;
  identifier: string;
  name: string;
  password: string;
};

const EMPTY_AUTH_FORM: AuthForm = { confirm: "", identifier: "", name: "", password: "" };

export function AuthPortal({
  mode,
  notice = "",
  onAuthenticated,
  onNavigate,
  role,
}: {
  mode: "login" | "register";
  notice?: string;
  onAuthenticated: (role: AuthRole, identity: AuthIdentity) => void;
  onNavigate: (mode: "forgot" | "login" | "register", role: AuthRole) => void;
  role: AuthRole;
}) {
  const [form, setForm] = useState<AuthForm>(EMPTY_AUTH_FORM);
  const [accountHistory, setAccountHistory] = useState<RememberedLoginAccount[]>(() =>
    mode === "login" ? getRememberedAccounts(window.localStorage, role) : [],
  );
  const [historyAnchor, setHistoryAnchor] = useState<"identifier" | "name" | null>(null);
  const [rememberAccount, setRememberAccount] = useState(mode === "login");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fieldPrefix = `${role}-${mode}`;
  const minimumPasswordLength = role === "student" && mode === "login" ? 3 : 8;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (
      !form.name.trim()
      || !form.identifier.trim()
      || form.password.length < minimumPasswordLength
    ) {
      setError(
        `请填写姓名、${role === "teacher" ? "工号" : "学号"}和至少 ${minimumPasswordLength} 位密码`,
      );
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
          ? await authApi.registerStudent(credentials)
          : await authApi.login(role, credentials);
      if (mode === "login") {
        if (rememberAccount) {
          rememberLoginAccount(window.localStorage, role, {
            identifier: credentials.identifier,
            name: credentials.name,
          });
        }
      }
      onAuthenticated(role, identity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "认证失败");
    } finally {
      setSubmitting(false);
    }
  };

  const selectRememberedAccount = (account: RememberedLoginAccount) => {
    setForm((current) => ({
      ...current,
      identifier: account.identifier,
      name: account.name,
    }));
    setHistoryAnchor(null);
  };

  const forgetAccount = (identifier: string) => {
    forgetRememberedAccount(window.localStorage, role, identifier);
    const nextHistory = getRememberedAccounts(window.localStorage, role);
    setAccountHistory(nextHistory);
    if (nextHistory.length === 0) setHistoryAnchor(null);
  };

  const accountPicker = accountHistory.length > 0 ? (
    <AccountHistoryPicker
      accounts={accountHistory}
      identifierLabel={role === "teacher" ? "工号" : "学号"}
      onForget={forgetAccount}
      onSelect={selectRememberedAccount}
    />
  ) : null;

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
          <form
            className="role-auth-form"
            autoComplete={mode === "login" ? "off" : "on"}
            id={`${fieldPrefix}-auth-form`}
            name={`${fieldPrefix}-auth-form`}
            onSubmit={submit}
          >
            <header className="role-auth-form-header">
              <div>
                <h2>{role === "teacher" ? "教师" : "学生"}{mode === "register" ? "注册" : "登录"}</h2>
                <p>{role === "teacher" ? "进入流程设计与管理工作台" : "查看并继续个人填写流程"}</p>
              </div>
              {mode === "login" ? (
                <button
                  className="auth-role-entry"
                  onClick={() =>
                    onNavigate("login", role === "student" ? "teacher" : "student")
                  }
                  type="button"
                >
                  {role === "student" ? "教师入口 →" : "学生入口 →"}
                </button>
              ) : null}
            </header>
            <div
              className="account-history-control"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setHistoryAnchor(null);
              }}
            >
              <label htmlFor={`${fieldPrefix}-name`}>
                <span>姓名</span>
                <input
                  autoComplete="off"
                  id={`${fieldPrefix}-name`}
                  name="account-name"
                  onFocus={() => setHistoryAnchor("name")}
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              {historyAnchor === "name" ? accountPicker : null}
            </div>
            <div
              className="account-history-control"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setHistoryAnchor(null);
              }}
            >
              <label htmlFor={`${fieldPrefix}-username`}>
                <span>{role === "teacher" ? "工号" : "学号"}</span>
                <input
                  autoCapitalize="none"
                  autoComplete="off"
                  id={`${fieldPrefix}-username`}
                  inputMode={role === "teacher" ? "numeric" : undefined}
                  maxLength={role === "teacher" ? 5 : undefined}
                  name="account-identifier"
                  onFocus={() => setHistoryAnchor("identifier")}
                  pattern={role === "teacher" ? "[0-9]{5}" : undefined}
                  required
                  spellCheck={false}
                  value={form.identifier}
                  onChange={(event) => setForm({ ...form, identifier: event.target.value })}
                />
              </label>
              {historyAnchor === "identifier" ? accountPicker : null}
            </div>
            <label htmlFor={`${fieldPrefix}-password`}>
              <span>密码</span>
              <input
                autoComplete={mode === "register" ? "new-password" : "off"}
                id={`${fieldPrefix}-password`}
                name={mode === "register" ? "new-password" : "account-secret"}
                required
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </label>
            {mode === "register" ? (
              <label htmlFor={`${fieldPrefix}-password-confirmation`}>
                <span>确认密码</span>
                <input
                  autoComplete="new-password"
                  id={`${fieldPrefix}-password-confirmation`}
                  name="password-confirmation"
                  required
                  type="password"
                  value={form.confirm}
                  onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                />
              </label>
            ) : null}
            {mode === "login" ? (
              <label className="remember-account-row" htmlFor={`${fieldPrefix}-remember-account`}>
                <input
                  checked={rememberAccount}
                  id={`${fieldPrefix}-remember-account`}
                  name="remember-account"
                  onChange={(event) => setRememberAccount(event.target.checked)}
                  type="checkbox"
                />
                <span>记住账号</span>
              </label>
            ) : null}
            {notice ? <p className="role-auth-notice">{notice}</p> : null}
            <p className="role-auth-error" role="alert">{error}</p>
            <button className="primary-action role-auth-submit" disabled={submitting} type="submit">
              {submitting ? "处理中" : mode === "register" ? "注册并进入" : "登录"}
            </button>
            <div className="role-auth-links">
              {role === "student" ? (
                <button type="button" onClick={() => onNavigate(mode === "login" ? "register" : "login", role)}>
                  {mode === "login" ? "注册学生账户" : "已有账户，返回登录"}
                </button>
              ) : null}
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
