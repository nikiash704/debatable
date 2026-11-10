/** Platform modifier label for hotkey hints. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? "⌘" : "Ctrl+";

/** True when a keyboard event comes from a text field (then single-letter hotkeys are off). */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}
