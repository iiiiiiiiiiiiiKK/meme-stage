
import fs from 'node:fs/promises';
const local = await fs.readFile('dist/index.html','utf8');
const live = await (await fetch('https://meme-stage.pages.dev/')).text();
const pick = h => (h.match(/assets\/index-[^"]+/)||[''])[0];
console.log('local build:', pick(local));
console.log('live build :', pick(live));
console.log('match:', pick(local) === pick(live));
