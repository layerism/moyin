import { useEffect, useRef, useState, type ReactNode } from "react";
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

type BindingIconName = "shield" | "phone" | "lock" | "code" | "message" | "check";
function BindingIcon({ name }: { name: BindingIconName }) {
  const paths: Record<BindingIconName, ReactNode> = {
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 5h4M11 18h2" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    code: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 10h10M7 14h2m3 0h1m3 0h1" /></>,
    message: <><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M7 8h10M7 12h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg className="binding-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function SmsForm({ role, onDone, required = false, replacing = false, onBusyChange, onCancel }: { role: AuthRole; onDone: () => void; required?: boolean; replacing?: boolean; onBusyChange?: (busy: boolean) => void; onCancel?: () => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
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
  if (done) return <div className="sms-auth-form binding-success"><span className="binding-success-icon"><BindingIcon name="check" /></span><h2>手机号绑定成功</h2><p role="status">{notice}</p><button className="primary-action" onClick={onDone}><BindingIcon name="check" />{required ? "进入系统" : "完成"}</button></div>;
  return <form className="sms-auth-form phone-binding-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label><span className="binding-field-label"><BindingIcon name="phone" />{replacing ? "新手机号" : "待绑定手机号"}</span><input required type="tel" autoComplete="tel" inputMode="numeric" pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} disabled={busy} onChange={(event) => setPhone(event.target.value.trim())} /></label>
    <label><span className="binding-field-label"><BindingIcon name="lock" />当前密码</span><input required type="password" autoComplete="current-password" maxLength={128} value={password} disabled={busy || !!challengeId} onChange={(event) => setPassword(event.target.value)} /></label>
    <label><span className="binding-field-label"><BindingIcon name="code" />短信验证码</span><div className="sms-code-row"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /><button type="button" disabled={busy || remaining > 0 || !/^1[3-9]\d{9}$/.test(phone) || password.length < 3} onClick={() => void send()}><BindingIcon name="message" />{remaining ? `${remaining} 秒后重发` : "获取验证码"}</button></div></label>
    {notice && <p className="sms-auth-note" role="status">{notice}</p>}
    {error && <p className="role-auth-error" role="alert">{error}</p>}
    <p className="sms-auth-note">绑定后可通过短信找回密码。更换号码只需验证当前密码和新号码。</p>
    <div className="phone-binding-actions">
      {onCancel && <button type="button" className="sms-binding-button" disabled={busy} onClick={onCancel}>取消</button>}
      <button className="primary-action" disabled={busy || !challengeId}><BindingIcon name="shield" />{busy ? "处理中…" : replacing ? "验证并更换" : "验证并绑定"}</button>
    </div>
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

function BoundPhone({ role, phone, onDone, onBusyChange }: { role: AuthRole; phone: string; onDone: () => void; onBusyChange: (busy: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  return <div className="profile-phone-bound">
    <div className="phone-binding-status"><div><small>当前绑定</small><strong>{phone}</strong></div><span><BindingIcon name="check" />已验证</span></div>
    {editing ? <SmsForm role={role} replacing onDone={onDone} onCancel={onDone} onBusyChange={onBusyChange} /> : <><p>可用于短信找回密码。</p><button type="button" className="sms-binding-button" onClick={() => setEditing(true)}>更换手机号</button></>}
  </div>;
}

export function PhoneBindingButton({ role, label = "安全手机号", editing = false, onClose }: {
  role: AuthRole; label?: string; editing?: boolean; onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); onClose?.(); };
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
  return <><button type="button" className="sms-binding-button" onClick={() => void show()}>{label}</button>{open && createPortal(<div className="sms-binding-backdrop" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><section ref={dialogRef} tabIndex={-1} className="sms-recovery-card phone-security-dialog" role="dialog" aria-modal="true" aria-label={label}><div className="sms-dialog-heading"><span className="phone-security-icon"><BindingIcon name="shield" /></span><div><h2>{label}</h2><p>用于账户验证与密码找回</p></div><button type="button" aria-label="关闭" disabled={busy} onClick={close}>×</button></div>{loading ? <p>正在读取…</p> : error ? <p role="alert">{error}</p> : phone && !editing ? <BoundPhone role={role} phone={phone} onDone={close} onBusyChange={setBusy} /> : <SmsForm role={role} replacing={!!phone} onDone={close} onCancel={close} onBusyChange={setBusy} />}</section></div>, document.body)}</>;
}

export function PasswordChangeButton({ role, onChanged }: {
  role: AuthRole;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const { remaining, coolDown } = useSmsCooldown(`${role}:password-change:${phone ?? "unbound"}`);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [open]);
  const show = async () => {
    setOpen(true); setLoading(true); setPhone(null); setChallengeId("");
    setCode(""); setPassword(""); setConfirm(""); setShowPassword(false); setShowConfirm(false); setNotice(""); setError("");
    try { setPhone((await call<{ phone: string | null }>(role, "phone")).phone); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "读取失败"); }
    finally { setLoading(false); }
  };
  const send = async () => {
    setBusy(true); setError(""); setNotice(""); setChallengeId(""); setCode("");
    try {
      const data = await call<{ challengeId: string; retryAfter: number }>(role, "password-change/code", {});
      setChallengeId(data.challengeId); coolDown(data.retryAfter); setNotice("验证码已发送，5 分钟内有效。");
    } catch (reason) {
      if (reason instanceof SmsError && reason.retryAfter) coolDown(reason.retryAfter);
      setError(reason instanceof Error ? reason.message : "发送失败，请重试");
    } finally { setBusy(false); }
  };
  const submit = async () => {
    setError("");
    if (password !== confirm) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    try {
      await call(role, "password-change/confirm", { challengeId, code, newPassword: password });
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改密码失败，请重试");
      setBusy(false);
    }
  };
  return <><button type="button" className="sms-binding-button" onClick={() => void show()}>修改密码</button>{open && createPortal(<div className="sms-binding-backdrop" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); setOpen(false); }
    if (event.key === "Tab") {
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><section ref={dialogRef} tabIndex={-1} className="sms-recovery-card phone-security-dialog password-security-dialog" role="dialog" aria-modal="true" aria-label="修改密码">
    <div className="sms-dialog-heading"><span className="phone-security-icon"><BindingIcon name="lock" /></span><div><h2>修改密码</h2><p>通过安全手机号验证身份</p></div><button type="button" aria-label="关闭" disabled={busy} onClick={() => setOpen(false)}>×</button></div>
    {loading ? <p>正在读取安全设置…</p> : error && !phone ? <p className="role-auth-error" role="alert">{error}</p> : !phone ? <><p className="sms-auth-note password-change-unbound">修改密码前，请先绑定安全手机号。</p><button type="button" className="sms-binding-button" onClick={() => setOpen(false)}>返回</button></> : <form className="sms-auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="phone-binding-status"><div><small>验证码接收号码</small><strong>{phone}</strong></div><span><BindingIcon name="shield" />已绑定</span></div>
      <label><span className="binding-field-label"><BindingIcon name="code" />短信验证码</span><div className="sms-code-row"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /><button type="button" disabled={busy || remaining > 0} onClick={() => void send()}><BindingIcon name="message" />{remaining ? `${remaining} 秒后重发` : "获取验证码"}</button></div></label>
      <label><span className="binding-field-label"><BindingIcon name="lock" />新密码</span><div className="password-security-input"><input required type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /><button type="button" disabled={busy} aria-label={showPassword ? "隐藏新密码" : "显示新密码"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "隐藏" : "显示"}</button></div><small className="password-security-hint">至少 8 位，建议使用字母、数字和符号组合</small></label>
      <label><span className="binding-field-label"><BindingIcon name="lock" />确认新密码</span><div className="password-security-input"><input required type={showConfirm ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} value={confirm} disabled={busy} onChange={(event) => setConfirm(event.target.value)} /><button type="button" disabled={busy} aria-label={showConfirm ? "隐藏确认新密码" : "显示确认新密码"} aria-pressed={showConfirm} onClick={() => setShowConfirm(value => !value)}>{showConfirm ? "隐藏" : "显示"}</button></div></label>
      {confirm && <p className={password === confirm ? "password-security-match" : "role-auth-error"} aria-live="polite">{password === confirm ? "两次密码输入一致" : "两次密码输入不一致"}</p>}
      {notice && <p className="sms-auth-note" role="status">{notice}</p>}
      {error && <p className="role-auth-error" role="alert">{error}</p>}
      <p className="sms-auth-note password-security-warning">修改成功后，所有设备将退出登录。请使用新密码重新登录。</p>
      <div className="phone-binding-actions"><button type="button" className="sms-binding-button" disabled={busy} onClick={() => setOpen(false)}>取消</button><button className="primary-action" disabled={busy || !challengeId}>{busy ? "处理中…" : "验证并修改"}</button></div>
    </form>}
  </section></div>, document.body)}</>;
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
  return <div className="profile-phone-bound">
    {phone ? <><strong>已绑定 {phone}</strong><p>可用于短信找回密码。</p></> : <p className="sms-auth-note">绑定手机号后，可通过短信验证找回密码。</p>}
    <PhoneBindingButton role={role} label={phone ? "更换手机号" : "绑定手机号"} editing onClose={() => setAttempt(value => value + 1)} />
  </div>;
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
  return <main className="sms-recovery-page"><section className="sms-recovery-card required-binding-card">
    <header className="binding-heading"><span className="binding-heading-icon"><BindingIcon name="shield" /></span><div><h1>绑定手机号</h1><p className="sms-auth-note">完成安全验证，开启你的工作流程</p></div></header>
    <SmsForm role="student" required onDone={() => void complete()} />
    {error && <p className="role-auth-error" role="alert">{error}</p>}
  </section></main>;
}
