/** Keep the final filename segment and extension visible when the row is narrow. */
export function MaterialFileName({ name }: { name: string }) {
  const dot = name.lastIndexOf(".");
  const tailStart = Math.max(0, (dot > 0 ? dot : name.length) - 8);
  return <strong className="material-filename" title={name} aria-label={name}>
    <span className="material-filename-start" aria-hidden="true">{name.slice(0, tailStart)}</span>
    <span className="material-filename-end" aria-hidden="true">{name.slice(tailStart)}</span>
  </strong>;
}
