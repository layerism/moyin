const FENCE_START = /^\s{0,3}(`{3,}|~{3,})/;
const ONE_LINE_DISPLAY_MATH = /^(\s{0,3})\$\$\s*(.+?)\s*\$\$\s*$/;

export function normalizeStandardMathMarkdown(source: string): string {
  let fence: { character: string; length: number } | null = null;
  return source.split("\n").flatMap((line) => {
    const fenceMatch = line.match(FENCE_START);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) {
        fence = { character: token[0], length: token.length };
      } else if (token[0] === fence.character && token.length >= fence.length) {
        fence = null;
      }
      return [line];
    }
    if (fence) return [line];
    const displayMatch = line.match(ONE_LINE_DISPLAY_MATH);
    if (!displayMatch) return [line];
    const indentation = displayMatch[1];
    return [`${indentation}$$`, displayMatch[2].trim(), `${indentation}$$`];
  }).join("\n");
}

export function findContentAssetIds(source: string): string[] {
  return [...new Set(
    [...source.matchAll(/asset:\/\/([A-Za-z0-9-]+)/g)].map((match) => match[1]),
  )];
}

export function replaceContentAssetUrls(
  source: string,
  assets: ReadonlyMap<string, string>,
): string {
  let result = source;
  for (const [assetId, url] of assets) {
    result = result.replaceAll(`asset://${assetId}`, url);
  }
  return result;
}

export function restoreContentAssetReferences(
  source: string,
  assets: ReadonlyMap<string, string>,
): string {
  let result = source;
  for (const [assetId, url] of assets) {
    result = result.replaceAll(url, `asset://${assetId}`);
  }
  return result;
}
