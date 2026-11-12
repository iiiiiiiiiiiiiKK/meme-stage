// 确认旧的服务端 AI 接口已经不存在（不应再返回 JSON 能力数据）。
const base = "https://meme-stage.pages.dev";
for (const [path, method] of [
  ["/api/ai/capabilities", "GET"],
  ["/api/ai/generate", "POST"],
  ["/api/ai/edit", "POST"],
]) {
  const res = await fetch(`${base}${path}`, { method });
  const text = await res.text();
  console.log(`${method} ${path} → ${res.status} ${res.headers.get("content-type")} :: ${text.slice(0, 90).replace(/\s+/g, " ")}`);
}
