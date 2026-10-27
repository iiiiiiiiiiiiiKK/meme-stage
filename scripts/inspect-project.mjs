const slug = process.argv[2] || "meme-ssjm";
const base = process.argv[3] || "https://meme-stage.pages.dev";
const res = await fetch(`${base}/api/public/${slug}`);
const json = await res.json();
const p = json.project.data;
console.log("title", json.project.title, "elements", p.elements.length, "events", p.events.length, "cover", json.project.coverUrl);
for (const el of p.elements.slice(0, 3)) {
  console.log(el.id, el.character?.name, "voice:", el.character?.voice?.url, "line:", el.character?.line);
}
console.log("event triggers", p.events.map((e) => ({ trigger: e.triggerId, steps: e.steps.map((s) => s.type) })));
