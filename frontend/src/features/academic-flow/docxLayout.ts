const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
type Styles = Record<string, string>;
type DocxNode = {
  type: string; children?: DocxNode[]; cssStyle?: Styles;
  cssStyleText?: string; tagName?: string; attrs?: Record<string, string>;
  break?: string; styleName?: string; pageBreakBefore?: boolean;
  sectionProps?: { type?: string };
  tabs?: { position: string; style: string; leader?: string }[];
  gridBefore?: number; span?: number;
};
type DocxStyle = { id: string | null; target: string | null; basedOn?: string; isDefault?: boolean;
  paragraphProps?: { tabs?: DocxNode["tabs"] };
  styles: { target: string; values: Styles }[] };
type ParsedDocx = {
  documentPart: { path: string; body: DocxNode };
  stylesPart?: { path: string; styles: DocxStyle[] };
  settingsPart?: { path: string };
  parts: { path: string; body?: DocxNode; rootElement?: DocxNode; notes?: DocxNode[] }[];
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
  for (const name of ["keepNext", "keepLines", "widowControl"]) {
    const setting = child(properties, name);
    if (setting) values[`--docx-${name.toLowerCase()}`] = enabled(setting) ? "1" : "0";
  }
  const snap = child(properties, "snapToGrid");
  if (snap) values["--docx-snap-to-grid"] = enabled(snap) ? "1" : "0";
  const spacing = child(properties, "spacing");
  const line = number(spacing, "line");
  const declaredRule = attribute(spacing, "lineRule");
  if (declaredRule) values["--docx-line-rule"] = declaredRule;
  if (line !== null && line > 0) {
    // Preserve value and rule independently: a direct value can inherit its rule.
    values["--docx-line-value"] = String(line);
  }
  for (const side of ["before", "after"]) {
    const lines = number(spacing, `${side}Lines`);
    const automatic = ["1", "true", "on"].includes(attribute(spacing, `${side}Autospacing`) ?? "0");
    if (automatic || (lines === null && number(spacing, side) !== null)) {
      // A direct point-based value must not retain a style's line-based override.
      values[`--docx-${side}-lines`] = "initial";
    } else if (lines !== null) {
      values[`--docx-${side}-lines`] = String(lines / 100);
    }
  }
}

function descendants(node: DocxNode, type: string): DocxNode[] {
  return [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap((entry) => descendants(entry, type))];
}

// Keep the pinned renderer's internal XML access in one place. Its own parser
// already inflated and parsed these parts; consumers share a normalized copy.
export function createDocxXmlContext(parsed: { parts: { path: string; _xmlDocument?: Document }[] }) {
  const documents = new Map<string, Document>();
  return (path?: string): Document | null => {
    if (!path) return null;
    if (documents.has(path)) return documents.get(path)!;
    const part = parsed.parts.find((entry) => entry.path === path);
    if (!part) return null;
    if (!part._xmlDocument) throw new Error("DOCX 解析器未保留 XML，请检查预览依赖版本。");
    const source = part._xmlDocument.cloneNode(true) as Document;
    for (const alternate of Array.from(source.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/markup-compatibility/2006", "AlternateContent"))) {
      const fallback = Array.from(alternate.children).find((entry) => entry.localName === "Fallback");
      alternate.replaceWith(...(fallback?.firstElementChild ? [fallback.firstElementChild] : []));
    }
    documents.set(path, source);
    return source;
  };
}
export type DocxXmlContext = ReturnType<typeof createDocxXmlContext>;

// Saved layout markers are historical results, not author-requested breaks.
// Keep the library's explicit break renderer, with one event per section boundary.
export function prepareDocxBreaks(parsed: {
  documentPart: { body: DocxNode & { props?: { type?: string } } };
  stylesPart?: { styles: { id: string | null; basedOn?: string; paragraphProps?: { pageBreakBefore?: boolean } }[] };
}) {
  const removeSaved = (node: DocxNode) => {
    if (!node.children) return;
    node.children = node.children.filter((child) => child.break !== "lastRenderedPageBreak");
    node.children.forEach(removeSaved);
  };
  const body = parsed.documentPart.body;
  removeSaved(body);
  const blocks = body.children ?? [];
  const before = (node: DocxNode): boolean => {
    if (node.pageBreakBefore !== undefined) return node.pageBreakBefore;
    let id = node.styleName;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const style = parsed.stylesPart?.styles.find((entry) => entry.id === id);
      if (style?.paragraphProps?.pageBreakBefore !== undefined) return style.paragraphProps.pageBreakBefore;
      id = style?.basedOn;
    }
    return false;
  };
  blocks.forEach((block, index) => {
    if (!block.sectionProps || index === blocks.length - 1) return;
    const next = blocks[index + 1];
    const nextSection = blocks.slice(index + 1).find((entry) => entry.sectionProps)?.sectionProps ?? body.props;
    const kind = nextSection?.type ?? "nextPage";
    (next.cssStyle ??= {})["--docx-section-start"] = kind;
    if (!["nextPage", "evenPage", "oddPage"].includes(kind)) return;
    // pageBreakBefore is already handled by the library, including style inheritance.
    if (before(next)) return;
    const lastRun = block.children?.[block.children.length - 1];
    const last = lastRun?.children?.[lastRun.children.length - 1];
    if (last?.break === "page") return;
    (block.children ??= []).push({ type: "run", children: [{ type: "break", break: "page" }] });
  });
}

// Supplement omitted properties on the library model before its style cascade.
export function supplementDocxLayout(xml: DocxXmlContext, parsed: ParsedDocx) {
  const documentXml = xml(parsed.documentPart.path);
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
  const tableProperties = tableStyleProperties(stylesXml);
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
  const settings = xml(parsed.settingsPart?.path);
  const characterSpacingControl = attribute(child(settings?.documentElement, "characterSpacingControl"), "val");
  if (characterSpacingControl && characterSpacingControl !== "doNotCompress") {
    (parsed.documentPart.body.cssStyle ??= {})["--docx-punctuation-compression"] = characterSpacingControl;
  }
  const underlineTrailingSpaces = enabled(child(child(settings?.documentElement, "compat"), "ulTrailSpace"));
  // ISO/IEC 29500 defaultTabStop: 720 twips only when the element is omitted.
  const defaultTab = number(settings?.getElementsByTagNameNS(wordNamespace, "defaultTabStop")[0], "val") ?? 720;
  const styleTabs = (id: string | undefined, seen = new Set<string>()): NonNullable<DocxNode["tabs"]> => {
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const style = parsed.stylesPart?.styles.find((entry) => entry.id === id);
    return [...styleTabs(style?.basedOn, seen), ...(style?.paragraphProps?.tabs ?? [])];
  };
  for (const part of parsed.parts) {
    const roots = part.body ? [part.body] : part.rootElement ? [part.rootElement] : part.notes ?? [];
    if (!roots.length) continue;
    const source = xml(part.path);
    if (!source) continue;
    supplementTables(source.documentElement, roots, tableProperties);
    const nodes = roots.flatMap((root) => descendants(root, "paragraph"));
    if (part.path !== parsed.documentPart.path) {
      const sources = Array.from(source.getElementsByTagNameNS(wordNamespace, "p"));
      if (sources.length === nodes.length) sources.forEach((entry, index) =>
        supplementParagraph(child(entry, "pPr"), nodes[index].cssStyle ??= {}));
    }
    for (const node of nodes) {
      const stops = new Map<string, NonNullable<DocxNode["tabs"]>[number]>();
      const styleId = node.styleName ?? parsed.stylesPart?.styles.find((entry) => entry.isDefault && entry.target === "p")?.id ?? undefined;
      for (const stop of [...styleTabs(styleId), ...(node.tabs ?? [])]) stops.set(stop.position, stop);
      const values = node.cssStyle ??= {};
      values["--docx-tabs"] = JSON.stringify([...stops.values()]);
      values["--docx-default-tab"] = String(defaultTab / 15);
      // ISO 29500 ulTrailSpace: omission/false does not underline trailing spaces.
      // Carry the document setting to every text part and to pagination clones.
      values["--docx-underline-trailing-spaces"] = underlineTrailingSpaces ? "1" : "0";
    }
  }
}

// The library's experimental tab refresh runs on a fixed 500ms timer. Use its
// parsed tab stops after project fonts are ready, without that timing race.
export function applyDocxTabs(body: HTMLElement): string[] {
  const warnings = new Set<string>();
  for (const paragraph of Array.from(body.querySelectorAll<HTMLElement>("p"))) {
    const tabs = Array.from(paragraph.querySelectorAll<HTMLElement>("docx-tab"));
    if (!tabs.length) continue;
    const style = getComputedStyle(paragraph);
    const stops = (JSON.parse(style.getPropertyValue("--docx-tabs") || "[]") as NonNullable<DocxNode["tabs"]>)
      .map((stop) => ({ ...stop, x: parseFloat(stop.position) * 96 / 72 })).sort((a, b) => a.x - b.x);
    const interval = Number(style.getPropertyValue("--docx-default-tab"));
    if (style.direction === "rtl" || style.writingMode !== "horizontal-tb") {
      warnings.add("竖排或从右向左的制表位尚未精确支持。");
      continue;
    }
    tabs.forEach((tab, index) => {
      const left = tab.getBoundingClientRect().left - (paragraph.getBoundingClientRect().left - (parseFloat(style.marginLeft) || 0));
      const stop = stops.find((entry) => entry.style !== "clear" && entry.x > left);
      const destination = stop?.x ?? (interval > 0 ? (Math.floor(left / interval) + 1) * interval : left);
      let offset = 0;
      if (stop && ["right", "center"].includes(stop.style)) {
        const range = document.createRange();
        range.setStartAfter(tab);
        if (tabs[index + 1]) range.setEndBefore(tabs[index + 1]);
        else range.setEnd(paragraph, paragraph.childNodes.length);
        offset = range.getBoundingClientRect().width * (stop.style === "center" ? 0.5 : 1);
      } else if (stop && !["left", "start"].includes(stop.style)) {
        warnings.add("小数点或竖线制表位尚未精确支持，请对照原件。");
      }
      tab.style.width = `${Math.max(0, destination - left - offset)}px`;
      if (["dot", "middleDot", "hyphen", "underscore", "heavy"].includes(stop?.leader ?? "")) {
        warnings.add("制表位前导符尚未精确绘制，已保留制表间距。");
      }
    });
  }
  return [...warnings];
}

// Single underlines use one paint path for text and spaces after pagination.
// The library still owns shaping, advances and line breaks. Unsupported paragraphs
// keep their native decorations as a whole, rather than mixing two renderers.
export function applyDocxUnderlines(body: HTMLElement): string[] {
  const warnings = new Set<string>();
  const svgNamespace = "http://www.w3.org/2000/svg";
  const layers = new Map<HTMLElement, SVGSVGElement>();
  const baselines = new Map<string, number>();
  type Segment = { left: number; right: number; y: number; thickness: number; color: string };
  const metadata = (style: CSSStyleDeclaration, name: string): string => {
    const raw = style.getPropertyValue(name).trim();
    return raw ? JSON.parse(raw) : "";
  };
  const contentBounds = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { left: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      right: rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) };
  };
  const baseline = (page: HTMLElement, style: CSSStyleDeclaration): number => {
    const names = ["font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-feature-settings", "font-variation-settings"];
    const key = names.map((name) => style.getPropertyValue(name)).join(";");
    if (baselines.has(key)) return baselines.get(key)!;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;line-height:normal;padding:0;margin:0;border:0;";
    for (const name of names) probe.style.setProperty(name, style.getPropertyValue(name), "important");
    probe.style.setProperty("font-synthesis", "weight style", "important");
    const text = document.createTextNode(" ");
    const marker = document.createElement("docx-baseline");
    marker.style.cssText = "display:inline-block;vertical-align:baseline;width:0;height:0;line-height:0;padding:0;margin:0;border:0;";
    probe.append(text, marker);
    page.appendChild(probe);
    const range = document.createRange();
    range.selectNodeContents(text);
    const offset = marker.getBoundingClientRect().top - range.getBoundingClientRect().top;
    probe.remove();
    baselines.set(key, offset);
    return offset;
  };
  // Restore native declarations before a repeat pass. Other decorations and their
  // priorities are retained; no generated underline can compound on a second pass.
  for (const element of Array.from(body.querySelectorAll<HTMLElement>("[data-docx-native-underline]"))) {
    const saved = JSON.parse(element.dataset.docxNativeUnderline!) as { value: string; priority: string };
    if (saved.value) element.style.setProperty("text-decoration-line", saved.value, saved.priority);
    else element.style.removeProperty("text-decoration-line");
    delete element.dataset.docxNativeUnderline;
  }
  for (const page of Array.from(body.querySelectorAll<HTMLElement>("section.docx"))) {
    page.querySelector(":scope > svg[data-docx-underlines]")?.remove();
  }
  const paragraphs = new Set(Array.from(body.querySelectorAll<HTMLElement>('docx-text[data-docx-underline="single"]'))
    .map((element) => element.closest<HTMLElement>("p, li")).filter((element): element is HTMLElement => Boolean(element)));
  for (const paragraph of paragraphs) {
    const runs = Array.from(paragraph.querySelectorAll<HTMLElement>("docx-text[data-docx-underline]"))
      .filter((element) => element.closest("p, li") === paragraph);
    const underlined = runs.filter((element) => element.dataset.docxUnderline === "single");
    const page = paragraph.closest<HTMLElement>("section.docx");
    if (!page) continue;
    const paragraphStyle = getComputedStyle(paragraph);
    const owners = [paragraph, ...Array.from(paragraph.querySelectorAll<HTMLElement>("*"))]
      .filter((element) => element instanceof HTMLElement && getComputedStyle(element).textDecorationLine.includes("underline"));
    let externalDecoration = false;
    for (let ancestor = paragraph.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).textDecorationLine.includes("underline")) externalDecoration = true;
      if (ancestor === body) break;
    }
    // A decorating ancestor cannot be cancelled by a child's text-decoration:none.
    // Do not remove it if that would also change another paragraph or a generated field.
    const unsupported = externalDecoration || paragraph.getClientRects().length !== 1
      || paragraph.querySelector(".docx-page-field, docx-tab, svg, math, canvas, object, ruby")
      || owners.some((element) => metadata(getComputedStyle(element), "--docx-underline") !== "single")
      || runs.some((element) => !["single", "none"].includes(element.dataset.docxUnderline!))
      || underlined.some((element) => {
        const style = getComputedStyle(element);
        return style.writingMode !== "horizontal-tb" || style.direction !== "ltr"
          || style.transform !== "none" || metadata(style, "--docx-underline-theme")
          || !style.getPropertyValue("--docx-underline-thickness").trim();
      });
    if (unsupported) {
      warnings.add("部分下划线包含复杂装饰、字段或方向，所在段落完整保留库的渲染。");
      continue;
    }
    const trailing = paragraphStyle.getPropertyValue("--docx-underline-trailing-spaces").trim() === "1";
    const bounds = contentBounds(paragraph);
    const cell = paragraph.closest<HTMLElement>("td, th");
    const cellBounds = cell ? contentBounds(cell) : null;
    const indentValue = paragraphStyle.textIndent;
    const indent = indentValue.endsWith("%") ? parseFloat(indentValue) * (bounds.right - bounds.left) / 100
      : parseFloat(indentValue);
    if (!Number.isFinite(indent)) {
      warnings.add("复杂首行缩进的下划线保留库的渲染。");
      continue;
    }
    const paragraphRange = document.createRange();
    paragraphRange.selectNodeContents(paragraph);
    const first = Array.from(paragraphRange.getClientRects()).filter((rect) => rect.height > 0)
      .sort((a, b) => a.top - b.top)[0];
    // Physical line ends include all text, whether underlined or not. Only ASCII
    // spaces at those ends are controlled here; tabs remain the library's concern.
    const ink: DOMRect[] = [];
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let unmapped = false;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.parentElement?.closest("p, li") !== paragraph) continue;
      if (node.data && !node.parentElement?.closest("docx-text")) unmapped = true;
      for (const match of node.data.matchAll(/[^ \t\r\n]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        ink.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0));
      }
    }
    if (unmapped) {
      warnings.add("部分动态文字尚未保留下划线格式，所在段落保留库的渲染。");
      continue;
    }
    for (const image of Array.from(paragraph.querySelectorAll<HTMLElement>("img"))) {
      const style = getComputedStyle(image);
      if (image.closest("p, li") === paragraph && style.display.startsWith("inline")
        && style.float === "none" && !["absolute", "fixed"].includes(style.position)) {
        ink.push(...Array.from(image.getClientRects()).filter((rect) => rect.width > 0));
      }
    }
    const segments: Segment[] = [];
    const pageRect = page.getBoundingClientRect();
    for (const run of underlined) {
      const style = getComputedStyle(run);
      const size = parseFloat(style.fontSize);
      const position = Number(style.getPropertyValue("--docx-underline-position")) * size;
      const thickness = Number(style.getPropertyValue("--docx-underline-thickness")) * size;
      const range = document.createRange();
      range.selectNodeContents(run);
      const space = /^ +$/.test(run.textContent ?? "");
      for (const rect of Array.from(range.getClientRects())) {
        if (!rect.width || !rect.height) continue;
        let start = rect.left;
        let end = rect.right;
        if (space) {
          const line = ink.filter((entry) => entry.top < rect.bottom && entry.bottom > rect.top);
          // Omit only actual trailing space fragments when ulTrailSpace is disabled.
          if (!trailing) end = Math.min(end, Math.max(...line.map((entry) => entry.right)));
          const firstLine = first && rect.top < first.bottom && rect.bottom > first.top;
          start = Math.max(start, bounds.left + (firstLine ? indent : 0), cellBounds?.left ?? -Infinity);
          end = Math.min(end, bounds.right, cellBounds?.right ?? Infinity);
        }
        if (end <= start) continue;
        segments.push({ left: start - pageRect.left - page.clientLeft,
          right: end - pageRect.left - page.clientLeft,
          y: rect.top - pageRect.top - page.clientTop + baseline(page, style) + position + thickness / 2,
          thickness, color: style.getPropertyValue("--docx-underline-color") });
      }
    }
    // Remove native underline only after all geometry is collected successfully.
    // In particular, retain line-through/overline and respect explicit w:u="none".
    for (const owner of owners) {
      owner.dataset.docxNativeUnderline = JSON.stringify({ value: owner.style.getPropertyValue("text-decoration-line"),
        priority: owner.style.getPropertyPriority("text-decoration-line") });
      const remaining = getComputedStyle(owner).textDecorationLine.split(/\s+/).filter((line) => line !== "underline");
      owner.style.setProperty("text-decoration-line", remaining.join(" ") || "none", "important");
    }
    if (!segments.length) continue;
    let layer = layers.get(page);
    if (!layer) {
      layer = document.createElementNS(svgNamespace, "svg");
      layer.setAttribute("data-docx-underlines", "");
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute("focusable", "false");
      layer.style.cssText = `position:absolute;left:0;top:0;width:${page.clientWidth}px;height:${page.clientHeight}px;overflow:visible;pointer-events:none;z-index:2;`;
      page.appendChild(layer);
      layers.set(page, layer);
    }
    // Join touching fragments only when their actual decoration metrics agree.
    // No join crosses a glyph with no underline, a line/page break or a color change.
    segments.sort((a, b) => a.y - b.y || a.left - b.left);
    const joined: Segment[] = [];
    for (const segment of segments) {
      const previous = joined[joined.length - 1];
      if (previous && previous.y === segment.y && previous.thickness === segment.thickness
        && previous.color === segment.color && segment.left <= previous.right) {
        previous.right = Math.max(previous.right, segment.right);
      } else joined.push({ ...segment });
    }
    for (const segment of joined) {
      const underline = document.createElementNS(svgNamespace, "line");
      underline.setAttribute("x1", String(segment.left));
      underline.setAttribute("x2", String(segment.right));
      underline.setAttribute("y1", String(segment.y));
      underline.setAttribute("y2", String(segment.y));
      underline.setAttribute("stroke", segment.color);
      underline.setAttribute("stroke-width", String(segment.thickness));
      layer.appendChild(underline);
    }
  }
  return [...warnings];
}

// Resolve geometry from XML, not the renderer's table-style CSS (which targets td).
function tableStyleProperties(source: Document | null) {
  const styles = new Map(Array.from(source?.getElementsByTagNameNS(wordNamespace, "style") ?? [])
    .filter((entry) => attribute(entry, "type") === "table")
    .map((entry) => [attribute(entry, "styleId")!, entry]));
  const defaultStyle = Array.from(styles.values()).find((entry) =>
    ["1", "true", "on"].includes(attribute(entry, "default") ?? ""));
  const cache = new Map<string, Map<string, Element>>();
  const resolve = (id: string, visiting = new Set<string>()): Map<string, Element> => {
    if (cache.has(id)) return cache.get(id)!;
    if (visiting.has(id)) throw new Error(`DOCX 表格样式循环引用：${id}`);
    const style = styles.get(id);
    if (!style) return new Map();
    visiting.add(id);
    const base = attribute(child(style, "basedOn"), "val");
    const values = new Map(base ? resolve(base, visiting) : []);
    for (const entry of Array.from(child(style, "tblPr")?.children ?? [])) values.set(entry.localName, entry);
    visiting.delete(id); cache.set(id, values);
    return values;
  };
  return (table: Element) => {
    const direct = child(table, "tblPr");
    const id = attribute(child(direct, "tblStyle"), "val");
    const values = new Map(resolve(id && styles.has(id) ? id : attribute(defaultStyle, "styleId") ?? ""));
    for (const entry of Array.from(direct?.children ?? [])) values.set(entry.localName, entry);
    // MS-OI29500 17.4.51: only the first row's indent exception affects the table.
    const firstRow = child(table, "tr");
    const exception = child(child(firstRow, "tblPrEx"), "tblInd");
    if (exception) values.set("tblInd", exception);
    return values;
  };
}
function supplementTablePosition(table: Element, node: DocxNode, properties: Map<string, Element>) {
  const style = node.cssStyle ??= {};
  const indent = properties.get("tblInd");
  const alignment = attribute(properties.get("jc"), "val");
  // Floating anchors and RTL table layout need their own coordinate/column model.
  // Retain the renderer's geometry for these instead of adding a second displacement.
  if (properties.has("tblpPr") || enabled(properties.get("bidiVisual"))) {
    if (indent) style["--docx-table-position-unresolved"] = "1";
    return;
  }
  if (Array.from(table.children).filter((entry) => entry.localName === "tr")
    .some((row) => child(child(row, "trPr"), "jc") || child(child(row, "tblPrEx"), "jc"))) {
    style["--docx-table-position-unresolved"] = "1";
    return;
  }
  if (!indent && !alignment) return;
  const type = attribute(indent, "type") ?? "dxa";
  // pct/auto are ignored by the table indentation rule; nil explicitly means zero.
  const ignored = ["pct", "auto", "nil"].includes(type);
  const value = !indent || ignored ? 0 : number(indent, "w");
  if ((!ignored && type !== "dxa") || value === null
    || (alignment && !["left", "start", "center", "right", "end"].includes(alignment))) {
    style["--docx-table-position-unresolved"] = "1";
    return;
  }
  // Word retains tblInd for center/right alignment too (MS-OI29500 17.4.50).
  // Anchor against the containing text area, then offset by the XML indent.
  // Unlike auto margins this also centers/right-aligns tables wider than that area.
  // Translation preserves cell widths, nesting and pagination clones.
  // Without jc, Word still honors indentation from the leading margin (17.4.28).
  const anchor = alignment === "center" ? 50 : ["right", "end"].includes(alignment ?? "") ? 100 : 0;
  if (anchor || value !== 0) {
    delete style["text-align"];
    style["margin-left"] = style["margin-right"] = "0pt";
    style.position = "relative";
    style.left = anchor ? `calc(${anchor}% + ${value / 20}pt)` : `${value / 20}pt`;
    if (anchor) style.transform = `translateX(-${anchor}%)`;
  }
  style["--docx-table-indent"] = `${value / 20}pt`;
}

function supplementTables(source: Element | undefined, roots: DocxNode[], resolveProperties: ReturnType<typeof tableStyleProperties>) {
  const xmlTables = Array.from(source?.getElementsByTagNameNS(wordNamespace, "tbl") ?? []);
  const tables = roots.flatMap((root) => descendants(root, "table"));
  if (xmlTables.length !== tables.length) return;
  xmlTables.forEach((table, index) => {
    supplementTablePosition(table, tables[index], resolveProperties(table));
    const rows = Array.from(table.children).filter((entry) => entry.localName === "tr");
    const parsedRows = (tables[index].children ?? []).filter((entry) => entry.type === "row");
    if (rows.length === parsedRows.length) rows.forEach((row, rowIndex) => {
      const height = child(child(row, "trPr"), "trHeight");
      const style = parsedRows[rowIndex].cssStyle ??= {};
      const rule = attribute(height, "hRule");
      if (rule === "auto") style.height = "auto";
      for (const name of ["cantSplit", "tblHeader"]) {
        const setting = child(child(row, "trPr"), name);
        if (setting) style[`--docx-${name.toLowerCase()}`] = enabled(setting) ? "1" : "0";
      }
      // In 0.4.1 the gridBefore placeholder does not advance the renderer's
      // vertical-merge column cursor. A real empty cell does, preserving offsets.
      const parsedRow = parsedRows[rowIndex];
      if (parsedRow.gridBefore) {
        (parsedRow.children ??= []).unshift({ type: "cell", span: parsedRow.gridBefore,
          children: [], cssStyle: { border: "none", "border-left": "none", "border-right": "none",
            "border-top": "none", "border-bottom": "none", padding: "0" } });
        delete parsedRow.gridBefore;
      }
    });
    const properties = child(table, "tblPr");
    if (attribute(child(properties, "tblLayout"), "type") !== "fixed") return;
    const width = child(properties, "tblW");
    // HTML ignores fixed table layout when width is auto. Word still uses its grid.
    if (width && attribute(width, "type") !== "auto" && (number(width, "w") ?? 0) > 0) return;
    const columns = Array.from(child(table, "tblGrid")?.children ?? []);
    const widths = columns.map((column) => number(column, "w") ?? 0);
    if (!widths.length || widths.some((value) => value <= 0)) return;
    const style = tables[index].cssStyle ??= {};
    const conflicting = rows.some((row) => {
      let column = number(child(child(row, "trPr"), "gridBefore"), "val") ?? 0;
      return Array.from(row.children).filter((entry) => entry.localName === "tc").some((cell) => {
        const properties = child(cell, "tcPr");
        const span = number(child(properties, "gridSpan"), "val") ?? 1;
        const width = child(properties, "tcW");
        const preferred = number(width, "w");
        const gridWidth = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0);
        column += span;
        return preferred !== null && preferred > 0
          && (attribute(width, "type") !== "dxa" || preferred !== gridWidth);
      });
    });
    if (conflicting) {
      style["--docx-table-width-unresolved"] = "1";
      return;
    }
    style.width = `${widths.reduce((sum, value) => sum + value, 0) / 20}pt`;
    style["table-layout"] = "fixed";
  });
}

function supplementTextBoxes(source: Element | undefined, body: DocxNode) {
  const vmlNamespace = "urn:schemas-microsoft-com:vml";
  const shapes = Array.from(source?.getElementsByTagNameNS(vmlNamespace, "shape") ?? []);
  const renderedShapes = descendants(body, "vmlElement").filter((node) => node.tagName === "g");
  // Align the selected XML branch in source order, not by non-unique CSS text.
  if (shapes.length !== renderedShapes.length) return;
  const sources = new Map(renderedShapes.map((node, index) => [node, shapes[index]]));
  const visit = (node: DocxNode, cell?: DocxNode) => {
    if (node.type === "cell") cell = node;
    if (node.tagName === "g" && node.cssStyleText) {
      const shape = sources.get(node);
      const box = node.children?.find((entry) => entry.tagName === "foreignObject");
      if (shape?.getAttribute("type") === "#_x0000_t202" && box) {
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
        node.children!.unshift({ type: node.type, tagName: "rect", children: [], attrs: {
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

// Measure the loaded face's single-line box, not glyph ink bounds or font-size.
// A cache per layout pass also keeps mixed-script documents from creating a
// probe for every run. The probe has no document text, breaks, images or margins.
function naturalLineHeight(body: HTMLElement, style: CSSStyleDeclaration, cache: Map<string, number>): number {
  const properties = ["font-family", "font-size", "font-weight", "font-style", "font-stretch",
    "font-feature-settings", "font-variation-settings", "font-variant", "font-kerning",
    "font-size-adjust", "font-optical-sizing", "font-synthesis"];
  const values = properties.map((name) => style.getPropertyValue(name));
  const key = JSON.stringify(values);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const probe = document.createElement("docx-line-metrics");
  probe.style.cssText = "position:absolute;visibility:hidden;display:block;width:max-content;height:auto;min-height:0;padding:0;margin:0;border:0;white-space:pre;line-height:normal;";
  properties.forEach((name, index) => probe.style.setProperty(name, values[index]));
  probe.textContent = " ";
  body.appendChild(probe);
  try {
    const height = probe.getBoundingClientRect().height;
    cache.set(key, height);
    return height;
  } finally {
    probe.remove();
  }
}

export function applyDocxLineSpacing(body: HTMLElement): string[] {
  const warnings = new Set<string>();
  const lineHeights = new Map<string, number>();
  if (Array.from(body.querySelectorAll<HTMLElement>("section.docx")).some((page) =>
    getComputedStyle(page).getPropertyValue("--docx-punctuation-compression").trim())) {
    warnings.add("此文档启用了标点压缩；浏览器字形排列尚不能完整复现 Word 的压缩规则。");
  }
  // Resolve the library's CSS cascade first. auto is the OOXML default after
  // inheritance, not a project-specific line spacing multiplier.
  for (const paragraph of Array.from(body.querySelectorAll<HTMLElement>("section.docx p"))) {
    const style = getComputedStyle(paragraph);
    const line = Number(style.getPropertyValue("--docx-line-value"));
    const rule = style.getPropertyValue("--docx-line-rule").trim() || "auto";
    if (!(line > 0)) continue;
    if (rule === "exact") {
      paragraph.style.lineHeight = `${line / 20}pt`;
      paragraph.style.minHeight = `${line / 20}pt`;
    } else if (rule === "auto" || rule === "atLeast") {
      if (!paragraph.getClientRects().length) continue;
      if (style.writingMode !== "horizontal-tb") {
        warnings.add("竖排文字的字体行高尚未精确支持，保留原渲染器的行距。");
        continue;
      }
      // Scale each inline font's natural line box independently. Taking the
      // tallest run in the entire paragraph would enlarge unrelated lines;
      // setting only the paragraph would make all runs inherit one pixel height.
      // CSS combines the runs' ascent/descent and half-leading on each line.
      const elements = [paragraph, ...Array.from(paragraph.querySelectorAll<HTMLElement>("span, a, sup, sub, docx-text"))];
      const heights = elements.flatMap((element) => {
        if (element !== paragraph && element.closest("p") !== paragraph) return [];
        const current = getComputedStyle(element);
        if ((element !== paragraph && current.display !== "inline") || current.writingMode !== "horizontal-tb"
          || parseFloat(current.fontSize) === 0 || parseFloat(current.lineHeight) === 0) return [];
        const natural = naturalLineHeight(body, current, lineHeights);
        if (!(natural > 0)) {
          warnings.add("部分字体无法测量单行高度，保留原渲染器的行距。");
          return [];
        }
        return [{ element, height: rule === "auto" ? natural * line / 240 : Math.max(line / 15, natural) }];
      });
      // Read all effective styles before writing; repeated layout passes cannot
      // multiply an already expanded line-height or leak it into a nested run.
      for (const { element, height } of heights) element.style.lineHeight = `${height}px`;
      const paragraphHeight = heights.find((entry) => entry.element === paragraph)?.height;
      if (paragraphHeight !== undefined) paragraph.style.minHeight = `${paragraphHeight}px`;
    }
  }
  // Read once per paragraph before writing; never invent a normal line-height.
  const paragraphs = Array.from(body.querySelectorAll<HTMLElement>("section.docx p")).map((paragraph) => {
    const style = getComputedStyle(paragraph);
    return { paragraph, lineHeight: parseFloat(style.lineHeight),
      before: style.getPropertyValue("--docx-before-lines").trim(),
      after: style.getPropertyValue("--docx-after-lines").trim(),
      keepLines: style.getPropertyValue("--docx-keeplines").trim(),
      keepNext: style.getPropertyValue("--docx-keepnext").trim(),
      widow: style.getPropertyValue("--docx-widowcontrol").trim(),
      grid: parseFloat(style.getPropertyValue("--docx-line-grid")),
      snap: style.getPropertyValue("--docx-snap-to-grid").trim(),
      rule: style.getPropertyValue("--docx-line-rule").trim(),
      tableGrid: style.getPropertyValue("--docx-table-grid").trim() };
  });
  for (const entry of paragraphs) {
    const { paragraph, lineHeight } = entry;
    paragraph.dataset.docxKeepLines = entry.keepLines;
    paragraph.dataset.docxKeepNext = entry.keepNext;
    paragraph.dataset.docxWidow = entry.widow;
    // Grid alignment needs baseline/font metrics and compatibility handling.
    // Keep this limitation visible while using the browser's line layout.
    if (entry.grid > 0 && entry.snap !== "0" && entry.rule !== "exact"
      && (!paragraph.closest("td,th") || entry.tableGrid === "1")) {
      warnings.add("此文档使用文档网格；网格基线对齐尚不能保证与 Word 一致。");
    }
    for (const [lines, property] of [[entry.before, "marginTop"], [entry.after, "marginBottom"]] as const) {
      if (!lines) continue;
      if (Number(lines) === 0) paragraph.style[property] = "0px";
      else if (Number.isFinite(lineHeight)) paragraph.style[property] = `${Number(lines) * lineHeight}px`;
      else warnings.add("部分按行设置的段落间距缺少可确定的行高，保留原渲染结果。");
    }
  }
  for (const row of Array.from(body.querySelectorAll<HTMLTableRowElement>("tr"))) {
    // Row properties must not leak from an outer row into a nested table.
    row.dataset.docxCantSplit = row.style.getPropertyValue("--docx-cantsplit").trim();
    row.dataset.docxTableHeader = row.style.getPropertyValue("--docx-tblheader").trim();
  }
  for (const table of Array.from(body.querySelectorAll<HTMLElement>("table"))) {
    if (table.style.getPropertyValue("--docx-table-position-unresolved")) {
      warnings.add("部分表格定位配置暂未完整支持，已保留原渲染器的处理；缩进与对齐可能与 Word 有差异。");
    }
    if (table.style.getPropertyValue("--docx-table-width-unresolved")) {
      warnings.add("部分表格的列网格与单元格首选宽度不一致，已保留库的宽度处理。");
    }
  }
  return [...warnings];
}
