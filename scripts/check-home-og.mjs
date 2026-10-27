const home = await fetch("https://meme-stage.pages.dev/").then((r) => r.text());
const demoTags = await fetch("https://meme-stage.pages.dev/p/demo").then((r) => r.text());
const count = (html, re) => (html.match(re) ?? []).length;
console.log("home og:title count", count(home, /property="og:title"/g));
console.log("home og:image", /og:image" content="([^"]+)/.exec(home)?.[1]);
console.log("demo og:title count", count(demoTags, /property="og:title"/g));
console.log("demo og:url", /og:url" content="([^"]+)/.exec(demoTags)?.[1]);
console.log("home has marker", home.includes("OG_META_START"));
