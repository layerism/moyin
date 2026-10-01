export function MaterialActionIcon({ action }: { action: "preview" | "replace" | "remove" }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    {action === "preview" ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
      : action === "replace" ? <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
        : <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />}
  </svg>;
}
