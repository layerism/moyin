import { useCallback, useEffect, useState } from "react";

import {
  workflowApi,
  type MaterialLibrary,
  type MaterialLibraryFile,
} from "../academic-flow/api";
import type { AuthIdentity } from "../auth/authApi";
import { TeacherAccountMenu } from "../auth/TeacherAccountMenu";

type MaterialLibraryPath =
  | { level: "root" }
  | { level: "flow"; flowId: string }
  | { level: "node"; flowId: string; nodeKey: string }
  | { level: "student"; flowId: string; nodeKey: string; rosterEntryId: number };

const materialStatusLabels: Record<MaterialLibraryFile["submissionStatus"], string> = {
  reviewing: "审核中",
  approved: "已通过",
  rejected: "已驳回",
  audit_error: "审核异常",
};

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSubmittedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function nodeFileCount(node: MaterialLibrary["flows"][number]["nodes"][number]) {
  return node.students.reduce((total, student) => total + student.files.length, 0);
}

function flowFileCount(flow: MaterialLibrary["flows"][number]) {
  return flow.nodes.reduce((total, node) => total + nodeFileCount(node), 0);
}

function pathExists(library: MaterialLibrary, path: MaterialLibraryPath) {
  if (path.level === "root") return true;
  const flow = library.flows.find((item) => item.flowId === path.flowId);
  if (!flow) return false;
  if (path.level === "flow") return true;
  const node = flow.nodes.find((item) => item.nodeKey === path.nodeKey);
  if (!node) return false;
  if (path.level === "node") return true;
  return node.students.some((item) => item.rosterEntryId === path.rosterEntryId);
}

export function OssMaterialLibraryView({
  onAcademicFlow,
  onDatabaseAdmin,
  onTeacherLogout,
  teacherIdentity,
}: {
  onAcademicFlow: () => void;
  onDatabaseAdmin: () => void;
  onTeacherLogout: () => void;
  teacherIdentity: AuthIdentity;
}) {
  const [library, setLibrary] = useState<MaterialLibrary | null>(null);
  const [path, setPath] = useState<MaterialLibraryPath>({ level: "root" });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<{
    fileId: string;
    message: string;
  } | null>(null);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const nextLibrary = await workflowApi.getMaterialLibrary();
      setLibrary(nextLibrary);
      setPath((current) => pathExists(nextLibrary, current) ? current : { level: "root" });
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "学生材料读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    setQuery("");
    setDownloadError(null);
  }, [path]);

  const selectedFlow = path.level === "root"
    ? null
    : library?.flows.find((flow) => flow.flowId === path.flowId) ?? null;
  const selectedNode = path.level === "node" || path.level === "student"
    ? selectedFlow?.nodes.find((node) => node.nodeKey === path.nodeKey) ?? null
    : null;
  const selectedStudent = path.level === "student"
    ? selectedNode?.students.find((student) => student.rosterEntryId === path.rosterEntryId) ?? null
    : null;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const matches = (value: string) =>
    !normalizedQuery || value.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  const visibleFlows = (library?.flows ?? []).filter((flow) => matches(flow.name));
  const visibleNodes = (selectedFlow?.nodes ?? []).filter((node) => matches(node.title));
  const visibleStudents = (selectedNode?.students ?? []).filter((student) =>
    matches(`${student.studentNo}-${student.name}`),
  );
  const visibleFiles = (selectedStudent?.files ?? []).filter((file) =>
    matches(file.originalName),
  );

  const downloadFile = async (file: MaterialLibraryFile) => {
    setDownloadingFileId(file.fileId);
    setDownloadError(null);
    try {
      const result = await workflowApi.downloadMaterialLibraryFile(file.fileId);
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = result.originalName;
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (reason) {
      setDownloadError({
        fileId: file.fileId,
        message: reason instanceof Error ? reason.message : "文件下载失败",
      });
    } finally {
      setDownloadingFileId(null);
    }
  };

  const hasVisibleEntries = path.level === "root"
    ? visibleFlows.length > 0
    : path.level === "flow"
      ? visibleNodes.length > 0
      : path.level === "node"
        ? visibleStudents.length > 0
        : visibleFiles.length > 0;
  const emptyMessage = normalizedQuery
    ? "当前目录没有匹配项"
    : path.level === "root"
      ? "暂无已发布流程"
      : path.level === "flow"
        ? "该流程暂无学生提交文件"
        : path.level === "node"
          ? "该节点暂无学生提交文件"
          : "该学生暂无有效提交文件";

  return (
    <main className="home-page">
      <aside className="drive-sidebar">
        <div className="drive-logo">
          <span className="logo-mark">T</span>
          <strong>材料收集</strong>
        </div>
        <nav className="drive-nav" aria-label="主导航">
          <button onClick={onAcademicFlow}>教务流程</button>
          <button className="selected">▾ OSS 云盘</button>
        </nav>
      </aside>

      <section className="drive-main">
        <header className="drive-topbar">
          <label className="drive-search">
            <span>⌕</span>
            <input
              disabled={!library}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索当前目录"
              value={query}
            />
          </label>
          <TeacherAccountMenu
            identity={teacherIdentity}
            onDatabaseAdmin={onDatabaseAdmin}
            onLogout={onTeacherLogout}
          />
        </header>

        <section className="drive-panel" aria-label="OSS 学生材料库">
          <div className="drive-breadcrumb">
            {path.level === "root" ? (
              <strong>OSS 云盘</strong>
            ) : (
              <button className="breadcrumb-button" onClick={() => setPath({ level: "root" })}>
                OSS 云盘
              </button>
            )}
            {selectedFlow ? <span>›</span> : null}
            {selectedFlow && path.level === "flow" ? (
              <strong>{selectedFlow.name}</strong>
            ) : selectedFlow ? (
              <button
                className="breadcrumb-button"
                onClick={() => setPath({ level: "flow", flowId: selectedFlow.flowId })}
              >
                {selectedFlow.name}
              </button>
            ) : null}
            {selectedNode ? <span>›</span> : null}
            {selectedNode && path.level === "node" ? (
              <strong>{selectedNode.title}</strong>
            ) : selectedNode && selectedFlow ? (
              <button
                className="breadcrumb-button"
                onClick={() => setPath({
                  level: "node",
                  flowId: selectedFlow.flowId,
                  nodeKey: selectedNode.nodeKey,
                })}
              >
                {selectedNode.title}
              </button>
            ) : null}
            {selectedStudent ? <span>›</span> : null}
            {selectedStudent ? (
              <strong>{selectedStudent.studentNo}－{selectedStudent.name}</strong>
            ) : null}
          </div>

          {loadError ? (
            <div className="material-library-load-error" role="alert">
              <span>{loadError}</span>
              <button onClick={() => void loadLibrary()}>重新加载</button>
            </div>
          ) : null}
          {loading && !library ? (
            <div className="material-library-state">正在读取学生材料…</div>
          ) : library ? (
            <div className="material-library-table" role="table" aria-label="材料目录">
              <div className="material-library-row material-library-head" role="row">
                <span>名称</span>
                <span>类型 / 状态</span>
                <span>内容</span>
                <span>提交时间</span>
                <span>操作</span>
              </div>

              {path.level === "root" && visibleFlows.map((flow) => (
                <div className="material-library-row" key={flow.flowId} role="row">
                  <button
                    className="material-library-name"
                    onClick={() => setPath({ level: "flow", flowId: flow.flowId })}
                  >
                    <span className="material-library-icon is-folder">夹</span>
                    <span>{flow.name}</span>
                  </button>
                  <span>流程</span>
                  <span>{flow.nodes.length} 个节点 · {flowFileCount(flow)} 个文件</span>
                  <span>—</span>
                  <button
                    className="link-button"
                    onClick={() => setPath({ level: "flow", flowId: flow.flowId })}
                  >
                    打开
                  </button>
                </div>
              ))}

              {path.level === "flow" && selectedFlow && visibleNodes.map((node) => (
                <div className="material-library-row" key={node.nodeKey} role="row">
                  <button
                    className="material-library-name"
                    onClick={() => setPath({
                      level: "node",
                      flowId: selectedFlow.flowId,
                      nodeKey: node.nodeKey,
                    })}
                  >
                    <span className="material-library-icon is-folder">夹</span>
                    <span>{node.title}</span>
                  </button>
                  <span>节点</span>
                  <span>{node.students.length} 名学生 · {nodeFileCount(node)} 个文件</span>
                  <span>—</span>
                  <button
                    className="link-button"
                    onClick={() => setPath({
                      level: "node",
                      flowId: selectedFlow.flowId,
                      nodeKey: node.nodeKey,
                    })}
                  >
                    打开
                  </button>
                </div>
              ))}

              {path.level === "node" && selectedFlow && selectedNode
                ? visibleStudents.map((student) => (
                    <div className="material-library-row" key={student.rosterEntryId} role="row">
                      <button
                        className="material-library-name"
                        onClick={() => setPath({
                          level: "student",
                          flowId: selectedFlow.flowId,
                          nodeKey: selectedNode.nodeKey,
                          rosterEntryId: student.rosterEntryId,
                        })}
                      >
                        <span className="material-library-icon is-folder">夹</span>
                        <span>{student.studentNo}－{student.name}</span>
                      </button>
                      <span>学生</span>
                      <span>{student.files.length} 个文件</span>
                      <span>—</span>
                      <button
                        className="link-button"
                        onClick={() => setPath({
                          level: "student",
                          flowId: selectedFlow.flowId,
                          nodeKey: selectedNode.nodeKey,
                          rosterEntryId: student.rosterEntryId,
                        })}
                      >
                        打开
                      </button>
                    </div>
                  ))
                : null}

              {path.level === "student" && selectedStudent
                ? visibleFiles.map((file) => (
                    <div className="material-library-row" key={file.fileId} role="row">
                      <div className="material-library-file-name">
                        <span className="material-library-icon is-file">文</span>
                        <span>{file.originalName}</span>
                        {downloadError?.fileId === file.fileId ? (
                          <small className="material-library-inline-error" role="alert">
                            {downloadError.message}
                          </small>
                        ) : null}
                      </div>
                      <span className={`material-library-status is-${file.submissionStatus}`}>
                        {materialStatusLabels[file.submissionStatus]}
                      </span>
                      <span>{formatFileSize(file.sizeBytes)}</span>
                      <span>{formatSubmittedAt(file.submittedAt)}</span>
                      <button
                        className="link-button"
                        disabled={downloadingFileId === file.fileId}
                        onClick={() => void downloadFile(file)}
                      >
                        {downloadingFileId === file.fileId ? "下载中" : "下载"}
                      </button>
                    </div>
                  ))
                : null}

              {!hasVisibleEntries ? (
                <div className="material-library-state">{emptyMessage}</div>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
