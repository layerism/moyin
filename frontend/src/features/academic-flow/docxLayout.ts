import { strFromU8, unzipSync } from "fflate";

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
type Styles = Record<string, string>;
type DocxNode = {
  type: string; children?: DocxNode[]; cssStyle?: Styles;
  cssStyleText?: string; tagName?: string; attrs?: Record<string, string>;
};
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
  // Match docx-preview's chosen branch; counting both DrawingML and its VML
  // fallback duplicates textbox paragraphs and prevents positional XML mapping.
  for (const alternate of Array.from(documentXml?.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/markup-compatibility/2006", "AlternateContent") ?? [])) {
    const fallback = Array.from(alternate.children).find((entry) => entry.localName === "Fallback");
    alternate.replaceWith(...(fallback?.firstElementChild ? [fallback.firstElementChild] : []));
  }
  const stylesXml = xml(parsed.stylesPart?.path);
  for (const source of Array.from(stylesXml?.documentElement.children ?? [])) {
    const defaults = source.localName === "docDefaults";
    const style = parsed.stylesPart?.styles.find((entry) => entry.id === (defaults ? null : attribute(source, "styleId")));
    if (!style) continue;
    const paragraph = defaults ? child(child(source, "pPrDefault"), "pPr") : child(source, "pPr");
    const runValues = style.styles.find((entry) => entry.target === "span")?.values;
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
  supplementTables(bodyXml, parsed.documentPart.body);
  supplementTextBoxes(bodyXml, parsed.documentPart.body);
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
}

function supplementTables(source: Element | undefined, body: DocxNode) {
  const xmlTables = Array.from(source?.getElementsByTagNameNS(wordNamespace, "tbl") ?? []);
  const tables = descendants(body, "table");
  if (xmlTables.length !== tables.length) return;
  xmlTables.forEach((table, index) => {
    const properties = child(table, "tblPr");
    if (attribute(child(properties, "tblLayout"), "type") !== "fixed") return;
    const width = child(properties, "tblW");
    // HTML ignores fixed table layout when width is auto. Word still uses its grid.
    if (width && attribute(width, "type") !== "auto" && (number(width, "w") ?? 0) > 0) return;
    const columns = Array.from(child(table, "tblGrid")?.children ?? []);
    const widths = columns.map((column) => number(column, "w") ?? 0);
    if (!widths.length || widths.some((value) => value <= 0)) return;
    const style = tables[index].cssStyle ??= {};
    style.width = `${widths.reduce((sum, value) => sum + value, 0) / 20}pt`;
    style["table-layout"] = "fixed";
  });
}

function supplementTextBoxes(source: Element | undefined, body: DocxNode) {
  const vmlNamespace = "urn:schemas-microsoft-com:vml";
  const shapes = Array.from(source?.getElementsByTagNameNS(vmlNamespace, "shape") ?? [])
    .filter((shape) => shape.getAttribute("type") === "#_x0000_t202");
  const visit = (node: DocxNode, cell?: DocxNode) => {
    if (node.type === "cell") cell = node;
    if (node.tagName === "g" && node.cssStyleText) {
      const shape = shapes.find((entry) => entry.getAttribute("style") === node.cssStyleText);
      const box = node.children?.find((entry) => entry.tagName === "foreignObject");
      if (shape && box) {
        const style = document.createElement("span").style;
        style.cssText = node.cssStyleText;
        // VML's text-relative positioning is relative to the enclosing cell here,
        // not the page. Keep page/margin-relative shapes on the renderer's path.
        const textRelative = /mso-position-horizontal-relative\s*:\s*text(?:;|$)/i.test(node.cssStyleText)
          && /mso-position-vertical-relative\s*:\s*text(?:;|$)/i.test(node.cssStyleText);
        if (cell && textRelative && style.position === "absolute") {
          (cell.cssStyle ??= {}).position = "relative";
        }
        // The renderer converts a VML shape into an empty SVG group and omits
        // the default rectangle. Restore geometry without changing text runs.
        const stroked = !["f", "false", "0"].includes(shape.getAttribute("stroked") ?? "true");
        const filled = !["f", "false", "0"].includes(shape.getAttribute("filled") ?? "true");
        node.children!.unshift({ type: node.type, tagName: "rect", attrs: {
          x: "0", y: "0", width: "100%", height: "100%",
          fill: filled ? shape.getAttribute("fillcolor") ?? "white" : "none",
          stroke: stroked ? shape.getAttribute("strokecolor") ?? "black" : "none",
          "stroke-width": shape.getAttribute("strokeweight") ?? "1pt",
        } });
        const textbox = Array.from(shape.children).find((entry) => entry.localName === "textbox");
        const toPixels = (value: string): number | null => {
          const match = value.trim().match(/^(-?[\d.]+)(pt|in|cm|mm|px)?$/);
          if (!match) return null;
          const scale: Record<string, number> = { pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, px: 1 };
          const result = Number(match[1]) * scale[match[2] ?? "px"];
          return Number.isFinite(result) ? result : null;
        };
        const inset = (textbox?.getAttribute("inset") ?? "7.2pt,3.6pt,7.2pt,3.6pt").split(",").map(toPixels);
        const width = toPixels(style.width);
        const height = toPixels(style.height);
        if (inset.length === 4 && inset.every((value) => value !== null) && width !== null && height !== null) {
          const [left, top, right, bottom] = inset as number[];
          Object.assign(box.attrs ??= {}, { x: String(left), y: String(top),
            width: String(Math.max(0, width - left - right)), height: String(Math.max(0, height - top - bottom)) });
        }
        // Keep declared dimensions even when the renderer measures the SVG bbox.
        node.cssStyleText += ";overflow:visible";
      }
    }
    for (const entry of node.children ?? []) visit(entry, cell);
  };
  visit(body);
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
