import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { workflowApi } from "./api";
import { saveDownload } from "./download";
import type { ExportJob } from "./runtimeTypes";


type ExportTasksValue = {
  jobs: ExportJob[];
  submitting: string[];
  start: (versionId: string) => void;
  openTasks: () => void;
};
const ExportTasksContext = createContext<ExportTasksValue | null>(null);
export function useExportTasks() {
  const value = useContext(ExportTasksContext);
  if (!value) throw new Error("ExportTasksProvider is required");
  return value;
}

export function ExportTasksProvider({ teacherId, visible, children }: {
  teacherId: number | string | null; visible: boolean; children: ReactNode;
}) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [submitting, setSubmitting] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"notifications" | "chat" | "companions">("notifications");
  const openTasks = () => { setTab("notifications"); setOpen(true); };
  useEffect(() => {
    if (!open || !visible) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, visible]);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const activeRequests = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async () => {
    const next = await workflowApi.listExportJobs();
    if (alive.current) setJobs(next);
  }, []);
  useEffect(() => {
    if (teacherId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await workflowApi.listExportJobs();
        if (!cancelled) setJobs(next);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "导出任务读取失败");
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [teacherId]);
  const start = async (versionId: string) => {
    if (teacherId === null || activeRequests.current.has(versionId)) return;
    openTasks();
    setError("");
    if (jobs.some((job) => job.versionId === versionId && ["pending", "running"].includes(job.status))) return;
    activeRequests.current.add(versionId);
    setSubmitting((current) => [...current, versionId]);
    try {
      const job = await workflowApi.createExportJob(versionId);
      if (alive.current) setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : "创建导出任务失败");
    } finally {
      activeRequests.current.delete(versionId);
      if (alive.current) setSubmitting((current) => current.filter((id) => id !== versionId));
    }
  };
  const seen = async (id: string) => {
    try {
      await workflowApi.markExportJobSeen(id);
      if (alive.current) setJobs((current) => current.map((job) => job.id === id ? { ...job, seen: true } : job));
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "更新提醒失败"); }
  };
  const download = async (job: ExportJob) => {
    if (downloading) return;
    openTasks();
    setDownloading(job.id);
    setError("");
    try {
      const result = await workflowApi.downloadExportJob(job.id);
      if (!alive.current) return;
      saveDownload(result.blob, result.filename);
      await seen(job.id);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : "下载失败，请重试");
    } finally { if (alive.current) setDownloading(null); }
  };
  const running = jobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const unread = jobs.filter((job) => !job.seen && ["completed", "failed"].includes(job.status));
  const notice = unread[0];
  const labels = { pending: "排队中", running: "正在打包", completed: "已完成", failed: "失败", expired: "已过期" };
  return <ExportTasksContext.Provider value={{ jobs, submitting, start: (id) => void start(id), openTasks }}>
    {children}
    {teacherId !== null && visible && <div className="export-task-center">
      <button type="button" className="export-task-launcher" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="work-assistant-panel" aria-label={`工作助手，${running} 个任务进行中，${unread.length} 条未读通知`} title="工作助手">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M2 12v4m20-4v4M9 16h6" /><circle cx="9" cy="12" r=".8" /><circle cx="15" cy="12" r=".8" />
        </svg>
        {unread.length > 0 && <span className="assistant-unread" aria-hidden="true">{unread.length > 99 ? "99+" : unread.length}</span>}
        {running > 0 && <span className="assistant-running" aria-hidden="true" />}
      </button>
      {notice && !open && <section className="export-task-toast" role="status">
        <strong>{notice.status === "completed" ? "材料已打包" : "材料打包失败"}</strong>
        <p>{notice.flowName}</p>
        {notice.status === "failed" && <p>{notice.error}</p>}
        <div className="export-task-actions">
          {notice.status === "completed" ? <button type="button" disabled={!!downloading} onClick={() => void download(notice)}>{downloading === notice.id ? "正在下载…" : "下载 ZIP"}</button> : <button type="button" onClick={() => void start(notice.versionId)}>重试</button>}
          <button type="button" onClick={() => void seen(notice.id)}>知道了</button>
        </div>
      </section>}
      {open && <section id="work-assistant-panel" className="export-task-panel" aria-label="工作助手">
        <header><div><strong>工作助手</strong><small>通知与交互入口</small></div><button type="button" onClick={() => setOpen(false)} aria-label="收起工作助手">−</button></header>
        <nav className="assistant-tabs" aria-label="助手栏目">
          <button type="button" aria-pressed={tab === "notifications"} onClick={() => setTab("notifications")}>通知{unread.length > 0 ? ` · ${unread.length}` : ""}</button>
          <button type="button" aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>Chat</button>
          <button type="button" aria-pressed={tab === "companions"} onClick={() => setTab("companions")}>伙伴</button>
        </nav>
        {tab !== "notifications" ? <div className="assistant-placeholder">
          <strong>{tab === "chat" ? "Chat" : "伙伴"}</strong>
          <span>暂未开放</span>
          <p>{tab === "chat" ? "未来在这里与助手对话。" : "未来在这里与宠物和 Agent 互动。"}</p>
        </div> : <>
        <p className="export-task-help">退出流程后继续打包 · 文件保留 7 天</p>
        {error && <p role="alert" className="export-task-error">{error} <button type="button" onClick={() => void refresh().then(() => setError("")).catch(() => {})}>刷新</button></p>}
        {!jobs.length && <p className="export-task-help">暂无导出任务</p>}
        <div className="export-task-list">{jobs.map((job) => <article key={job.id}>
          <div className="export-task-heading"><strong>{job.flowName}</strong><span className={`export-task-state is-${job.status}`}>{labels[job.status]}</span></div>
          <small>{new Date(job.createdAt).toLocaleString("zh-CN")}</small>
          {job.status === "completed" && job.expiresAt && <small>有效至 {new Date(job.expiresAt).toLocaleString("zh-CN")}</small>}
          {job.error && <p className="export-task-error">{job.error}</p>}
          <div className="export-task-actions">
            {job.status === "completed" && <button type="button" disabled={!!downloading} onClick={() => void download(job)}>{downloading === job.id ? "正在下载…" : "下载 ZIP"}</button>}
            {["failed", "expired", "completed"].includes(job.status) && <button type="button" disabled={submitting.includes(job.versionId) || jobs.some((item) => item.versionId === job.versionId && ["pending", "running"].includes(item.status))} onClick={() => void start(job.versionId)}>{job.status === "failed" ? "重试" : "重新打包"}</button>}
            {!job.seen && ["completed", "failed"].includes(job.status) && <button type="button" onClick={() => void seen(job.id)}>标为已读</button>}
          </div>
        </article>)}</div>
        </>}
      </section>}
    </div>}
  </ExportTasksContext.Provider>;
}
