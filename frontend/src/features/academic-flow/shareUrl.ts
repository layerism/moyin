export function getAbsoluteShareUrl(shareUrl: string, origin: string) {
  return new URL(shareUrl, origin).href;
}
