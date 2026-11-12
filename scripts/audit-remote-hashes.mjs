import fs from "node:fs";
import crypto from "node:crypto";
const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN missing");
const paths = [
  "src/lib/characterList.ts",
  "src/lib/performance.ts",
  "src/hooks/useQuickImport.ts",
  "src/components/editor/ScriptPanel.tsx",
  "functions/_lib/files.ts",
  "tests/e2e/studio.spec.ts",
  "README.md",
];
for (const path of paths) {
  const bytes = fs.readFileSync(path);
  const prefix = Buffer.from(`blob ${bytes.length}\0`);
  const localSha = crypto.createHash("sha1").update(Buffer.concat([prefix, bytes])).digest("hex");
  const res = await fetch(`https://api.github.com/repos/iiiiiiiiiiiiiKK/meme-stage/contents/${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "meme-stage-audit",
    },
  });
  const json = await res.json();
  console.log(path, res.status, json.sha === localSha ? "MATCH" : "DIFF", json.sha ?? json.message, localSha);
}
