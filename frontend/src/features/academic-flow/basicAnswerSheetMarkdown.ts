export type BasicMarkdownNode = {
  alt?: string;
  children?: BasicMarkdownNode[];
  depth?: number;
  type: string;
  value?: string;
  [key: string]: unknown;
};

export function restrictBasicMarkdownTree(tree: BasicMarkdownNode): void {
  tree.children = normalizeBlocks(tree.children ?? []);
}

export function remarkBasicAnswerSheetMarkdown() {
  return (tree: unknown) => restrictBasicMarkdownTree(tree as BasicMarkdownNode);
}

function normalizeBlocks(nodes: BasicMarkdownNode[]): BasicMarkdownNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "heading") {
      const normalized = { ...node, children: normalizeInline(node.children ?? []) };
      return node.depth === 1 || node.depth === 2
        ? [normalized]
        : [{ type: "paragraph", children: normalized.children }];
    }
    if (node.type === "paragraph") {
      return [{ ...node, children: normalizeInline(node.children ?? []) }];
    }
    if (node.type === "code" || node.type === "math") return [node];
    if (node.children) return normalizeBlocks(node.children);
    return [];
  });
}

function normalizeInline(nodes: BasicMarkdownNode[]): BasicMarkdownNode[] {
  return nodes.flatMap((node) => {
    if (["text", "inlineCode", "inlineMath", "break"].includes(node.type)) {
      return [node];
    }
    if (node.type === "image" || node.type === "imageReference") {
      return node.alt ? [{ type: "text", value: node.alt }] : [];
    }
    return node.children ? normalizeInline(node.children) : [];
  });
}
