import { useEffect, useRef, useState } from 'react';
import { mapRegistrationRecords, parseRegistrationFile, parseRegistrationImport, registrationFields, registrationLabels, type RegistrationEntry, type RegistrationImport } from '../../utils/registrationImport';

type Entry = RegistrationEntry & { id: number; registered: boolean };
type ImportRow = RegistrationEntry & { line: number };
type Summary = { added: number; updated: number; duplicates: number; incomplete: number; errors: string[] };
type ClassRemoval = { className: string; count: number; digest: string };
async function request<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/admin/registration-allowlist' + path, { method, credentials: 'include', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '操作失败，请检查填写内容');
  return data;
}
function Icon({ name }: { name: 'upload' | 'paste' | 'add' | 'trash' | 'edit' | 'file' }) {
  const paths = { upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5', paste: 'M9 4H5v17h14V4h-4M9 2h6v5H9ZM8 11h8M8 15h8', add: 'M12 4v16M4 12h16', trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7', edit: 'm14 4 6 6M4 20l5-1L21 7l-6-6L3 13v7Z', file: 'M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h8' };
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function rowError(row: RegistrationEntry) {
  if (!registrationFields.some(field => row[field].trim())) return '至少填写一项';
  if (row.className.length > 128 || row.studentNo.length > 32 || row.name.length > 64) return '字段超出长度限制';
  if (row.studentNo.startsWith('[数值精度异常') || /^\d+(?:\.\d+)?e[+-]?\d+$/i.test(row.studentNo)) return '请核对完整学号';
  if (row.studentNo.startsWith('preview-student-')) return '系统保留学号';
  return '';
}
const blank = (): ImportRow => ({ className: '', studentNo: '', name: '', line: 1 });

export function RegistrationAllowlist() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [classes, setClasses] = useState<{ className: string; count: number }[]>([]);
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'paste' | 'editor' | 'remove' | null>(null);
  const [source, setSource] = useState<RegistrationImport | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]), [title, setTitle] = useState('');
  const [editId, setEditId] = useState<number | null>(null), [paste, setPaste] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null), [checking, setChecking] = useState(false);
  const [dialogError, setDialogError] = useState(''), [previewPage, setPreviewPage] = useState(1);
  const [removal, setRemoval] = useState<ClassRemoval | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const refresh = () => { setRevision(value => value + 1); };
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ q, page: String(page) });
    if (classFilter !== null) params.set('className', classFilter);
    const timer = window.setTimeout(() => {
      request<{ items: Entry[]; total: number; classes: { className: string; count: number }[] }>('?' + params).then(data => {
        if (!active) return;
        setEntries(data.items); setTotal(data.total); setClasses(data.classes);
        if (page > Math.max(1, Math.ceil(data.total / 30))) setPage(Math.max(1, Math.ceil(data.total / 30)));
      }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [q, classFilter, page, revision]);
  useEffect(() => {
    if (mode && !dialog.current?.open) dialog.current?.showModal();
    if (!mode) dialog.current?.close();
  }, [mode]);
  useEffect(() => {
    let active = true;
    setSummary(null);
    if (mode !== 'editor' || source?.needsMapping || source?.errors.length || !rows.length || rows.length > 10000 || rows.some(row => rowError(row))) { setChecking(false); return; }
    if (editId !== null) { setChecking(false); return; }
    setChecking(true);
    const timer = window.setTimeout(() => {
      request<Summary>('/preview', 'POST', { entries: rows }).then(value => { if (active) setSummary(value); })
        .catch(reason => { if (active) setSummary({ added: 0, updated: 0, duplicates: 0, incomplete: 0, errors: [reason.message] }); })
        .finally(() => { if (active) setChecking(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [rows, source, editId, mode]);
  const close = () => { if (!busy) { setMode(null); setDialogError(''); setSource(null); } };
  const openEditor = (parsed: RegistrationImport | null, label: string, initialRows: ImportRow[], id: number | null = null) => {
    setSource(parsed); setTitle(label); setRows(initialRows); setEditId(id); setSummary(null); setDialogError(''); setPreviewPage(1); setMode('editor');
  };
  const upload = async (file: File) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > 2_000_000) throw new Error('文件不能超过 2 MB');
      const parsed = await parseRegistrationFile(file);
      openEditor(parsed, file.name, parsed.rows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '文件读取失败'); }
    finally { setBusy(false); }
  };
  const applyMapping = (next: RegistrationImport) => {
    setSource(next); setRows(next.rows); setPreviewPage(1); setSummary(null); setDialogError('');
  };
  const save = async () => {
    setBusy(true); setDialogError('');
    try {
      if (editId !== null) await request(`/entries/${editId}`, 'PUT', rows[0]);
      else await request('', 'POST', { entries: rows });
      setMode(null); setNotice(editId !== null ? '记录已更新' : '名单已保存'); refresh();
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const removeClass = async () => {
    if (classFilter === null) return;
    setBusy(true); setError('');
    try {
      const result = await request<ClassRemoval>('/class-removal-preview', 'POST', { className: classFilter });
      setRemoval(result); setDialogError(''); setMode('remove');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取失败'); }
    finally { setBusy(false); }
  };
  const invalid = rows.some(row => rowError(row));
  const blocked = busy || !rows.length || rows.length > 10000 || invalid || !!source?.needsMapping || !!source?.errors.length || (editId === null && (checking || !summary || !!summary.errors.length));
  const columnCount = source?.records.reduce((max, record) => Math.max(max, record.cells.length), 0) ?? 0;
  return <section className="registration-manager">
    <div className={`registration-actions${dragging ? ' is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void upload(file); }}>
      <div className="registration-action-buttons">
        <button className="primary-action" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="upload" />{busy ? '处理中…' : '上传名单'}</button>
        <button disabled={busy} onClick={() => { setPaste(''); setDialogError(''); setMode('paste'); }}><Icon name="paste" />粘贴表格</button>
        <button disabled={busy} onClick={() => openEditor(null, '添加记录', [blank()])}><Icon name="add" />添加</button>
      </div>
      <span className="registration-hint" title="Excel 读取第一个工作表；支持非首行表头。发布者通过邀请注册。">Excel / CSV · 拖入即可预览</span>
      <input hidden ref={fileInput} type="file" accept=".xlsx,.csv" aria-label="上传名单" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
    </div>
    <div className="registration-filters">
      <select aria-label="按班级筛选" value={classFilter === null ? '' : JSON.stringify(classFilter)} onChange={event => { setClassFilter(event.target.value ? JSON.parse(event.target.value) as string : null); setPage(1); }}>
        <option value="">全部班级</option>{classes.map(item => <option key={item.className} value={JSON.stringify(item.className)}>{item.className || '未分班'}（{item.count}）</option>)}
      </select>
      <input aria-label="搜索学号或姓名" placeholder="搜索学号 / 姓名" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} />
      <button className="danger" disabled={busy || classFilter === null || !classes.some(item => item.className === classFilter && item.count)} onClick={() => void removeClass()}><Icon name="trash" />移除该班级</button>
    </div>
    {error && <p role="alert" className="user-admin-error">{error}</p>}{notice && <p role="status" className="registration-hint">{notice}</p>}
    <div className="user-admin-table"><table><thead><tr><th>班级</th><th>学号</th><th>姓名</th><th>状态</th><th>操作</th></tr></thead><tbody>{!loading && entries.map(entry => <tr key={entry.id}>
      <td>{entry.className || '—'}</td><td>{entry.studentNo || '—'}</td><td>{entry.name || '—'}</td>
      <td><span className={`registration-status${!entry.studentNo || !entry.name ? ' is-incomplete' : ''}`}>{!entry.studentNo || !entry.name ? '待补全' : entry.registered ? '已注册' : '未注册'}</span></td>
      <td><div className="registration-row-actions"><button title="编辑记录" aria-label={`编辑 ${entry.name || entry.studentNo || '记录'}`} disabled={busy} onClick={() => openEditor(null, '编辑记录', [{ ...entry, line: 1 }], entry.id)}><Icon name="edit" /></button><button className="danger" title="移出名单" aria-label={`移出 ${entry.name || entry.studentNo || '记录'}`} disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await request(`/entries/${entry.id}`, 'DELETE'); refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : '移除失败'); } finally { setBusy(false); }
      }}><Icon name="trash" /></button></div></td>
    </tr>)}</tbody></table>{loading ? <p role="status">加载中…</p> : !total && <p className="registration-empty">暂无名单，上传表格即可添加</p>}</div>
    <footer className="registration-pagination"><span>{total} 条 · 第 {page} 页</span><div><button disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>上一页</button><button disabled={loading || page * 30 >= total} onClick={() => setPage(value => value + 1)}>下一页</button></div></footer>
    <dialog ref={dialog} aria-labelledby="registration-dialog-title" className="registration-dialog" onCancel={event => { event.preventDefault(); close(); }} onClose={() => { if (!busy) setMode(null); }}>
      <header><div><Icon name={mode === 'remove' ? 'trash' : 'file'} /><h2 id="registration-dialog-title">{mode === 'paste' ? '粘贴表格' : mode === 'remove' ? '移除班级名单' : '名单预览'}</h2></div><button disabled={busy} aria-label="关闭" onClick={close}>×</button></header>
      {mode === 'paste' && <><textarea autoFocus aria-label="粘贴名单" rows={9} placeholder={'班级\t学号\t姓名\n一班\t20260001\t张同学'} value={paste} onChange={event => setPaste(event.target.value)} /><footer><button onClick={close}>取消</button><button className="primary-action" disabled={!paste.trim()} onClick={() => {
        try { const parsed = parseRegistrationImport(paste); openEditor(parsed, '粘贴的名单', parsed.rows); } catch (reason) { setDialogError(reason instanceof Error ? reason.message : '无法解析'); }
      }}>整理并预览</button></footer></>}
      {mode === 'editor' && <>
        <p className="registration-hint">{title} · {rows.length} 条 · 缺失留空，可直接编辑</p>
        {source && <details className="registration-mapping" open={source.needsMapping || undefined}><summary>{source.needsMapping ? '请选择表头和对应列' : '调整列识别'}</summary>
          <label>表头<select disabled={busy} value={source.headerIndex} onChange={event => applyMapping(mapRegistrationRecords(source.records, Number(event.target.value), source.columns))}><option value={-1}>无表头，从第一行读取</option>{source.records.map((record, index) => <option key={record.line} value={index}>第 {record.line} 行：{record.cells.join(' / ').slice(0, 90)}</option>)}</select></label>
          <div>{registrationFields.map(field => <label key={field}>{registrationLabels[field]}<select disabled={busy} value={source.columns[field]} onChange={event => applyMapping(mapRegistrationRecords(source.records, source.headerIndex, { ...source.columns, [field]: Number(event.target.value) }))}><option value={-1}>缺失，留空</option>{Array.from({ length: columnCount }, (_, i) => <option key={i} value={i}>第 {i + 1} 列{source.headerIndex >= 0 ? ` · ${source.records[source.headerIndex]?.cells[i] || '空'}` : ''}</option>)}</select></label>)}</div>
          {source.needsMapping && <button disabled={busy} onClick={() => applyMapping(mapRegistrationRecords(source.records, source.headerIndex, source.columns))}>确认列对应关系</button>}
        </details>}
        {source?.errors.map(value => <p key={value} className="user-admin-error">{value}</p>)}
        <div className="registration-editor-table"><table><thead><tr>{registrationFields.map(field => <th key={field}>{registrationLabels[field]}</th>)}<th>原始行 / 状态</th></tr></thead><tbody>{rows.slice((previewPage - 1) * 50, previewPage * 50).map((row, offset) => {
          const index = (previewPage - 1) * 50 + offset;
          return <tr key={index}>{registrationFields.map(field => <td key={field}><input aria-label={`第 ${row.line} 行${registrationLabels[field]}`} value={row[field]} disabled={busy} maxLength={field === 'className' ? 128 : field === 'studentNo' ? 32 : 64} onChange={event => { setSummary(null); setRows(values => values.map((value, i) => i === index ? { ...value, [field]: event.target.value } : value)); }} /></td>)}<td className={rowError(row) ? 'user-admin-error' : ''}>{row.line} · {rowError(row) || (!row.studentNo.trim() || !row.name.trim() ? '待补全' : '可保存')}</td></tr>;
        })}</tbody></table></div>
        {rows.length > 50 && <div className="registration-pagination"><span>预览第 {previewPage} / {Math.ceil(rows.length / 50)} 页</span><div><button disabled={previewPage === 1} onClick={() => setPreviewPage(value => value - 1)}>上一页</button><button disabled={previewPage * 50 >= rows.length} onClick={() => setPreviewPage(value => value + 1)}>下一页</button></div></div>}
        {!rows.length && <p className="user-admin-error">未识别到数据，请调整列识别或重新上传。</p>}
        {rows.length > 10000 && <p className="user-admin-error">每次最多导入 10000 条，请拆分文件。</p>}
        {checking && <p role="status" className="registration-hint">正在核对名单…</p>}
        {summary && <p className="registration-hint">新增 {summary.added} · 更新 {summary.updated} · 重复 {summary.duplicates} · 待补全 {summary.incomplete}</p>}
        {summary?.errors.map((value, i) => <p key={i} className="user-admin-error">{value}</p>)}
        <footer><span className="registration-hint">缺学号或姓名的记录暂不能用于注册</span><button disabled={busy} onClick={close}>取消</button><button className="primary-action" disabled={blocked} onClick={() => void save()}>{busy ? '保存中…' : '确认保存'}</button></footer>
      </>}
      {mode === 'remove' && removal && <><p>将移除 <strong>{removal.className || '未分班'}</strong> 的全部 <strong>{removal.count}</strong> 条名单。</p><p className="registration-hint">覆盖全部分页，不删除已注册账号。</p><footer><button disabled={busy} onClick={close}>取消</button><button className="danger" disabled={busy || !removal.count} onClick={async () => {
        setBusy(true); setDialogError('');
        try { await request('/class-removal', 'POST', removal); setMode(null); setClassFilter(null); setPage(1); setNotice(`已移除 ${removal.count} 条名单`); refresh(); } catch (reason) { setDialogError(reason instanceof Error ? reason.message : '移除失败'); } finally { setBusy(false); }
      }}>确认移除</button></footer></>}
      {dialogError && <p role="alert" className="user-admin-error">{dialogError}</p>}
    </dialog>
  </section>;
}
