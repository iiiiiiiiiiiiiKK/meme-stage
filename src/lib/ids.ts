export function uid(prefix = ""): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    const id = c.randomUUID().replace(/-/g, "").slice(0, 16);
    return prefix ? `${prefix}_${id}` : id;
  }
  const bytes = new Uint8Array(8);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return prefix ? `${prefix}_${hex}` : hex;
}

/** stable editor identity, generated once per browser and kept local */
export function getEditorKey(): string {
  const KEY = "ms.editor.key";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(KEY, value);
    return value;
  } catch {
    return "local-only";
  }
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "stage";
}

export function shortSlug(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return cleaned || "meme";
}
