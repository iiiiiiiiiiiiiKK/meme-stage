export interface DemoCharacter {
  id: string;
  name: string;
  image: string;
  face: string;
  voice: string;
  voiceName: string;
  duration: number;
  line: string;
  accent: string;
  width: number;
  height: number;
}

/** original artwork + synthesized voices shipped with the project */
export const DEMO_CHARACTERS: DemoCharacter[] = [
  {
    id: "k",
    name: "老K",
    image: "/demo/k.png",
    face: "/demo/k-face.png",
    voice: "/demo/voice-k.wav",
    voiceName: "老K · 这波不亏",
    duration: 3.23,
    line: "兄弟们，这波真的不亏。",
    accent: "#b6ff3c",
    width: 330,
    height: 440,
  },
  {
    id: "adai",
    name: "阿呆",
    image: "/demo/adai.png",
    face: "/demo/adai-face.png",
    voice: "/demo/voice-adai.wav",
    voiceName: "阿呆 · 这也行",
    duration: 2.24,
    line: "啊？这也行？",
    accent: "#ffd93d",
    width: 300,
    height: 400,
  },
  {
    id: "wallet",
    name: "钱包君",
    image: "/demo/wallet.png",
    face: "/demo/wallet-face.png",
    voice: "/demo/voice-wallet.wav",
    voiceName: "钱包君 · 早就空了",
    duration: 3.4,
    line: "别看了，我早就空了。",
    accent: "#4d7cff",
    width: 300,
    height: 400,
  },
  {
    id: "keyboard",
    name: "键盘侠",
    image: "/demo/keyboard.png",
    face: "/demo/keyboard-face.png",
    voice: "/demo/voice-keyboard.wav",
    voiceName: "键盘侠 · 先说为敬",
    duration: 2.75,
    line: "我不同意，但我先说为敬。",
    accent: "#9b5cff",
    width: 290,
    height: 387,
  },
  {
    id: "boss",
    name: "老板",
    image: "/demo/boss.png",
    face: "/demo/boss-face.png",
    voice: "/demo/voice-boss.wav",
    voiceName: "老板 · 下班前",
    duration: 4.78,
    line: "这个需求，今天下班前给我。",
    accent: "#ff4d9d",
    width: 280,
    height: 373,
  },
  {
    id: "cat",
    name: "猫猫头",
    image: "/demo/cat.png",
    face: "/demo/cat-face.png",
    voice: "/demo/voice-cat.wav",
    voiceName: "猫猫头 · 但是喵",
    duration: 3.42,
    line: "喵。听不懂，但是喵。",
    accent: "#ffb25c",
    width: 250,
    height: 333,
  },
];
