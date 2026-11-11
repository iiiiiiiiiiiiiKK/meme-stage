// Read-only concurrency probe: two simultaneous PUTs must not silently overwrite.
const base = "https://meme-stage.pages.dev";
const key = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const mk = (title) => ({
  version: 1,
  title,
  description: "",
  mode: "preset",
  width: 1600,
  height: 900,
  background: { type: "color", color: "#101018" },
  elements: [],
  events: [],
  settings: {
    audioMode: "single",
    reactions: true,
    showAuthor: true,
    allowRemix: true,
    authorName: "",
    soundHint: "轻点人物，听他们开口",
  },
  updatedAt: Date.now(),
});

const headers = { "X-Editor-Key": key, "content-type": "application/json" };

const created = await fetch(`${base}/api/projects`, {
  method: "POST",
  headers,
  body: JSON.stringify({ data: mk("concurrency-probe") }),
}).then((r) => r.json());
console.log("created", created);

const id = created.id;
const put = (data, rev, force = false) =>
  fetch(`${base}/api/projects/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ data, rev, force }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

// two writers read rev=1 and race
const [a, b] = await Promise.all([put(mk("writer-A"), 1), put(mk("writer-B"), 1)]);
console.log("A", a.status, JSON.stringify(a.body).slice(0, 90));
console.log("B", b.status, JSON.stringify(b.body).slice(0, 90));

const after = await fetch(`${base}/api/projects/${id}`, { headers }).then((r) => r.json());
console.log("stored:", after.project.title, "rev", after.project.rev);

// idempotent retry: same document again must not bump rev
const same = await put(after.project.data, after.project.rev);
console.log("idempotent retry", same.status, JSON.stringify(same.body));

// stale write must be rejected
const stale = await put(mk("stale"), 1);
console.log("stale write", stale.status, JSON.stringify(stale.body).slice(0, 80));

// pagination shape
const page = await fetch(`${base}/api/assets?limit=5&offset=0`, { headers }).then((r) => r.json());
console.log("assets page keys", Object.keys(page), "limit", page.limit, "hasMore", page.hasMore);

await fetch(`${base}/api/projects/${id}`, { method: "DELETE", headers });
console.log("cleaned up");
