/**
 * Renderer-side UUID generator. Prefers `crypto.randomUUID` (Electron's
 * Chromium ships it), falls back to a Math.random-based UUID-ish for
 * extreme legacy / sandboxed environments.
 */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const r = (Math.random() * 16) | 0;
    const v = char === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
