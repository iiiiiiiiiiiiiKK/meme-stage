/** Image export helpers: artboard PNG, social cover composition and downloads. */

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("封面绘制失败"));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Composes a 1200x630 Open Graph cover from the exported artboard.
 * Used for X / WeChat / iMessage link previews.
 */
export async function composeCover(
  frameDataUrl: string,
  options: { title: string; author?: string; accent?: string },
): Promise<string> {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas");

  ctx.fillStyle = "#07070a";
  ctx.fillRect(0, 0, W, H);

  const img = await loadHtmlImage(frameDataUrl);
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  const gradient = ctx.createLinearGradient(0, H * 0.35, 0, H);
  gradient.addColorStop(0, "rgba(7,7,10,0)");
  gradient.addColorStop(0.55, "rgba(7,7,10,0.72)");
  gradient.addColorStop(1, "rgba(7,7,10,0.97)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  const accent = options.accent ?? "#b6ff3c";

  // brand pill
  ctx.fillStyle = accent;
  roundRect(ctx, 56, 48, 232, 46, 10);
  ctx.fill();
  ctx.fillStyle = "#07070a";
  ctx.font = '900 24px "Arial Black", Impact, sans-serif';
  ctx.textBaseline = "middle";
  ctx.fillText("MEME STAGE", 74, 72);

  // title, wrapped to two lines
  const title = (options.title || "未命名作品").slice(0, 42);
  ctx.fillStyle = "#f4f1e8";
  ctx.font = '900 68px "Arial Black", Impact, "Microsoft YaHei", sans-serif';
  ctx.textBaseline = "alphabetic";
  const maxWidth = W - 112;
  const chars = Array.from(title);
  let line = "";
  const lines: string[] = [];
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = `${shown[1].slice(0, -1)}…`;
  shown.forEach((text, i) => {
    ctx.fillText(text, 56, 452 + i * 82);
  });

  ctx.fillStyle = "rgba(244,241,232,0.62)";
  ctx.font = '500 24px ui-sans-serif, system-ui, "Microsoft YaHei", sans-serif';
  ctx.fillText(
    `${options.author ? `${options.author} · ` : ""}点击人物，听他们开口`,
    58,
    H - 54,
  );

  return canvas.toDataURL("image/jpeg", 0.88);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("无效的图片数据");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/png";
  if (header.includes(";base64")) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

export function canvasPresetFor(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(ratio - 1) < 0.02) return "1:1";
  if (Math.abs(ratio - 4 / 5) < 0.02) return "4:5";
  return "custom";
}
