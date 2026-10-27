// Rewrites SAPI WAVs to a canonical 44-byte PCM header (SAPI emits an 18-byte
// fmt chunk that some browser decoders dislike) and prints exact durations.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "..", "public", "demo");
const files = (await readdir(dir)).filter((f) => f.endsWith(".wav"));

for (const file of files) {
  const buf = await readFile(path.join(dir, file));
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${file} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
        size,
      };
    } else if (id === "data") {
      data = { offset: body, size: Math.min(size, buf.length - body) };
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`missing fmt/data in ${file}`);
  if (fmt.format !== 1) throw new Error(`${file} is not PCM (format ${fmt.format})`);

  const blockAlign = (fmt.channels * fmt.bits) / 8;
  const byteRate = fmt.sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.size, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(fmt.channels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(fmt.bits, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.size, 40);

  const out = Buffer.concat([header, buf.subarray(data.offset, data.offset + data.size)]);
  await writeFile(path.join(dir, file), out);
  const seconds = data.size / byteRate;
  console.log(
    `${file.padEnd(22)} ${seconds.toFixed(2)}s  ${(out.length / 1024).toFixed(0)} KB  ${fmt.sampleRate}Hz ${fmt.channels}ch`,
  );
}
