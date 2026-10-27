/** Minimal 16-bit PCM WAV encoder used for microphone recordings + trimming. */

export interface WavResult {
  blob: Blob;
  duration: number;
  sampleRate: number;
}

export function encodeWavFromChannels(
  channels: Float32Array[],
  sampleRate: number,
  startSec: number,
  endSec: number,
): WavResult {
  const channelCount = Math.max(1, channels.length);
  const start = Math.max(0, Math.min(startSec, endSec));
  const end = Math.max(start, endSec);
  const frames = Math.max(1, Math.floor((end - start) * sampleRate));
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const startFrame = Math.floor(start * sampleRate);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const source = channels[ch] ?? channels[0];
      const sample = source[startFrame + i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return {
    blob: new Blob([buffer], { type: "audio/wav" }),
    duration: frames / sampleRate,
    sampleRate,
  };
}

export function audioBufferToWav(buffer: AudioBuffer, startSec: number, endSec: number): WavResult {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  return encodeWavFromChannels(channels, buffer.sampleRate, startSec, endSec);
}

/** peaks for the trim waveform, sampled into `buckets` columns */
export function waveformPeaks(buffer: AudioBuffer, buckets = 240): number[] {
  const channel = buffer.getChannelData(0);
  const size = Math.floor(channel.length / buckets) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * size;
    for (let j = 0; j < size; j += 8) {
      const value = Math.abs(channel[start + j] ?? 0);
      if (value > max) max = value;
    }
    peaks.push(max);
  }
  return peaks;
}
