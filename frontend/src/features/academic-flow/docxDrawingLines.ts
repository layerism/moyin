import type { DocxXmlContext } from "./docxLayout";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const v = "urn:schemas-microsoft-com:vml";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const property = "--docx-drawing-lines";
type Node = { type: string; children?: Node[]; cssStyle?: Record<string, string> };
type Part = { path: string; _xmlDocument?: Document; body?: Node; rootElement?: Node; notes?: Node[] };
type Line = { x: number; y: number; width: number; height: number; stroke: number; color: string; flipX: boolean; flipY: boolean; behind: boolean };
const descendants = (node: Node, type: string): Node[] => [
  ...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap(child => descendants(child, type)),
];
const first = (element: Element, namespace: string, name: string) => element.getElementsByTagNameNS(namespace, name)[0];
const inTable = (element: Element): boolean => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.namespaceURI === w && parent.localName === "tc") return true;
  }
  return false;
};
const emu = (value: string | null | undefined) => value?.trim() ? Number(value) / 9525 : NaN;

// Read the DrawingML definition paired with the renderer's VML fallback.
// Only explicit, solid, unrotated column/paragraph anchored lines are handled.
function readLine(alternate: Element): Line | null {
  const choice = Array.from(alternate.children).find(child => child.localName === "Choice");
  if (!choice) return null;
  const anchor = first(choice, wp, "anchor");
  if (!anchor || anchor.getAttribute("simplePos") === "1") return null;
  const geometry = first(anchor, a, "prstGeom");
  const horizontal = first(anchor, wp, "positionH");
  const vertical = first(anchor, wp, "positionV");
  const extent = first(anchor, wp, "extent");
  const stroke = first(anchor, a, "ln");
  const transform = first(anchor, a, "xfrm");
  const color = stroke && first(stroke, a, "srgbClr")?.getAttribute("val");
  if (geometry?.getAttribute("prst") !== "line" || !extent || !stroke
    || horizontal?.getAttribute("relativeFrom") !== "column"
    || vertical?.getAttribute("relativeFrom") !== "paragraph"
    || !first(anchor, wp, "wrapNone") || Number(transform?.getAttribute("rot") ?? 0) !== 0
    || !color || !/^[0-9a-f]{6}$/i.test(color)
    || Array.from(stroke.children).some(child => !["solidFill", "miter", "round", "bevel"].includes(child.localName))
    || (stroke.getAttribute("cmpd") ?? "sng") !== "sng") return null;
  const line: Line = {
    x: emu(first(horizontal, wp, "posOffset")?.textContent),
    y: emu(first(vertical, wp, "posOffset")?.textContent),
    width: emu(extent.getAttribute("cx")), height: emu(extent.getAttribute("cy")),
    stroke: emu(stroke.getAttribute("w")), color: `#${color}`,
    flipX: ["1", "true"].includes(transform?.getAttribute("flipH") ?? ""),
    flipY: ["1", "true"].includes(transform?.getAttribute("flipV") ?? ""),
    behind: ["1", "true"].includes(anchor.getAttribute("behindDoc") ?? ""),
  };
  return [line.x, line.y, line.width, line.height, line.stroke].every(Number.isFinite)
    && line.width >= 0 && line.height >= 0 && line.stroke > 0 ? line : null;
}

export function prepareDocxDrawingLines(xml: DocxXmlContext, parsed: { parts: Part[] }): string[] {
  const warnings = new Set<string>();
  for (const part of parsed.parts) {
    if (!part._xmlDocument) continue;
    const definitions = new Map<string, Line>();
    for (const alternate of Array.from(part._xmlDocument.getElementsByTagNameNS(mc, "AlternateContent"))) {
      const fallback = Array.from(alternate.children).find(child => child.localName === "Fallback");
      const source = fallback && first(fallback, v, "line");
      const id = source?.getAttribute("id");
      if (!id) continue;
      const line = readLine(alternate);
      if (line) definitions.set(id, line);
      else warnings.add("部分绘图直线的定位或线型暂未支持，请对照原件。");
    }
    if (!definitions.size) continue;
    const roots = part.body ? [part.body] : part.rootElement ? [part.rootElement] : part.notes ?? [];
    const paragraphs = roots.flatMap(root => descendants(root, "paragraph"));
    const sources = Array.from(xml(part.path)?.getElementsByTagNameNS(w, "p") ?? []);
    if (sources.length !== paragraphs.length) {
      warnings.add("绘图直线的段落对应关系无法确定，已保留原渲染。");
      continue;
    }
    sources.forEach((source, index) => {
      const pictures = Array.from(source.getElementsByTagNameNS(w, "pict"));
      const models = descendants(paragraphs[index], "vmlPicture");
      if (pictures.length !== models.length) return;
      const lines: Line[] = [];
      pictures.forEach((picture, pictureIndex) => {
        const children = Array.from(picture.children);
        if (children.length !== 1 || children[0].namespaceURI !== v || children[0].localName !== "line") return;
        const line = definitions.get(children[0].getAttribute("id") ?? "");
        if (!line || inTable(source) || source.getElementsByTagNameNS(w, "p").length) return;
        lines.push(line);
        // Suppress the malformed fallback image; one XML shape is painted once.
        models[pictureIndex].children = [];
        (models[pictureIndex].cssStyle ??= {}).display = "none";
      });
      if (lines.length) (paragraphs[index].cssStyle ??= {})[property] = JSON.stringify(lines);
    });
  }
  return [...warnings];
}

// Pagination moves/clones paragraphs. Resolve their final page/column origins
// only afterwards, before the whole document is scaled for display.
export function renderDocxDrawingLines(body: HTMLElement): string[] {
  const warnings = new Set<string>();
  const ns = "http://www.w3.org/2000/svg";
  body.querySelectorAll("svg[data-docx-drawing-line]").forEach(element => element.remove());
  for (const paragraph of Array.from(body.querySelectorAll<HTMLElement>("p"))) {
    const raw = paragraph.style.getPropertyValue(property);
    if (!raw || paragraph.hasAttribute("data-page-continuation")) continue;
    const page = paragraph.closest<HTMLElement>("section.docx");
    const column = paragraph.closest<HTMLElement>("article, header, footer");
    if (!page || !column || paragraph.closest("td, th") || Number(getComputedStyle(column).columnCount) > 1) {
      warnings.add("表格或多栏中的绘图直线定位暂未支持，请对照原件。");
      continue;
    }
    const pageRect = page.getBoundingClientRect();
    const columnStyle = getComputedStyle(column);
    const x = column.getBoundingClientRect().left - pageRect.left - page.clientLeft
      + column.clientLeft + parseFloat(columnStyle.paddingLeft);
    const y = paragraph.getBoundingClientRect().top - pageRect.top - page.clientTop;
    for (const line of JSON.parse(raw) as Line[]) {
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("data-docx-drawing-line", "");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.style.cssText = `position:absolute;left:${x + line.x}px;top:${y + line.y}px;width:${Math.max(1, line.width)}px;height:${Math.max(1, line.height)}px;overflow:visible;pointer-events:none;z-index:${line.behind ? 0 : 2};`;
      const stroke = document.createElementNS(ns, "line");
      stroke.setAttribute("x1", String(line.flipX ? line.width : 0));
      stroke.setAttribute("x2", String(line.flipX ? 0 : line.width));
      stroke.setAttribute("y1", String(line.flipY ? line.height : 0));
      stroke.setAttribute("y2", String(line.flipY ? 0 : line.height));
      stroke.setAttribute("stroke", line.color);
      stroke.setAttribute("stroke-width", String(line.stroke));
      svg.appendChild(stroke);
      page.appendChild(svg);
    }
  }
  return [...warnings];
}
