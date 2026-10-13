import type { DocxFontTheme } from "./docxFontConfig";
import { docxFontCoverage, docxFontMember, docxFontUnderline } from "./docxFontAsset";

type Face = { weight: string; style: string; file: string; member: number };
type ProjectFont = { family: string; aliases: string[]; faces: Face[] };
type LoadedFace = { data: ArrayBuffer; covers: ReturnType<typeof docxFontCoverage>; underline: ReturnType<typeof docxFontUnderline> };
const face = (file: string, weight = "400", style = "normal", member = 0): Face => ({ file, weight, style, member });
const chinese = (family: string, aliases: string[], regular: string, bold?: string, member = 0): ProjectFont => ({
  family: `MoyinDocx${family}`, aliases,
  faces: [face(regular, "400", "normal", member), ...(bold ? [face(bold, "700", "normal", member)] : [])],
});
const latin = (family: string, aliases: string[], files: string[]): ProjectFont => ({
  family: `MoyinDocx${family}`, aliases,
  faces: files.map((file, index) => face(file, index % 2 ? "700" : "400", index > 1 ? "italic" : "normal")),
});
const fonts = [
  chinese("Song", ["宋体", "SimSun"], "simsun.ttc"),
  chinese("NewSong", ["新宋体", "NSimSun"], "simsun.ttc", undefined, 1),
  chinese("FangSong", ["仿宋", "FangSong"], "simfang.ttf"),
  chinese("FangSongLegacy", ["仿宋_GB2312", "FangSong_GB2312"], "fangsong_gb2312.ttf"),
  chinese("Hei", ["黑体", "SimHei"], "simhei.ttf"),
  chinese("YaHei", ["微软雅黑", "Microsoft YaHei"], "msyh.ttc", "msyhbd.ttc"),
  chinese("YaHeiUI", ["微软雅黑 UI", "Microsoft YaHei UI"], "msyh.ttc", "msyhbd.ttc", 1),
  chinese("YaHeiLight", ["微软雅黑 Light", "Microsoft YaHei Light"], "msyhl.ttc"),
  chinese("YaHeiUILight", ["微软雅黑 UI Light", "Microsoft YaHei UI Light"], "msyhl.ttc", undefined, 1),
  chinese("DengXian", ["等线", "DengXian"], "deng.ttf", "dengb.ttf"),
  chinese("DengXianLight", ["等线 Light", "DengXian Light"], "dengl.ttf"),
  chinese("Kai", ["楷体", "KaiTi"], "simkai.ttf"),
  chinese("XingKai", ["华文行楷", "STXingkai"], "stxingka.ttf"),
  chinese("ZhongSong", ["华文中宋", "STZhongsong"], "stzhongs.ttf"),
  chinese("STSong", ["华文宋体", "STSong"], "stsong.ttf"),
  chinese("STKai", ["华文楷体", "STKaiti"], "stkaiti.ttf"),
  chinese("STFangSong", ["华文仿宋", "STFangsong"], "stfangso.ttf"),
  chinese("KaiLegacy", ["楷体_GB2312", "KaiTi_GB2312"], "kaiti_gb2312.ttf"),
  latin("Times", ["Times New Roman"], ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"]),
  latin("Arial", ["Arial"], ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"]),
  latin("Calibri", ["Calibri"], ["calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"]),
  latin("Aptos", ["Aptos"], ["aptos.ttf", "aptos-bold.ttf", "aptos-italic.ttf", "aptos-bold-italic.ttf"]),
  ...["Display", "Narrow", "Mono", "Serif"].map((variant) => {
    const file = `aptos-${variant.toLowerCase()}`;
    return latin(`Aptos${variant}`, [`Aptos ${variant}`], [`${file}.ttf`, `${file}-bold.ttf`, `${file}-italic.ttf`, `${file}-bold-italic.ttf`]);
  }),
  ...["Light", "SemiBold", "ExtraBold", "Black"].map((variant) => {
    const file = `aptos-${variant.toLowerCase()}`;
    // These names identify standalone families in Word's legacy font selection.
    // The file already contains the requested weight; retain its original glyphs.
    return { family: `MoyinDocxAptos${variant}`, aliases: [`Aptos ${variant}`],
      faces: [face(`${file}.ttf`), face(`${file}-italic.ttf`, "400", "italic")] };
  }),
  { family: "MoyinDocxCalibriLight", aliases: ["Calibri Light"], faces: [face("calibril.ttf"), face("calibrili.ttf", "400", "italic")] },
  latin("Consolas", ["Consolas"], ["consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf"]),
  latin("Courier", ["Courier New"], ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"]),
  latin("Cambria", ["Cambria"], ["cambria.ttc", "cambriab.ttf", "cambriai.ttf", "cambriaz.ttf"]),
  { family: "MoyinDocxCambriaMath", aliases: ["Cambria Math"], faces: [face("cambria.ttc", "400", "normal", 1)] },
  { family: "MoyinDocxWingdings2", aliases: ["Wingdings 2"], faces: [face("wingdng2.ttf")] },
  { family: "MoyinDocxSymbol", aliases: ["Symbol"], faces: [face("symbol.ttf")] },
  { family: "MoyinDocxWingdings", aliases: ["Wingdings"], faces: [face("wingding.ttf")] },
  { family: "MoyinDocxWingdings3", aliases: ["Wingdings 3"], faces: [face("wingdng3.ttf")] },
  { family: "MoyinDocxWebdings", aliases: ["Webdings"], faces: [face("webdings.ttf")] },
];
const byName = new Map(fonts.flatMap((font) => font.aliases.map((alias) => [alias.toLowerCase(), font] as const)));
const loaded = new Map<string, Promise<LoadedFace>>();
const buffers = new Map<string, Promise<ArrayBuffer>>();

function fontData(file: string): Promise<ArrayBuffer> {
  const cached = buffers.get(file);
  if (cached) return cached;
  const loading = fetch(`/docx-fonts/${file}`).then(async (response) => {
    if (!response.ok) throw new Error("Font asset unavailable");
    const data = await response.arrayBuffer();
    // Missing public assets may return the SPA HTML with HTTP 200.
    if (data.byteLength < 4 || ![0x00010000, 0x4f54544f, 0x74746366].includes(new DataView(data).getUint32(0))) throw new Error("Invalid font asset");
    return data;
  });
  buffers.set(file, loading);
  void loading.catch(() => buffers.delete(file));
  return loading;
}

function loadFace(font: ProjectFont, selected: Face): Promise<LoadedFace> {
  const key = `${font.family}:${selected.weight}:${selected.style}`;
  const cached = loaded.get(key);
  if (cached) return cached;
  const loading = (async () => {
    try {
      const data = docxFontMember(await fontData(selected.file), selected.member);
      const resource = new FontFace(font.family, data, { weight: selected.weight, style: selected.style });
      await resource.load();
      const covers = docxFontCoverage(data);
      document.fonts.add(resource);
      return { data, covers, underline: docxFontUnderline(data) };
    } catch {
      throw new Error(`DOCX 字体加载失败：${font.aliases[0]}（${selected.file}）。请检查 docx-fonts 中的文件。`);
    }
  })();
  loaded.set(key, loading);
  void loading.catch(() => loaded.delete(key));
  return loading;
}

const value = (style: CSSStyleDeclaration, key: string): string => {
  const raw = style.getPropertyValue(key).trim();
  return raw ? JSON.parse(raw) : "";
};
let numberingFamily = 0;
const compatibleFonts: Record<string, string> = {
  MoyinDocxFangSongLegacy: "仿宋", MoyinDocxKaiLegacy: "楷体",
};
const counterCharacters: Record<string, string> = {
  decimal: "0123456789", decimalZero: "0123456789",
  upperRoman: "IVXLCDM", lowerRoman: "ivxlcdm",
  upperLetter: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lowerLetter: "abcdefghijklmnopqrstuvwxyz",
  chineseCounting: "零一二三四五六七八九十百千万亿",
  chineseCountingThousand: "零一二三四五六七八九十百千万亿",
  chineseLegalSimplified: "零壹贰叁肆伍陆柒捌玖拾佰仟万亿",
};
const counterFormats: Record<string, string> = {
  "decimal-leading-zero": "decimalZero", "upper-roman": "upperRoman", "lower-roman": "lowerRoman",
  "upper-alpha": "upperLetter", "lower-alpha": "lowerLetter", "upper-latin": "upperLetter", "lower-latin": "lowerLetter",
  "cjk-decimal": "chineseCounting", "cjk-ideographic": "chineseCounting", "simp-chinese-informal": "chineseCounting",
  "simp-chinese-formal": "chineseLegalSimplified",
};
// Word's documented script-slot rules (MS-OI29500 2.1.88), including punctuation hints.
function slot(character: string, style: CSSStyleDeclaration): string {
  if (["cs", "rtl"].some((name) => style.getPropertyValue(`--docx-run-${name}`).trim() === "1")) return "cs";
  const code = character.codePointAt(0)!;
  if (code < 0x80) return "ascii";
  if ((code >= 0x590 && code <= 0x7bf) || (code >= 0xfb1d && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfefe)) return "ascii";
  if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x2f00 && code <= 0x2fdf)
    || (code >= 0x2ff0 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xa000 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xffef) || /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) return "eastasia";
  if (value(style, "--docx-font-hint") === "eastAsia") {
    const chinese = value(style, "--docx-language-eastasia").toLowerCase().startsWith("zh");
    if ([0xa1, 0xa4, 0xaa, 0xad, 0xaf, 0xd7, 0xf7].includes(code) || (code >= 0xa7 && code <= 0xa8)
      || (code >= 0xb0 && code <= 0xb4) || (code >= 0xb6 && code <= 0xba) || (code >= 0xbc && code <= 0xbf)
      || (code >= 0x2b0 && code <= 0x4ff) || (code >= 0x2000 && code <= 0x27bf)
      || (code >= 0x2e80 && code <= 0x2eff) || (code >= 0xe000 && code <= 0xf8ff)
      || (code >= 0xfb00 && code <= 0xfb1c)) return "eastasia";
    if (chinese && ((code >= 0x100 && code <= 0x2af) || (code >= 0x1e00 && code <= 0x1eff)
      || [0xe0, 0xe1, 0xe8, 0xe9, 0xea, 0xec, 0xed, 0xf2, 0xf3, 0xf9, 0xfa, 0xfc].includes(code))) return "eastasia";
  }
  return "hansi";
}

// MS-OI29500 2.1.230 / ISO 29500 17.7.3: resolve basedOn within each
// level first, then combine table, paragraph and character style levels.
// Direct run formatting is absolute; bCs/iCs do not inherit b/i.
function runToggle(style: CSSStyleDeclaration, name: string, paragraphMark: boolean): boolean {
  const read = (level: string) => style.getPropertyValue(`--docx-${level}-${name}`).trim();
  const direct = paragraphMark ? read("mark-run") : read("run");
  if (direct === "0" || direct === "1") return direct === "1";
  const initial = read("default") === "1";
  let result = initial;
  for (const level of ["table", "paragraph", "character"]) {
    const value = read(level);
    // Word uses document defaults for an unspecified hierarchy level. With a
    // true default, an even number of false levels leaves the effective value true.
    if ((value === "0" || value === "1") && (value === "1") !== initial) result = !result;
  }
  return result;
}

// Font names come exclusively from XML metadata, never a computed OS font-family.
export async function applyProjectDocxFonts(body: HTMLElement, theme: DocxFontTheme) {
  type Selection = { font: ProjectFont; face: Face; key: string; characters: Set<number>; weight: string; style: string };
  const required = new Map<string, Selection>();
  const resources = new Map<string, LoadedFace>();
  const selectionFor = (font: ProjectFont, weight: string, style: string): Selection => {
    const key = `${font.family}:${weight}:${style}`;
    const cached = required.get(key);
    if (cached) return cached;
    const selected = font.faces.find((entry) => entry.weight === weight && entry.style === style)
      ?? font.faces.find((entry) => entry.weight === weight && entry.style === "normal")
      ?? font.faces.find((entry) => entry.weight === "400" && entry.style === style) ?? font.faces[0];
    const request = { font, face: selected, key, characters: new Set<number>(), weight, style };
    required.set(key, request);
    return request;
  };
  const select = (text: string, style: CSSStyleDeclaration, paragraphMark = false) => {
    const groups: { text: string; selection: Selection }[] = [];
    const names = new Map<string, string>();
    // Formatting is constant for this run; do not re-read the cascade per glyph.
    const regular = { weight: runToggle(style, "b", paragraphMark) ? "700" : "400",
      fontStyle: runToggle(style, "i", paragraphMark) ? "italic" : "normal" };
    const complex = { weight: runToggle(style, "bcs", paragraphMark) ? "700" : "400",
      fontStyle: runToggle(style, "ics", paragraphMark) ? "italic" : "normal" };
    const language = (region: string) => (paragraphMark ? value(style, `--docx-mark-language-${region}`) : "")
      || value(style, `--docx-language-${region}`);
    const languages = { latin: language("latin"), eastAsia: language("eastasia"), cs: language("cs") };
    const configuredName = (scriptSlot: string) => {
      if (names.has(scriptSlot)) return names.get(scriptSlot)!;
      const configured = (paragraphMark ? value(style, `--docx-mark-font-${scriptSlot}`) : value(style, "--docx-font-symbol"))
        || value(style, `--docx-font-${scriptSlot}`);
      const name = configured.startsWith("theme:") ? theme(configured.slice(6), languages) : configured;
      names.set(scriptSlot, name); return name;
    };
    for (const character of text) {
      let scriptSlot = slot(character, style);
      if (scriptSlot === "eastasia" && configuredName("eastasia").toLowerCase() === "times new roman"
        && configuredName("ascii") && configuredName("ascii") === configuredName("hansi")) scriptSlot = "ascii";
      const name = configuredName(scriptSlot);
      if (!name) throw new Error(`DOCX XML 未配置 ${scriptSlot} 字体，请补充文档字体配置或下载原件查看。`);
      const font = byName.get(name.replace(/^@/, "").toLowerCase());
      if (!font) throw new Error(`DOCX 缺少项目字体：${name}。请将该原版字体补充到 docx-fonts 并注册，或下载原件查看。`);
      const { weight, fontStyle } = scriptSlot === "cs" ? complex : regular;
      // Synthesize only within this same family if an independent face does not exist.
      const selection = selectionFor(font, weight, fontStyle);
      const key = selection.key;
      const code = character.codePointAt(0)!;
      if (!/\p{Cc}|\p{Default_Ignorable_Code_Point}/u.test(character)) selection.characters.add(code);
      const previous = groups[groups.length - 1];
      if (previous?.selection.key === key && previous.selection.weight === weight && previous.selection.style === fontStyle) previous.text += character;
      else groups.push({ text: character, selection });
    }
    return groups;
  };
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts: { node: Text; groups: ReturnType<typeof select>; underline: string; underlineColor: string }[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text, parent = node.parentElement;
    if (!parent || parent.closest("style, script") || !node.data) continue;
    if (parent.getClientRects().length === 0) continue;
    const style = getComputedStyle(parent);
    const underline = value(style, "--docx-underline");
    let decoration = style;
    if (underline === "single" && !style.textDecorationLine.includes("underline")) {
      // Text decoration propagates rather than inheriting; an ancestor may own
      // its color when underline formatting came from a paragraph/table style.
      for (let ancestor = parent.parentElement; ancestor && ancestor !== body; ancestor = ancestor.parentElement) {
        const candidate = getComputedStyle(ancestor);
        if (candidate.textDecorationLine.includes("underline")) { decoration = candidate; break; }
      }
    }
    texts.push({ node, groups: select(node.data, style), underline,
      underlineColor: value(style, "--docx-underline-color") || decoration.textDecorationColor });
  }
  // Paragraph struts (including blank lines) also need XML fonts for stable line metrics.
  const paragraphs = Array.from(body.querySelectorAll<HTMLElement>("p, li"))
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => ({ element, selection: select(" ", getComputedStyle(element), true)[0].selection }));
  const pseudos: { element: HTMLElement; name: string; counters: string; groups: ReturnType<typeof select> }[] = [];
  for (const element of Array.from(body.querySelectorAll<HTMLElement>("*"))) {
    if (!(element instanceof HTMLElement) || element.getClientRects().length === 0) continue;
    for (const name of ["before", "after", "marker"]) {
      const style = getComputedStyle(element, `::${name}`);
      const list = getComputedStyle(element);
      const marker = name === "marker" && list.display === "list-item" && list.listStyleType !== "none";
      if (!marker && (style.display === "none" || ["none", "normal", '""'].includes(style.content))) continue;
      // CSSOM does not expose counter output; collect characters from its XML number format.
      const format = marker ? counterFormats[list.listStyleType] || list.listStyleType : value(style, "--docx-number-format") || "decimal";
      const formats = marker ? [format] : Array.from(style.content.matchAll(/counter\([^,)]+(?:,\s*([^\s)]+))?\)/g),
        (match) => match[1] ? counterFormats[match[1]] || match[1] : "decimal");
      for (const format of formats) if (!counterCharacters[format]) throw new Error(`DOCX 编号字体暂不支持格式：${format}，请下载原件查看。`);
      const counters = formats.map((format) => counterCharacters[format]).join("");
      const text = Array.from(style.content.matchAll(/"((?:[^"\\]|\\.)*)"/g), (match) => match[1].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))).join("")
        + counters + (marker ? ". " : "");
      if (!text.trim()) continue;
      const groups = select(text, style);
      pseudos.push({ element, name, counters, groups });
    }
  }
  await Promise.all(Array.from(required.values(), async (request) => {
    const resource = await loadFace(request.font, request.face);
    resources.set(request.key, resource);
  }));
  // Resolve unique missing glyphs once. Only the missing characters may change font.
  type Replacement = { selection: Selection; text: string };
  const replacements = new Map<string, Map<number, Replacement>>();
  const notices = new Map<string, Set<number>>();
  const note = (source: Selection, target: string, code: number) => {
    const message = `${source.font.aliases[0]} → ${target}`;
    let codes = notices.get(message);
    if (!codes) { codes = new Set(); notices.set(message, codes); }
    codes.add(code);
  };
  const ensureResource = async (selection: Selection) => {
    const resource = resources.get(selection.key) ?? await loadFace(selection.font, selection.face);
    resources.set(selection.key, resource);
    return resource;
  };
  const requests = Array.from(required.values());
  await Promise.all(requests.map(async (source) => {
    const missing = Array.from(source.characters).filter((code) => !resources.get(source.key)!.covers(code));
    if (!missing.length) return;
    const resolved = new Map<number, Replacement>();
    replacements.set(source.key, resolved);
    await Promise.all(missing.map(async (code) => {
      const text = String.fromCodePoint(code);
      // Private-use/symbol glyphs have font-specific meanings; never guess a substitute.
      const privateUse = (code >= 0xe000 && code <= 0xf8ff) || (code >= 0xf0000 && code <= 0xffffd)
        || (code >= 0x100000 && code <= 0x10fffd);
      const candidates = resources.get(source.key)!.covers.symbol || privateUse ? []
        : [compatibleFonts[source.font.family], "宋体", "微软雅黑"];
      for (const name of new Set(candidates.filter(Boolean))) {
        const font = byName.get(name.toLowerCase())!;
        if (font === source.font) continue;
        const target = selectionFor(font, source.weight, source.style);
        if ((await ensureResource(target)).covers(code)) {
          resolved.set(code, { selection: target, text });
          note(source, font.aliases[0], code);
          return;
        }
      }
      // A verified project glyph marks missing text; the notice retains its code point.
      const target = selectionFor(byName.get("宋体")!, source.weight, source.style);
      const label = "□";
      const resource = await ensureResource(target);
      if (!Array.from(label).every((character) => resource.covers(character.codePointAt(0)!))) {
        throw new Error("DOCX 缺字占位字体不可用，请检查项目宋体文件。");
      }
      resolved.set(code, { selection: target, text: label });
      note(source, "缺字占位", code);
    }));
  }));
  const replaceGroups = (groups: ReturnType<typeof select>): ReturnType<typeof select> => {
    const result: ReturnType<typeof select> = [];
    for (const group of groups) {
      const missing = replacements.get(group.selection.key);
      if (!missing) { result.push({ ...group }); continue; }
      for (const character of group.text) {
        const replacement = missing.get(character.codePointAt(0)!);
        const selection = replacement?.selection ?? group.selection;
        const text = replacement?.text ?? character;
        const previous = result[result.length - 1];
        if (previous?.selection.key === selection.key) previous.text += text;
        else result.push({ text, selection });
      }
    }
    return result;
  };
  const glyphText = (text: string, selection: Selection) => resources.get(selection.key)?.covers.symbol
    ? Array.from(text, (character) => {
      const code = character.codePointAt(0)!;
      return code >= 0x20 && code <= 0xff && !/\p{Cc}|\p{Default_Ignorable_Code_Point}/u.test(character)
        ? String.fromCodePoint(code + 0xf000) : character;
    }).join("") : text;
  for (const { element, selection } of paragraphs) {
    element.style.setProperty("font-family", `"${selection.font.family}"`, "important");
    element.style.setProperty("font-weight", selection.weight, "important");
    element.style.setProperty("font-style", selection.style, "important");
    element.style.setProperty("font-synthesis", "weight style", "important");
  }
  const decorationWarnings = new Set<string>();
  for (const { node, groups: originalGroups, underline, underlineColor } of texts) {
    const groups = replaceGroups(originalGroups);
    const parent = node.parentElement!;
    if (new Set(groups.map((group) => `${group.selection.weight}:${group.selection.style}`)).size === 1) {
      // Also retain formatting when a PAGE field subsequently replaces its text.
      (parent as HTMLElement).style.setProperty("font-weight", groups[0].selection.weight, "important");
      (parent as HTMLElement).style.setProperty("font-style", groups[0].selection.style, "important");
      (parent as HTMLElement).style.setProperty("font-synthesis", "weight style", "important");
    }
    if (new Set(groups.map((group) => group.selection.font.family)).size === 1) {
      // PAGE fields replace their text after pagination; preserve their private font on the parent.
      (parent as HTMLElement).style.setProperty("font-family", `"${groups[0].selection.font.family}"`, "important");
      node.data = groups.map((group) => glyphText(group.text, group.selection)).join("");
    }
    if (parent.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      if (new Set(originalGroups.map((group) => group.selection.font.family)).size !== 1) throw new Error("DOCX 公式或图形中的混合字体暂无法准确预览，请下载原件查看。");
      const families = new Set([originalGroups[0].selection.font.family, ...groups.map((group) => group.selection.font.family)]);
      (parent as HTMLElement).style.setProperty("font-family", Array.from(families, (family) => `"${family}"`).join(", "), "important");
      node.data = groups.map((group) => glyphText(group.text, group.selection)).join("");
      continue;
    }
    const fragment = document.createDocumentFragment();
    for (const { text, selection } of groups) {
      // Renderer styles target span; a neutral inline element must not reapply defaults
      // (especially font-size) inside an already formatted run.
      // Split underline spaces from text; preserve the original characters,
      // white-space handling and font advance (no NBSP or replacement underscores).
      const pieces = underline === "single" ? text.match(/ +|[^ ]+/g) ?? [] : [text];
      for (const piece of pieces) {
        const span = document.createElement("docx-text");
        span.textContent = glyphText(piece, selection);
        span.style.setProperty("font-family", `"${selection.font.family}"`, "important");
        span.style.setProperty("font-weight", selection.weight, "important");
        span.style.setProperty("font-style", selection.style, "important");
        span.style.setProperty("font-synthesis", "weight style", "important");
        span.dataset.docxWeight = selection.weight;
        span.dataset.docxFaceWeight = selection.face.weight;
        if (underline) span.dataset.docxUnderline = underline;
        if (underline === "single") {
          const metrics = resources.get(selection.key)!.underline;
          if (metrics) {
            span.style.setProperty("--docx-underline-position", String(metrics.position));
            span.style.setProperty("--docx-underline-thickness", String(metrics.thickness));
            span.style.setProperty("--docx-underline-color", underlineColor);
          } else decorationWarnings.add("部分字体缺少有效的下划线度量，所在段落保留库的处理。");
        } else if (underline && !["none", "words", "single"].includes(underline) && / /.test(piece)) {
          decorationWarnings.add("非单实线的空白下划线保留库的处理，行首、行尾效果可能与 Word 不同。");
        }
        fragment.appendChild(span);
      }
    }
    node.replaceWith(fragment);
  }
  const generated: FontFace[] = [];
  const markerCache = new Map<string, string>();
  try {
    for (const { element, name, counters, groups: originalGroups } of pseudos) {
      const groups = replaceGroups(originalGroups);
      const faces = new Map<string, { selection: Selection; characters: Set<number> }>();
      for (const { text, selection } of groups) {
        const key = `${selection.font.family}:${selection.face.weight}:${selection.face.style}`;
        let entry = faces.get(key);
        if (!entry) { entry = { selection, characters: new Set() }; faces.set(key, entry); }
        for (const character of text) {
          entry.characters.add(character.codePointAt(0)!);
          entry.characters.add(glyphText(character, selection).codePointAt(0)!);
        }
      }
      const entries = Array.from(faces.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, { selection, characters }]) => ({ key, selection,
        range: Array.from(characters).sort((a, b) => a - b).map((code) => `U+${code.toString(16)}`).join(", ") }));
      const cacheKey = JSON.stringify(entries.map(({ key, range }) => [key, range]));
      let family = markerCache.get(cacheKey);
      if (!family) {
        family = `MoyinDocxNumber${++numberingFamily}`;
        const fontFamily = family;
        const results = await Promise.allSettled(entries.map(async ({ selection, range }) => {
          const { data } = await loadFace(selection.font, selection.face);
          // Unicode ranges implement the XML slot assignment for generated list markers.
          const resource = new FontFace(fontFamily, data, { weight: selection.face.weight, style: selection.face.style,
            unicodeRange: range });
          await resource.load();
          document.fonts.add(resource); generated.push(resource);
        }));
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        markerCache.set(cacheKey, family);
      }
      // Normalize legacy symbol bytes in literal bullets, retaining counters and all other CSS.
      const content = getComputedStyle(element, `::${name}`).content;
      let mappedContent = content.replace(/"((?:[^"\\]|\\.)*)"/g, (match, literal: string) => {
        const decoded = literal.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
        const mapped = Array.from(decoded, (character) => {
          const selection = originalGroups.find((group) => group.text.includes(character))?.selection;
          if (!selection) return character;
          const replacement = replacements.get(selection.key)?.get(character.codePointAt(0)!);
          return replacement ? glyphText(replacement.text, replacement.selection) : glyphText(character, selection);
        }).join("");
        return mapped === decoded ? match : JSON.stringify(mapped);
      });
      // CSS counters cannot replace individual output characters. If any counter glyph
      // has no project font, show an explicit marker rather than permit system fallback.
      const missingCounter = originalGroups.some((group) => Array.from(counters).some((character) => {
        const replacement = replacements.get(group.selection.key)?.get(character.codePointAt(0)!);
        return group.text.includes(character) && replacement && replacement.text !== character;
      }));
      if (missingCounter) mappedContent = JSON.stringify("□");
      if (mappedContent !== content) {
        element.setAttribute(`data-docx-project-${name}-content`, "");
        element.style.setProperty(`--docx-project-${name}-content`, mappedContent);
      }
      element.setAttribute(`data-docx-project-${name}`, "");
      element.style.setProperty(`--docx-project-${name}-fonts`, `"${family}"`);
      // A single-face Chinese font still needs the requested weight on the
      // pseudo-element; choosing its regular file alone cannot synthesize bold.
      const weights = new Set(groups.map((group) => group.selection.weight));
      const styles = new Set(groups.map((group) => group.selection.style));
      if (weights.size === 1) element.style.setProperty(`--docx-project-${name}-weight`, groups[0].selection.weight);
      if (styles.size === 1) element.style.setProperty(`--docx-project-${name}-style`, groups[0].selection.style);
    }
  } catch (reason) {
    for (const resource of generated) document.fonts.delete(resource);
    throw reason;
  }
  const warnings = Array.from(notices, ([message, codes]) => {
    const sample = Array.from(codes).sort((a, b) => a - b).slice(0, 12)
      .map((code) => `${String.fromCodePoint(code)}（U+${code.toString(16).toUpperCase()}）`).join("、");
    return `${message}：${sample}${codes.size > 12 ? `等 ${codes.size} 种字符` : ""}`;
  });
  return { warnings: [...warnings, ...decorationWarnings],
    release: () => { for (const resource of generated) document.fonts.delete(resource); } };
}
