import { DriveNavIcon } from "../home/DriveNavIcon";
import { useEffect, useState } from "react";

import type { AcademicProcess } from "../../types";
import { TeacherAccountMenu } from "../auth/TeacherAccountMenu";
import type { AuthIdentity } from "../auth/authApi";
import { workflowApi, type ServerFlow, type WorkflowTemplate } from "./api";

type TemplateDraft = { id?: string; sourceFlowId: string; name: string; description: string };

export function WorkflowTemplatesPage({
  processes, sourceFlowId, teacherIdentity, onAcademicFlow, onOssCloud,
  onCreated, onDatabaseAdmin, onModelAdmin, onTeacherInvitations, onTeacherLogout,
}: {
  processes: AcademicProcess[];
  sourceFlowId: string | null;
  teacherIdentity: AuthIdentity;
  onAcademicFlow: () => void;
  onOssCloud: () => void;
  onCreated: (flow: ServerFlow) => void;
  onDatabaseAdmin: () => void;
  onModelAdmin: () => void;
  onTeacherInvitations: () => void;
  onTeacherLogout: () => void;
}) {
  const admin = teacherIdentity.role === "super_admin";
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(() => {
    const source = processes.find((flow) => flow.id === sourceFlowId);
    return admin && sourceFlowId ? { sourceFlowId, name: source?.name ?? "", description: "" } : null;
  });
  const [formError, setFormError] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try { setTemplates(await workflowApi.listWorkflowTemplates()); }
    catch (reason) { setLoadError(reason instanceof Error ? reason.message : "读取模板失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const useTemplate = async (template: WorkflowTemplate) => {
    setBusy(template.id);
    setError("");
    try { onCreated(await workflowApi.useWorkflowTemplate(template.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "创建流程失败，请重试"); }
    finally { setBusy(null); }
  };
  const changeAvailability = async (template: WorkflowTemplate) => {
    setBusy(template.id);
    setError("");
    try {
      await workflowApi.setWorkflowTemplateActive(template.id, !template.active);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "更新失败"); }
    finally { setBusy(null); }
  };
  const publish = async () => {
    if (!draft) return;
    setBusy("publish");
    setFormError("");
    try {
      await workflowApi.publishWorkflowTemplate({
        sourceFlowId: draft.sourceFlowId, name: draft.name.trim(), description: draft.description.trim(),
      }, draft.id);
      setDraft(null);
      await load();
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "发布失败，请重试"); }
    finally { setBusy(null); }
  };
  const visible = templates.filter((template) =>
    `${template.name} ${template.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <main className="home-page">
    <aside className="drive-sidebar">
      <div className="drive-logo"><span className="logo-mark">T</span><strong>材料收集</strong></div>
      <button className="drive-primary" type="button">+ 新建</button>
      <button className="drive-secondary" type="button">上传</button>
      <nav className="drive-nav" aria-label="主导航">
        <button onClick={onAcademicFlow}><DriveNavIcon kind="flow" />教务流程</button>
        <button className="selected" aria-current="page"><DriveNavIcon kind="template" />流程模板</button>
        <button onClick={onOssCloud}><DriveNavIcon kind="cloud" />OSS 云盘</button>
      </nav>
    </aside>
    <section className="drive-main">
      <header className="drive-topbar">
        <label className="drive-search"><span>⌕</span><input aria-label="搜索流程模板" placeholder="搜索流程模板" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <TeacherAccountMenu identity={teacherIdentity} onDatabaseAdmin={onDatabaseAdmin} onModelAdmin={onModelAdmin} onTeacherInvitations={onTeacherInvitations} onLogout={onTeacherLogout} />
      </header>
      <section className="drive-panel workflow-template-panel" aria-label="流程模板">
        <header className="workflow-template-heading">
          <div><h2>流程模板</h2><p>选用模板，在教务流程中创建自己的草稿。</p></div>
          {admin ? <button className="primary-action" disabled={busy !== null} onClick={() => {
            setFormError(""); setDraft({ sourceFlowId: "", name: "", description: "" });
          }}>发布模板</button> : null}
        </header>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        {loading ? <p className="workflow-template-empty">正在读取模板…</p>
          : loadError ? <div className="workflow-template-empty" role="alert"><p>{loadError}</p><button onClick={() => void load()}>重新读取</button></div>
          : visible.length === 0 ? <div className="workflow-template-empty"><p>{query.trim() ? "没有找到匹配的模板" : "暂无已发布模板"}</p>{query.trim() ? <button onClick={() => setQuery("")}>清除搜索</button> : null}</div>
          : <div className="workflow-template-list">{visible.map((template) => <article key={template.id}>
            <div className="workflow-template-symbol"><DriveNavIcon kind="flow" /></div>
            <div className="workflow-template-info">
              <h3>{template.name}{!template.active ? <small>已下架</small> : null}</h3>
              {template.description.trim() ? <p>{template.description}</p> : null}
              <div className="workflow-template-meta"><span><DriveNavIcon kind="flow" />{template.nodeCount} 个节点</span><span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>更新于 {new Date(template.updatedAt).toLocaleDateString("zh-CN")}</span></div>
            </div>
            <div className="workflow-template-actions">
              {admin ? <>
                <button disabled={busy !== null} onClick={() => {
                  setFormError(""); setDraft({ id: template.id, name: template.name, description: template.description, sourceFlowId: "" });
                }}>更新</button>
                <button disabled={busy !== null} onClick={() => void changeAvailability(template)}>{template.active ? "下架" : "上架"}</button>
              </> : null}
              <button className="primary-action" disabled={busy !== null || !template.active} onClick={() => void useTemplate(template)}>{busy === template.id ? "处理中…" : "使用模板"}</button>
            </div>
          </article>)}</div>}
      </section>
    </section>
    {draft ? <div className="modal-backdrop">
      <section className="workflow-template-editor" onKeyDown={(event) => { if (event.key === "Escape" && busy === null) setDraft(null); }} role="dialog" aria-modal="true" aria-labelledby="workflow-template-editor-title">
        <header><h2 id="workflow-template-editor-title">{draft.id ? "更新流程模板" : "发布流程模板"}</h2><button aria-label="关闭" disabled={busy !== null} onClick={() => setDraft(null)}>×</button></header>
        <form onSubmit={(event) => { event.preventDefault(); void publish(); }}>
          <label>来源流程<select autoFocus required disabled={busy !== null} value={draft.sourceFlowId} onChange={(event) => {
            const source = processes.find((process) => process.id === event.target.value);
            setDraft({ ...draft, sourceFlowId: event.target.value, name: draft.name || source?.name || "" });
          }}><option value="" disabled hidden>选择自己的流程</option>{processes.map((process) => <option key={process.id} value={process.serverId ?? process.id}>{process.name}</option>)}</select></label>
          <label>模板名称<input required maxLength={120} disabled={busy !== null} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>模板简介<textarea maxLength={500} rows={3} disabled={busy !== null} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <p>保存来源流程的当前草稿及附件；不包含学生数据，开始和截止时间会清空。更新后重新上架，已创建的流程不受影响。</p>
          {formError ? <p className="dialog-error" role="alert">{formError}</p> : null}
          <footer><button type="button" disabled={busy !== null} onClick={() => setDraft(null)}>取消</button><button className="primary-action" type="submit" disabled={busy !== null || !draft.sourceFlowId || !draft.name.trim()}>{busy === "publish" ? "正在保存…" : draft.id ? "更新并发布" : "发布模板"}</button></footer>
        </form>
      </section>
    </div> : null}
  </main>;
}
