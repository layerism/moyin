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
    setOpen(true);
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
    setOpen(true);
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
  return <ExportTasksContext.Provider value={{ jobs, submitting, start: (id) => void start(id), openTasks: () => setOpen(true) }}>
    {children}
    {teacherId !== null && visible && <div className="export-task-center">
      <button type="button" className="export-task-launcher" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span aria-hidden="true">↓</span> 导出任务 {running ? `· ${running} 进行中` : unread.length ? `· ${unread.length} 条提醒` : ""}
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
      {open && <section className="export-task-panel" aria-label="导出任务">
        <header><strong>导出任务</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭导出任务">×</button></header>
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
      </section>}
    </div>}
  </ExportTasksContext.Provider>;
}
