import { useEffect, useState, type FormEvent } from "react";

import { ApiError, workflowApi } from "../academic-flow/api";
import type { RuntimeFlowInstance, SharedFlow } from "../academic-flow/runtimeTypes";

export function StudentAccessGate({
  onEntered,
  token,
}: {
  onEntered: (instance: RuntimeFlowInstance) => void;
  token: string;
}) {
  const [flow, setFlow] = useState<SharedFlow | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ confirm: "", name: "", password: "", studentNo: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const shared = await workflowApi.getShared(token);
        if (cancelled) return;
        setFlow(shared);
        try {
          await workflowApi.me();
          const instance = await workflowApi.enterShared(token);
          if (!cancelled) onEntered(instance);
          return;
        } catch (reason) {
          if (!(reason instanceof ApiError) || reason.status !== 401) throw reason;
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "分享链接不可用");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [onEntered, token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.studentNo.trim() || form.password.length < 8) {
      setError("请填写姓名、学号和至少 8 位密码");
      return;
    }
    if (mode === "register" && form.password !== form.confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        studentNo: form.studentNo.trim(),
        password: form.password,
      };
      if (mode === "register") await workflowApi.register(payload);
      else await workflowApi.login(payload);
      onEntered(await workflowApi.enterShared(token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="oa-access-page">
      <section className="oa-access-summary">
        <span className="oa-brand-mark">OA</span>
        <p>教务流程采集</p>
        <h1>{flow?.name ?? "正在读取流程"}</h1>
        <div>{flow?.description ?? "请稍候"}</div>
      </section>
      <section className="oa-access-auth">
        <div className="oa-auth-tabs" role="tablist" aria-label="学生账号">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            登录
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>
        <form className="oa-auth-form" onSubmit={submit}>
          <h2>{mode === "register" ? "创建学生账号" : "学生登录"}</h2>
          <p>登录后系统将为你创建并持续保存独立填写进度。</p>
          <label>
            <span>姓名</span>
            <input
              autoComplete="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span>学号</span>
            <input
              autoComplete="username"
              value={form.studentNo}
              onChange={(event) => setForm({ ...form, studentNo: event.target.value })}
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
          <p className="oa-form-error" role="alert">
            {error}
          </p>
          <button className="primary-action oa-submit-button" disabled={loading} type="submit">
            {loading ? "处理中" : mode === "register" ? "注册并进入" : "登录并进入"}
          </button>
        </form>
      </section>
    </main>
  );
}
