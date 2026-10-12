type PageNumbering = { start?: number | null; format?: string | null };
type Section = { pageNumber?: PageNumbering };
type DocxNode = {
  type: string;
  children?: DocxNode[];
  cssStyle?: Record<string, string>;
  className?: string;
  text?: string;
  instruction?: string;
  charType?: string;
  fieldRun?: boolean;
  sectionProps?: Section;
};
type ParsedDocx = {
  documentPart: { body: DocxNode & { props?: Section } };
  parts: { rootElement?: DocxNode }[];
};
type PageField = { kind: string; format?: string };
const fieldFormats: Record<string, string> = {
  Arabic: "decimal", ROMAN: "upperRoman", roman: "lowerRoman",
  ALPHABETIC: "upperLetter", alphabetic: "lowerLetter",
};

function pageField(instruction: string): PageField | null {
  const kind = instruction.match(/^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i)?.[1].toUpperCase();
  if (!kind) return null;
  const format = Array.from(instruction.matchAll(/\\\*\s+(\w+)/g))
    .map((match) => fieldFormats[match[1]]).find(Boolean);
  return { kind, format };
}

function markField(node: DocxNode, field: PageField, continuation = false) {
  node.className = [node.className, "docx-page-field", continuation ? "docx-page-field-continuation" : ""].filter(Boolean).join(" ");
  const style = node.cssStyle ??= {};
  style.font = "inherit";
  style.color = "inherit";
  style["--docx-page-field"] = field.kind;
  if (field.format) style["--docx-page-field-format"] = field.format;
}

function prepareFields(root: DocxNode) {
  const stack: { instruction: string; result: boolean; separator?: DocxNode; run?: DocxNode; texts: { node: DocxNode; run?: DocxNode }[] }[] = [];
  const visit = (node: DocxNode, run?: DocxNode) => {
    if (node.type === "run") run = node;
    if (node.type === "simpleField") {
      const field = pageField(node.instruction ?? "");
      if (field) {
        node.type = "run";
        node.children = [{ type: "text", text: "1" }];
        markField(node, field);
      }
      return;
    }
    if (node.type === "complexField") {
      if (node.charType === "begin") stack.push({ instruction: "", result: false, texts: [] });
      const current = stack[stack.length - 1];
      if (node.charType === "separate" && current) {
        current.result = true; current.separator = node; current.run = run;
      }
      if (node.charType === "end" && current) {
        stack.pop();
        const field = pageField(current.instruction);
        // Nested fields may be part of an IF instruction rather than its visible result.
        if (field && !stack.length) {
          const results = current.texts.length ? current.texts
            : current.separator ? [{ node: current.separator, run: current.run }] : [];
          results.forEach(({ node: text, run: parent }, index) => {
            const value = text.type === "text" ? text.text : "1";
            text.type = "run";
            text.children = [{ type: "text", text: value }];
            delete text.text;
            markField(text, field, index > 0);
            if (parent) parent.fieldRun = false;
          });
        }
      }
      return;
    }
    const current = stack[stack.length - 1];
    if (node.type === "instruction" && current && !current.result) current.instruction += node.text ?? "";
    if (node.type === "text" && current?.result) current.texts.push({ node, run });
    for (const child of node.children ?? []) visit(child, run);
  };
  visit(root);
}

// Keep numbering metadata on content blocks so it survives the renderer's and our page splits.
export function prepareDocxPageNumbers(parsed: ParsedDocx): PageNumbering[] {
  const body = parsed.documentPart.body;
  const blocks = body.children ?? [];
  const sections: PageNumbering[] = [];
  let start = 0;
  const section = (end: number, properties?: Section) => {
    const id = sections.length;
    sections.push(properties?.pageNumber ?? {});
    for (let index = start; index < end; index++) {
      (blocks[index].cssStyle ??= {})["--docx-numbering-section"] = String(id);
    }
    start = end;
  };
  blocks.forEach((block, index) => { if (block.sectionProps) section(index + 1, block.sectionProps); });
  section(blocks.length, body.props);
  for (const part of parsed.parts) {
    if (part.rootElement && ["header", "footer"].includes(part.rootElement.type)) prepareFields(part.rootElement);
  }
  return sections;
}

function formatNumber(value: number, format: string): string {
  if (format === "none") return "";
  if (format === "decimalZero") return String(value).padStart(2, "0");
  if (value > 0 && ["upperLetter", "lowerLetter"].includes(format)) {
    let result = "";
    for (let number = value; number > 0; number = Math.floor((number - 1) / 26)) {
      result = String.fromCharCode(65 + (number - 1) % 26) + result;
    }
    return format === "lowerLetter" ? result.toLowerCase() : result;
  }
  if (value > 0 && ["upperRoman", "lowerRoman"].includes(format)) {
    let result = "";
    let number = value;
    for (const [amount, symbol] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
      result += symbol.repeat(Math.floor(number / amount));
      number %= amount;
    }
    return format === "lowerRoman" ? result.toLowerCase() : result;
  }
  return String(value);
}

export function updateDocxPageNumbers(body: HTMLElement, sections: PageNumbering[]) {
  const pages = Array.from(body.querySelectorAll<HTMLElement>("section.docx"));
  const sectionIds = pages.map((page) => {
    const blocks = Array.from(page.querySelectorAll<HTMLElement>(":scope > article > *"))
      .filter((block) => block.style.getPropertyValue("--docx-numbering-section"));
    const block = blocks.find((entry) => entry.textContent?.trim() || entry.querySelector("img,svg")) ?? blocks[0];
    return Number(block?.style.getPropertyValue("--docx-numbering-section") ?? 0);
  });
  const sectionCounts = new Map<number, number>();
  for (const id of sectionIds) sectionCounts.set(id, (sectionCounts.get(id) ?? 0) + 1);
  let pageNumber = 0;
  let previousSection = -1;
  pages.forEach((page, index) => {
    const sectionId = sectionIds[index];
    const numbering = sections[sectionId] ?? {};
    pageNumber = sectionId !== previousSection && numbering.start != null ? numbering.start : pageNumber + 1;
    previousSection = sectionId;
    for (const field of Array.from(page.querySelectorAll<HTMLElement>(":scope > header .docx-page-field, :scope > footer .docx-page-field"))) {
      const kind = field.style.getPropertyValue("--docx-page-field");
      const value = kind === "NUMPAGES" ? pages.length : kind === "SECTIONPAGES"
        ? sectionCounts.get(sectionId) ?? 0 : pageNumber;
      const format = field.style.getPropertyValue("--docx-page-field-format") || (kind === "PAGE" ? numbering.format : null) || "decimal";
      field.textContent = field.classList.contains("docx-page-field-continuation") ? "" : formatNumber(value, format);
    }
  });
}
