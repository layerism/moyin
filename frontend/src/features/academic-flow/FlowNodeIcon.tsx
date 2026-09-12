import type { AcademicFlowNodeKind } from "../../types";

export function FlowNodeIcon({ kind }: { kind: AcademicFlowNodeKind }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "file" ? <><path d="M12 16V3m-4 4 4-4 4 4M4 15v5h16v-5" /></> :
      kind === "manual_review" ? <><circle cx="9" cy="7" r="3" /><path d="M3 20v-3a6 6 0 0 1 10-4m2 4 2 2 4-5" /></> :
      kind === "confirmation" ? <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m7 12 3 3 7-7" /></> :
      kind === "announcement" ? <><path d="m4 9 15-5v16L4 15ZM4 9v6m4 1 1 5h4l-2-4" /></> :
      kind === "answer_sheet" ? <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m7 8 1 1 2-2m-3 7 1 1 2-2m3-5h4m-4 6h4" /></> :
      <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>}
  </svg>;
}
