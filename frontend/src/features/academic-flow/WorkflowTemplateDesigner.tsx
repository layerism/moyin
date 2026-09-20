import { useEffect, useState } from "react";
import type { AcademicProcess } from "../../types";
import { AcademicFlowDesigner } from "./AcademicFlowDesigner";
import { ApiError, workflowApi } from "./api";
import { mapServerFlow } from "./flowMapping";

export function WorkflowTemplateDesigner({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const [process, setProcess] = useState<AcademicProcess | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setConflict(false);
    workflowApi.openWorkflowTemplateEditor(templateId).then((result) => {
      if (!cancelled) setProcess({ ...mapServerFlow(result.flow), name: result.name, description: result.description });
    }).catch((reason) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : "读取模板编辑草稿失败");
        setConflict(reason instanceof ApiError && reason.status === 409);
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [templateId, reload]);

  const save = async (candidate: AcademicProcess) => ({
    ...mapServerFlow(await workflowApi.saveDraft(candidate.serverId ?? candidate.id, candidate)),
    name: candidate.name, description: candidate.description,
  });
  if (loading) return <main className="auth-loading-page"><strong>正在载入模板编辑草稿…</strong></main>;
  if (!process) return <main className="auth-loading-page">
    <p role="alert">{error}</p>
    <button type="button" onClick={() => setReload((value) => value + 1)}>重新载入</button>
    {conflict ? <button type="button" onClick={async () => {
      if (!window.confirm("放弃此前暂存的模板编辑内容，并重新载入最新模板？")) return;
      try {
        await workflowApi.discardWorkflowTemplateDraft(templateId);
        setReload((value) => value + 1);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); }
    }}>放弃旧草稿并重新载入</button> : null}
    <button type="button" onClick={onBack}>返回模板列表</button>
  </main>;
  return <AcademicFlowDesigner templateMode process={process} onBack={onBack}
    onProcessChange={setProcess} onSaveProcess={save} onPublishProcess={async (candidate) => {
      const saved = await save(candidate);
      await workflowApi.updateWorkflowTemplateFromDraft(templateId, {
        sourceFlowId: saved.serverId ?? saved.id, name: candidate.name, description: candidate.description,
      });
      onBack();
      return saved;
    }} />;
}
