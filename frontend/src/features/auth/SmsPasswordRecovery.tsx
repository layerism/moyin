import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authApi, type AuthIdentity, type AuthRole } from "./authApi";

class SmsError extends Error {
  constructor(message: string, public retryAfter: number) { super(message); }
}
async function call<T>(role: AuthRole, path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/auth/${role}/${path}`, {
    method: body ? "POST" : "GET", credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new SmsError(typeof data.detail === "string" ? data.detail : "请检查填写内容", Number(response.headers.get("Retry-After")) || 0);
  return data as T;
}

function useSmsCooldown(phone: string) {
  const [now, setNow] = useState(Date.now());
  const storageKey = `moyin-sms-cooldown:${phone}`;
  const [deadline, setDeadline] = useState(0);
  useEffect(() => {
    try { setDeadline(Number(localStorage.getItem(storageKey)) || 0); } catch { setDeadline(0); }
  }, [storageKey]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = (event: StorageEvent) => { if (event.key === storageKey) setDeadline(Number(event.newValue) || 0); };
    window.addEventListener("storage", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", sync); };
  }, [storageKey]);
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const coolDown = (seconds: number) => {
    const until = Date.now() + seconds * 1000;
    setNow(Date.now()); setDeadline(until);
    try { localStorage.setItem(storageKey, String(until)); } catch { /* Server still enforces cooldown. */ }
  };
  return { remaining, coolDown };
}

function SmsForm({ role, onDone }: { role: AuthRole; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const { remaining, coolDown } = useSmsCooldown(phone);
  useEffect(() => { setChallengeId(""); setCode(""); setError(""); setNotice(""); }, [phone]);
  const send = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await call<{ challengeId: string; retryAfter: number }>(role,
        "phone/code", { phone, password });
      setChallengeId(data.challengeId); setCode(""); coolDown(data.retryAfter);
      setNotice("验证码已发送，5 分钟内有效");
    } catch (reason) {
      if (reason instanceof SmsError && reason.retryAfter) coolDown(reason.retryAfter);
      setError(reason instanceof Error ? reason.message : "发送失败");
    } finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const data = await call<{ message: string }>(role, "phone/verify", { challengeId, code });
      setNotice(data.message); setDone(true); setPassword(""); setCode(""); setChallengeId("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作未完成"); }
    finally { setBusy(false); }
  };
  if (done) return <div className="sms-auth-form"><p role="status">{notice}</p><button className="primary-action" onClick={onDone}>完成</button></div>;
  return <form className="sms-auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label>待绑定手机号<input required type="tel" autoComplete="tel" inputMode="numeric" pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} disabled={busy} onChange={(event) => setPhone(event.target.value.trim())} /></label>
    <label>当前密码<input required type="password" autoComplete="current-password" maxLength={128} value={password} disabled={busy || !!challengeId} onChange={(event) => setPassword(event.target.value)} /></label>
    <label>短信验证码<div className="sms-code-row"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /><button type="button" disabled={busy || remaining > 0 || !/^1[3-9]\d{9}$/.test(phone) || password.length < 3} onClick={() => void send()}>{remaining ? `${remaining} 秒后重发` : "获取验证码"}</button></div></label>
    {notice && <p className="sms-auth-note" role="status">{notice}</p>}
    {error && <p className="role-auth-error" role="alert">{error}</p>}
    <button className="primary-action" disabled={busy || !challengeId}>{busy ? "处理中…" : "验证并绑定"}</button>
    <p className="sms-auth-note">绑定后可通过短信找回密码。更换已绑定号码请联系管理员核实身份。</p>
  </form>;
}

type RecoveryStep = "identity" | "phone" | "password" | "done";
const RECOVERY_STEPS = ["确认身份", "验证手机号", "设置密码"];

export function SmsPasswordRecovery({ role, onBack }: { role: AuthRole; onBack: () => void }) {
  const [step, setStep] = useState<RecoveryStep>("identity");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const { remaining, coolDown } = useSmsCooldown(phone);
  const index = step === "identity" ? 0 : step === "phone" ? 1 : 2;
  useEffect(() => { heading.current?.focus(); }, [step]);
  const changeStep = (next: RecoveryStep) => { setError(""); setNotice(""); setStep(next); };
  const restart = () => {
    setRecoveryToken(""); setChallengeId(""); setResetToken("");
    setPhone(""); setCode(""); setPassword(""); setConfirm(""); changeStep("identity");
  };
  const send = async () => {
    setBusy(true); setError(""); setNotice(""); setChallengeId(""); setCode("");
    try {
      const data = await call<{challengeId: string; retryAfter: number}>(role, "password-reset/code", { recoveryToken, phone });
      setChallengeId(data.challengeId); coolDown(data.retryAfter); setNotice("验证码已发送，5 分钟内有效。");
    } catch (reason) {
      if (reason instanceof SmsError && reason.retryAfter) coolDown(reason.retryAfter);
      setError(reason instanceof Error ? reason.message : "发送失败，请重试");
    } finally { setBusy(false); }
  };
  const submit = async () => {
    setError(""); setNotice("");
    if (step === "password" && password !== confirm) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    try {
      if (step === "identity") {
        const data = await call<{recoveryToken: string}>(role, "password-reset/identify", { name: name.trim(), identifier: identifier.trim() });
        setRecoveryToken(data.recoveryToken); changeStep("phone");
      } else if (step === "phone") {
        const data = await call<{resetToken: string}>(role, "password-reset/verify", { challengeId, code });
        setResetToken(data.resetToken); setChallengeId(""); setCode(""); changeStep("password");
      } else if (step === "password") {
        await call(role, "password-reset/confirm", { resetToken, newPassword: password });
        setResetToken(""); setRecoveryToken(""); setPassword(""); setConfirm(""); changeStep("done");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作未完成，请重试"); }
    finally { setBusy(false); }
  };
  return <main className="sms-recovery-page"><section className="sms-recovery-card sms-recovery-wizard">
    <header className="sms-recovery-heading"><span className="oa-brand-mark" aria-hidden="true">OA</span><div><h1>找回密码</h1><p>{role === "teacher" ? "发布者账户" : "用户账户"} · 安全验证</p></div></header>
    <ol className="sms-recovery-steps" aria-label="找回密码步骤">{RECOVERY_STEPS.map((label, i) => <li key={label} aria-current={step !== "done" && i === index ? "step" : undefined} className={i < index || step === "done" ? "is-complete" : ""}><span>{i < index || step === "done" ? "✓" : i + 1}</span>{label}</li>)}</ol>
    <div className="sms-recovery-stage" key={step}>
      <h2 ref={heading} tabIndex={-1}>{step === "done" ? "密码已重置" : RECOVERY_STEPS[index]}</h2>
      <p className="sms-auth-note">{step === "identity" ? `请填写注册时的姓名和${role === "teacher" ? "工号" : "学号"}。` : step === "phone" ? "请输入该账号已绑定的手机号，获取并核验验证码。" : step === "password" ? "手机号验证成功，请在 5 分钟内设置新密码。" : "旧登录会话已失效，请使用新密码重新登录。"}</p>
      {step === "done" ? <button className="primary-action" onClick={onBack}>返回登录</button> : <form className="sms-auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {step === "identity" && <><label>姓名<input required maxLength={64} autoComplete="name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label><label>{role === "teacher" ? "工号" : "学号"}<input required maxLength={32} autoComplete="username" value={identifier} disabled={busy} onChange={(event) => setIdentifier(event.target.value)} /></label></>}
        {step === "phone" && <><label>绑定手机号<input required type="tel" autoComplete="tel" inputMode="numeric" pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} disabled={busy} onChange={(event) => { setPhone(event.target.value.trim()); setChallengeId(""); setCode(""); setError(""); setNotice(""); }} /></label><label>短信验证码<div className="sms-code-row"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /><button type="button" disabled={busy || remaining > 0 || !/^1[3-9][0-9]{9}$/.test(phone)} onClick={() => void send()}>{remaining ? `${remaining} 秒后重发` : "获取验证码"}</button></div></label></>}
        {step === "password" && <><label>新密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label><label>确认密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirm} disabled={busy} onChange={(event) => setConfirm(event.target.value)} /></label></>}
        {notice && <p className="sms-auth-note" role="status">{notice}</p>}
        {error && <p className="role-auth-error" role="alert">{error}</p>}
        <button className="primary-action" disabled={busy || (step === "phone" && !challengeId)}>{busy ? "处理中…" : step === "identity" ? "查询并继续" : step === "phone" ? "验证并继续" : "确认重置密码"}</button>
      </form>}
      {step !== "done" && <nav className="sms-recovery-navigation">{step !== "identity" && <button type="button" disabled={busy} onClick={restart}>重新确认身份</button>}<button type="button" disabled={busy} onClick={onBack}>返回登录</button></nav>}
    </div>
  </section></main>;
}

export function PhoneBindingButton({ role }: { role: AuthRole }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [open]);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const show = async () => {
    setOpen(true); setLoading(true); setError(""); setPhone(null);
    try { setPhone((await call<{phone: string | null}>(role, "phone")).phone); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "读取失败"); }
    finally { setLoading(false); }
  };
  return <><button type="button" className="sms-binding-button" onClick={() => void show()}>安全手机号</button>{open && createPortal(<div className="sms-binding-backdrop" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
    if (event.key === "Tab") {
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><section ref={dialogRef} tabIndex={-1} className="sms-recovery-card" role="dialog" aria-modal="true" aria-label="安全手机号"><div className="sms-dialog-heading"><h2>安全手机号</h2><button type="button" aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>{loading ? <p>正在读取…</p> : error ? <p role="alert">{error}</p> : phone ? <p>已绑定 {phone}，可用于找回密码。更换号码请联系管理员。</p> : <SmsForm role={role} onDone={() => setOpen(false)} />}</section></div>, document.body)}</>;
}

export function PhoneSecurityPanel({ role }: { role: AuthRole }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    call<{ phone: string | null }>(role, "phone").then(data => {
      if (!cancelled) setPhone(data.phone);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "读取失败");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [role, attempt]);
  if (loading) return <p role="status">正在读取安全设置…</p>;
  if (error) return <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>;
  return phone ? <div className="profile-phone-bound"><strong>已绑定 {phone}</strong><p>可用于找回密码。更换号码请联系管理员核实身份。</p></div> : <><p className="sms-auth-note">绑定手机号后，可通过短信验证找回密码。</p><SmsForm role={role} onDone={() => setAttempt(value => value + 1)} /></>;
}

export function RequiredPhoneBinding({ onBound }: { onBound: (identity: AuthIdentity) => void | Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const complete = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const identity = await authApi.me("student");
      if (!identity.phoneBound) throw new Error("请先完成手机号绑定");
      await onBound(identity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "进入页面失败，请重试");
    } finally { setBusy(false); }
  };
  return <main className="sms-recovery-page"><section className="sms-recovery-card">
    <h1>绑定手机号</h1>
    <p className="sms-auth-note">完成手机号验证后，才能继续使用。</p>
    <SmsForm role="student" onDone={() => void complete()} />
    {error && <p className="role-auth-error" role="alert">{error}</p>}
  </section></main>;
}
