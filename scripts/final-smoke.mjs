const base = "https://meme-stage.pages.dev";
const checks = [];
const add = (name, ok, extra = "") => checks.push({ name, ok, extra });

const home = await fetch(base + "/");
add("/", home.status === 200, home.headers.get("content-type"));
const homeHtml = await home.text();
add("home OG", /og:image" content="https:\/\/meme-stage\.pages\.dev\/demo\/cover\.png/.test(homeHtml));
add("CSP header", /script-src 'self'/.test(home.headers.get("content-security-policy") ?? ""), "yes");
add("HSTS", !!home.headers.get("strict-transport-security"));

const demo = await fetch(base + "/p/demo");
const demoHtml = await demo.text();
add("/p/demo", demo.status === 200 && demoHtml.includes("全员开麦"));
add("demo OG", demoHtml.includes(`og:url" content="${base}/p/demo"`));
add("demo audio", (await fetch(base + "/demo/voice-k.wav")).status === 200);
add("demo cover", (await fetch(base + "/demo/cover.png")).status === 200);
add("demo API", (await fetch(base + "/api/public/demo")).status === 200);
add("missing slug 404", (await fetch(base + "/api/public/nope-nope")).status === 404);
add("404 shell", (await fetch(base + "/p/nope-nope")).status === 200);
add("library shell", (await fetch(base + "/library")).status === 200);
add("editor shell", (await fetch(base + "/editor")).status === 200);
add("robots", (await fetch(base + "/robots.txt")).status === 200);
add("sitemap", (await fetch(base + "/sitemap.xml")).status === 200);
add("favicon", (await fetch(base + "/favicon.svg")).status === 200);

// private API requires a valid capability key
add("private API 401", (await fetch(base + "/api/projects")).status === 401);
add("asset API 401", (await fetch(base + "/api/assets")).status === 401);

// cross-site write blocked by middleware
const crossSite = await fetch(base + "/api/projects", {
  method: "POST",
  headers: { "content-type": "application/json", Origin: "https://evil.example", "X-Editor-Key": "a".repeat(64) },
  body: "{}",
});
add("cross-site write 403", crossSite.status === 403, String(crossSite.status));

for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name} ${check.extra ?? ""}`);
console.log(checks.every((c) => c.ok) ? "\nALL PASS" : "\nSOME FAILED");
