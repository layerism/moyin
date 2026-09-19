import { useEffect, useState } from 'react';
import { parseRegistrationImport, type RegistrationImport } from '../../utils/registrationImport';

type User = { id: number; kind: 'student' | 'teacher'; account: string; name: string; role: string; status: string; created_at: string };
type Entry = { studentNo: string; name: string; registered?: boolean };
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
  const [users, setUsers] = useState<User[]>([]); const [entries, setEntries] = useState<Entry[]>([]); const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<User | null>(null); const [action, setAction] = useState<'reset' | 'delete' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null); const [confirmation, setConfirmation] = useState(''); const [remove, setRemove] = useState(false); const [password, setPassword] = useState('');
  const [text, setText] = useState(''); const [singleNo, setSingleNo] = useState(''); const [singleName, setSingleName] = useState('');
  const [importPreview, setImportPreview] = useState<{ added: number; duplicates: number; errors: string[]; parsed: RegistrationImport } | null>(null);
  const refresh = () => setRevision(v => v + 1);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      api<{ items: User[] | Entry[]; total: number }>(`${tab}?q=${encodeURIComponent(q)}&kind=${kind}&page=${page}`)
        .then(v => { if (active) { setTotal(v.total); if (tab === 'users') setUsers(v.items as User[]); else setEntries(v.items as Entry[]); } })
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
    <div className="user-admin-toolbar"><input aria-label="搜索账号或姓名" placeholder={tab === 'users' ? '搜索学号 / 工号 / 姓名' : '搜索学号 / 姓名'} value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />{tab === 'users' && <select aria-label="角色" value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="all">全部用户</option><option value="teacher">教师</option><option value="student">学生</option></select>}</div>
    {error && <p role="alert" className="user-admin-error">{error}</p>}
    {tab === 'registration-allowlist' && <section className="user-admin-import">
      <p>此名单仅用于普通用户注册，学号与姓名须同时匹配。发布者必须受邀注册，请通过“邀请管理”发送邀请。名单为空时禁止普通用户新注册；移除名单不影响现有账号登录。</p>
      <div className="user-admin-toolbar"><input placeholder="学号" aria-label="学号" value={singleNo} onChange={e => setSingleNo(e.target.value)} /><input placeholder="姓名" aria-label="姓名" value={singleName} onChange={e => setSingleName(e.target.value)} /><button disabled={busy || !singleNo.trim() || !singleName.trim()} onClick={() => void run(async () => { await api('registration-allowlist', 'POST', { entries: [{ studentNo: singleNo, name: singleName }] }); setSingleNo(''); setSingleName(''); refresh(); })}>添加</button></div>
      <details><summary>批量粘贴 / CSV 导入</summary>
        <p>自动识别学号、学生编号、姓名、学生姓名等表头，支持换列和额外列。可粘贴表格或上传 UTF-8 CSV；无表头时尝试根据内容识别，请核对解析结果。</p>
        <input type="file" accept=".csv,text/csv" aria-label="导入 CSV" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { setImportPreview(null); if (file.size > 2_000_000) throw new Error('文件不能超过 2 MB'); setText(await file.text()); }); }} />
        <textarea aria-label="名单内容" rows={6} disabled={busy} value={text} placeholder={'姓名,学号,班级\n张同学,20260001,一班\n李同学,20260002,二班'} onChange={e => { setText(e.target.value); setImportPreview(null); }} />
        <button disabled={busy || !text.trim()} onClick={() => void run(async () => {
          setImportPreview(null);
          const parsed = parseRegistrationImport(text);
          if (parsed.errors.length || !parsed.entries.length) {
            setImportPreview({ parsed, added: 0, duplicates: 0, errors: parsed.errors.length ? parsed.errors : ['未识别到可导入的名单。'] });
            return;
          }
          const result = await api<{ added: number; duplicates: number; errors: string[] }>('registration-allowlist/preview', 'POST', { entries: parsed.entries });
          setImportPreview({ ...result, parsed });
        })}>预览导入</button>
        {importPreview && <div>
          <p>识别 {importPreview.parsed.entries.length} 条，新增 {importPreview.added} 条，重复 {importPreview.duplicates} 条。请核对学号和姓名后确认导入。</p>
          {importPreview.errors.map((v, i) => <p key={i} className="user-admin-error">{v}</p>)}
          {importPreview.parsed.rows.length > 0 && <div className="user-admin-table registration-import-preview"><table><thead><tr><th>原始行</th><th>学号</th><th>姓名</th><th>识别结果</th></tr></thead><tbody>{importPreview.parsed.rows.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.studentNo || '—'}</td><td>{row.name || '—'}</td><td className={row.error ? 'user-admin-error' : undefined}>{row.error || '已识别'}</td></tr>)}</tbody></table></div>}
          <button disabled={busy || !!importPreview.errors.length || !importPreview.added} onClick={() => void run(async () => { await api('registration-allowlist', 'POST', { entries: importPreview.parsed.entries }); setText(''); setImportPreview(null); refresh(); })}>确认导入</button>
        </div>}
      </details>
    </section>}
    <div className="user-admin-table"><table><thead><tr><th>姓名</th><th>账号</th><th>{tab === 'users' ? '角色' : '注册状态'}</th><th>操作</th></tr></thead><tbody>{!loading && tab === 'users' && users.map(u => <tr key={`${u.kind}-${u.id}`}><td>{u.name}</td><td>{u.account}</td><td>{u.role === 'super_admin' ? '超级管理员' : u.kind === 'teacher' ? '教师' : '学生'}</td><td>{u.role === 'super_admin' ? '受保护' : <><button disabled={busy} onClick={() => void open(u, 'reset')}>初始化密码</button><button disabled={busy} className="danger" onClick={() => void open(u, 'delete')}>彻底删除</button></>}</td></tr>)}{!loading && tab === 'registration-allowlist' && entries.map(e => <tr key={e.studentNo}><td>{e.name}</td><td>{e.studentNo}</td><td>{e.registered ? '已注册' : '未注册'}</td><td><button disabled={busy} className="danger" onClick={() => void run(async () => { await api(`registration-allowlist/${encodeURIComponent(e.studentNo)}`, 'DELETE'); refresh(); })}>移出名单</button></td></tr>)}</tbody></table>{loading ? <p>加载中…</p> : total === 0 && <p>暂无记录</p>}</div>
    <footer className="user-admin-toolbar"><span>共 {total} 条 · 第 {page} 页</span><button disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><button disabled={loading || page * 30 >= total} onClick={() => setPage(p => p + 1)}>下一页</button></footer>
    {jobs.length > 0 && <details><summary>最近删除任务</summary>{jobs.map(j => <p key={j.id}>{j.id.slice(0, 8)} · {{ pending: '文件清理中', running: '文件清理中', failed: '文件清理失败', completed: '已彻底删除' }[j.status]} {j.error}{j.status === 'failed' && <button disabled={busy} onClick={() => void run(async () => { await api(`user-deletions/${j.id}/retry`, 'POST'); refresh(); })}>重试</button>}</p>)}</details>}
    {selected && <div className="user-admin-overlay"><section role="alertdialog" aria-modal="true" aria-labelledby="user-dialog-title" className="user-admin-dialog" onKeyDown={e => { if (e.key === 'Escape' && !busy) close(); if (e.key === 'Tab') { const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary')); const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}><h2 id="user-dialog-title">{action === 'reset' ? '初始化密码' : '彻底删除用户'}</h2><p>{selected.name} · {selected.account}</p>{action === 'reset' ? password ? <><p>请将临时密码交给用户，下次登录必须修改。</p><code>{password}</code><button onClick={() => void run(async () => { await copyPassword(password); })}>复制密码</button></> : <p>所有登录设备将退出。系统生成临时密码，用户下次登录必须修改；原有资料保留。</p> : preview ? <><p className="user-admin-error">将永久清空在线关联记录与专属文件，无法撤销。历史备份与已下载文件不在此范围。</p><p>关联文件 {preview.files} 个，涉及学生 {preview.affectedStudents} 人。</p><details><summary>关联记录明细</summary>{Object.entries(preview.counts).map(([key, count]) => <p key={key}>{labels[key] ?? key}：{count}</p>)}</details>{selected.kind === 'student' && <label><input type="checkbox" checked={remove} onChange={e => setRemove(e.target.checked)} />同时移出普通用户注册白名单</label>}<input autoFocus aria-label="确认删除账号" placeholder={`输入 ${selected.account} 确认`} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></> : <p>正在读取删除范围…</p>}{error && <p role="alert" className="user-admin-error">{error}</p>}<footer><button autoFocus disabled={busy} onClick={close}>{password ? '关闭' : '取消'}</button>{!password && <button className={action === 'delete' ? 'danger' : ''} disabled={busy || (action === 'delete' && (!preview || confirmation !== selected.account))} onClick={() => void run(async () => { if (action === 'reset') { const v = await api<{ password: string }>(`users/${selected.kind}/${selected.id}/reset-password`, 'POST'); setPassword(v.password); } else { await api(`users/${selected.kind}/${selected.id}/deletion`, 'POST', { confirmation, digest: preview!.digest, removeFromAllowlist: remove }); close(); refresh(); } })}>{busy ? '处理中…' : action === 'delete' ? '确认彻底删除' : '确认初始化'}</button>}</footer></section></div>}
  </article>;
}
