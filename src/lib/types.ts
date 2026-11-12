/**
 * Shared domain types for MEME STAGE.
 *
 * The same module is consumed by the browser app and by the Cloudflare Pages
 * Functions (via a relative import), so it must stay free of DOM / Node APIs.
 */

export type ElementType = "character" | "text" | "image";

export type BubblePreset = "comic" | "plain" | "thought" | "caption" | "big" | "custom";
export type BubbleAnimation = "pop" | "bounce" | "fade" | "none";
export type BubbleTail = "none" | "left" | "right" | "bottom";

export interface BubbleStyle {
  preset: BubblePreset;
  bg: string;
  fg: string;
  border: string;
  borderWidth: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  radius: number;
  padding: number;
  tail: BubbleTail;
  animation: BubbleAnimation;
  /** how long the bubble stays visible, in seconds (0 = until audio ends) */
  hold: number;
}

export interface VoiceClip {
  id: string;
  name: string;
  /** same-origin path, e.g. /api/files/abc */
  url: string;
  assetId?: string;
  /** seconds; 0 when unknown */
  duration: number;
  volume: number;
  /** optional subtitle shown together with this clip */
  line?: string;
  /** playback rate (0.5–2); text-to-speech uses it as the "speed" style */
  rate?: number;
  /** where the clip came from */
  source?: "upload" | "tts" | "device" | "record";
  /** TTS language code (zh/en/jp/kr/fr/es) or BCP-47 for device voices */
  lang?: string;
  /** device-speech text (source === "device") */
  text?: string;
  /** preferred browser voice URI (source === "device") */
  voiceURI?: string;
  /** 0.5–2 */
  pitch?: number;
}

export type VoiceMode = "cycle" | "random";

export type BubbleAnchor = "auto" | "top" | "bottom" | "left" | "right";

/** where a character's speech bubble is attached, in world units */
export interface BubblePlacement {
  anchor: BubbleAnchor;
  /** offset from the anchor point, in canvas world pixels */
  offsetX: number;
  offsetY: number;
  /** max bubble width in screen pixels */
  maxWidth: number;
}

/**
 * Where a character's mouth sits, as a fraction of the element box (0–1).
 * `x`/`y` is the mouth centre, `size` is the mouth width relative to the box
 * width. Defaults are derived from the box when a character has never been
 * marked, so old projects still flap sensibly.
 */
export interface MouthAnchor {
  /** 0 = left edge, 1 = right edge */
  x: number;
  /** 0 = top edge, 1 = bottom edge */
  y: number;
  /** mouth width as a fraction of the element width (0.04–0.6) */
  size: number;
  /** true when the author placed it by hand, so imports never overwrite it */
  custom?: boolean;
}

export interface CharacterData {
  name: string;
  imageUrl: string;
  thumbUrl?: string;
  assetId?: string;
  voices: VoiceClip[];
  /** how repeated clicks pick the next clip */
  voiceMode: VoiceMode;
  /** fallback subtitle when the chosen clip has no line */
  line: string;
  bubble: BubbleStyle;
  bubblePlacement: BubblePlacement;
  /** lip-flap mouth position; omitted = derived default */
  mouth?: MouthAnchor;
  effects: {
    outline: number;
    shadow: boolean;
    glow: string | null;
    shake: boolean;
  };
}

export interface TextData {
  content: string;
  style: BubbleStyle;
  duration: number;
}

export interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** higher = closer to viewer */
  z: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  flipX: boolean;
  flipY: boolean;
  character?: CharacterData;
  text?: TextData;
  image?: {
    url: string;
    thumbUrl?: string;
    assetId?: string;
    name: string;
    /**
     * Animated media is drawn as a static frame in the editor (Konva cannot play
     * GIFs) and as a DOM overlay on the visitor stage so it actually animates.
     */
    animated?: "gif" | "webp" | "mp4";
  };
}

export type StepType =
  | "playAudio"
  | "say"
  | "animate"
  | "show"
  | "hide"
  | "move"
  | "wait"
  | "flash"
  | "goto";

export type AnimationName =
  | "bounce"
  | "shake"
  | "pop"
  | "spin"
  | "pulse"
  | "nod"
  | "turn"
  | "jump"
  | "zoomIn"
  | "zoomOut"
  | "highlight"
  | "reaction";

/** where an effect sticker (GIF / WebP / MP4) is anchored during a cue */
export type EffectAnchor = "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right";

export interface CueEffect {
  id: string;
  /** same-origin asset url */
  url: string;
  /** gif / webp / mp4 — the DOM overlay plays it natively */
  kind: "gif" | "webp" | "mp4";
  anchor: EffectAnchor;
  /** rendered width in canvas world pixels */
  size: number;
  /** how long the sticker stays, in ms */
  duration: number;
  /** start offset relative to the cue start, in ms */
  delay?: number;
  loop?: boolean;
  muted?: boolean;
}

/** one line of the performance script */
export interface PerformanceCue {
  id: string;
  /** element id of the speaker */
  actorId: string;
  /** specific voice clip; omitted = next clip in the actor's rotation */
  clipId?: string;
  /** bubble text; omitted = the clip's own line */
  text?: string;
  /** ms to wait before this cue starts */
  waitBefore?: number;
  /** ms to wait after the audio/bubble finished */
  waitAfter?: number;
  animation?: AnimationName;
  /** dim every other character while this cue plays ("舞台聚光") */
  spotlight?: boolean;
  /** show a subtitle bubble (default true) */
  showBubble?: boolean;
  /** move the actor by this offset in world pixels */
  moveX?: number;
  moveY?: number;
  /** sticker effects played with this cue */
  effects?: CueEffect[];
  /** lip-flap mouth opening while speaking */
  lipFlap?: boolean;
  /** ms override for how long the cue blocks (default: audio duration) */
  holdMs?: number;
}

export interface Performance {
  id: string;
  name: string;
  cues: PerformanceCue[];
  /** loop the whole script forever */
  loop: boolean;
  /** auto-start after the visitor's first tap */
  autoPlay?: boolean;
}

export interface Step {
  id: string;
  type: StepType;
  /** which element the step acts on */
  targetId?: string;
  /** say: override text; playAudio: specific clip id */
  text?: string;
  clipId?: string;
  ms?: number;
  animation?: AnimationName;
  dx?: number;
  dy?: number;
  eventId?: string;
  /** start this step without blocking the next one (bubble + voice together) */
  parallel?: boolean;
}

export interface EventDef {
  id: string;
  name: string;
  /** clicking this element starts the event */
  triggerId: string;
  steps: Step[];
  /** automatically continue with another event once this one finishes */
  nextEventId: string | null;
  enabled: boolean;
}

export interface ProjectSettings {
  audioMode: "single" | "mix";
  /** visual reactions on tap (bounce + particles) */
  reactions: boolean;
  showAuthor: boolean;
  allowRemix: boolean;
  authorName: string;
  soundHint: string;
  /** show a "开始表演" button on the published page when a performance exists */
  showPlayButton?: boolean;
}

export interface ProjectData {
  version: 1;
  title: string;
  description: string;
  mode: "preset" | "free";
  width: number;
  height: number;
  background: {
    type: "color" | "image";
    color: string;
    url?: string;
    assetId?: string;
  };
  elements: CanvasElement[];
  events: EventDef[];
  /** scripted performances; the first one is what "开始表演" runs */
  performances?: Performance[];
  settings: ProjectSettings;
  updatedAt: number;
}

export interface ServerProject {
  id: string;
  slug: string | null;
  title: string;
  description: string;
  data: ProjectData;
  coverUrl: string | null;
  visibility: "private" | "public";
  published: boolean;
  rev: number;
  views: number;
  createdAt: number;
  updatedAt: number;
}

export interface AssetRecord {
  id: string;
  kind: "image" | "audio" | "video" | "cover";
  url: string;
  mime: string;
  size: number;
  name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  /** where the bytes came from; older rows omit it */
  createdAt?: number;
}

export interface ApiError {
  error: string;
  message: string;
}
