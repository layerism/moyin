import type { DocxXmlContext } from "./docxLayout";

type Section = {
  pageMargins?: { left?: string; right?: string; top?: string; gutter?: string };
};
type ParsedDocx = {
  documentPart: { path: string; body: { children?: { sectionProps?: Section }[]; props?: Section } };
  settingsPart?: { path: string };
};
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const child = (element: Element | null | undefined, name: string) =>
  Array.from(element?.children ?? []).find((entry) => entry.namespaceURI === wordNamespace && entry.localName === name);
const enabled = (element: Element | undefined) => Boolean(element
  && !["0", "false", "off"].includes(element.getAttributeNS(wordNamespace, "val") ?? "true"));

// Match body-level sections, including content controls flattened by docx-preview.
// Do not include historical sectPrChange values or sections inside table cells.
function paragraphSections(element: Element | undefined): Element[] {
  return Array.from(element?.children ?? []).flatMap((entry): Element[] => {
    if (entry.namespaceURI !== wordNamespace) return [];
    if (entry.localName === "p") {
      const section = child(child(entry, "pPr"), "sectPr");
      return section ? [section] : [];
    }
    return entry.localName === "sdt" ? paragraphSections(child(entry, "sdtContent")) : [];
  });
}

export function prepareDocxPageMargins(xml: DocxXmlContext, parsed: ParsedDocx) {
  const settings = xml(parsed.settingsPart?.path)?.documentElement;
  const mirror = enabled(child(settings, "mirrorMargins"));
  const imposed = ["bookFoldPrinting", "bookFoldRevPrinting", "printTwoOnOne"]
    .some((name) => enabled(child(settings, name)));
  if (imposed) return { mirror: false, warnings: ["文档使用书籍折页或每张多页设置，装订线与页边距尚不能完整还原。"] };

  // ISO/IEC 29500: mirrorMargins takes precedence over gutterAtTop.
  const atTop = !mirror && enabled(child(settings, "gutterAtTop"));
  const source = child(xml(parsed.documentPart.path)?.documentElement, "body");
  const sources = [...paragraphSections(source), child(source, "sectPr")];
  const body = parsed.documentPart.body;
  const sections = [...(body.children ?? []).flatMap((block) => block.sectionProps ? [block.sectionProps] : []), body.props];
  if (sources.length !== sections.length) {
    return { mirror: false, warnings: ["文档分节信息未能对应，装订线与镜像页边距保留原始预览布局。"] };
  }
  sections.forEach((section, index) => {
    const margins = section?.pageMargins;
    if (!margins?.gutter || parseFloat(margins.gutter) === 0) return;
    const side = atTop ? "top" : enabled(child(sources[index], "rtlGutter")) ? "right" : "left";
    // The pinned renderer parses gutter but ignores it. Add it to the model
    // before rendering so text, headers and pagination share the usable area.
    // Retain the renderer's CSS units; no document-specific margin constants.
    section!.pageMargins = { ...margins, [side]: `calc(${margins[side] ?? "0pt"} + ${margins.gutter})` };
  });
  return { mirror, warnings: [] as string[] };
}

export function applyDocxMirrorMargins(body: HTMLElement, mirror: boolean) {
  if (!mirror) return;
  // Use physical facing pages, including blanks inserted for odd/even sections,
  // rather than displayed page numbers (which can restart in each section).
  // Swapping sides preserves the measured text width and therefore pagination.
  Array.from(body.querySelectorAll<HTMLElement>("section.docx")).forEach((page, index) => {
    if (index % 2 === 0) return;
    const left = page.style.paddingLeft;
    page.style.paddingLeft = page.style.paddingRight;
    page.style.paddingRight = left;
  });
}
