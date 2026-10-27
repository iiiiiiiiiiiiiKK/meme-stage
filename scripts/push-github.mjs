// Publishes the working tree to GitHub through the REST API.
// The sandbox can reach api.github.com but not github.com:443, so `git push` is
// not available here. Usage: GH_TOKEN=... node scripts/push-github.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = process.env.GH_OWNER || "iiiiiiiiiiiiiKK";
const repo = process.env.GH_REPO || "meme-stage";
const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN is required");

const api = async (pathname, options = {}) => {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "meme-stage-release",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${options.method ?? "GET"} ${pathname} -> ${res.status}: ${text.slice(0, 400)}`);
  return data;
};

const INCLUDE = [
  ".env.example",
  ".gitignore",
  "LICENSE",
  "README.md",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "wrangler.jsonc",
  ".github",
  "assets",
  "db",
  "docs",
  "functions",
  "public",
  "scripts",
  "src",
  "tests",
];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".wrangler", ".seed", "shots", "test-results", "tmp-audio"]);
const BLOCKED_FILES = new Set([".env", ".env.local", "build.log", "tsconfig.tsbuildinfo"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (!BLOCKED_FILES.has(entry.name)) out.push(full);
  }
  return out;
}

const files = [];
for (const item of INCLUDE) {
  const full = path.join(root, item);
  if (!fs.existsSync(full)) continue;
  if (fs.statSync(full).isDirectory()) walk(full, files);
  else files.push(full);
}

// hard stop before publishing anything that looks like a live credential
const secretPatterns = [/ghp_[A-Za-z0-9]{20,}/, /cfat_[A-Za-z0-9]{20,}/, /cfut_[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
for (const file of files) {
  if (!/\.(ts|tsx|js|mjs|json|md|txt|yml|yaml|html|css|sql)$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) throw new Error(`refusing to publish ${path.relative(root, file)}: matches ${pattern}`);
  }
}

console.log(`publishing ${files.length} files to ${owner}/${repo}`);

let repository;
try {
  repository = await api(`/repos/${owner}/${repo}`);
  console.log("repo exists:", repository.html_url);
} catch (error) {
  if (!String(error.message).includes("404")) throw error;
  repository = await api("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: repo,
      description: "MEME STAGE — 互动式 Meme 无限画布：批量导入人物、独立配音、点击就演。Infinite meme canvas with per-character voices.",
      homepage: "https://meme-stage.pages.dev",
      private: false,
      has_issues: true,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    }),
  });
  console.log("repo created:", repository.html_url);
}

await api(`/repos/${owner}/${repo}`, {
  method: "PATCH",
  body: JSON.stringify({
    description: "MEME STAGE — 互动式 Meme 无限画布：批量导入人物、独立配音、点击就演。Infinite meme canvas with per-character voices.",
    homepage: "https://meme-stage.pages.dev",
    has_wiki: false,
    has_projects: false,
  }),
});

let parentSha = null;
try {
  const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/main`);
  parentSha = ref.object.sha;
  console.log("existing head:", parentSha.slice(0, 8));
} catch (error) {
  if (!String(error.message).includes("404") && !String(error.message).includes("409")) throw error;
  console.log("empty repository, seeding the first commit through the contents API");
  // The git data API rejects blob creation on a repository with no commits,
  // so bootstrap with the README and then push the full tree.
  const readme = fs.readFileSync(path.join(root, "README.md"));
  await api(`/repos/${owner}/${repo}/contents/README.md`, {
    method: "PUT",
    body: JSON.stringify({
      message: "chore: bootstrap repository",
      content: readme.toString("base64"),
    }),
  });
  const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/main`);
  parentSha = ref.object.sha;
}

const blobs = [];
for (let i = 0; i < files.length; i += 8) {
  const batch = files.slice(i, i + 8);
  const created = await Promise.all(
    batch.map(async (file) => {
      const content = fs.readFileSync(file).toString("base64");
      const blob = await api(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content, encoding: "base64" }),
      });
      return { path: path.relative(root, file).split(path.sep).join("/"), sha: blob.sha };
    }),
  );
  blobs.push(...created);
  process.stdout.write(`\rblobs ${blobs.length}/${files.length}`);
}
console.log();

const tree = await api(`/repos/${owner}/${repo}/git/trees`, {
  method: "POST",
  body: JSON.stringify({
    tree: blobs.map((blob) => ({ path: blob.path, mode: "100644", type: "blob", sha: blob.sha })),
  }),
});

const commit = await api(`/repos/${owner}/${repo}/git/commits`, {
  method: "POST",
  body: JSON.stringify({
    message:
      "feat: MEME STAGE — interactive meme canvas\n\n" +
      "- infinite canvas editor (pan/zoom, multi-select, snapping, layers, undo)\n" +
      "- batch character import with six auto layouts\n" +
      "- per-character voices, bubble styling and interaction chains\n" +
      "- autosave, publish, OG cover and mobile visitor runtime\n" +
      "- Cloudflare Pages Functions + D1 + R2\n",
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
  }),
});
console.log("commit:", commit.sha.slice(0, 8));

if (parentSha) {
  await api(`/repos/${owner}/${repo}/git/refs/heads/main`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: true }),
  });
} else {
  await api(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: "refs/heads/main", sha: commit.sha }),
  });
}

await api(`/repos/${owner}/${repo}/topics`, {
  method: "PUT",
  body: JSON.stringify({
    names: ["meme", "infinite-canvas", "konva", "react", "cloudflare-pages", "d1", "r2", "audio", "creative-tools", "typescript"],
  }),
});

const check = await api(`/repos/${owner}/${repo}/contents/README.md`);
console.log("README bytes:", check.size);
console.log("done:", repository.html_url);
