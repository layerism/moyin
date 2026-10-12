type Table = { tag: number; checksum: number; offset: number; length: number };
const tables = (data: DataView, start = 0): Table[] => Array.from({ length: data.getUint16(start + 4) }, (_, index) => {
  const offset = start + 12 + index * 16;
  return { tag: data.getUint32(offset), checksum: data.getUint32(offset + 4), offset: data.getUint32(offset + 8), length: data.getUint32(offset + 12) };
});
const align = (length: number) => Math.ceil(length / 4) * 4;

// Extract the exact original TTC member as browser-readable sfnt, without changing glyphs.
export function docxFontMember(buffer: ArrayBuffer, member: number): ArrayBuffer {
  const source = new DataView(buffer);
  if (source.getUint32(0) !== 0x74746366) return buffer;
  if (member >= source.getUint32(8)) throw new Error("Font collection member unavailable");
  const start = source.getUint32(12 + member * 4);
  const entries = tables(source, start);
  const header = 12 + entries.length * 16;
  const output = new Uint8Array(header + entries.reduce((total, entry) => total + align(entry.length), 0));
  output.set(new Uint8Array(buffer, start, 12));
  const view = new DataView(output.buffer);
  let position = header, head = 0;
  entries.forEach((entry, index) => {
    const offset = 12 + index * 16;
    view.setUint32(offset, entry.tag);
    view.setUint32(offset + 4, entry.checksum);
    view.setUint32(offset + 8, position);
    view.setUint32(offset + 12, entry.length);
    output.set(new Uint8Array(buffer, entry.offset, entry.length), position);
    if (entry.tag === 0x68656164) { head = position; view.setUint32(head + 8, 0); }
    position += align(entry.length);
  });
  let checksum = 0;
  for (let index = 0; index < output.length; index += 4) checksum = (checksum + view.getUint32(index)) >>> 0;
  if (head) view.setUint32(head + 8, (0xb1b0afba - checksum) >>> 0);
  return output.buffer;
}

// Detect unsupported characters before the browser can fall back to a system glyph.
export function docxFontCoverage(buffer: ArrayBuffer): { (character: number): boolean; symbol: boolean } {
  const data = new DataView(buffer);
  const cmap = tables(data).find((entry) => entry.tag === 0x636d6170);
  if (!cmap) throw new Error("Font character map unavailable");
  const maps = Array.from({ length: data.getUint16(cmap.offset + 2) }, (_, index) => {
    const entry = cmap.offset + 4 + index * 8;
    const platform = data.getUint16(entry), encoding = data.getUint16(entry + 2);
    return { offset: cmap.offset + data.getUint32(entry + 4),
      unicode: platform === 0 || (platform === 3 && [1, 10].includes(encoding)), symbol: platform === 3 && encoding === 0 };
  });
  const unicode = maps.filter((entry) => entry.unicode);
  const selected = unicode.length ? unicode : maps.filter((entry) => entry.symbol);
  const full = selected.find((entry) => data.getUint16(entry.offset) === 12)?.offset;
  const bmp = selected.find((entry) => data.getUint16(entry.offset) === 4)?.offset;
  const symbol = !unicode.length && selected.some((entry) => entry.symbol);
  if (full === undefined && bmp === undefined) throw new Error("Unsupported font character map");
  return Object.assign((character: number) => {
    // Legacy symbol-font bytes and w:sym PUA values refer to the same original glyph.
    if (symbol && character >= 0x20 && character <= 0xff) character += 0xf000;
    if (full !== undefined) {
      let low = 0, high = data.getUint32(full + 12) - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1, group = full + 16 + middle * 12;
        const start = data.getUint32(group), end = data.getUint32(group + 4);
        if (character < start) high = middle - 1;
        else if (character > end) low = middle + 1;
        else return data.getUint32(group + 8) + character - start !== 0;
      }
    }
    if (bmp === undefined || character > 0xffff) return false;
    const count = data.getUint16(bmp + 6) / 2;
    const ends = bmp + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, ranges = deltas + count * 2;
    let low = 0, high = count - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (character > data.getUint16(ends + middle * 2)) low = middle + 1;
      else high = middle - 1;
    }
    if (low === count || character < data.getUint16(starts + low * 2)) return false;
    const delta = data.getInt16(deltas + low * 2), range = data.getUint16(ranges + low * 2);
    if (!range) return ((character + delta) & 0xffff) !== 0;
    const glyph = data.getUint16(ranges + low * 2 + range + (character - data.getUint16(starts + low * 2)) * 2);
    return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
  }, { symbol });
}
