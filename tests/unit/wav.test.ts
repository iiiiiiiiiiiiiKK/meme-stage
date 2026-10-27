import { describe, expect, it } from "vitest";
import { encodeWavFromChannels, waveformPeaks } from "../../src/lib/wav";

function sine(seconds: number, sampleRate: number, freq = 440): Float32Array {
  const samples = Math.floor(seconds * sampleRate);
  const data = new Float32Array(samples);
  for (let i = 0; i < samples; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5;
  return data;
}

describe("wav encoder", () => {
  it("encodes a 16-bit PCM WAV with a valid header", async () => {
    const sampleRate = 8000;
    const result = encodeWavFromChannels([sine(1, sampleRate)], sampleRate, 0, 1);
    expect(result.duration).toBeCloseTo(1, 3);
    const buffer = new Uint8Array(await result.blob.arrayBuffer());
    const view = new DataView(buffer.buffer);
    const tag = (o: number) => String.fromCharCode(...buffer.subarray(o, o + 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(8000 * 2);
    expect(buffer.byteLength).toBe(44 + 16000);
  });

  it("trims to the selected range", async () => {
    const result = encodeWavFromChannels([sine(2, 8000)], 8000, 0.5, 1.5);
    expect(result.duration).toBeCloseTo(1, 3);
    const buffer = new Uint8Array(await result.blob.arrayBuffer());
    expect(new DataView(buffer.buffer).getUint32(40, true)).toBe(8000 * 2);
  });

  it("supports stereo and clamps out-of-range samples", async () => {
    const left = new Float32Array([2, -2, 0.5, 0]);
    const right = new Float32Array([0, 0, 0, 0]);
    const result = encodeWavFromChannels([left, right], 8000, 0, 4 / 8000);
    const buffer = new Uint8Array(await result.blob.arrayBuffer());
    const view = new DataView(buffer.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(-32768);
  });

  it("produces a waveform with the requested bucket count", () => {
    const buffer = {
      numberOfChannels: 1,
      sampleRate: 8000,
      duration: 1,
      length: 8000,
      getChannelData: () => sine(1, 8000),
    } as unknown as AudioBuffer;
    const peaks = waveformPeaks(buffer, 100);
    expect(peaks).toHaveLength(100);
    expect(Math.max(...peaks)).toBeGreaterThan(0.1);
  });
});
