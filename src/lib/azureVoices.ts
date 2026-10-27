/**
 * Microsoft Azure Speech catalog + SSML builder.
 *
 * Shared by the Pages Function (server-side allowlist) and the editor UI.
 * Azure's free F0 tier covers 0.5M neural characters/month; the key lives in
 * the Pages secret `AZURE_SPEECH_KEY` and is never sent to the browser.
 */

export interface AzureVoice {
  id: string;
  label: string;
  locale: string;
  gender: "Female" | "Male";
  styles: string[];
}

export const AZURE_VOICES: AzureVoice[] = [
  {
    id: "zh-CN-XiaoxiaoNeural",
    label: "晓晓 · 中文女声",
    locale: "zh-CN",
    gender: "Female",
    styles: [
      "general",
      "cheerful",
      "gentle",
      "affectionate",
      "calm",
      "sad",
      "angry",
      "serious",
      "newscast",
      "poetry-reading",
    ],
  },
  {
    id: "zh-CN-YunxiNeural",
    label: "云希 · 中文男声",
    locale: "zh-CN",
    gender: "Male",
    styles: ["general", "cheerful", "sad", "angry", "serious", "narration-relaxed"],
  },
  {
    id: "zh-CN-YunjianNeural",
    label: "云健 · 中文男声（解说）",
    locale: "zh-CN",
    gender: "Male",
    styles: [
      "general",
      "sports-commentary",
      "sports-commentary-excited",
      "documentary-narration",
      "cheerful",
      "sad",
    ],
  },
  {
    id: "zh-CN-XiaoyiNeural",
    label: "晓伊 · 中文女声（少女）",
    locale: "zh-CN",
    gender: "Female",
    styles: ["general", "cheerful", "sad", "angry"],
  },
  {
    id: "en-US-AriaNeural",
    label: "Aria · English (US)",
    locale: "en-US",
    gender: "Female",
    styles: ["general", "cheerful", "sad", "angry", "newscast", "narration-professional"],
  },
  {
    id: "en-US-GuyNeural",
    label: "Guy · English (US)",
    locale: "en-US",
    gender: "Male",
    styles: ["general", "cheerful", "sad", "angry", "newscast"],
  },
  {
    id: "ja-JP-NanamiNeural",
    label: "Nanami · 日本語",
    locale: "ja-JP",
    gender: "Female",
    styles: ["general", "cheerful"],
  },
  {
    id: "ko-KR-SunHiNeural",
    label: "SunHi · 한국어",
    locale: "ko-KR",
    gender: "Female",
    styles: ["general"],
  },
];

export const AZURE_STYLE_LABELS: Record<string, string> = {
  general: "默认",
  cheerful: "开心",
  gentle: "温柔",
  affectionate: "亲切",
  calm: "平静",
  sad: "难过",
  angry: "生气",
  serious: "严肃",
  newscast: "新闻播报",
  "poetry-reading": "诗歌朗诵",
  "narration-relaxed": "轻松旁白",
  "narration-professional": "专业旁白",
  "documentary-narration": "纪录片旁白",
  "sports-commentary": "体育解说",
  "sports-commentary-excited": "激情解说",
};

export function findAzureVoice(id: string): AzureVoice | undefined {
  return AZURE_VOICES.find((voice) => voice.id === id);
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) =>
    ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : ch === "'" ? "&apos;" : "&quot;",
  );
}

/** 1.2 → "+20%", 0.8 → "-20%" */
export function rateToPercent(rate: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

export function buildAzureSsml(input: {
  text: string;
  voiceId: string;
  style?: string;
  rate?: number;
}): string {
  const voice = findAzureVoice(input.voiceId);
  if (!voice) throw new Error(`unknown Azure voice: ${input.voiceId}`);
  const style = input.style && voice.styles.includes(input.style) ? input.style : "general";
  const rate = rateToPercent(input.rate ?? 1);
  const body = `<prosody rate="${rate}" pitch="+0Hz">${escapeXml(input.text)}</prosody>`;
  const styled =
    style === "general"
      ? body
      : `<mstts:express-as style="${style}">${body}</mstts:express-as>`;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${voice.locale}">` +
    `<voice name="${voice.id}">${styled}</voice></speak>`
  );
}
