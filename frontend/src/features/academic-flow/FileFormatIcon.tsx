/** Compact file-type artwork shared by template and reference rows. */
export function FileFormatIcon({ filename }: { filename: string }) {
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const kind = extension === "docx" ? "word" : extension === "pdf" ? "pdf"
    : extension === "xlsx" ? "excel" : extension === "pptx" ? "slides"
    : ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "svg"].includes(extension) ? "image"
    : ["zip", "rar", "7z", "gz", "tar"].includes(extension) ? "archive" : "file";
  const colors = { word: "#185abd", pdf: "#d92d20", excel: "#16834a", slides: "#d35230", image: "#8250c4", archive: "#b77912", file: "#64748b" };
  const label = { word: "W", pdf: "PDF", excel: "X", slides: "P", image: "", archive: "", file: "" }[kind];
  return <span className="node-template-file-icon file-format-icon" title={extension.toUpperCase() || "文件"} aria-hidden="true">
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" focusable="false">
      <path d="M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" fill={colors[kind]} fillOpacity=".12" />
      <path d="M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke={colors[kind]} strokeWidth="1.2" />
      <path d="M15 2v5h5" stroke={colors[kind]} strokeWidth="1.2" strokeLinejoin="round" />
      {label ? <>
        <path d="M9 10h7M9 13h7M9 16h7M9 19h7" stroke={colors[kind]} strokeOpacity=".35" strokeWidth="1.2" />
        <rect x="1" y="9" width={kind === "pdf" ? 20 : 13} height="12" rx="2" fill={colors[kind]} />
        <text x={kind === "pdf" ? 11 : 7.5} y="17.8" textAnchor="middle" fill="white" fontFamily="Arial, sans-serif" fontSize={kind === "pdf" ? 7 : 9} fontWeight="700">{label}</text>
      </> : kind === "image" ? <>
        <circle cx="10" cy="11" r="1.5" fill={colors[kind]} />
        <path d="m7 19 4-5 2 2 3-4 2 7Z" fill={colors[kind]} />
      </> : kind === "archive" ? <>
        <path d="M11 4h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2z" fill={colors[kind]} />
        <rect x="11" y="15" width="4" height="5" rx="1" stroke={colors[kind]} strokeWidth="1.5" />
      </> : <path d="M8 11h9M8 15h9M8 19h6" stroke={colors[kind]} strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  </span>;
}
