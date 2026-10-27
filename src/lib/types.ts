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

export type AnimationName = "bounce" | "shake" | "pop" | "spin" | "pulse";

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
  kind: "image" | "audio" | "cover";
  url: string;
  mime: string;
  size: number;
  name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface ApiError {
  error: string;
  message: string;
}
