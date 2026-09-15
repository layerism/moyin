import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthRole } from "./authApi";

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

function SmsForm({ role, binding, onDone }: { role: AuthRole; binding: boolean; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(Date.now());
  const storageKey = `moyin-sms-cooldown:${phone}`;
  const [deadline, setDeadline] = useState(0);
  useEffect(() => {
    try { setDeadline(Number(localStorage.getItem(storageKey)) || 0); } catch { setDeadline(0); }
    setChallengeId(""); setCode(""); setError(""); setNotice("");
  }, [storageKey, identifier]);
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
  const send = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await call<{ challengeId: string; retryAfter: number }>(role,
        binding ? "phone/code" : "password-reset/code",
        binding ? { phone, password } : { phone, identifier });
      setChallengeId(data.challengeId); setCode(""); coolDown(data.retryAfter);
      setNotice(binding ? "验证码已发送，5 分钟内有效" : "若账号与已绑定手机号匹配，将收到验证码，5 分钟内有效");
    } catch (reason) {
      if (reason instanceof SmsError && reason.retryAfter) coolDown(reason.retryAfter);
      setError(reason instanceof Error ? reason.message : "发送失败");
    } finally { setBusy(false); }
  };
  const submit = async () => {
    if (!binding && password !== confirm) { setError("两次输入的密码不一致"); return; }
    setBusy(true); setError("");
    try {
      const data = await call<{ message: string }>(role, binding ? "phone/verify" : "password-reset/confirm",
        { challengeId, code, ...(!binding ? { newPassword: password } : {}) });
      setNotice(data.message); setDone(true); setPassword(""); setConfirm(""); setCode(""); setChallengeId("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作未完成"); }
    finally { setBusy(false); }
  };
  if (done) return <div className="sms-auth-form"><p role="status">{notice}</p><button className="primary-action" onClick={onDone}>{binding ? "完成" : "返回登录"}</button></div>;
  return <form className="sms-auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    {!binding && <label>{role === "teacher" ? "工号" : "学号"}<input required maxLength={32} autoComplete="username" value={identifier} disabled={busy} onChange={(event) => setIdentifier(event.target.value.trim())} /></label>}
    <label>{binding ? "待绑定手机号" : "已绑定手机号"}<input required type="tel" autoComplete="tel" inputMode="numeric" pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} disabled={busy} onChange={(event) => setPhone(event.target.value.trim())} /></label>
    {binding && <label>当前密码<input required type="password" autoComplete="current-password" maxLength={128} value={password} disabled={busy || !!challengeId} onChange={(event) => setPassword(event.target.value)} /></label>}
    <label>短信验证码<div className="sms-code-row"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /><button type="button" disabled={busy || remaining > 0 || !/^1[3-9]\d{9}$/.test(phone) || (binding ? password.length < 3 : !identifier)} onClick={() => void send()}>{remaining ? `${remaining} 秒后重发` : "获取验证码"}</button></div></label>
    {!binding && <><label>新密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label><label>确认新密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirm} disabled={busy} onChange={(event) => setConfirm(event.target.value)} /></label></>}
    {notice && <p className="sms-auth-note" role="status">{notice}</p>}
    {error && <p className="role-auth-error" role="alert">{error}</p>}
    <button className="primary-action" disabled={busy || !challengeId}>{busy ? "处理中…" : binding ? "验证并绑定" : "重置密码"}</button>
    <p className="sms-auth-note">{binding ? "绑定后可通过短信找回密码。更换已绑定号码请联系管理员核实身份。" : "未绑定手机号或已无法接收短信，请联系管理员恢复账号。"}</p>
  </form>;
}

export function SmsPasswordRecovery({ role, onBack }: { role: AuthRole; onBack: () => void }) {
  return <main className="sms-recovery-page"><section className="sms-recovery-card"><span className="oa-brand-mark">OA</span><p>{role === "teacher" ? "发布者账户" : "用户账户"}</p><h1>找回密码</h1><p className="sms-auth-note">使用已绑定的手机号验证身份，设置新密码。</p><SmsForm role={role} binding={false} onDone={onBack} /><button className="sms-back" type="button" onClick={onBack}>返回登录</button></section></main>;
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
  }}><section ref={dialogRef} tabIndex={-1} className="sms-recovery-card" role="dialog" aria-modal="true" aria-label="安全手机号"><div className="sms-dialog-heading"><h2>安全手机号</h2><button type="button" aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>{loading ? <p>正在读取…</p> : error ? <p role="alert">{error}</p> : phone ? <p>已绑定 {phone}，可用于找回密码。更换号码请联系管理员。</p> : <SmsForm role={role} binding onDone={() => setOpen(false)} />}</section></div>, document.body)}</>;
}
