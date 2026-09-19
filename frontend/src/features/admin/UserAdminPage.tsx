import { useEffect, useState } from 'react';
import { RegistrationAllowlist } from './RegistrationAllowlist';

type User = { id: number; kind: 'student' | 'teacher'; account: string; name: string; role: string; status: string; created_at: string };
type Job = { id: string; status: string; error: string | null };
type Preview = { account: string; name: string; digest: string; counts: Record<string, number>; files: number; affectedStudents: number };
async function copyPassword(value: string) {
  if (navigator.clipboard) { await navigator.clipboard.writeText(value); return; }
  const input = document.createElement('textarea');
  input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.appendChild(input); input.select();
  try { if (!document.execCommand('copy')) throw new Error('自动复制不可用，请选中临时密码手动复制'); }
  finally { input.remove(); }
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/admin/' + path, { method, credentials: 'include', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : '请求失败，请检查输入');
  return value;
}

const labels: Record<string, string> = { student_accounts: '学生账号', teacher_accounts: '教师账号', flows: '流程', flow_instances: '学生流程实例', submissions: '提交', uploaded_files: '上传文件', answer_sheet_grades: '成绩', flow_roster_entries: '流程名单', audit_jobs: '审核任务', student_sessions: '学生登录会话', teacher_sessions: '教师登录会话' };

export function UserAdminPage() {
  const [tab, setTab] = useState<'users' | 'registration-allowlist'>('users');
  const [q, setQ] = useState(''); const [kind, setKind] = useState('all'); const [page, setPage] = useState(1);
  const [users, setUsers] = useState<User[]>([]); const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<User | null>(null); const [action, setAction] = useState<'reset' | 'delete' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null); const [confirmation, setConfirmation] = useState(''); const [remove, setRemove] = useState(false); const [password, setPassword] = useState('');
  const refresh = () => setRevision(v => v + 1);
  useEffect(() => {
    if (tab !== 'users') return;
    let active = true; setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      api<{ items: User[]; total: number }>(`${tab}?q=${encodeURIComponent(q)}&kind=${kind}&page=${page}`)
        .then(v => { if (active) { setTotal(v.total); setUsers(v.items); } })
        .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [tab, q, kind, page, revision]);
  useEffect(() => {
    let active = true;
    const load = () => api<Job[]>('user-deletions').then(v => { if (active) setJobs(v); }).catch(e => { if (active) setError(e.message); });
    void load(); const timer = window.setInterval(() => void load(), 4000);
    return () => { active = false; clearInterval(timer); };
  }, [revision]);
  async function run(work: () => Promise<void>) { setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } }
  function close() { setSelected(null); setAction(null); setPassword(''); setPreview(null); setConfirmation(''); setRemove(false); }
  async function open(user: User, operation: 'reset' | 'delete') {
    setError(''); setSelected(user); setAction(operation); setPreview(null); setConfirmation(''); setRemove(false); setPassword('');
    if (operation === 'delete') await run(async () => setPreview(await api<Preview>(`users/${user.kind}/${user.id}/deletion-preview`)));
  }
  return <article className="profile-card user-admin">
    <div className="user-admin-tabs">{(['users', 'registration-allowlist'] as const).map(t => <button key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setPage(1); setQ(''); }}>{t === 'users' ? '用户列表' : '普通用户注册白名单'}</button>)}</div>
    {tab === 'registration-allowlist' ? <RegistrationAllowlist /> : <>
    <div className="user-admin-toolbar"><input aria-label="搜索账号或姓名" placeholder="搜索学号 / 工号 / 姓名" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />{tab === 'users' && <select aria-label="角色" value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="all">全部用户</option><option value="teacher">教师</option><option value="student">学生</option></select>}</div>
    {error && <p role="alert" className="user-admin-error">{error}</p>}
    <div className="user-admin-table"><table><thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>操作</th></tr></thead><tbody>{!loading && users.map(u => <tr key={`${u.kind}-${u.id}`}><td>{u.name}</td><td>{u.account}</td><td>{u.role === 'super_admin' ? '超级管理员' : u.kind === 'teacher' ? '教师' : '学生'}</td><td>{u.role === 'super_admin' ? '受保护' : <><button disabled={busy} onClick={() => void open(u, 'reset')}>初始化密码</button><button disabled={busy} className="danger" onClick={() => void open(u, 'delete')}>彻底删除</button></>}</td></tr>)}</tbody></table>{loading ? <p>加载中…</p> : total === 0 && <p>暂无记录</p>}</div>
    <footer className="user-admin-toolbar"><span>共 {total} 条 · 第 {page} 页</span><button disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><button disabled={loading || page * 30 >= total} onClick={() => setPage(p => p + 1)}>下一页</button></footer>
    </>}
    {jobs.length > 0 && <details><summary>最近删除任务</summary>{jobs.map(j => <p key={j.id}>{j.id.slice(0, 8)} · {{ pending: '文件清理中', running: '文件清理中', failed: '文件清理失败', completed: '已彻底删除' }[j.status]} {j.error}{j.status === 'failed' && <button disabled={busy} onClick={() => void run(async () => { await api(`user-deletions/${j.id}/retry`, 'POST'); refresh(); })}>重试</button>}</p>)}</details>}
    {selected && <div className="user-admin-overlay"><section role="alertdialog" aria-modal="true" aria-labelledby="user-dialog-title" className="user-admin-dialog" onKeyDown={e => { if (e.key === 'Escape' && !busy) close(); if (e.key === 'Tab') { const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary')); const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}><h2 id="user-dialog-title">{action === 'reset' ? '初始化密码' : '彻底删除用户'}</h2><p>{selected.name} · {selected.account}</p>{action === 'reset' ? password ? <><p>请将临时密码交给用户，下次登录必须修改。</p><code>{password}</code><button onClick={() => void run(async () => { await copyPassword(password); })}>复制密码</button></> : <p>所有登录设备将退出。系统生成临时密码，用户下次登录必须修改；原有资料保留。</p> : preview ? <><p className="user-admin-error">将永久清空在线关联记录与专属文件，无法撤销。历史备份与已下载文件不在此范围。</p><p>关联文件 {preview.files} 个，涉及学生 {preview.affectedStudents} 人。</p><details><summary>关联记录明细</summary>{Object.entries(preview.counts).map(([key, count]) => <p key={key}>{labels[key] ?? key}：{count}</p>)}</details>{selected.kind === 'student' && <label><input type="checkbox" checked={remove} onChange={e => setRemove(e.target.checked)} />同时移出普通用户注册白名单</label>}<input autoFocus aria-label="确认删除账号" placeholder={`输入 ${selected.account} 确认`} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></> : <p>正在读取删除范围…</p>}{error && <p role="alert" className="user-admin-error">{error}</p>}<footer><button autoFocus disabled={busy} onClick={close}>{password ? '关闭' : '取消'}</button>{!password && <button className={action === 'delete' ? 'danger' : ''} disabled={busy || (action === 'delete' && (!preview || confirmation !== selected.account))} onClick={() => void run(async () => { if (action === 'reset') { const v = await api<{ password: string }>(`users/${selected.kind}/${selected.id}/reset-password`, 'POST'); setPassword(v.password); } else { await api(`users/${selected.kind}/${selected.id}/deletion`, 'POST', { confirmation, digest: preview!.digest, removeFromAllowlist: remove }); close(); refresh(); } })}>{busy ? '处理中…' : action === 'delete' ? '确认彻底删除' : '确认初始化'}</button>}</footer></section></div>}
  </article>;
}
