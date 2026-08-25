const FENCE_START = /^\s{0,3}(`{3,}|~{3,})/;

export function toStandardMathMarkdown(source: string): string {
  return transformMarkdown(source, "custom-to-standard");
}

export function fromStandardMathMarkdown(source: string): string {
  return transformMarkdown(source, "standard-to-custom");
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

function transformMarkdown(
  source: string,
  direction: "custom-to-standard" | "standard-to-custom",
): string {
  let fence: { character: string; length: number } | null = null;
  return source.split("\n").map((line) => {
    const fenceMatch = line.match(FENCE_START);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) {
        fence = { character: token[0], length: token.length };
      } else if (token[0] === fence.character && token.length >= fence.length) {
        fence = null;
      }
      return line;
    }
    if (fence) return line;
    if (direction === "custom-to-standard" && line.trim() === "$$$$") {
      return line.replace("$$$$", "$$");
    }
    if (direction === "standard-to-custom" && line.trim() === "$$") {
      return line.replace("$$", "$$$$");
    }
    return transformOutsideInlineCode(line, direction);
  }).join("\n");
}

function transformOutsideInlineCode(
  line: string,
  direction: "custom-to-standard" | "standard-to-custom",
): string {
  let result = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] === "`") {
      const run = countRun(line, index, "`");
      const closing = line.indexOf("`".repeat(run), index + run);
      if (closing < 0) return result + transformMath(line.slice(index), direction);
      result += line.slice(index, closing + run);
      index = closing + run;
      continue;
    }
    const nextCode = line.indexOf("`", index);
    const end = nextCode < 0 ? line.length : nextCode;
    result += transformMath(line.slice(index, end), direction);
    index = end;
  }
  return result;
}

function transformMath(
  value: string,
  direction: "custom-to-standard" | "standard-to-custom",
): string {
  if (direction === "custom-to-standard") {
    return value.replace(/(?<!\\)\$\$/g, "$");
  }
  return value.replace(/(?<!\\)(?<!\$)\$(?!\$)/g, "$$");
}

function countRun(value: string, start: number, character: string): number {
  let end = start;
  while (value[end] === character) end += 1;
  return end - start;
}
