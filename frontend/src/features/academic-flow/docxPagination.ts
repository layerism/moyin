// Pagination is based on browser layout, not Word's layout engine.
// Run at zoom 1, after fonts and images have loaded in the connected shadow root.
export function paginateDocx(body: HTMLElement): number {
  const originals = Array.from(body.querySelectorAll<HTMLElement>("section.docx"));
  for (const original of originals) {
    const template = original.cloneNode(true) as HTMLElement;
    const blocks = Array.from(original.children).flatMap((child) =>
      child.tagName === "ARTICLE"
        ? Array.from(child.children).map((block) => ({ shell: child, block: block as HTMLElement }))
        : child.tagName === "HEADER" || child.tagName === "FOOTER"
          ? [] : [{ shell: document.createElement("article"), block: child as HTMLElement }]);
    let page = original;
    let article: HTMLElement;
    let shell: Element | undefined;
    let count = 0;
    const clear = (target: HTMLElement) => {
      for (const child of Array.from(target.children)) {
        if (!["HEADER", "FOOTER"].includes(child.tagName)) child.remove();
      }
    };
    clear(template);
    clear(page);
    const nextPage = () => {
      const next = template.cloneNode(true) as HTMLElement;
      page.after(next);
      page = next;
      shell = undefined;
      count = 0;
    };
    const container = (source: Element) => {
      if (shell !== source) {
        article = source.cloneNode(false) as HTMLElement;
        page.insertBefore(article, page.querySelector(":scope > footer"));
        shell = source;
      }
      return article;
    };
    const bottom = () => {
      const style = getComputedStyle(page);
      const footer = page.querySelector<HTMLElement>(":scope > footer");
      return page.getBoundingClientRect().top + page.clientHeight
        - parseFloat(style.paddingBottom) - (footer?.offsetHeight ?? 0);
    };
    const fits = (block: HTMLElement) => {
      const rect = block.getBoundingClientRect();
      return rect.top + Math.max(rect.height, block.scrollHeight)
        + (parseFloat(getComputedStyle(block).marginBottom) || 0) <= bottom() + 1;
    };
    for (const entry of blocks) {
      let block = entry.block;
      for (;;) {
        container(entry.shell).appendChild(block);
        if (fits(block)) { count++; break; }
        const rest = splitBlock(block, fits);
        if (rest) {
          nextPage();
          block = rest;
        } else if (count > 0) {
          block.remove();
          nextPage();
        } else {
          // A single image, merged table row, or other indivisible object may
          // exceed the printable area. Fit it proportionally instead of clipping.
          const rect = block.getBoundingClientRect();
          const available = bottom() - rect.top;
          block.style.width = `${rect.width}px`;
          block.style.zoom = String(Math.max(0.01, Math.min(1, available / Math.max(rect.height, block.scrollHeight))) * 0.98);
          count++;
          break;
        }
      }
    }
  }
  return body.querySelectorAll("section.docx").length;
}

function splitBlock(block: HTMLElement, fits: (block: HTMLElement) => boolean): HTMLElement | null {
  if (block.tagName === "TABLE") return splitTable(block as HTMLTableElement, fits);
  if (block.tagName !== "P" || block.querySelector("img,svg,math,canvas,object")) return null;
  const source = block.cloneNode(true) as HTMLElement;
  const length = source.textContent?.length ?? 0;
  if (length < 2) return null;
  const cut = (offset: number) => {
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode()!;
    while (offset > (node.textContent?.length ?? 0)) {
      offset -= node.textContent!.length;
      node = walker.nextNode()!;
    }
    const before = document.createRange();
    before.selectNodeContents(source);
    before.setEnd(node, offset);
    const after = document.createRange();
    after.selectNodeContents(source);
    after.setStart(node, offset);
    return [before.cloneContents(), after.cloneContents()];
  };
  let low = 0;
  let high = length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    block.replaceChildren(cut(mid)[0]);
    if (fits(block)) low = mid;
    else high = mid - 1;
  }
  // Do not divide a UTF-16 surrogate pair between pages.
  if (low > 0 && /[\uD800-\uDBFF]/.test(source.textContent![low - 1])) low--;
  if (!low) { block.replaceChildren(...Array.from(source.childNodes)); return null; }
  const [before, after] = cut(low);
  block.replaceChildren(before);
  const remainder = source.cloneNode(false) as HTMLElement;
  remainder.appendChild(after);
  remainder.style.textIndent = "0";
  remainder.style.marginTop = "0";
  // Generated list labels must only appear on the first fragment.
  remainder.dataset.pageContinuation = "true";
  return remainder;
}

function splitTable(table: HTMLTableElement, fits: (block: HTMLElement) => boolean): HTMLElement | null {
  const source = table.cloneNode(true) as HTMLTableElement;
  const rows = Array.from(source.rows);
  const headerCount = source.tHead?.rows.length ?? 0;
  let chosen = 0;
  // Keep vertically merged cells together and retain any explicit table header.
  for (let index = headerCount + 1; index < rows.length; index++) {
    if (rows.slice(0, index).some((row, rowIndex) => Array.from(row.cells).some((cell) =>
      cell.rowSpan === 0 || rowIndex + cell.rowSpan > index))) continue;
    table.replaceChildren(...Array.from(source.cloneNode(true).childNodes));
    while (table.rows.length > index) table.deleteRow(table.rows.length - 1);
    if (!fits(table)) break;
    chosen = index;
  }
  table.replaceChildren(...Array.from(source.cloneNode(true).childNodes));
  if (!chosen) return null;
  while (table.rows.length > chosen) table.deleteRow(table.rows.length - 1);
  for (let index = chosen - 1; index >= headerCount; index--) source.deleteRow(index);
  return source;
}
