
const live = await (await fetch('https://meme-stage.pages.dev/')).text();
const src = (live.match(/src="([^"]*index-[^"]+\.js)"/) || [])[1];
const js = await (await fetch('https://meme-stage.pages.dev' + src)).text();
for (const t of ['lg:flex-row','34dvh','max-h-[46dvh]','gap-0 sm:gap-1','overflow-x-clip','本机素材']) console.log(t, js.includes(t));
const h = await fetch('https://meme-stage.pages.dev/assets/' + src.split('/assets/')[1], { method: 'HEAD' });
console.log('last-modified', h.headers.get('last-modified'), 'age', h.headers.get('age'), 'etag', (h.headers.get('etag')||'').slice(0,40));
