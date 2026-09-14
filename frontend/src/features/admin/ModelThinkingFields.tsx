import { useEffect, useState } from "react";
import { modelCardsApi, type ModelThinking, type ModelVendor, type ThinkingProfile } from "./modelCardsApi";

export function thinkingLabel(value: ModelThinking, profile: ThinkingProfile): string {
  const mode = profile.modeLabels[value.mode];
  if (value.mode !== "on") return mode;
  if (profile.budgetSupported) return `${mode} · ${value.budget !== null ? `${value.budget} Token` : profile.defaultEffortLabel}`;
  if (!profile.efforts.length) return mode;
  return `${mode} · ${value.effort === "default" ? profile.defaultEffortLabel : profile.effortLabels[value.effort] ?? value.effort}`;
}
export function ModelThinkingFields({ vendor, model, value, disabled, onChange }: {
  vendor: ModelVendor; model: string; value: ModelThinking; disabled: boolean; onChange: (value: ModelThinking) => void;
}) {
  const [profile, setProfile] = useState<ThinkingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      modelCardsApi.thinkingProfile(vendor, model).then((next) => { if (active) { setProfile(next); setLoading(false); } }).catch(() => { if (active) { setError("读取模型能力失败，请重新输入型号后重试。"); setLoading(false); } });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [vendor, model]);
  return <section className="model-thinking-settings">
    <h3>思考设置</h3>
    {!profile && !error ? <p>正在匹配模型能力…</p> : null}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    {profile ? <>
      <p>{loading ? "正在匹配模型能力…" : profile.note}</p>
      <div className="model-thinking-fields">
        <label className="audit-script-config-field">思考模式<select disabled={disabled || loading || Boolean(error) || profile.modes.length === 1} value={value.mode} onChange={(event) => onChange({ mode: event.target.value as ModelThinking["mode"], effort: "default", budget: null })}>{profile.modes.map((mode) => <option key={mode} value={mode}>{profile.modeLabels[mode]}</option>)}</select></label>
        {value.mode === "on" && profile.efforts.length > 0 ? <label className="audit-script-config-field">思考档位<select disabled={disabled || loading || Boolean(error)} value={value.effort} onChange={(event) => onChange({ ...value, effort: event.target.value })}><option value="default">{profile.defaultEffortLabel}</option>{profile.efforts.map((effort) => <option key={effort} value={effort}>{profile.effortLabels[effort] ?? effort}</option>)}</select></label> : null}
        {value.mode === "on" && profile.budgetSupported ? <label className="audit-script-config-field">思考预算（Token）<input disabled={disabled || loading || Boolean(error)} type="number" min={1} max={32768} step={1} placeholder="模型默认预算" value={value.budget ?? ""} onChange={(event) => onChange({ ...value, budget: event.target.value === "" ? null : Number(event.target.value) })} /></label> : null}
      </div>
    </> : null}
  </section>;
}
