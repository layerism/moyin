// Resolve after font selection and before tab measurement/pagination. Custom
// properties carry docDefaults, style inheritance and direct run overrides.
export function characterSpacing(style: CSSStyleDeclaration) {
  const spacing = style.getPropertyValue("--docx-character-spacing").trim();
  const threshold = style.getPropertyValue("--docx-kerning-threshold").trim();
  const fontSizePoints = parseFloat(style.fontSize) * 72 / 96;
  return {
    letterSpacing: spacing !== "" ? `${Number(spacing) / 20}pt` : "normal",
    // An absent w:kern throughout the hierarchy means no kerning. The value
    // is a size threshold, not a boolean; zero must not be treated as absent.
    fontKerning: threshold !== "" && fontSizePoints >= Number(threshold) / 2 ? "normal" : "none",
  };
}

export function applyDocxCharacterSpacing(body: HTMLElement) {
  const parents = new Set<HTMLElement>();
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent instanceof HTMLElement && !parent.closest("style,script,math,svg")) parents.add(parent);
  }
  // Read before writing so formatting a parent cannot affect a later read.
  const entries = Array.from(parents, (element) => ({ element, ...characterSpacing(getComputedStyle(element)) }));
  for (const { element, letterSpacing, fontKerning } of entries) {
    element.style.letterSpacing = letterSpacing;
    element.style.setProperty("font-kerning", fontKerning);
  }
}
