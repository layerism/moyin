export function DriveNavIcon({ kind }: { kind: "flow" | "template" | "cloud" }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    {kind === "flow" ? <>
      <rect x="8" y="3" width="8" height="5" rx="1" />
      <path d="M12 8v4M5 16v-4h14v4" />
      <rect x="2" y="16" width="6" height="5" rx="1" />
      <rect x="16" y="16" width="6" height="5" rx="1" />
    </> : kind === "template" ? <>
      <rect x="7" y="7" width="13" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2M11 12h5M11 16h5" />
    </> : <path d="M7 19a5 5 0 0 1-1-9.9 6.5 6.5 0 0 1 12.5-1.6A5.8 5.8 0 0 1 18 19Z" />}
  </svg>;
}
