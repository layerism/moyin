const paths = {
  chevron: "m9 5 7 7-7 7",
  folder: "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
  folderPlus: "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z M12 10v7m-3-3.5h6",
  plus: "M12 5v14M5 12h14",
  edit: "m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-3-3L6 16l-2 4Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  open: "M5 12h14m-6-6 6 6-6 6",
  template: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h5",
  copy: "M8 8h13v13H8V8ZM16 8V3H3v13h5",
  flow: "M8 3h8v5H8V3Zm0 13h8v5H8v-5Zm4-8v8M3 12h18",
};

export function WorkflowIcon({ name }: { name: keyof typeof paths | "grip" }) {
  return (
    <svg aria-hidden="true" className="workflow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {name === "grip"
        ? [5, 12, 19].flatMap((cy) => [8, 16].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill="currentColor" stroke="none" />))
        : <path d={paths[name]} />}
    </svg>
  );
}
