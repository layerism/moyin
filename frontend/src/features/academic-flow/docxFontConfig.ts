import type { DocxXmlContext } from "./docxLayout";

const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
const math = "http://schemas.openxmlformats.org/officeDocument/2006/math";
type Values = Record<string, string>;
type Node = { type: string; children?: Node[]; cssStyle?: Values };
type Part = { path: string; body?: Node; rootElement?: Node; notes?: Node[] };
type Style = { id: string | null; target: string | null; styles: { target: string; values: Values; mod?: string }[] };
type Numbering = { id: string; level: number; rStyle: Values };
type Parsed = {
  documentPart: Part & { body: Node }; parts: Part[];
  stylesPart?: { path: string; styles: Style[] };
  themePart?: { path: string }; settingsPart?: { path: string };
  numberingPart?: { path: string; domNumberings: Numbering[] };
};
export type DocxFontTheme = (name: string, languages: { latin: string; eastAsia: string; cs: string }) => string;
const child = (element: Element | null | undefined, name: string) =>
  Array.from(element?.children ?? []).find((entry) => entry.namespaceURI === word && entry.localName === name);
const attr = (element: Element | null | undefined, name: string) => element?.getAttributeNS(word, name);
const on = (element: Element) => !["0", "false", "off"].includes(attr(element, "val") ?? "true");
const toggles = ["b", "i", "bcs", "ics"] as const;
// Keep hierarchy levels separate: CSS specificity is not Word's toggle cascade.
const toggleLevel = (values: Values, level: string, reset = true): Values => Object.fromEntries(toggles
  .filter((name) => reset || values[`--docx-run-${name}`] !== undefined).map((name) =>
  [`--docx-${level}-${name}`, values[`--docx-run-${name}`] ?? "initial"]));
const fontProperties = (values: Values): Values => Object.fromEntries(Object.entries(values)
  .filter(([name]) => !toggles.some((toggle) => name === `--docx-run-${toggle}`)));
const descendants = (node: Node, type: string): Node[] =>
  [...(node.type === type ? [node] : []), ...(node.children ?? []).flatMap((entry) => descendants(entry, type))];

// Preserve each XML script slot separately; a CSS font-family list cannot express this.
function properties(run: Element | undefined): Values {
  const values: Values = {};
  const fonts = child(run, "rFonts");
  for (const [slot, theme] of [["ascii", "asciiTheme"], ["hAnsi", "hAnsiTheme"], ["eastAsia", "eastAsiaTheme"], ["cs", "cstheme"]]) {
    const reference = attr(fonts, theme);
    const name = reference ? `theme:${reference}` : attr(fonts, slot);
    if (name) values[`--docx-font-${slot.toLowerCase()}`] = JSON.stringify(name);
  }
  for (const [source, target] of [["val", "latin"], ["eastAsia", "eastasia"], ["bidi", "cs"]]) {
    const language = attr(child(run, "lang"), source);
    if (language) values[`--docx-language-${target}`] = JSON.stringify(language);
  }
  const hint = attr(fonts, "hint");
  if (hint) values["--docx-font-hint"] = JSON.stringify(hint);
  for (const name of ["cs", "rtl", "b", "i", "bCs", "iCs"]) {
    const value = child(run, name);
    if (value) values[`--docx-run-${name.toLowerCase()}`] = on(value) ? "1" : "0";
  }
  return values;
}

const scripts: Record<string, string> = {
  ja: "Jpan", ko: "Hang", ar: "Arab", fa: "Arab", ur: "Arab", he: "Hebr",
  th: "Thai", hi: "Deva", bn: "Beng", ta: "Taml", te: "Telu", gu: "Gujr",
  pa: "Guru", kn: "Knda", ml: "Mlym", si: "Sinh", km: "Khmr", lo: "Laoo",
};
function script(language: string) {
  const value = language.toLowerCase();
  if (value.startsWith("zh")) return /^zh-(tw|hk|mo|hant)/.test(value) ? "Hant" : "Hans";
  return scripts[value.split("-")[0]];
}

// Add inheritable XML metadata to the renderer's existing style tree before rendering.
export function prepareDocxFontConfig(xml: DocxXmlContext, parsed: Parsed): DocxFontTheme {
  const styles = xml(parsed.stylesPart?.path);
  const defaults = child(styles?.documentElement, "docDefaults");
  const defaultValues = properties(child(child(defaults, "rPrDefault"), "rPr"));
  const settings = xml(parsed.settingsPart?.path);
  const themeLanguage = settings?.getElementsByTagNameNS(word, "themeFontLang")[0];
  for (const [source, target] of [["val", "latin"], ["eastAsia", "eastasia"], ["bidi", "cs"]]) {
    const value = attr(themeLanguage, source);
    if (value && !defaultValues[`--docx-language-${target}`]) defaultValues[`--docx-language-${target}`] = JSON.stringify(value);
  }
  const rootValues = { ...fontProperties(defaultValues), ...toggleLevel(defaultValues, "default") };
  Object.assign(parsed.documentPart.body.cssStyle ??= {}, rootValues);

  const sources = new Map(Array.from(styles?.getElementsByTagNameNS(word, "style") ?? [])
    .map((source) => [attr(source, "styleId") ?? "", source]));
  const defaultStyles = new Map(Array.from(sources.values())
    .filter((source) => ["1", "true", "on"].includes(attr(source, "default") ?? ""))
    .map((source) => [attr(source, "type"), source]));
  const resolved = new Map<string, Values>();
  const resolve = (id: string, visiting = new Set<string>()): Values => {
    if (resolved.has(id)) return resolved.get(id)!;
    if (visiting.has(id)) throw new Error(`DOCX 字体样式循环引用：${id}`);
    const source = sources.get(id);
    if (!source) return {};
    visiting.add(id);
    const base = attr(child(source, "basedOn"), "val");
    // A basedOn chain resolves one style level. A cross-type reference is not a base.
    const sameType = base && attr(sources.get(base), "type") === attr(source, "type");
    const values = { ...(sameType ? resolve(base, visiting) : {}), ...properties(child(source, "rPr")) };
    visiting.delete(id); resolved.set(id, values);
    return values;
  };
  for (const style of parsed.stylesPart?.styles ?? []) {
    if (!style.id || !style.target) continue;
    // Put paragraph/table fonts on their container, so character styles can override slots.
    let target = style.styles.find((entry) => entry.target === style.target);
    if (!target) { target = { target: style.target, values: {} }; style.styles.push(target); }
    Object.assign(target.values, fontProperties(resolve(style.id)));
    const conditionalTargets: Record<string, string> = {
      firstRow: "tr.first-row td span", lastRow: "tr.last-row td span",
      firstCol: "td.first-col span", lastCol: "td.last-col span",
      band1Vert: "td.odd-col span", band2Vert: "td.even-col span",
      band1Horz: "tr.odd-row span", band2Horz: "tr.even-row span",
    };
    for (const conditional of Array.from(sources.get(style.id)?.children ?? []).filter((entry) => entry.localName === "tblStylePr")) {
      const targetName = conditionalTargets[attr(conditional, "type") ?? ""];
      const entry = style.styles.find((candidate) => candidate.target === targetName);
      if (entry) {
        // Table fonts are inherited by paragraphs; explicit paragraph/character fonts win.
        const cellTarget = targetName.replace(/ span$/, "").replace(/^(tr\.[\w-]+)$/, "$1 td");
        style.styles.push({ target: cellTarget, mod: entry.mod,
          values: { ...fontProperties(properties(child(conditional, "rPr"))),
            ...toggleLevel(properties(child(conditional, "rPr")), "table", false) } });
      }
    }
  }

  for (const part of parsed.parts) {
    const roots = part.body ? [part.body] : part.rootElement ? [part.rootElement] : part.notes ?? [];
    if (!roots.length) continue;
    for (const root of roots) Object.assign(root.cssStyle ??= {}, rootValues);
    const source = xml(part.path);
    if (!source) continue;
    const runs = roots.flatMap((root) => descendants(root, "run"));
    const xmlRuns = Array.from(source.getElementsByTagNameNS(word, "r"));
    if (runs.length !== xmlRuns.length) throw new Error(`DOCX 字体配置无法与正文对应（${part.path}），请下载原件查看。`);
    const runProperties = (run: Element) => {
      const direct = properties(child(run, "rPr"));
      const id = attr(child(child(run, "rPr"), "rStyle"), "val");
      const character = id && attr(sources.get(id), "type") === "character" ? resolve(id) : {};
      // Reset absent direct properties so a surrounding drawing/text-box run cannot
      // leak its direct bold into a nested paragraph. Character styles are explicit.
      return { ...direct, ...toggleLevel(direct, "run"), ...toggleLevel(character, "character") };
    };
    xmlRuns.forEach((run, index) => Object.assign(runs[index].cssStyle ??= {}, runProperties(run)));
    const mathRuns = roots.flatMap((root) => descendants(root, "mmlRun"));
    const xmlMathRuns = Array.from(source.getElementsByTagNameNS(math, "r"));
    if (mathRuns.length !== xmlMathRuns.length) throw new Error(`DOCX 公式字体配置无法对应（${part.path}），请下载原件查看。`);
    xmlMathRuns.forEach((run, index) => Object.assign(mathRuns[index].cssStyle ??= {}, runProperties(run)));
    const paragraphs = roots.flatMap((root) => descendants(root, "paragraph"));
    const xmlParagraphs = Array.from(source.getElementsByTagNameNS(word, "p"));
    if (paragraphs.length !== xmlParagraphs.length) throw new Error(`DOCX 段落字体配置无法对应（${part.path}），请下载原件查看。`);
    xmlParagraphs.forEach((paragraph, index) => {
      const id = attr(child(child(paragraph, "pPr"), "pStyle"), "val");
      const style = id && attr(sources.get(id), "type") === "paragraph" ? sources.get(id) : defaultStyles.get("paragraph");
      Object.assign(paragraphs[index].cssStyle ??= {},
        toggleLevel(style ? resolve(attr(style, "styleId")!) : {}, "paragraph"),
        toggleLevel({}, "character"), toggleLevel({}, "run"), toggleLevel({}, "mark-run"));
      // Paragraph-mark formatting affects line metrics, but must not override text runs.
      const mark = properties(child(child(paragraph, "pPr"), "rPr"));
      Object.assign(paragraphs[index].cssStyle ??= {}, Object.fromEntries(Object.entries(mark)
        .map(([name, value]) => [name.replace("--docx-", "--docx-mark-"), value])));
    });
    const tables = roots.flatMap((root) => descendants(root, "table"));
    const xmlTables = Array.from(source.getElementsByTagNameNS(word, "tbl"));
    if (tables.length !== xmlTables.length) throw new Error(`DOCX 表格字体配置无法对应（${part.path}），请下载原件查看。`);
    xmlTables.forEach((table, index) => {
      const id = attr(child(child(table, "tblPr"), "tblStyle"), "val");
      const style = id && attr(sources.get(id), "type") === "table" ? sources.get(id) : defaultStyles.get("table");
      Object.assign(tables[index].cssStyle ??= {}, toggleLevel(style ? resolve(attr(style, "styleId")!) : {}, "table"));
    });
  }

  const numbering = xml(parsed.numberingPart?.path);
  const abstracts = new Map(Array.from(numbering?.getElementsByTagNameNS(word, "abstractNum") ?? [])
    .map((entry) => [attr(entry, "abstractNumId"), entry]));
  for (const num of Array.from(numbering?.getElementsByTagNameNS(word, "num") ?? [])) {
    const id = attr(num, "numId");
    const abstract = abstracts.get(attr(child(num, "abstractNumId"), "val"));
    for (const level of parsed.numberingPart?.domNumberings.filter((entry) => entry.id === id) ?? []) {
      const match = (entry: Element) => Number(attr(entry, "ilvl")) === level.level;
      const base = Array.from(abstract?.children ?? []).find((entry) => entry.localName === "lvl" && match(entry));
      const override = Array.from(num.children).find((entry) => entry.localName === "lvlOverride" && match(entry));
      Object.assign(level.rStyle, properties(child(base, "rPr")), properties(child(child(override, "lvl"), "rPr")));
      const format = attr(child(child(override, "lvl"), "numFmt"), "val") || attr(child(base, "numFmt"), "val");
      if (format) level.rStyle["--docx-number-format"] = JSON.stringify(format);
    }
  }
  const theme = xml(parsed.themePart?.path);
  return (name, languages) => {
    const group = theme?.getElementsByTagNameNS(drawing, name.startsWith("major") ? "majorFont" : "minorFont")[0];
    const slot = name.endsWith("EastAsia") ? "ea" : name.endsWith("Bidi") ? "cs" : "latin";
    // The theme token determines its region even when asciiTheme refers to minorEastAsia.
    // themeFontLang defines theme mapping independently of the run's proofreading language.
    const region = slot === "ea" ? "eastAsia" : slot === "cs" ? "cs" : "latin";
    const themeLang = attr(themeLanguage, slot === "ea" ? "eastAsia" : slot === "cs" ? "bidi" : "val");
    const language = themeLang || languages[region];
    const primary = Array.from(group?.children ?? []).find((entry) => entry.localName === slot)?.getAttribute("typeface");
    const regional = Array.from(group?.children ?? []).find((entry) => entry.localName === "font" && entry.getAttribute("script") === script(language));
    const mapped = regional?.getAttribute("typeface");
    const font = themeLang ? mapped || primary : primary || mapped;
    if (!font) throw new Error(`DOCX 主题字体未配置：${name}（${language || "未指定语言"}）。`);
    return font;
  };
}
