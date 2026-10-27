const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN required");
const owner = "iiiiiiiiiiiiiKK";
const repo = "meme-stage";
const api = async (path) => {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json", "User-Agent": "meme-stage-check" },
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const info = await api("");
console.log("repo:", info.data.html_url, "private:", info.data.private, "branch:", info.data.default_branch);
console.log("license:", info.data.license?.spdx_id, "sizeKB:", info.data.size, "topics:", info.data.topics);
console.log("description:", info.data.description);
console.log("homepage:", info.data.homepage);

const commits = await api("/commits?per_page=5");
console.log("commits:", commits.data.length);
for (const commit of commits.data) console.log(" ", commit.sha.slice(0, 8), commit.commit.message.split("\n")[0]);

const root = await api("/contents/");
console.log("root:", root.data.map((f) => f.name).join(", "));

for (const path of [
  "src/lib/schema.ts",
  "functions/api/projects/%5Bid%5D/publish.ts",
  "docs/screenshots/home.png",
  "db/schema.sql",
  "tests/unit/engine.test.ts",
  ".env.example",
  "README.md",
  "LICENSE",
]) {
  const res = await api(`/contents/${path}`);
  console.log(path, "=>", res.status, res.data?.size ?? res.data?.message);
}

const seed = await api("/contents/.seed/seed.json");
console.log(".seed/seed.json =>", seed.status, seed.status === 404 ? "(not published, good)" : "LEAK!");

const runs = await api("/actions/runs?per_page=3");
for (const run of runs.data.workflow_runs ?? []) {
  console.log("CI:", run.name, run.status, run.conclusion, run.html_url);
}
