// Builds the 1200x630 social cover for the official demo project.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const chars = [
  { file: "k.png", name: "老K", x: 40, y: 210, h: 360, rot: -4 },
  { file: "adai.png", name: "阿呆", x: 300, y: 240, h: 330, rot: 2 },
  { file: "wallet.png", name: "钱包君", x: 585, y: 215, h: 350, rot: 1 },
  { file: "keyboard.png", name: "键盘侠", x: 845, y: 195, h: 380, rot: 3 },
  { file: "boss.png", name: "老板", x: 690, y: 20, h: 230, rot: -2 },
  { file: "cat.png", name: "猫猫头", x: 1010, y: 300, h: 270, rot: 5 },
];

const images = [];
for (const c of chars) {
  const buf = await readFile(path.join(root, "public", "demo", c.file));
  images.push({ ...c, src: `data:image/png;base64,${buf.toString("base64")}` });
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;background:#07070a;font-family:ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif;color:#f4f1e8}
  .grid{position:absolute;inset:0;background-image:radial-gradient(circle at 1px 1px,rgba(244,241,232,.16) 1px,transparent 0);background-size:22px 22px}
  .glow{position:absolute;width:520px;height:520px;border-radius:999px;filter:blur(110px);opacity:.45}
  .c{position:absolute;object-fit:contain;filter:drop-shadow(6px 10px 0 rgba(0,0,0,.85))}
  .brand{position:absolute;left:44px;top:36px;display:inline-flex;align-items:center;gap:10px;background:#b6ff3c;color:#07070a;padding:8px 14px;font-weight:900;letter-spacing:-.02em;font-size:24px;border:3px solid #07070a;box-shadow:5px 5px 0 #000;transform:rotate(-2deg)}
  h1{position:absolute;left:44px;top:96px;width:700px;font-size:56px;line-height:.98;letter-spacing:-.045em;font-weight:900;text-shadow:4px 4px 0 #000}
  h1 em{font-style:normal;background:#b6ff3c;color:#07070a;padding:0 8px}
  .sub{position:absolute;left:46px;top:238px;font-size:20px;font-weight:600;color:#b9b9c9}
  .tag{position:absolute;right:44px;top:40px;background:#ff4d9d;color:#07070a;font-weight:900;font-size:16px;padding:6px 12px;border:3px solid #07070a;box-shadow:4px 4px 0 #000;transform:rotate(3deg)}
  .foot{position:absolute;left:46px;bottom:26px;font-size:16px;color:#8f8fa3;letter-spacing:.02em}
  .foot b{color:#b6ff3c}
  .line{position:absolute;left:44px;bottom:60px;width:360px;height:4px;background:#b6ff3c}
</style></head>
<body>
  <div class="grid"></div>
  <div class="glow" style="background:#4d7cff;left:-120px;top:220px"></div>
  <div class="glow" style="background:#ff4d9d;right:-140px;top:300px"></div>
  <div class="brand">MEME STAGE</div>
  <div class="tag">点谁 谁开口</div>
  <h1>全员开麦：<br/><em>这波到底亏不亏</em></h1>
  <div class="sub">六个人，六条声音。点老K 会自动接阿呆，再接钱包君。</div>
  <div class="line"></div>
  <div class="foot"><b>MEME STAGE</b> · 无限画布 × 独立配音 × 点击就演</div>
  ${images
    .map(
      (img) =>
        `<img class="c" src="${img.src}" style="left:${img.x}px;top:${img.y}px;height:${img.h}px;transform:rotate(${img.rot}deg)" />`,
    )
    .join("\n  ")}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(root, "public", "demo", "cover.png"), omitBackground: false });
await browser.close();
console.log("cover written to public/demo/cover.png");
