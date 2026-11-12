import fs from "node:fs";

const path = "src/features/sticker/AiGeneratePanel.tsx";
const text = fs.readFileSync(path, "utf8");
const lines = text.split("\n");
const start = lines.findIndex((l) => l.includes("Measured against the live gateway") && l.includes("transparent") && l.includes("useState"));
if (start === -1) {
  console.error("marker not found");
  process.exit(1);
}
// the broken lines are the ones that swallowed the escaping; rebuild the block
const end = lines.findIndex((l, i) => i >= start && l.includes('useState(false);') && l.includes("transparent"));
const block = [
  "  // Measured against the live gateway: asking the model for a transparent",
  "  // background reliably ends in a ~196s upstream timeout, while the same prompt",
  "  // without it finishes in ~15s. Transparency is therefore opt-in, and the normal",
  "  // path is: generate on a plain background, then cut it out locally (free, fast,",
  "  // and far more accurate than asking the model).",
  "  const [transparent, setTransparent] = useState(false);",
];
lines.splice(start, end - start + 1, ...block);
fs.writeFileSync(path, lines.join("\n"), "utf8");
console.log("repaired lines", start + 1, "to", end + 1);
