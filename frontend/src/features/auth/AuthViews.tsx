import { useState, type FormEvent, type ReactNode } from "react";

import type { StudentAccount } from "../../types";

export function LoginView({
  notice,
  onBack,
  onChangePassword,
  onLogin,
  onReset,
}: {
  notice: string;
  onBack: () => void;
  onChangePassword: () => void;
  onLogin: (name: string, studentNo: string, password: string) => boolean;
  onReset: () => void;
}) {
  const [form, setForm] = useState({ name: "", password: "", studentNo: "" });
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.studentNo.trim() || !form.password) {
      setError("请填写姓名、学号和密码");
      return;
    }
    setError(onLogin(form.name, form.studentNo, form.password) ? "" : "姓名、学号或密码不正确");
  };

  return (
    <AuthShell title="学生登录" subtitle="使用名单内姓名、学号和密码进入材料提交页面。">
      <form className="auth-card" onSubmit={submit}>
        <label>
          <span>姓名</span>
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如：李四"
          />
        </label>
        <label>
          <span>学号</span>
          <input
            value={form.studentNo}
            onChange={(event) => setForm({ ...form, studentNo: event.target.value })}
            placeholder="例如：20240002"
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="演示默认：学号后四位 + Aa"
          />
        </label>
        <StatusLine message={error || notice} />
        <button className="primary submit" type="submit">
          登录并填写
        </button>
        <div className="auth-links">
          <button type="button" onClick={onReset}>
            忘记密码
          </button>
          <button type="button" onClick={onChangePassword}>
            修改密码
          </button>
          <button type="button" onClick={onBack}>
            返回首页
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

export function PasswordResetView({
  notice,
  onBack,
  onResetPassword,
}: {
  notice: string;
  onBack: () => void;
  onResetPassword: (name: string, studentNo: string, password: string) => boolean;
}) {
  const [form, setForm] = useState({ confirm: "", name: "", password: "", studentNo: "" });
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.studentNo.trim() || !form.password) {
      setError("请填写姓名、学号和新密码");
      return;
    }
    if (form.password !== form.confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (form.password.length < 6) {
      setError("演示密码至少 6 位");
      return;
    }
    setError(onResetPassword(form.name, form.studentNo, form.password) ? "" : "未找到匹配账号");
  };

  return (
    <AuthShell title="重置密码" subtitle="通过姓名和学号确认名单身份后设置新密码。">
      <form className="auth-card" onSubmit={submit}>
        <AuthInput
          label="姓名"
          value={form.name}
          onChange={(value) => setForm({ ...form, name: value })}
        />
        <AuthInput
          label="学号"
          value={form.studentNo}
          onChange={(value) => setForm({ ...form, studentNo: value })}
        />
        <AuthInput
          label="新密码"
          type="password"
          value={form.password}
          onChange={(value) => setForm({ ...form, password: value })}
        />
        <AuthInput
          label="确认新密码"
          type="password"
          value={form.confirm}
          onChange={(value) => setForm({ ...form, confirm: value })}
        />
        <StatusLine message={error || notice} />
        <button className="primary submit" type="submit">
          重置密码
        </button>
        <button className="secondary-submit" type="button" onClick={onBack}>
          返回登录
        </button>
      </form>
    </AuthShell>
  );
}

export function PasswordChangeView({
  activeUser,
  notice,
  onBack,
  onChangePassword,
}: {
  activeUser: StudentAccount | null;
  notice: string;
  onBack: () => void;
  onChangePassword: (
    name: string,
    studentNo: string,
    oldPassword: string,
    newPassword: string,
  ) => boolean;
}) {
  const [form, setForm] = useState({
    confirm: "",
    name: activeUser?.name ?? "",
    newPassword: "",
    oldPassword: "",
    studentNo: activeUser?.studentNo ?? "",
  });
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.studentNo.trim() || !form.oldPassword || !form.newPassword) {
      setError("请填写账号信息、原密码和新密码");
      return;
    }
    if (form.newPassword !== form.confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (form.newPassword === form.oldPassword) {
      setError("新密码不能与原密码相同");
      return;
    }
    setError(
      onChangePassword(form.name, form.studentNo, form.oldPassword, form.newPassword)
        ? ""
        : "原密码不正确",
    );
  };

  return (
    <AuthShell title="修改密码" subtitle="输入原密码后更新当前学生账号密码。">
      <form className="auth-card" onSubmit={submit}>
        <AuthInput
          label="姓名"
          value={form.name}
          onChange={(value) => setForm({ ...form, name: value })}
        />
        <AuthInput
          label="学号"
          value={form.studentNo}
          onChange={(value) => setForm({ ...form, studentNo: value })}
        />
        <AuthInput
          label="原密码"
          type="password"
          value={form.oldPassword}
          onChange={(value) => setForm({ ...form, oldPassword: value })}
        />
        <AuthInput
          label="新密码"
          type="password"
          value={form.newPassword}
          onChange={(value) => setForm({ ...form, newPassword: value })}
        />
        <AuthInput
          label="确认新密码"
          type="password"
          value={form.confirm}
          onChange={(value) => setForm({ ...form, confirm: value })}
        />
        <StatusLine message={error || notice} />
        <button className="primary submit" type="submit">
          保存新密码
        </button>
        <button className="secondary-submit" type="button" onClick={onBack}>
          返回
        </button>
      </form>
    </AuthShell>
  );
}

function AuthShell({
  children,
  subtitle,
  title,
}: {
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <span className="product-mark">材料收集</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </section>
      {children}
    </main>
  );
}

function AuthInput({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function StatusLine({ message }: { message: string }) {
  return <p className="status-line">{message}</p>;
}
