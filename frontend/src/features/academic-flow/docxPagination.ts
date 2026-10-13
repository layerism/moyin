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
      // The renderer places part of the footer inside the already reserved bottom margin.
      const footerHeight = footer ? Math.max(0, footer.offsetHeight + (parseFloat(getComputedStyle(footer).marginBottom) || 0)) : 0;
      return page.getBoundingClientRect().top + page.clientHeight
        - parseFloat(style.paddingBottom) - footerHeight;
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
        } else if (fits(block)) {
          count++;
          break;
        } else if (count > 0) {
          block.remove();
          nextPage();
        } else {
          if (block.tagName === "TABLE" && block.textContent?.trim()) {
            throw new Error("此表格包含无法安全跨页的内容，请下载原件查看。");
          }
          // Fit indivisible media proportionally instead of clipping it.
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
  const columns = Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col"));
  const widths = columns.map((column) => column.getBoundingClientRect().width);
  table.style.width = `${table.getBoundingClientRect().width}px`;
  table.style.tableLayout = "fixed";
  columns.forEach((column, index) => { column.style.width = `${widths[index]}px`; });
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
  if (!chosen) return splitTableGroup(table, source, headerCount, fits);
  const rest = splitTableGroup(table, source, headerCount, fits, chosen);
  if (rest || fits(table)) return rest;
  while (table.rows.length > chosen) table.deleteRow(table.rows.length - 1);
  for (let index = chosen - 1; index >= headerCount; index--) source.deleteRow(index);
  return source;
}

function splitTableGroup(
  table: HTMLTableElement,
  source: HTMLTableElement,
  headerCount: number,
  fits: (block: HTMLElement) => boolean,
  start = headerCount,
): HTMLElement | null {
  const rows = Array.from(source.rows);
  if (rows.length <= start) return null;
  let end = start + 1;
  // A vertical merge group keeps the same grid on each continuation page.
  for (let index = 0; index < end; index++) {
    for (const cell of Array.from(rows[index].cells)) {
      end = Math.min(rows.length, Math.max(end, cell.rowSpan ? index + cell.rowSpan : rows.length));
    }
  }
  // Fixed-height cells have an explicit viewport. Move these rows together,
  // rather than stripping their height and splitting the clipped content.
  if (rows.slice(start, end).some((row) => row.dataset.docxExactRow === "true")) return null;
  const remainder = source.cloneNode(true) as HTMLTableElement;
  while (table.rows.length > end) table.deleteRow(table.rows.length - 1);
  const group = (target: HTMLTableElement) => Array.from(target.rows).slice(start, end);
  const cells = (target: HTMLTableElement) => group(target).flatMap((row) => Array.from(row.cells));
  const originalCells = cells(source);
  const currentCells = cells(table);
  const nextCells = cells(remainder);
  for (const target of [table, remainder]) {
    for (const row of group(target)) {
      row.style.height = "auto";
      row.style.minHeight = "0";
    }
    for (const cell of cells(target)) {
      cell.style.height = "auto";
      cell.style.minHeight = "0";
      if (cell.style.display !== "none") cell.replaceChildren();
    }
  }
  let consumed = false;
  let continued = false;
  originalCells.forEach((cell, index) => {
    if (cell.style.display === "none") return;
    const parts = Array.from(cell.childNodes);
    const current = currentCells[index];
    const next = nextCells[index];
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const part = parts[partIndex].cloneNode(true);
      current.appendChild(part);
      if (fits(table)) { consumed = true; continue; }
      const rest = part instanceof HTMLElement ? splitBlock(part, () => fits(table)) : null;
      if (rest) {
        consumed = true;
        next.appendChild(rest);
      } else {
        current.removeChild(part);
        next.appendChild(part);
      }
      next.append(...parts.slice(partIndex + 1).map((child) => child.cloneNode(true)));
      continued = true;
      break;
    }
  });
  if (!consumed) {
    table.replaceChildren(...Array.from(source.cloneNode(true).childNodes));
    return null;
  }
  if (!continued) {
    for (let index = end - 1; index >= start; index--) remainder.deleteRow(index);
  }
  for (let index = start - 1; index >= headerCount; index--) remainder.deleteRow(index);
  return remainder.rows.length > headerCount ? remainder : null;
}
