// Publishes the official demo project (idempotent).
// Usage: node scripts/seed-demo.mjs [https://meme-stage.pages.dev]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const base = (process.argv[2] || "https://meme-stage.pages.dev").replace(/\/$/, "");
const seedDir = path.join(root, ".seed");
const metaPath = path.join(seedDir, "seed.json");

await mkdir(seedDir, { recursive: true });

let meta = null;
try {
  meta = JSON.parse(await readFile(metaPath, "utf8"));
} catch {
  meta = null;
}

const key = meta?.key ?? crypto.randomBytes(32).toString("hex");
const project = JSON.parse(await readFile(path.join(root, "src", "data", "demo-project.json"), "utf8"));
const cover = await readFile(path.join(root, "public", "demo", "cover.png"));
const coverDataUrl = `data:image/png;base64,${cover.toString("base64")}`;

const headers = { "content-type": "application/json", "X-Editor-Key": key };

async function call(pathname, options = {}) {
  const res = await fetch(base + pathname, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${options.method ?? "GET"} ${pathname} -> ${res.status} ${text.slice(0, 300)}`);
  return data;
}

let id = meta?.id;
let rev = 0;
if (id) {
  try {
    const current = await call(`/api/projects/${id}`);
    rev = current.project.rev;
    const saved = await call(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ data: project, rev, force: true }),
    });
    rev = saved.rev;
    console.log("updated existing demo project", id, "rev", rev);
  } catch (error) {
    console.warn("could not update existing demo, creating a new one:", error.message);
    id = null;
  }
}
if (!id) {
  const created = await call("/api/projects", { method: "POST", body: JSON.stringify({ data: project }) });
  id = created.id;
  rev = created.rev;
  console.log("created demo project", id);
}

const published = await call(`/api/projects/${id}/publish`, {
  method: "POST",
  body: JSON.stringify({ data: project, coverDataUrl, slug: "demo" }),
});

await writeFile(metaPath, JSON.stringify({ key, id, slug: published.slug }, null, 2));
console.log("published:", published.url);
console.log("slug:", published.slug);
if (published.slug !== "demo") {
  console.warn("WARNING: slug 'demo' was already taken; published at", published.slug);
}
