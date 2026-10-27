// Removes the throwaway probe Pages project / Worker used to validate platform permissions.
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = "6559ab8c7e59a32b779cd824dbaf7f20";
if (!token) throw new Error("CLOUDFLARE_API_TOKEN required");
const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };

for (const [label, path] of [
  ["pages project", `/accounts/${account}/pages/projects/meme-stage-probe`],
  ["worker", `/accounts/${account}/workers/scripts/meme-stage-probe`],
]) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method: "DELETE", headers });
  console.log(label, res.status, (await res.text()).slice(0, 200));
}

const pages = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects`, { headers });
const list = await pages.json();
console.log(
  "remaining pages:",
  list.result?.map((p) => p.name).join(", "),
);
