import type { DocxFontTheme } from "./docxFontConfig";
import { docxFontCoverage, docxFontMember } from "./docxFontAsset";

type Face = { weight: string; style: string; file: string; member: number };
type ProjectFont = { family: string; aliases: string[]; faces: Face[] };
type LoadedFace = { data: ArrayBuffer; covers: ReturnType<typeof docxFontCoverage> };
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
  chinese("KaiLegacy", ["楷体_GB2312", "KaiTi_GB2312"], "kaiti_gb2312.ttf"),
  latin("Times", ["Times New Roman"], ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"]),
  latin("Arial", ["Arial"], ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"]),
  latin("Calibri", ["Calibri"], ["calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"]),
  { family: "MoyinDocxCalibriLight", aliases: ["Calibri Light"], faces: [face("calibril.ttf"), face("calibrili.ttf", "400", "italic")] },
  latin("Consolas", ["Consolas"], ["consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf"]),
  latin("Courier", ["Courier New"], ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"]),
  latin("Cambria", ["Cambria"], ["cambria.ttc", "cambriab.ttf", "cambriai.ttf", "cambriaz.ttf"]),
  { family: "MoyinDocxCambriaMath", aliases: ["Cambria Math"], faces: [face("cambria.ttc", "400", "normal", 1)] },
  { family: "MoyinDocxWingdings2", aliases: ["Wingdings 2"], faces: [face("wingdng2.ttf")] },
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
      return { data, covers };
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

// Font names come exclusively from XML metadata, never a computed OS font-family.
export async function applyProjectDocxFonts(body: HTMLElement, theme: DocxFontTheme) {
  type Selection = { font: ProjectFont; face: Face; key: string; characters: Set<number>; weight: string; style: string };
  const required = new Map<string, Selection>();
  const resources = new Map<string, LoadedFace>();
  const select = (text: string, style: CSSStyleDeclaration, paragraphMark = false) => {
    const groups: { text: string; selection: Selection }[] = [];
    const names = new Map<string, string>();
    const configuredName = (scriptSlot: string) => {
      if (names.has(scriptSlot)) return names.get(scriptSlot)!;
      const configured = (paragraphMark ? value(style, `--docx-mark-font-${scriptSlot}`) : value(style, "--docx-font-symbol"))
        || value(style, `--docx-font-${scriptSlot}`);
      const language = value(style, `--docx-language-${scriptSlot === "eastasia" ? "eastasia" : scriptSlot === "cs" ? "cs" : "latin"}`);
      const name = configured.startsWith("theme:") ? theme(configured.slice(6), language) : configured;
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
      const csWeight = scriptSlot === "cs" ? style.getPropertyValue("--docx-run-bcs").trim() : "";
      const csItalic = scriptSlot === "cs" ? style.getPropertyValue("--docx-run-ics").trim() : "";
      const weight = csWeight ? (csWeight === "1" ? "700" : "400") : Number(style.fontWeight) >= 600 || style.fontWeight === "bold" ? "700" : "400";
      const italic = csItalic ? csItalic === "1" : /^(italic|oblique)/.test(style.fontStyle);
      const fontStyle = italic ? "italic" : "normal";
      // Synthesize only within this same family if an independent face does not exist.
      const selected = font.faces.find((entry) => entry.weight === weight && entry.style === fontStyle)
        ?? font.faces.find((entry) => entry.weight === weight && entry.style === "normal")
        ?? font.faces.find((entry) => entry.weight === "400" && entry.style === fontStyle) ?? font.faces[0];
      const key = `${font.family}:${selected.weight}:${selected.style}`;
      let request = required.get(key);
      if (!request) { request = { font, face: selected, key, characters: new Set(), weight, style: fontStyle }; required.set(key, request); }
      const code = character.codePointAt(0)!;
      if (code >= 0x20 && ![0x200c, 0x200d, 0x2060, 0xfeff].includes(code) && !(code >= 0xfe00 && code <= 0xfe0f)) request.characters.add(code);
      const selection = { ...request, weight, style: fontStyle };
      const previous = groups[groups.length - 1];
      if (previous?.selection.key === key && previous.selection.weight === weight && previous.selection.style === fontStyle) previous.text += character;
      else groups.push({ text: character, selection });
    }
    return groups;
  };
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts: { node: Text; groups: ReturnType<typeof select> }[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text, parent = node.parentElement;
    if (!parent || parent.closest("style, script") || !node.data) continue;
    if (parent.getClientRects().length === 0) continue;
    texts.push({ node, groups: select(node.data, getComputedStyle(parent)) });
  }
  // Paragraph struts (including blank lines) also need XML fonts for stable line metrics.
  const paragraphs = Array.from(body.querySelectorAll<HTMLElement>("p, li"))
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => ({ element, selection: select(" ", getComputedStyle(element), true)[0].selection }));
  const pseudos: { element: HTMLElement; name: string; family: string; groups: ReturnType<typeof select> }[] = [];
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
      const text = Array.from(style.content.matchAll(/"((?:[^"\\]|\\.)*)"/g), (match) => match[1].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))).join("")
        + formats.map((format) => counterCharacters[format]).join("") + (marker ? ". " : "");
      if (!text.trim()) continue;
      const groups = select(text, style);
      pseudos.push({ element, name, family: `MoyinDocxNumber${++numberingFamily}`, groups });
    }
  }
  await Promise.all(Array.from(required.values(), async (request) => {
    const resource = await loadFace(request.font, request.face);
    resources.set(request.key, resource);
    for (const code of request.characters) {
      if (!resource.covers(code)) throw new Error(`DOCX 字体 ${request.font.aliases[0]} 缺少字符 U+${code.toString(16).toUpperCase()}，已停止预览以避免系统字体替换。`);
    }
  }));
  const glyphText = (text: string, selection: Selection) => resources.get(selection.key)?.covers.symbol
    ? Array.from(text, (character) => {
      const code = character.codePointAt(0)!;
      return code >= 0x20 && code <= 0xff ? String.fromCodePoint(code + 0xf000) : character;
    }).join("") : text;
  for (const { element, selection } of paragraphs) element.style.setProperty("font-family", `"${selection.font.family}"`, "important");
  for (const { node, groups } of texts) {
    const parent = node.parentElement!;
    if (new Set(groups.map((group) => group.selection.font.family)).size === 1) {
      // PAGE fields replace their text after pagination; preserve their private font on the parent.
      (parent as HTMLElement).style.setProperty("font-family", `"${groups[0].selection.font.family}"`, "important");
      node.data = groups.map((group) => glyphText(group.text, group.selection)).join("");
    }
    if (parent.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      if (new Set(groups.map((group) => group.selection.font.family)).size !== 1) throw new Error("DOCX 公式或图形中的混合字体暂无法准确预览，请下载原件查看。");
      (parent as HTMLElement).style.setProperty("font-family", `"${groups[0].selection.font.family}"`, "important");
      continue;
    }
    const fragment = document.createDocumentFragment();
    for (const { text, selection } of groups) {
      // Renderer styles target span; a neutral inline element must not reapply defaults
      // (especially font-size) inside an already formatted run.
      const span = document.createElement("docx-text");
      span.textContent = glyphText(text, selection);
      span.style.setProperty("font-family", `"${selection.font.family}"`, "important");
      span.style.setProperty("font-weight", selection.weight, "important");
      span.style.setProperty("font-style", selection.style, "important");
      fragment.appendChild(span);
    }
    node.replaceWith(fragment);
  }
  const generated: FontFace[] = [];
  try {
    for (const { element, name, family, groups } of pseudos) {
      const faces = new Map<string, { selection: Selection; characters: Set<number> }>();
      for (const { text, selection } of groups) {
        const key = `${selection.key}:${selection.weight}:${selection.style}`;
        let entry = faces.get(key);
        if (!entry) { entry = { selection, characters: new Set() }; faces.set(key, entry); }
        for (const character of text) {
          entry.characters.add(character.codePointAt(0)!);
          entry.characters.add(glyphText(character, selection).codePointAt(0)!);
        }
      }
      const markerResources = await Promise.all(Array.from(faces.values(), async ({ selection, characters }) => {
        const { data } = await loadFace(selection.font, selection.face);
        // Unicode ranges implement the XML slot assignment for generated list markers.
        const resource = new FontFace(family, data, { weight: selection.face.weight, style: selection.face.style,
          unicodeRange: Array.from(characters, (code) => `U+${code.toString(16)}`).join(", ") });
        await resource.load(); return resource;
      }));
      for (const resource of markerResources) { document.fonts.add(resource); generated.push(resource); }
      // Normalize legacy symbol bytes in literal bullets, retaining counters and all other CSS.
      const content = getComputedStyle(element, `::${name}`).content;
      const mappedContent = content.replace(/"((?:[^"\\]|\\.)*)"/g, (match, literal: string) => {
        const decoded = literal.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
        const mapped = Array.from(decoded, (character) => {
          const selection = groups.find((group) => group.text.includes(character))?.selection;
          return selection ? glyphText(character, selection) : character;
        }).join("");
        return mapped === decoded ? match : JSON.stringify(mapped);
      });
      if (mappedContent !== content) {
        element.setAttribute(`data-docx-project-${name}-content`, "");
        element.style.setProperty(`--docx-project-${name}-content`, mappedContent);
      }
      element.setAttribute(`data-docx-project-${name}`, "");
      element.style.setProperty(`--docx-project-${name}-fonts`, `"${family}"`);
    }
  } catch (reason) {
    for (const resource of generated) document.fonts.delete(resource);
    throw reason;
  }
  return () => { for (const resource of generated) document.fonts.delete(resource); };
}
