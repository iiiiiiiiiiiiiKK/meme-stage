/**
 * Sticker domain types.
 *
 * These are the shared vocabulary between the local sticker pipeline, the local
 * asset store and the MEME STAGE asset bridge. They deliberately do not import
 * from `src/lib/types.ts`: a sticker is a *source artifact*, while a Stage
 * element is a *composition node* that only ever holds a URL and an asset id.
 */

/** Trim shapes supported by the local cutout engine. */
export type CutMode =
  | "background"
  | "face"
  | "head"
  | "head-neck"
  | "head-shoulders"
  | "upper-body"
  | "full";

export const CUT_MODES: { id: CutMode; label: string; hint: string }[] = [
  { id: "head", label: "头部", hint: "头发到下巴，最经典的贴纸" },
  { id: "face", label: "只要脸", hint: "按人脸轮廓精确裁切" },
  { id: "head-neck", label: "头 + 脖子", hint: "合成时多一点脖子" },
  { id: "head-shoulders", label: "头 + 肩", hint: "反应图的胸像裁切" },
  { id: "upper-body", label: "上半身", hint: "到胸口的裁切" },
  { id: "background", label: "去背", hint: "保留整个人，去掉背景" },
  { id: "full", label: "整个人", hint: "完整轮廓 + 透明背景" },
];

export const MODE_LABEL: Record<CutMode, string> = {
  background: "去背",
  face: "只要脸",
  head: "头部贴纸",
  "head-neck": "头 + 脖子",
  "head-shoulders": "头 + 肩",
  "upper-body": "上半身",
  full: "整个人",
};

export const FACE_MODES: CutMode[] = ["face", "head", "head-neck", "head-shoulders", "upper-body"];

export function modeUsesFace(mode: CutMode): boolean {
  return mode !== "background" && mode !== "full";
}

/** Stroke settings, expressed at the cutout resolution. */
export interface OutlineSettings {
  enabled: boolean;
  thickness: number;
  color: string;
  layers: 1 | 2 | 3;
  secondColor: string;
  secondThickness: number;
  /** 第三层（最外层）描边，仅在 layers === 3 时使用 */
  thirdColor: string;
  thirdThickness: number;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOpacity: number;
  glow: boolean;
  glowColor: string;
  inner: number;
}

export const DEFAULT_OUTLINE: OutlineSettings = {
  enabled: true,
  thickness: 14,
  color: "#ffffff",
  layers: 2,
  secondColor: "#111111",
  secondThickness: 6,
  thirdColor: "#ffffff",
  thirdThickness: 0,
  shadow: false,
  shadowColor: "#000000",
  shadowBlur: 18,
  shadowOpacity: 0.45,
  glow: false,
  glowColor: "#c6f24e",
  inner: 0,
};

export interface CutoutOptions {
  mode: CutMode;
  faceIndex: number;
  /** 多主体合并：只 union 这些脸的轮廓（长度 > 1 时生效） */
  faceIndices?: number[];
  feather: number;
  expand: number;
  edgeSmooth: number;
  outline: OutlineSettings;
}

/**
 * Colour treatment applied to the subject's own pixels.
 *
 * Deliberately not part of the AI path: these are local canvas operations, so
 * changing them never costs a request and never redraws the person.
 */
export type PersonColor = "original" | "grayscale" | "mono" | "duotone" | "halftone" | "custom";

export const PERSON_COLORS: { id: PersonColor; label: string; hint: string }[] = [
  { id: "original", label: "原图彩色", hint: "保留原图颜色（默认）" },
  { id: "grayscale", label: "灰度", hint: "去饱和，保留明暗层次" },
  { id: "mono", label: "黑白", hint: "硬边二值，经典 meme 感" },
  { id: "duotone", label: "双色调", hint: "阴影染色 + 高光留白" },
  { id: "halftone", label: "漫画网点", hint: "按亮度生成圆点，印刷质感" },
  { id: "custom", label: "自定义染色", hint: "用你选的颜色轻微罩染" },
];

export const PERSON_COLOR_LABEL: Record<PersonColor, string> = {
  original: "原图彩色",
  grayscale: "灰度",
  mono: "黑白",
  duotone: "双色调",
  halftone: "漫画网点",
  custom: "自定义染色",
};

/** Stroke presets, expressed at the 200px face reference scale. */
export const OUTLINE_PRESETS: { id: string; label: string; patch: Partial<OutlineSettings> }[] = [
  { id: "none", label: "无描边", patch: { enabled: false } },
  {
    id: "thin",
    label: "细",
    patch: { enabled: true, thickness: 8, layers: 1, secondThickness: 0 },
  },
  {
    id: "medium",
    label: "中等",
    patch: { enabled: true, thickness: 14, color: "#ffffff", layers: 1, secondThickness: 0 },
  },
  {
    id: "thick",
    label: "粗",
    patch: { enabled: true, thickness: 22, color: "#ffffff", layers: 1, secondThickness: 0 },
  },
  {
    id: "ultra",
    label: "超粗",
    patch: { enabled: true, thickness: 32, color: "#ffffff", layers: 1, secondThickness: 0 },
  },
  {
    id: "classic",
    label: "白粗 + 黑细（默认）",
    patch: {
      enabled: true,
      thickness: 14,
      color: "#ffffff",
      layers: 2,
      secondColor: "#111111",
      secondThickness: 6,
    },
  },
];

/** A detected face plus its landmark mesh, in source-pixel coordinates. */
export interface FaceDetection {
  index: number;
  box: [number, number, number, number];
  score: number;
  mesh: Array<[number, number]>;
  oval: Array<[number, number]>;
}

/** One image the user imported, kept byte-for-byte until they delete it. */
export interface StickerSource {
  id: string;
  name: string;
  mime: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: number;
  /** 清空本地缓存后原件不可恢复，这里只记录它是否存在 */
  hasOriginal: boolean;
}

/** A saved mask, either generated or hand-edited. */
export interface MaskRecord {
  id: string;
  sourceId: string;
  width: number;
  height: number;
  algorithm: "selfie" | "rvm" | "fallback" | "manual";
  /** alpha 占比，用于在界面上提示蒙版是否合理 */
  coverage: number;
  createdAt: number;
}

export type StickerVariantKind = "local-cutout" | "manual-mask" | "outline-only" | "ai-style" | "ai-generate";

/** A rendered transparent sticker. */
export interface StickerVariant {
  id: string;
  sourceId: string;
  maskId: string;
  parentVariantId?: string;
  kind: StickerVariantKind;
  name: string;
  width: number;
  height: number;
  byteSize: number;
  mime: "image/png" | "image/webp";
  outline: OutlineSettings;
  mode: CutMode;
  warnings: string[];
  /**
   * 云端 id 只在用户主动“加入作品”后才有。`undefined` = 仅本机。
   * 不能把它和本地 id 混用。
   */
  cloudAssetId?: string;
  cloudUrl?: string;
  /**
   * 批量任务里的临时渲染结果。
   *
   * 导出 ZIP / 加入画布都需要真实字节，所以字节必须落盘；但当用户关掉「完成后
   * 保存到本机素材」时，它不应该出现在素材库里，否则那个开关等于没作用。
   */
  ephemeral?: boolean;
  createdAt: number;
}

export type BatchItemStage =
  | "queued"
  | "decoding"
  | "detecting"
  | "matting"
  | "composing"
  | "saving"
  | "done"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface BatchItemError {
  code:
    | "input-invalid"
    | "model-load"
    | "matte-failed"
    | "mask-empty"
    | "storage-quota"
    | "upload-failed"
    | "unknown";
  message: string;
  retryable: boolean;
}

export interface BatchItem {
  id: string;
  sourceId: string;
  name: string;
  stage: BatchItemStage;
  /** 0–100，只有真实阶段推进时才变动 */
  progress: number;
  attempt: number;
  variantIds: string[];
  error?: BatchItemError;
  startedAt?: number;
  finishedAt?: number;
}

export interface BatchJob {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** 提交时的参数快照；之后改面板不影响已提交的任务 */
  settings: {
    mode: CutMode;
    outline: OutlineSettings;
    maxSide: number;
    format: "png" | "webp";
    /** local colour treatment, applied before masking */
    personColor?: PersonColor;
    colorTint?: string;
  };
  concurrency: number;
  items: BatchItem[];
}

/** Import payload handed to the Stage canvas bridge. */
export interface StickerImportInput {
  variant: StickerVariant;
  asCharacter: boolean;
  /** Stage 元素名，默认取 variant.name */
  name?: string;
  line?: string;
}

export interface StickerImportResult {
  ok: StickerVariant[];
  failed: { name: string; message: string }[];
}
