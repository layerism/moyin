type Face = { weight: string; style: string; files: string[] };
type ProjectFont = { family: string; aliases: string[]; faces: Face[] };
const chinese = (family: string, aliases: string[], originals: string[], fallback: string): ProjectFont => ({
  family: `MoyinDocx${family}`, aliases,
  faces: [{ weight: "400", style: "normal", files: [...originals, `fallback/${fallback}.otf`] }],
});
const latin = (family: string, aliases: string[], originals: string[], fallback: string): ProjectFont => ({
  family: `MoyinDocx${family}`, aliases,
  faces: ["Regular", "Bold", "Italic", "BoldItalic"].map((style, index) => ({
    weight: index % 2 ? "700" : "400", style: index > 1 ? "italic" : "normal",
    files: [originals[index], `fallback/Liberation${fallback}-${style}.ttf`],
  })),
});
const fonts = [
  chinese("Song", ["宋体", "新宋体", "SimSun", "NSimSun", "serif"], ["simsun.ttc"], "FandolSong-Regular"),
  chinese("FangSong", ["仿宋", "FangSong"], ["simfang.ttf"], "FandolFang-Regular"),
  chinese("FangSongLegacy", ["仿宋_GB2312", "FangSong_GB2312"], ["fangsong_gb2312.ttf", "simfang.ttf"], "FandolFang-Regular"),
  chinese("Hei", ["黑体", "SimHei", "sans-serif", "system-ui"], ["simhei.ttf"], "FandolHei-Regular"),
  chinese("YaHei", ["微软雅黑", "Microsoft YaHei"], ["msyh.ttc"], "FandolHei-Regular"),
  chinese("DengXian", ["等线", "DengXian"], ["deng.ttf"], "FandolHei-Regular"),
  chinese("Kai", ["楷体", "KaiTi", "cursive"], ["simkai.ttf"], "FandolKai-Regular"),
  chinese("XingKai", ["华文行楷", "STXingkai"], ["stxingka.ttf"], "FandolKai-Regular"),
  chinese("KaiLegacy", ["楷体_GB2312", "KaiTi_GB2312"], ["kaiti_gb2312.ttf", "simkai.ttf"], "FandolKai-Regular"),
  latin("Times", ["Times New Roman", "Times"], ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"], "Serif"),
  latin("Arial", ["Arial", "Helvetica"], ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"], "Sans"),
  latin("Calibri", ["Calibri"], ["calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"], "Sans"),
  latin("Mono", ["Consolas", "Courier New", "monospace"], ["consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf"], "Mono"),
];
const byName = new Map(fonts.flatMap((font) => font.aliases.map((alias) => [alias.toLowerCase(), font] as const)));
const loaded = new Map<string, Promise<void>>();
const buffers = new Map<string, Promise<ArrayBuffer>>();

function fontData(file: string): Promise<ArrayBuffer> {
  const cached = buffers.get(file);
  if (cached) return cached;
  const loading = fetch(`/docx-fonts/${file}`).then(async (response) => {
    if (!response.ok) throw new Error("Font asset unavailable");
    const data = await response.arrayBuffer();
    // A missing public asset can return the SPA's index.html with status 200.
    if (data.byteLength < 4 || ![0x00010000, 0x4f54544f, 0x74746366].includes(new DataView(data).getUint32(0))) {
      throw new Error("Invalid font asset");
    }
    return data;
  });
  buffers.set(file, loading);
  void loading.catch(() => buffers.delete(file));
  return loading;
}

function loadFace(font: ProjectFont, face: Face): Promise<void> {
  const key = `${font.family}:${face.weight}:${face.style}`;
  const cached = loaded.get(key);
  if (cached) return cached;
  const loading = (async () => {
    for (const file of face.files) {
      try {
        const data = await fontData(file);
        const resource = new FontFace(font.family, data, { weight: face.weight, style: face.style });
        await resource.load();
        document.fonts.add(resource);
        return;
      } catch {
        // Try the next project file; never resolve a font from the operating system.
      }
    }
    throw new Error("DOCX 预览字体加载失败，请重新加载预览或下载原件查看。");
  })();
  loaded.set(key, loading);
  void loading.catch(() => loaded.delete(key));
  return loading;
}

function projectFamilies(value: string): ProjectFont[] {
  const families = (value.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+/g) ?? [])
    .map((name) => name.trim().replace(/^(['"])(.*)\1$/, "$2").toLowerCase());
  return [...new Set([...families.map((name) => byName.get(name) ?? fonts[0]), fonts[0]])];
}

// Use private family names and explicit files: system fonts cannot win by sharing a DOCX name.
export async function applyProjectDocxFonts(body: HTMLElement) {
  const elements = [body, ...Array.from(body.querySelectorAll<HTMLElement>("*"))]
    .filter((element) => element instanceof HTMLElement);
  const required = new Map<string, { font: ProjectFont; face: Face }>();
  const family = (style: CSSStyleDeclaration) => {
    const selected = projectFamilies(style.fontFamily);
    for (const font of selected) {
      const weight = Number(style.fontWeight) >= 600 || style.fontWeight === "bold" ? "700" : "400";
      const italic = ["italic", "oblique"].some((value) => style.fontStyle.startsWith(value));
      const face = font.faces.find((entry) => entry.weight === weight && entry.style === (italic ? "italic" : "normal")) ?? font.faces[0];
      required.set(`${font.family}:${face.weight}:${face.style}`, { font, face });
    }
    return selected.map((font) => `"${font.family}"`).join(", ");
  };
  // Snapshot inherited styles before applying overrides to their parents.
  const snapshots = elements.map((element) => {
    const style = getComputedStyle(element);
    const pseudos = ["before", "after"].flatMap((name) => {
      const pseudo = getComputedStyle(element, `::${name}`);
      return ["none", "normal", '""'].includes(pseudo.content) ? [] : [{ name, family: family(pseudo) }];
    });
    return { element, family: family(style), pseudos };
  });
  await Promise.all(Array.from(required.values(), ({ font, face }) => loadFace(font, face)));
  for (const { element, family, pseudos } of snapshots) {
    element.style.setProperty("font-family", family, "important");
    for (const pseudo of pseudos) {
      element.setAttribute(`data-docx-project-${pseudo.name}`, "");
      element.style.setProperty(`--docx-project-${pseudo.name}-fonts`, pseudo.family);
    }
  }
}
