import { strFromU8, unzipSync } from "fflate";

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
type Styles = Record<string, string>;
type DocxNode = { type: string; children?: DocxNode[]; cssStyle?: Styles };
type DocxStyle = { id: string | null; target: string | null; styles: { target: string; values: Styles }[] };
type ParsedDocx = {
  documentPart: { path: string; body: DocxNode };
  stylesPart?: { path: string; styles: DocxStyle[] };
  settingsPart?: { path: string };
};
const child = (element: Element | null | undefined, name: string) =>
  Array.from(element?.children ?? []).find((entry) => entry.namespaceURI === wordNamespace && entry.localName === name);
const attribute = (element: Element | null | undefined, name: string) => element?.getAttributeNS(wordNamespace, name);
const enabled = (element: Element | null | undefined) => Boolean(element && !["0", "false", "off"].includes(attribute(element, "val") ?? "true"));
const number = (element: Element | null | undefined, name: string) => {
  const value = attribute(element, name);
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
};

function supplementFont(properties: Element | undefined, values: Styles) {
  const font = attribute(child(properties, "rFonts"), "hAnsi");
  if (font) values["font-family"] = [values["font-family"], CSS.escape(font)].filter(Boolean).join(", ");
}

function supplementParagraph(properties: Element | undefined, values: Styles) {
  const snap = child(properties, "snapToGrid");
  if (snap) values["--docx-snap-to-grid"] = enabled(snap) ? "1" : "0";
  const spacing = child(properties, "spacing");
  const line = number(spacing, "line");
  if (line !== null && line > 0) {
    const declaredRule = attribute(spacing, "lineRule");
    const rule = declaredRule === "exact" || declaredRule === "atLeast" ? declaredRule : "auto";
    values["--docx-line-rule"] = rule;
    values["line-height"] = rule === "auto" ? String(line / 240)
      : rule === "atLeast" ? `max(1em, ${line / 20}pt)` : `${line / 20}pt`;
    values["min-height"] = rule === "exact" ? `${line / 20}pt` : "1em";
  }
  for (const side of ["before", "after"]) {
    const lines = number(spacing, `${side}Lines`);
    if (lines !== null && !["1", "true", "on"].includes(attribute(spacing, `${side}AutoSpacing`) ?? "0")) {
      values[`--docx-${side}-lines`] = String(lines / 100);
    }
  }
}

function descendants(node: DocxNode, type: string): DocxNode[] {
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap((entry) => descendants(entry, type))];
}

// Supplement XML fields omitted by the pinned renderer without replacing its style inheritance.
export function supplementDocxLayout(data: ArrayBuffer, parsed: ParsedDocx) {
  const paths = new Set([parsed.documentPart.path, parsed.stylesPart?.path, parsed.settingsPart?.path]);
  const archive = unzipSync(new Uint8Array(data), { filter: (entry) => paths.has(entry.name) });
  const xml = (path: string | undefined) => path && archive[path]
    ? new DOMParser().parseFromString(strFromU8(archive[path]), "application/xml") : null;
  const documentXml = xml(parsed.documentPart.path);
  const stylesXml = xml(parsed.stylesPart?.path);
  for (const source of Array.from(stylesXml?.documentElement.children ?? [])) {
    const defaults = source.localName === "docDefaults";
    const style = parsed.stylesPart?.styles.find((entry) => entry.id === (defaults ? null : attribute(source, "styleId")));
    if (!style) continue;
    const paragraph = defaults ? child(child(source, "pPrDefault"), "pPr") : child(source, "pPr");
    const run = defaults ? child(child(source, "rPrDefault"), "rPr") : child(source, "rPr");
    const runValues = style.styles.find((entry) => entry.target === "span")?.values;
    if (runValues) supplementFont(run, runValues);
    if (defaults || style.target === "p") {
      let paragraphStyle = style.styles.find((entry) => entry.target === "p");
      if (!paragraphStyle) { paragraphStyle = { target: "p", values: {} }; style.styles.push(paragraphStyle); }
      supplementParagraph(paragraph, paragraphStyle.values);
      for (const property of ["font-family", "font-size"]) {
        const value = runValues?.[property];
        if (value && !paragraphStyle.values[property]) paragraphStyle.values[property] = value;
      }
    }
  }
  const bodyXml = documentXml?.getElementsByTagNameNS(wordNamespace, "body")[0];
  const xmlParagraphs = Array.from(bodyXml?.getElementsByTagNameNS(wordNamespace, "p") ?? []);
  const paragraphs = descendants(parsed.documentPart.body, "paragraph");
  if (xmlParagraphs.length === paragraphs.length) {
    xmlParagraphs.forEach((source, index) => supplementParagraph(child(source, "pPr"), paragraphs[index].cssStyle ??= {}));
    const settings = xml(parsed.settingsPart?.path);
    const tableGrid = enabled(settings?.getElementsByTagNameNS(wordNamespace, "adjustLineHeightInTable")[0]);
    const grid = (start: number, end: number, section: Element | undefined) => {
      const properties = child(section, "docGrid");
      const pitch = number(properties, "linePitch") ?? 0;
      const type = attribute(properties, "type");
      for (let index = start; index < end; index++) {
        const values = paragraphs[index].cssStyle ??= {};
        values["--docx-line-grid"] = String(["lines", "linesAndChars"].includes(type ?? "") ? pitch / 15 : 0);
        values["--docx-table-grid"] = tableGrid ? "1" : "0";
      }
    };
    let start = 0;
    xmlParagraphs.forEach((paragraph, index) => {
      const section = child(child(paragraph, "pPr"), "sectPr");
      if (section) { grid(start, index + 1, section); start = index + 1; }
    });
    grid(start, paragraphs.length, child(bodyXml, "sectPr"));
  }
  const xmlRuns = Array.from(bodyXml?.getElementsByTagNameNS(wordNamespace, "r") ?? []);
  const runs = descendants(parsed.documentPart.body, "run");
  if (xmlRuns.length === runs.length) {
    xmlRuns.forEach((source, index) => supplementFont(child(source, "rPr"), runs[index].cssStyle ??= {}));
  }
}

export function applyDocxLineSpacing(body: HTMLElement) {
  for (const paragraph of Array.from(body.querySelectorAll<HTMLElement>("section.docx > article p"))) {
    const style = getComputedStyle(paragraph);
    let height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const pitch = parseFloat(style.getPropertyValue("--docx-line-grid"));
    const inTable = Boolean(paragraph.closest("td, th"));
    if (pitch > 0 && style.getPropertyValue("--docx-line-rule").trim() !== "exact"
      && style.getPropertyValue("--docx-snap-to-grid").trim() !== "0"
      && (!inTable || style.getPropertyValue("--docx-table-grid").trim() === "1")) {
      height = Math.ceil(height / pitch) * pitch;
      paragraph.style.lineHeight = `${height}px`;
    }
    for (const [side, property] of [["before", "marginTop"], ["after", "marginBottom"]] as const) {
      const lines = style.getPropertyValue(`--docx-${side}-lines`).trim();
      if (lines) paragraph.style[property] = `${Number(lines) * height}px`;
    }
  }
}
