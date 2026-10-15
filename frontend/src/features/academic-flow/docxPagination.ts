// Pagination is based on browser layout, not Word's layout engine.
// Run at zoom 1, after fonts and images have loaded in the connected shadow root.
export async function paginateDocx(body: HTMLElement, signal: AbortSignal): Promise<{ pageCount: number; warnings: string[] }> {
  const warnings = new Set<string>();
  let sliceStart = performance.now();
  const yieldLayout = async () => {
    signal.throwIfAborted();
    if (performance.now() - sliceStart > 16) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      signal.throwIfAborted();
      sliceStart = performance.now();
    }
  };
  const originals = Array.from(body.querySelectorAll<HTMLElement>("section.docx"));
  for (const original of originals) {
    await yieldLayout();
    if (original.dataset.docxUnpaged || Array.from(original.querySelectorAll<HTMLElement>(":scope > article")).some((article) =>
      Number(getComputedStyle(article).columnCount) > 1) || original.querySelector(":scope > ol")) {
      warnings.add("缺少纸张高度、分栏或脚注页面保留库的原始布局，自动分页尚不能保证与 Word 一致。");
      original.style.height = "auto";
      original.style.overflow = "visible";
      continue;
    }
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
    const nextPage = (reason = "overflow") => {
      const next = template.cloneNode(true) as HTMLElement;
      page.after(next);
      page = next;
      page.dataset.docxPageReason = reason;
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
    for (let entryIndex = 0; entryIndex < blocks.length; entryIndex++) {
      await yieldLayout();
      const entry = blocks[entryIndex];
      // Start an overflowing keepNext chain on a fresh page, even when the
      // chain itself exceeds one page. Its contents can then paginate normally.
      // Requiring the entire chain to fit silently drops keepNext for long tables.
      let chainEnd = entryIndex;
      while (blocks[chainEnd]?.block.dataset.docxKeepNext === "1"
        && blocks[chainEnd + 1]?.shell === entry.shell) chainEnd++;
      if (chainEnd > entryIndex && count > 0) {
        const chain = blocks.slice(entryIndex, chainEnd + 1).map((part) => part.block);
        chain.forEach((part) => container(entry.shell).appendChild(part));
        const move = !fits(chain[chain.length - 1]);
        chain.forEach((part) => part.remove());
        if (move) nextPage("keepNext");
      }
      let block = entry.block;
      for (;;) {
        container(entry.shell).appendChild(block);
        if (fits(block)) { count++; break; }
        if (block.dataset.docxKeepLines === "1" && count > 0) {
          block.remove();
          nextPage("keepLines");
          continue;
        }
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
          // Preserve content and scale. An unsupported indivisible object must
          // not become tiny text or be silently clipped by a fixed page viewport.
          page.style.height = "auto";
          page.style.overflow = "visible";
          page.dataset.docxPageReason = "oversize";
          warnings.add("部分不可拆分内容超过页面可用高度，已完整显示，分页可能与 Word 不同。");
          count++;
          break;
        }
      }
    }
  }
  const seen = new Set<string>();
  let physicalPage = 0;
  let previousSection = "0";
  for (const page of Array.from(body.querySelectorAll<HTMLElement>("section.docx"))) {
    const first = page.querySelector<HTMLElement>(":scope > article > *");
    const id = first?.style.getPropertyValue("--docx-numbering-section") || previousSection;
    const kind = first?.style.getPropertyValue("--docx-section-start");
    if (!seen.has(id) && ["oddPage", "evenPage"].includes(kind ?? "")) {
      const wanted = kind === "oddPage" ? 1 : 0;
      if ((physicalPage + 1) % 2 !== wanted) {
        const blank = page.cloneNode(false) as HTMLElement;
        blank.dataset.docxPageReason = kind!;
        blank.dataset.docxSectionId = previousSection;
        page.before(blank);
        physicalPage++;
      }
    }
    seen.add(id);
    previousSection = id;
    physicalPage++;
  }
  return { pageCount: body.querySelectorAll("section.docx").length, warnings: [...warnings] };
}

function splitBlock(block: HTMLElement, fits: (block: HTMLElement) => boolean): HTMLElement | null {
  if (block.tagName === "TABLE") return splitTable(block as HTMLTableElement, fits);
  if (block.dataset.docxKeepLines === "1") return null;
  if (block.tagName !== "P" || block.querySelector("img,svg,math,canvas,object,docx-tab")) return null;
  const source = block.cloneNode(true) as HTMLElement;
  const length = source.textContent?.length ?? 0;
  if (length < 2) return null;
  // Record browser line boundaries before detaching anything. Text ranges avoid
  // counting inline wrapper rectangles twice. Overlapping vertical intervals
  // belong to one line even when that line contains different font sizes.
  const lineRanges: { top: number; bottom: number }[] = [];
  const textWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (textWalker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(textWalker.currentNode);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width && rect.height) lineRanges.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  lineRanges.sort((a, b) => a.top - b.top);
  const lines: { top: number; bottom: number }[] = [];
  for (const rect of lineRanges) {
    const previous = lines[lines.length - 1];
    if (previous && rect.top < previous.bottom && rect.bottom > previous.top) previous.bottom = Math.max(previous.bottom, rect.bottom);
    else lines.push({ ...rect });
  }
  const widowControl = block.dataset.docxWidow !== "0";
  if (widowControl && lines.length < 4) return null;
  block.style.marginBottom = "0";
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
  // Keep combining characters and emoji sequences with their base character.
  const Segmenter = (Intl as unknown as { Segmenter: new (locale?: string, options?: { granularity: string }) => {
    segment(text: string): Iterable<{ index: number }>;
  } }).Segmenter;
  if (Segmenter) {
    let boundary = 0;
    for (const entry of new Segmenter(undefined, { granularity: "grapheme" }).segment(source.textContent!)) {
      if (entry.index > low) break;
      boundary = entry.index;
    }
    low = boundary;
  } else if (low > 0 && /[\uD800-\uDBFF]/.test(source.textContent![low - 1])) low--;
  if (!low) {
    block.style.marginBottom = source.style.marginBottom;
    block.replaceChildren(...Array.from(source.childNodes)); return null;
  }
  const [before, after] = cut(low);
  block.replaceChildren(before);
  if (widowControl) {
    const range = document.createRange();
    range.selectNodeContents(block);
    const bottom = Math.max(...Array.from(range.getClientRects(), (rect) => rect.bottom));
    const consumed = lines.filter((line) => line.top < bottom).length;
    if (consumed < 2) {
      block.style.marginBottom = source.style.marginBottom;
      block.replaceChildren(...Array.from(source.childNodes));
      return null;
    }
    if (lines.length - consumed < 2) {
      // Retry against the previous full-line boundary, leaving two lines for
      // the continuation. This is an actual measured boundary, not a character
      // count or font-size estimate.
      block.replaceChildren(...Array.from(source.cloneNode(true).childNodes));
      block.style.marginBottom = source.style.marginBottom;
      const limit = lines[lines.length - 2].top;
      return splitBlock(block, (candidate) => {
        const measured = document.createRange();
        measured.selectNodeContents(candidate);
        return fits(candidate) && Array.from(measured.getClientRects()).every((rect) => rect.bottom <= limit);
      });
    }
  }
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
  const rows = Array.from(table.rows);
  let headerCount = source.tHead?.rows.length ?? 0;
  if (!headerCount) {
    while (rows[headerCount]?.dataset.docxTableHeader === "1") headerCount++;
  }
  let chosen = 0;
  // Remove one suffix once, then grow the prefix with existing row nodes.
  // This avoids deep-cloning the entire table for every candidate boundary.
  const parents = rows.map((row) => row.parentElement!);
  rows.forEach((row) => row.remove());
  for (let index = 0; index < rows.length; index++) {
    parents[index].appendChild(rows[index]);
    const cut = index + 1;
    if (cut <= headerCount || cut === rows.length) continue;
    if (rows.slice(0, cut).some((row, rowIndex) => Array.from(row.cells).some((cell) =>
      cell.style.display !== "none" && (cell.rowSpan === 0 || rowIndex + cell.rowSpan > cut)))) continue;
    if (!fits(table)) break;
    chosen = cut;
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
  if (rows.slice(start, end).some((row) => row.dataset.docxCantSplit === "1")) return null;
  // The renderer carries w:trHeight into inline height. Splitting only the text
  // cannot distribute a row's reserved writing space between two pages. Keep
  // height-constrained rows (and their vertical merge group) intact instead of
  // discarding that space or duplicating the full height on both fragments.
  // The caller can still split at row boundaries or move the group to a new page;
  // oversized groups use the existing visible-overflow fallback and warning.
  const hasReservedHeight = (element: HTMLElement) =>
    [element.style.height, element.style.minHeight].some((value) => parseFloat(value) > 0);
  if (rows.slice(start, end).some((row) => hasReservedHeight(row)
    || Array.from(row.cells).some(hasReservedHeight))) return null;
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
