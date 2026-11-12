import fs from "node:fs";

const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN missing");
const res = await fetch("https://api.github.com/repos/iiiiiiiiiiiiiKK/meme-stage/contents/README.md", {
  headers: {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "meme-stage-audit",
  },
});
if (!res.ok) throw new Error(`fetch failed ${res.status}`);
const json = await res.json();
const bytes = Buffer.from(json.content, "base64");
fs.writeFileSync("README.md", bytes);
console.log("restored bytes:", bytes.length, "sha:", json.sha);
