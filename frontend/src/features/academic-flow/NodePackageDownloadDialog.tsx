import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type NodePackageOptions,
  type NodePackageStudentStatus,
  workflowApi,
} from "./api";
import { saveDownload } from "./download";

const statusLabels: Record<NodePackageStudentStatus, string> = {
  unsubmitted: "未提交",
  reviewing: "审核中",
  approved: "已通过",
  rejected: "未通过",
  audit_error: "审核异常",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function NodePackageDownloadDialog({
  nodeKey,
  onClose,
  versionId,
}: {
  nodeKey: string;
  onClose: () => void;
  versionId: string;
}) {
  const [options, setOptions] = useState<NodePackageOptions | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [includeWorkbook, setIncludeWorkbook] = useState(true);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodePackageStudentStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await workflowApi.getTeacherNodePackageOptions(versionId, nodeKey);
      setOptions(next);
      setSelectedIds(new Set(next.students.map((student) => student.rosterEntryId)));
      setIncludeFiles(next.supportsFiles && next.students.some((student) => student.fileCount > 0));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "下载范围加载失败");
    } finally {
      setLoading(false);
    }
  }, [nodeKey, versionId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !downloading) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [downloading, onClose]);

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return (options?.students ?? []).filter((student) => {
      const matchesQuery = !normalizedQuery
        || student.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
        || student.studentNo.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      return matchesQuery && (status === "all" || student.status === status);
    });
  }, [options, query, status]);

  const selectedStudents = useMemo(
    () => (options?.students ?? []).filter((student) => selectedIds.has(student.rosterEntryId)),
    [options, selectedIds],
  );
  const selectedFileCount = selectedStudents.reduce(
    (total, student) => total + student.fileCount,
    0,
  );
  const selectedFileBytes = selectedStudents.reduce(
    (total, student) => total + student.fileSizeBytes,
    0,
  );
  const selectedFileStudentCount = selectedStudents.filter(
    (student) => student.fileCount > 0,
  ).length;
  const fileOptionAvailable = Boolean(
    options?.supportsFiles && options.students.some((student) => student.fileCount > 0),
  );
  const allFilteredSelected = filteredStudents.length > 0
    && filteredStudents.every((student) => selectedIds.has(student.rosterEntryId));
  const canDownload = selectedStudents.length > 0
    && (includeWorkbook || (includeFiles && selectedFileCount > 0));
  const downloadLabel = includeWorkbook && includeFiles
    ? "下载资料包"
    : includeWorkbook
      ? "下载 Excel"
      : "下载文件";

  const toggleFilteredStudents = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      filteredStudents.forEach((student) => {
        if (allFilteredSelected) next.delete(student.rosterEntryId);
        else next.add(student.rosterEntryId);
      });
      return next;
    });
  };

  const download = async () => {
    if (!options || !canDownload || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const allStudentsSelected = selectedIds.size === options.students.length;
      const result = await workflowApi.downloadTeacherNodePackage(versionId, nodeKey, {
        includeFiles,
        includeWorkbook,
        rosterEntryIds: allStudentsSelected ? [] : [...selectedIds],
        studentScope: allStudentsSelected ? "all" : "selected",
      });
      saveDownload(result.blob, result.filename);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "节点资料下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="node-package-dialog-backdrop"
      onMouseDown={() => {
        if (!downloading) onClose();
      }}
    >
      <section
        aria-labelledby="node-package-dialog-title"
        aria-modal="true"
        className="node-package-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>节点资料下载</span>
            <h2 id="node-package-dialog-title">{options?.nodeTitle ?? "加载中…"}</h2>
            <p>{options ? `${options.flowName} · 当前发布版本` : "正在读取下载范围"}</p>
          </div>
          <button aria-label="关闭下载弹窗" disabled={downloading} onClick={onClose} type="button">×</button>
        </header>

        <div className="node-package-dialog-body">
          {error ? <p className="node-package-dialog-error" role="alert">{error}</p> : null}
          {loading ? (
            <div className="node-package-dialog-loading" role="status">正在读取学生与文件信息…</div>
          ) : options ? (
            <>
              <section className="node-package-content-section">
                <h3>下载内容</h3>
                <label className={includeWorkbook ? "is-selected" : ""}>
                  <input
                    checked={includeWorkbook}
                    disabled={downloading}
                    onChange={(event) => setIncludeWorkbook(event.target.checked)}
                    type="checkbox"
                  />
                  <span><strong>填写数据 Excel</strong><small>每名所选学生一行，包含提交状态、填写内容和审核结果</small></span>
                </label>
                <label className={includeFiles ? "is-selected" : ""}>
                  <input
                    checked={includeFiles}
                    disabled={downloading || !fileOptionAvailable}
                    onChange={(event) => setIncludeFiles(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>学生提交文件</strong>
                    <small>{fileOptionAvailable ? "仅包含当前有效提交中的原始文件" : "当前节点暂无学生文件"}</small>
                  </span>
                </label>
              </section>

              <section className="node-package-student-section">
                <div className="node-package-section-heading">
                  <h3>选择学生</h3>
                  <span>共 {options.students.length} 人</span>
                </div>
                <div className="node-package-filter-row">
                  <input
                    aria-label="搜索学生"
                    disabled={downloading}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索姓名或学号"
                    type="search"
                    value={query}
                  />
                  <select
                    aria-label="筛选提交状态"
                    disabled={downloading}
                    onChange={(event) => setStatus(event.target.value as NodePackageStudentStatus | "all")}
                    value={status}
                  >
                    <option value="all">全部状态</option>
                    <option value="unsubmitted">未提交</option>
                    <option value="reviewing">审核中</option>
                    <option value="approved">已通过</option>
                    <option value="rejected">未通过</option>
                    <option value="audit_error">审核异常</option>
                  </select>
                </div>
                <div className="node-package-select-summary">
                  <label>
                    <input
                      checked={allFilteredSelected}
                      disabled={downloading || filteredStudents.length === 0}
                      onChange={toggleFilteredStudents}
                      type="checkbox"
                    />
                    全选当前筛选结果
                  </label>
                  <span>显示 {filteredStudents.length} 人 · 已选 {selectedStudents.length} 人</span>
                </div>
                <div className="node-package-student-list">
                  {filteredStudents.map((student) => (
                    <label key={student.rosterEntryId}>
                      <input
                        checked={selectedIds.has(student.rosterEntryId)}
                        disabled={downloading}
                        onChange={() => setSelectedIds((current) => {
                          const next = new Set(current);
                          if (next.has(student.rosterEntryId)) next.delete(student.rosterEntryId);
                          else next.add(student.rosterEntryId);
                          return next;
                        })}
                        type="checkbox"
                      />
                      <span className="node-package-student-identity">
                        <strong>{student.name}</strong><small>{student.studentNo}</small>
                      </span>
                      <span className={`node-package-status is-${student.status}`}>{statusLabels[student.status]}</span>
                      <span className="node-package-file-count">{student.fileCount} 个文件</span>
                    </label>
                  ))}
                  {filteredStudents.length === 0 ? <p>没有符合条件的学生</p> : null}
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer>
          <div>
            <strong>已选 {selectedStudents.length} 名学生</strong>
            <span>
              {selectedFileStudentCount} 人有文件 · {selectedFileCount} 个文件
              {selectedFileBytes > 0 ? ` · ${formatBytes(selectedFileBytes)}` : ""}
            </span>
          </div>
          <div className="node-package-dialog-actions">
            <button disabled={downloading} onClick={onClose} type="button">取消</button>
            <button
              className="primary-action"
              disabled={!options || !canDownload || downloading}
              onClick={() => void download()}
              type="button"
            >
              {downloading ? "正在生成…" : `${downloadLabel}（${selectedStudents.length}人）`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
