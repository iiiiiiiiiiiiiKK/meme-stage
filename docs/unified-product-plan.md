# MEME STAGE × MEME STUDIO — 统一产品规划

> 版本：产品整合方案 1.0（2026-11-12）  
> 目标：把现有 MEME STAGE 的“角色/声音/剧情发布”和 Meme Studio 的“本地抠图/透明贴纸/描边/批处理”合为一个连续创作产品；保留两者强项，避免第二套素材库、第二套画布和重复的图片处理引擎。

---

## 实施进度（2026-11-12 更新）

阶段 0–5 的核心能力已在 `meme-stage` 主仓落地并部署到 `https://meme-stage.pages.dev`：

| 阶段 | 状态 | 落地内容 |
| --- | --- | --- |
| 0 审计 | ✅ | 确认两套技术栈、模型体积（约 6.5MB）、许可与线上基线 |
| 1 Asset Bridge | ✅ | 贴纸经 `/api/assets` 上传为 R2 对象，作为独立 `image` 或 `character` 元素插入；上传失败不产生坏引用 |
| 2 单张工坊 | ✅ | 本地检测/抠图/程序化双层描边/手动 Mask 修复/版本保存，均在 `/studio/sticker` |
| 3 批量工坊 | ✅ | IndexedDB 持久化队列、刷新恢复、单张超时保护、ZIP + manifest、批量入画布，在 `/studio/batch` |
| 4 素材库合并 | ✅ | `/assets` 统一入口：本机（IndexedDB）与云端（R2）同一屏、作用域标记、类型/名称筛选、多选加入画布、云端删除 |
| 5 AI Provider | ✅ | 服务端 Provider 适配层 + `/api/ai/capabilities|generate|edit`；文字生成、风格化、结果落 R2、未配置态、成本与失败直说 |
| 6 多主体/通用物体 | ⏳ 部分 | 多脸选择已可用；动物/商品/卡通没有专属模型，明确以本地 Alpha + 手修兜底 |

### 阶段 5 的实际核验记录（2026-11-13）

密钥按要求只写入 Cloudflare Pages secret `IMAGE_API_KEY`，没有进入源码、文档、构建产物或仓库：

- `GET /v1/models` 返回 17 个模型，账号可用集合经阈值筛选为 `gpt-image-2.5` / `gpt-image-2.6`。
- `POST /v1/images/generations`：`model + prompt + n + size` 约 15–20s 出图；加上 `response_format` / `output_format` / `background:"transparent"` 会稳定 196s 后返回 `upstream_total_timeout`。实现因此默认不带这些字段，并在超时/空图时用最小 body 自动重试一次。
- `POST /v1/images/uploads`：只接受**原始图片字节 + `image/*` Content-Type**；JSON body 返回 400，data URL 返回 415。
- `POST /v1/images/edits`：必须用 `images:[{image_url}]` 指向已上传的 URL，约 25–35s 出图。
- 生成的 CDN 链接是临时的，所以服务端会立刻下载并写入 R2 + D1，对外只暴露 `/api/files/:id`。

代码位置：

- `src/features/sticker/` — 引擎、处理器、仓储、桥接、两个工坊、AI 面板
- `src/features/sticker/engine/` — 从 Meme Studio 原样迁入的 `ai/mask/outline/cutout/image`
- `src/features/sticker/{ai,AiStylePanel,AiGeneratePanel}.tsx` — 浏览器侧 AI 客户端与两个面板
- `functions/_lib/{imageProvider,generatedAsset}.ts` — 服务端 Provider 适配与生成结果入库
- `functions/api/ai/{capabilities,generate,edit}.ts` — 三个只走服务端的 AI 接口
- `src/pages/{Studio,UnifiedLibrary}.tsx` — `/studio/*` 与 `/assets` 路由
- `public/models/` — 本地模型静态资源（selfie / blazeface / facemesh / rvm）

---

## 0. 本轮已审阅的真实材料

- 已读取 MEME STAGE：React 19、TypeScript、Vite 8、Konva、Zustand；Cloudflare Pages Functions + D1 + R2；线上分享、访问权限和声音/剧情工作流已有实现。
- 已读取 Meme Studio 源码结构与 README：React 18 + Vite 5、TensorFlow.js 本地人物分割与 FaceMesh、Canvas Alpha Mask/程序化描边、手动 Mask 画笔、IndexedDB 本地资产库、批处理页、透明导出和 Canvas 编辑器。Studio README 声明默认图像处理在浏览器本地完成，图片不上传；源码中 `cutout.ts` 的处理流水线可复用，批量页目前使用 1–4 worker、单项失败隔离、队列暂停/取消/失败重试和 JSZip；当前仍有 Batch / Create / Editor 三个独立路由。
- 已读取任务书相关章节：多主体选择、Mask 修复、统一批量参数、失败重试、ZIP + manifest、同一处理引擎、素材库合并、画布独立图层导入、AI 默认关闭/显式授权成本、API Key 仅服务端。
- 已读取图像 API 文档概览：`https://shyfai.cn/#start` 把 Images API 分为 `/v1/images/generations`、`/v1/images/edits`、参考图上传、异步任务与状态查询；API 文档重点要求服务端保管密钥、尊重 `response_format` / `output_format` 差异、支持异步轮询与幂等。用户另给 `https://agent3.shyfai.cn/usage`，该页面可访问但公开抓取只显示“Agent - AI API Gateway”标题，尚未得到足够的路径、模型、请求体、计费/额度详情，不能据此把它视为已验证的 OpenAI 兼容 API。
- API 密钥只通过 Cloudflare Pages secret `IMAGE_API_KEY` 注入（已执行），`IMAGE_API_BASE_URL` / `IMAGE_API_MODELS` 是 `wrangler.jsonc` 里的明文 `vars`。密钥没有进入源码、文档、浏览器 LocalStorage、GitHub、构建产物或本计划文件；每次提交前都做了字符串扫描确认。

> 范围说明：本文开头第 1–27 行是**实施结果**，之后章节保留原始规划内容以说明设计意图。原始规划里"尚未调用生图 API"等表述反映的是写作当时的状态，已由实施记录覆盖。

---

## 1. 产品定义：一条流水线，三个工作阶段

统一产品暂定名称 **MEME STAGE Studio**（品牌可后续定名），内部能力区分三种工件：

1. **源图 Source**：上传/本地导入的原始图，永不被覆写。
2. **贴纸 Sticker**：由源图生成的透明 PNG（或保留原 alpha 的 WebP），可有多个版本：原始抠图、手动修 Mask、描边版本、风格变体。
3. **作品 Project**：MEME STAGE 的无限画布、文字/角色/语音/剧本/互动事件、发布版本。

统一创作路径：

```text
源图导入
  → 主体识别 / 选主体
  → 本地抠图得到 Alpha Mask
  → 手工修边（可选）
  → 程序化描边 / 阴影 / 颜色效果
  → 生成贴纸版本
  → 保存到唯一素材库
  → 直接作为独立图层加入作品
  → 添加台词 / 声音 / 口型 / cue / GIF/MP4 特效
  → 预览、保存、发布、分享
```

**默认不调用生成式 AI**。绝大多数贴纸只用本地分割、Mask 和描边。AI 仅在用户主动选中“生成风格版本 / 补画 / 图像编辑”并确认本次估算与额度后，由服务端调用 provider。

### 统一首页与 IA

不要保留“Studio 独立产品 + Stage 独立产品”两套顶层导航。融合后一级入口建议：

- **作品**：新建/最近/已发布/模板。
- **素材**：唯一资产库，源图、贴纸、背景、音频、动图、封面用类型筛选。
- **创作**：单图贴纸工作台；也可从批量项深入到同一工作台。
- **批量工坊**：批处理任务队列与结果画廊。
- **舞台**：MEME STAGE 画布、角色声音、剧本和交互。

“贴纸工坊”和“批量”是**同一处理链的两种入口**，不是两个算法实现。作品画布是最终消费面板，不另做第三个资产库。

### 两个场景的边界

- **Studio** 负责得到质量可靠、可编辑、有来源记录的 Sticker 工件。
- **Stage** 负责把贴纸排成故事/舞台，角色声音和演出顺序是 Stage 的主职。
- AI 生图不是背景移除的默认替代品。模型风格编辑产生的是新的候选 Sticker 版本，原图与原始本地抠图必须保留。
- Stage 的项目内容继续使用 Cloudflare 保存/发布；Studio 的原图/Mask/中间态默认只在本地。用户主动“加入作品/云端同步/发布”时，才把选定导出工件上传到 Stage R2。

---

## 2. 去重决策表（避免重复建设）

| 能力 | 唯一所有者 | 复用/改造方式 | 不能并存的重复版本 |
|---|---|---|---|
| 背景移除、主体分割 | Studio `cutout` pipeline | 把 `detectAll/personAlpha/runCutout` 从页面抽成无 UI 的 `StickerEngine`，单张和批量调用相同接口 | Stage 再写一套抠图 API/Canvas 算法 |
| Alpha Mask、形态学、边缘羽化 | Studio `mask.ts` | 保持像素算法与来源分辨率，不由 AI 描边 | Stage 仿写描边/前端套 CSS outline |
| 双层描边、阴影、发光 | Studio `outline.ts` | 配置对象移入共享 Sticker 领域包，渲染器只维护一份 | Studio 和 Stage 各存一套描边参数语义 |
| 手动 Mask 修复 | Studio | 以原分辨率 mask 编辑器写回不可变 Sticker 版本 | Stage Inspector 再做一个 Mask 编辑器 |
| 单张/批量处理队列 | Studio Batch | 统一 TaskQueue；单张就是 1 个 task，批量只是提交多项 | 单张按钮和 Batch 各自维护异步状态机 |
| PNG/ZIP/manifest | Studio export | 所有通过/失败项来源于真实 task record；ZIP 可重复构建 | Stage 另做不带 manifest 的第二种批量打包 |
| 素材库 | MEME STAGE R2/D1（云资产）+ Studio IndexedDB（本地工件） | 一个跨存储 Asset Repository 与统一 UI；本地 assetId 与 cloudAssetId 明确区分 | 继续让两边各有用户看不见彼此的“我的素材” |
| 画布/图层/旋转/缩放/文字 | MEME STAGE Konva Editor | 继续用现有 ProjectData/CanvasElement，把贴纸作为 image/character element 导入 | 在 Studio 继续扩建第二个无限画布编辑器 |
| 语音、TTS、录音、多语音 | MEME STAGE | 保留 voice clips / audioEngine，Sticker 可升级为角色 | Studio 加一套不同音频模型 |
| 剧本、cue、互动配方、发布 | MEME STAGE | 保留 PerformanceRunner、events、publish/public viewer | Studio 模板复制同类脚本数据 |
| AI 图像 API | 新增共享服务端 Provider | 单一 Cloudflare Worker/Pages Function adapter、模型白名单、额度和审计 | 前端各组件直连供应商或各模块私藏 API key |

### 重要整合选择：合代码库而非套 iframe

不建议把两个现有 SPA 用 iframe 拼起来：两边 React 版本、路由、样式体系、IndexedDB、资源 URL 和状态互不相通，导入会沦为下载再上传，重复存储和权限问题仍在。推荐：

1. 先保持 `meme-stage` 为主仓/主部署，它已经有真实作品分享、云素材和服务端接口；
2. 把 Studio 的处理核心与 UI 组件分层迁入同一 repo（非破坏式搬移、按域分包），而非整个 App 嵌套；
3. Studio IndexedDB 资产作为本地原件来源，Stage 后端继续作为发布与云资产层；
4. 删除 Studio 的第二套作品编辑器入口，保留必要的独立导出预览；
5. 等真实 API 和产品边界验证后，再决定是否迁移 Studio repo 或保留为旧版独立工具。

---

## 3. 目标用户体验：从单张到发布不跳工具

### 路径 A：单张角色贴纸并做成会说话人物

1. 在“创作”导入照片（拖拽/粘贴/素材库/Stage 画布反向导入）。
2. 浏览器本地读取图像尺寸/格式，创建 Source record；保留原始 Blob。
3. 加载本地 AI 分割模型，运行人物分割和人脸检测；展示脸部框、主体蒙版与处理质量提示。
4. 多人图显示主体选择卡片：选一个、选多个分别输出，或选择“整组作为一个贴纸”；FaceMesh 只辅助选脸/裁头，人物 alpha matte 定义身体轮廓，不把矩形框冒充 Mask。
5. 使用实际 Alpha 做 erode/dilate/feather 与程序化描边；实时调白边、黑外线、阴影、颜色变体，不重复分割。
6. 可进入 Mask 修复画笔（restore/erase、笔刷大小/硬度、撤销/重做），所有操作写入新的 Mask 版本，原始 matte 保留。
7. 选择“保存贴纸”进入唯一素材库。选择“加入舞台”创建 Stage 作品（若无当前作品则创建草稿），上传透明结果与必要缩略图，再在画布上默认居中插入独立 layer。
8. 角色创建后右侧切换“声音/口型/气泡”，绑定多条声音或 TTS，设置嘴部锚点、脚本 cue、GIF/MP4 特效。
9. 预览一键演出，发布 Stage 项目并获得分享链接；素材工厂负责 sticker，Stage 负责完整故事。

### 路径 B：批量制作 20–50 张

1. Batch 工作台添加多文件/文件夹/粘贴/从素材库勾选/从现有 Project 勾选。
2. 队列项显示来源图、文件名、格式/尺寸、识别状态、Mask 状态、描边版本、结果缩略图、错误原因。
3. 设置批量默认策略：模式、输出格式、描边、缩放上限、标签。提交时将设置快照固化到任务版本；之后改 UI 默认值不改变已运行任务。
4. 设并发 1–4；模型在浏览器本地执行，避免所有大图同时解码。任务状态持久化 IndexedDB；每个任务可以单独取消/重试/重新编辑。暂停不杀正在运行的本地模型推理，只阻止新任务开跑，并准确显示“当前项完成后暂停”。
5. 一个坏文件只影响自己，完成/失败项继续保留；错误详情有“重试本项”和“打开单张修复”。
6. 结果画廊支持网格/列表、透明棋盘格、原图对比、选中/全选、删除/收藏、单张下载、批量存本地库、批量导入舞台。
7. ZIP 仅打包成功选择项；文件名冲突稳定去重，包含 `manifest.json`（原名、来源、hash、输出、尺寸、Mask 模式、描边、任务状态、时间、warnings）；可另下载失败报告。
8. 批量导入 Stage 时，默认一张结果对应一张独立角色/贴纸层。若创建“角色组”，UI 不预设语音；用户可再按文件名/批量清单绑定声音和台词。

### 路径 C：可选 AI 风格版

1. 用户选中一个或多个 Sticker 版本，明确打开“AI 风格版”。
2. UI 显示模型、输出张数、预计计费依据（若 API usage/价格可用）、并发与是否覆盖不透明背景；用户逐次确认，不对队列自动调用。
3. 输入内容应以原图/透明贴纸作为参考图，说明需保留面孔、手势、姿势和透明背景；若供应商不能保证 Alpha，则先生成风格候选，再用本地模型去背景，保留“AI 图像”与“后处理”来源链。
4. 生成是异步 task：queued → submitted → polling → downloading → validating → completed/failed；幂等键防止双击重复扣费。
5. AI 结果为独立 variant，原始 source 和 local-cutout 均不可覆盖；失败、取消、API 未配置都清楚标识，不伪造完成状态。

---

## 4. 统一信息架构与页面

### 顶层导航

- **主页 / 最近作品**：可玩预览、最近作品、新建空画布/从图片创作。
- **创作工坊**：单张贴纸处理与编辑（原 Studio Create，命名升级为 Sticker Studio）。
- **批量队列**：原 Batch Studio，提供真实任务/结果。
- **素材库**：本地/云端统一检索；筛选“仅本机”“云端可发布”“已在某作品使用”。
- **作品**：MEME STAGE projects；打开现有 Konva editor。
- **模板**：去重的 Stage 模板和 Sticker presets 分域显示，不混为同一种模板。
- **设置**：AI Provider 状态、模型选择、额度/成本提示、存储使用、隐私清理。

### 单张工坊工作区

按任务书三栏，但把版面服从“纸感编辑器”的统一视觉：

- 左：素材/Source/选中主体/处理历史；批量模式时换任务清单。
- 中：原图、透明预览、Mask/描边预览；before/after 拖动对比；缩放、平移。
- 右：主体选择、抠图模式、Mask 参数、描边层、颜色、手修、AI 变体（高级折叠）。
- 底：`分析主体`、`生成贴纸`、`加入舞台`、`保存版本`、`下载`，耗时/阶段有真实状态。

### 批量页职责

保留 BatchPage 任务板和结果网格；右侧为统一样式面板。点击某项“修复/独立设置”复用单张工坊同一组件与处理服务，点击返回维持队列上下文。

### Stage 画布职责

继续是完整故事编辑器：导入结果层、角色、声线、剧本、互动和发布。它不显示 Alpha 处理参数（最多有“去创作工坊编辑此贴纸”跳转）。

---

## 5. 目标架构

### 当前基线（本次检查）

- Stage：主仓 `meme-stage`、React 19/Vite 8、Konva、Zustand、Pages Functions、D1/R2、已部署 `meme-stage.pages.dev`。
- Studio：独立 GitHub Pages SPA、React 18/Vite 5、浏览器 TensorFlow.js `@vladmandic/human`、本地 Segment/FaceMesh、本地 IndexedDB (idb)、JSZip、Canvas mask/outline。Studio README 宣称纯前端本地优先，无 API key/服务器。
- 因此不能把 Studio “零上传”说明原封不动保留在同一 UI：Stage 的发布/云素材必然会将选定图像上传至 Cloudflare。要用清晰的本地/云端标签和一次性动作告知切换边界。

### 建议 monorepo/module boundaries

```
apps/
  web/                     # 统一 SPA、路由、品牌导航
packages/
  sticker-core/            # decode, face detect, matte, mask, cutout, outline
  sticker-workbench/       # 单张 + batch 共用 React 工作区与 task UI
  stage-canvas/            # 现有 Konva Editor/VisitorStage/Performance
  asset-domain/            # Source/Sticker/Variant/Project/Import DTO 和校验
  provider-contracts/      # ImageGenerationProvider 与定价/结果/能力声明
functions/
  api/ai/images/*          # 仅服务端持密钥的 generate/edit/upload/status routes
  api/assets/*             # 现有 Stage 云资产接口扩展派生关系/批量导入
  api/projects/*           # 现有 Stage Project 保存/发布接口保持
```

第一阶段可先在 Stage 仓库内 `src/features/sticker/**` 搬入 Studio 核心和 UI；同一部署能减少重复产物。抽包后才按稳定 API 边界拆 workspace package，不为“架构漂亮”先迁整个产品。

### 核心纯函数处理合约

```ts
interface StickerProcessor {
  inspect(source: ImageSource, signal?: AbortSignal): Promise<SourceFacts>;
  detect(source: ImageSource, signal?: AbortSignal): Promise<DetectedSubject[]>;
  makeMatte(source: ImageSource, subjectId: string, signal?: AbortSignal): Promise<MaskVersion>;
  compose(source: ImageSource, mask: MaskVersion, params: ComposeParams): Promise<StickerBlob>;
}
```

- `detect/makeMatte/compose` 的实现默认仍是本地模型和 Canvas 算法；不得在批量页复制核心算法。
- `compose` 输入源 Blob + 规范化 Mask + 参数，输出透明 Blob/尺寸/hash，不直接写 D1/R2/IndexedDB，存储层由 AssetRepository 决定。
- mask/stroke 调参可重跑 `compose()`，不重新调用模型；只有 Source 或选择主体变化才重算 matte。
- 像素维度与存储值区分“源图空间”和“UI 参考尺寸”；结果 manifest 记实际像素参数。

### 跨边界导入 DTO

最小 DTO：

```ts
interface StickerImportDTO {
  sourceAssetId?: string;
  stickerBlob: Blob;
  name: string;
  width: number;
  height: number;
  mime: "image/png" | "image/webp";
  hasAlpha: true;
  variantId: string;
  sourceHash: string;
  outline: OutlineSettings;
  warnings: string[];
}
```

Stage 侧做映射：

```ts
createImage({url, thumbUrl, assetId, name, animated?: undefined})
```

或用户勾选“作为角色”，则创建 `character` element，`imageUrl` 指向透明贴纸，尺寸保留比例，`mouth` 用已有嘴部取点锚点编辑。ID 关系 `sourceAssetId → stickerVariantId → cloudAssetId → projectElementId` 可追溯。

---

## 6. 数据模型与存储

### SourceAsset（原件）

- `id, localId, cloudId?`
- `name, mime, byteSize, width, height, sha256`
- `localBlob?`（只在本机，不可序列化进项目 JSON）
- `storageScope: local | cloud`
- `createdAt, deletedAt?`

### SubjectSelection（检测对象）

- `id, sourceId, type: person|animal|object|unknown`
- `bbox`, `score`, `faceLandmarks?`, `sourceIndex`
- `maskVersionId?`, `userAccepted`, `warnings[]`
- 多人图各主体独立选择；“整组”是一个全图 matte variant，而非把多个主体 id 混到一个裁剪框。

### MaskVersion

- `id, sourceId, subjectId, algorithm, modelVersion, width, height`
- alpha bytes 压缩 Blob（IndexedDB 本机）；hash、透明占比、生成时间、质量 warning。
- edits 以版本化 undo/redo 记录或 Mask stroke command log；不要存成巨大 React state / 项目 JSON。

### StickerVariant

- `id, sourceId, maskVersionId, parentVariantId?`
- `kind: local-cutout|manual-mask|ai-style|restyled|outline-only`
- `outlineSettings`, `colorMode`, `format`, `width`, `height`, `byteSize`, `sha256`
- `provider/model/requestId?`, `costEstimate?`, `costActual?`, `status`, `createdAt`
- 云端 R2 仅保存用户选择上传/加入可发布作品的变体；默认本地原图和 mask 留 IndexedDB。

### BatchJob / BatchItem

- BatchJob 存：`id, createdAt, status, concurrency, settingsSnapshot, total/completed/failed/cancelled, pauseRequested, version`。
- BatchItem 存：`id, sourceAssetId, subjectSelections[], currentStage, progress, attempt, resultVariantIds[], errorCode/errorMessage, retryable, startedAt/finishedAt`。
- 用 IndexedDB 逐项写状态；处理中刷新后恢复 `queued/paused`，把 crash 前 `working` 项标成 `interrupted` 并可恢复，而不是冒充已完成。
- worker 数保持 1 默认，最多 4，受内存估算和设置上限约束；不能同时解码 50 张大图。

### Stage Project

- 继续用既有 `ProjectData`、`elements`、`performances`、`events` 与 `rev` 乐观锁。
- Stage R2/D1 云资产增加可选 metadata：`source_local_id` 不存本地隐私路径，只存导出端 sourceHash/variantId；不写入整张 base64 或 Mask 数据。
- 删除云贴纸需检查被项目引用的情况：标记 archived/确认断链，而非从 R2 删除后让公开作品 404。
- Stage 项目发布只引用已上传的 same-origin `/api/files/...`；单纯本机 blob URL 必须提示“上传以发布”并执行显式上传。

---

## 7. API Provider：接入策略与密钥安全

### Provider 接口

```ts
interface ImageGenerationProvider {
  capabilities(): Promise<ModelCapabilities[]>;
  generate(input: GenerateRequest, signal?: AbortSignal): Promise<GenerationTask>;
  edit(input: EditRequest, signal?: AbortSignal): Promise<GenerationTask>;
  getTask(id: string): Promise<GenerationTask>;
  uploadReference?(file: Blob): Promise<{url: string; expiresAt?: number}>;
  estimate?(request: GenerateRequest | EditRequest): Promise<CostEstimate | null>;
}
```

每个 ModelCapabilities 明确：`id/name`, `generate/edit`, `referenceImage`, `mask`, `maxN`, `supportedSizes/aspectRatios`, `synchronous|asynchronous`, `outputMime`, `requiresRemoteImageURL`、价格信息来源/更新时间。

### 安全/配置

- 生产：`IMAGE_API_BASE_URL`、`IMAGE_API_KEY`、`IMAGE_API_MODEL_ALLOWLIST` 只由 Cloudflare secrets/runtime env 读取；客户端只能请求 `/api/ai/images/*`。
- 不把用户刚在对话中发的 key 作为部署值；建议先在供应商控制台轮换，然后只通过 secret manager 注入。
- 不向前端下发 secret；服务器日志删 `Authorization`、请求体 image/data URL、签名 URL query；错误只返回安全 code/message/requestId。
- 服务端做模型 allowlist、体积/像素数/格式白名单、输入 URL 策略、超时、并发 semaphore、用户配额、日预算和幂等键。
- 云 API 请求中的参考图片优先由服务端上传接口或经签名的临时附件提供；禁止任意 URL fetch，避免 SSRF。若供应商必须可公开拉取，上传到短 TTL staging 路径；任务完成或过期清理。
- 调用费用按成功响应的 `usage` / 供应商账单记录；供应商没有可靠用量/价格时显示“费用未知”，不伪造精确估算。

### Agent3 URL 尚待验证的连接点

`https://agent3.shyfai.cn/usage` 公开抓取只显示标题，没有足够公开内容证明具体 Base URL、OpenAI 兼容路径、异步任务协议、模型名称或价格；`https://shyfai.cn/#start` 文档说明其图片 REST API，但是否与 Agent3 是同一域/同一账号/同一路由尚未确认。上线 API adapter 前做**非生成式只读验证**：

1. API Key 轮换后放入服务器 secret，不在浏览器调用。
2. 对 Agent3 的官方 usage/config 查当前套餐、剩余额度、模型目录、准确 base URL 和请求示例。
3. 用服务端的 `/models`/provider capabilities 查询验证模型确实可用。
4. 使用低成本的一张小尺寸请求作为明确单次 smoke（需 UI 用户点击），记录 request id、usage、返回格式；不自动发送测试图。
5. 检查生成结果的 URL/Base64、异步/轮询、参考图编辑和真实成本；据此填 provider capability config。
6. 若 Agent3 仅有前端页面登录的账户用量、没有正式 API，则先不接入生图；实现 provider contract + unavailable 状态，不模拟结果。

### 生成/Edit 字段映射（须按实际 gateway 验证）

基于已读取的 shyfai 文档，OpenAI 兼容大致使用：

- 文生图 `POST {BASE}/v1/images/generations`: `model`, `prompt`, `n`, `size`, `quality`, `response_format=url|b64_json`, `output_format=png|jpeg|webp`, `Idempotency-Key`。
- 图像编辑 `POST {BASE}/v1/images/edits`: 支持参考图 `images` / `image`, mask 取决于兼容路由；优先 URL/多图格式，multipart boundary 由 HTTP 客户端设。
- 异步：`callback_url` 可令该文档入口走异步，之后 `GET /v1/images/tasks/{request_id}` 查询；但不能假设 Agent3 usage endpoint 也提供这些路径，需单独确认。
- `response_format` 控制 URL 或 Base64，`output_format` 控制图片 mime，二者是正交维度。
- 最小输出默认数量 1；API 调用前用户确认，批量 AI 风格变体必须二次确认选中数和预算。

API 适配必须测试重试/幂等、异步超时、URL 失效、部分成功、多图拒绝、授权错误；接口输出作为 AI 变体，不作为本地抠图替代。

---

## 8. UI/交互与命名归一

避免功能重复的具体规则：

1. `Create` 改成 **Sticker Studio / 贴纸工坊**，承担单张上传、分割、修 Mask、描边、预览、保存/加入舞台。
2. 原 Studio `BatchPage` 变成 **批量队列**，只负责任务组织/批量参数/进度/结果集；点击结果编辑时复用单张 Sticker Studio。
3. `LibraryPage` 与 `useLibrary`/`asset-store.ts` 统一为素材库。资产 `kind` 扩展到 `source|sticker|background|audio|gif|video|cover|project-export`，加本地/云端状态，不再另做 Sticker Library。
4. `EditorPage` 统一为 **MEME STAGE 作品画布**，导入结果只添加现有 image/character layer，不在 Studio 复刻 layer sidebar/transformer/export。
5. Stage 现有角色语音、TTS、剧本、cue、口型、效果与分享保留；Studio 贴纸的来源/Mask 元数据不要塞进舞台 JSON，只用 `assetId` 引用。
6. 处理模式（head/full/background/face）仅是“贴纸生成”参数；Stage 项目画布模板（16:9、9:16、场景排版）保留各自含义，不在菜单里把两者都叫 Template。
7. 结果页提供一个主要操作“加入作品”，再选择当前作品/新建作品；“存入素材库”是保留可重用资产，“加入作品”才上传并放入舞台。一次加入多张=每张独立 element；可选择是否批量转成角色。
8. UI 声明清楚：“本地处理/已保存本机”“上传到 MEME STAGE 以便发布”两个状态；从本机 IndexedDB 分享作品不代表读者能取得本机图片。

---

## 9. 功能详表与 MVP 边界

### 现有基础、应原样保留

- 本地 TFJS 人脸检测/468 点 FaceMesh/人物 matte 和 fallback warning。
- 7 种切图模式；原 Alpha Mask；膨胀/腐蚀/羽化/连通组件；双描边/阴影/发光。
- 手动擦除/恢复 Mask、undo/redo、原图/mask/result 对比。
- Batch 1–4 worker、失败隔离/重试、暂停/继续/取消、ZIP、自动存本地库选项。
- IDB 素材、收藏/标签/回收站/项目和 Preset。
- Stage 无限画布、人物属性、音频、批量人物、声音、事件、剧本演出、素材上传、模板、发布分享。

### P0：连成端到端的最小版本

- 两套应用同视觉/导航 shell，保留现有各自本地工作路径。
- 唯一 AssetRepository facade（本地与 Stage 云端 adapter），避免二边直接 import 对方的 store。
- Sticker 工件导出 DTO，Stage 导入为 image element/可转 character；导入真实文件保留 alpha、比例、文件名、来源。
- Batch 结果支持 grid/list、每项放大/对比/下载、选择、保存素材库、ZIP、`manifest.json`。
- Batch 任务状态和 settings snapshot 可 IndexedDB 持久化；刷新恢复 queued/failed/interrupted。
- 修好任务书规定：同一引擎、取消和恢复边界、文件名冲突、格式实际支持/失败解释、无假 progress。
- API Provider 先完成 config/capabilities/unconfigured UI/Mock contract tests；正式请求只在密钥/模型/费用已核实后启用。

### P1：多人/多主体和交互效率

- 人脸以外的物体/动物目标检测能力评估；先用当前分割能力给出“分割主体”而不是许诺任意物体完美识别。
- 多脸选择配合 FaceMesh；选多个主体 separately cut，或 merge-with-alpha 为 group sticker。
- 批量结果从文件名自动命名；可以 CSV manifest 调整 name/tags/mode/outline，预览后应用。
- 一个失败 task 可单独进入单张修复，再把修正版结果回填原 batch item。
- 批量导入 Stage 预览队列：要上传的项、尺寸、角色/贴纸 layer 类型、默认排布、云端空间与公开作品影响先展示。

### P2：AI 变体与进阶生产

- API Provider 完成认证、文本/图像编辑、异步轮询、成本审计、限流和操作确认后，才开放 AI 风格候选。
- 风格 Preset 可以用 AI Prompt Profile 保存，但图像调参可编辑、能追踪模型/参数。
- mask-aware edit/透明输出能力按模型实测；不保证的场合：AI 输出转本地 mask，再保留 AI 原件并展示对比。
- 只对用户选择的多个 sticker 发并发 AI 任务；每个任务独立失败/重试、批次预算硬止损。
- 支持给 AI 生成候选后快速接受/丢弃；接受不会覆盖原始 sticker。

### P3：多人协作 / 云同步（可另立决策）

- 账号/团队/配额、云端私有素材、云同步、AI 额度账单、共享空间。
- 当前 Stage 用匿名 editor key 是作品编辑能力，不等于成熟用户身份与团队资产控制；不要把它直接宣称成权限/组织账户系统。
- 只有存储、删除、费用、隐私与容量策略决定后才实现全素材云端化。

---

## 10. 跨端数据流与导入行为

### 从工坊至 Stage

1. 贴纸先得到 local assetId 和 Blob。
2. 点击 `加入作品` → 生成 StickerImportDTO → Stage Import Adapter 校验尺寸/mime/`hasAlpha`/sourceHash。
3. 不存在云文件则通过现有 `api.uploadAsset()` 上传 `kind=image`，获取云 `assetId/url/thumbUrl`。
4. 在现有 `useEditor.addElements()` 一次 `mutate()` 放入 N 个元素，Z 顺序连续；从批量导入用统一 `layoutElements()` 一次布局，默认保证同画布内且分开。
5. 元素默认可为 `image` sticker；勾“设为角色”则 `createCharacter` 填图并配置 bubble/voice empty，使后续可以加声音。
6. 成功后写本地关联 mapping `localStickerId → cloudAssetId`；项目保存走现有 rev optimistic lock。
7. 如果 Cloudflare 上传/保存失败：工坊保留 local item，不新增损坏 Element，显示可重试；禁止静默插入只本机 blob url 到可公开作品。

### 从 Stage 至工坊

- 选单个 Element：“编辑贴纸”把同源文件下载/读入一个 local Source，Editor 原 layer 不变。
- 选多个 Element：“复制到贴纸队列”由 Stage DOM 取 fetch blob；多项按原 layer 顺序入队，复用相同 processor。
- Stage 上传素材列表已经分页且 cloud asset 有 kind/size/name/url，Studio 可用 Stage adapter 拉数据并选择导入本地；无需新增第二个 Cloud 素材 API。
- 不从 Project JSON 遍历/复制 Data URL；仍只保存 asset URLs 和 element attributes。

### URL / Blob / ID 约定

- IndexedDB object URLs (`blob:`) 仅当前浏览器 session，有离场失效；任何发布项目不能引用该临时 URL。
- Local asset id 不能冒充 Cloudflare `asset.id`；形式上使用 `local:` / `cloud:` namespace 或 `{scope,id}`。
- R2 URL 受权限和同源保护；公开分享用 Stage `/api/files/:id` 可访问的对象 key。
- `sourceHash` 做去重提示，不作为跨用户授权；用户仍可选择保留相同图像两个版本。

---

## 11. 算法与质量路线

### Processing 产物分离

```
Original source
  ├─ detected subjects + confidence
  ├─ person/subject alpha matte (editable versioned mask)
  ├─ user mask edits (command history / new mask hash)
  ├─ Sticker composition: color filter + stroke layers + shadow/glow
  └─ AI variant (optional, separate source relationship)
```

- `runCutout()` 现有统一处理函数可以作为第一版 cutout engine；通过 interface 包装，不必改掉实际算法重写。
- `buildCutMask()` 目前多人选择主要靠 FaceMesh/所选脸的连通区域；不能把它称作“所有对象检测”。用户任务书提到动物/商品/卡通，方案要分能力层：Person 高质量、Face mesh 可选、generic object 先标实验/人工遮罩，后续评估模型许可、体积与内存。
- `personAlpha()` 的 Selfie Segmentation 对人像效果最好；未知/错误 matte 必须显示 fallback badge 和 warning。对商品/动物不可默认承诺质量。
- 批量与单张都用同一 `StickerProcessor`。统一参数改变只重跑 compose；AI style 只重跑 selected variants；mask 改动不需重测 source metadata。
- 局部修复 painter 使用 source-space 坐标；屏幕缩放只影响画笔指针，不改变 Mask resolution。
- 透明 PNG 导出需测 PNG RGBA alpha > 0、透明背景边缘无 checkerboard flatten；JPEG 明确告知透明变白。检查 GIF 动图另走 stage media，不作为 cutout mask 的结果格式。

---

## 12. API / 费用 / UI 状态设计

### 任务状态机

```text
queued
  → local-decoding
  → subject-detection
  → matte-generation
  → mask-refine (optional)
  → outline-composition
  → local-saving / cloud-upload (only after user action)
  → completed
```

AI variant 任务状态另有：

```text
awaiting-confirmation → submitted → provider-queued → provider-running
→ downloading → alpha-recovery (optional) → completed | failed | cancelled | expired
```

- 每项进度必须由真实阶段转移/可观测步骤驱动；第三方没有返回进度时显示“模型处理中”微进度/经过时间，不显示模拟百分比。
- 错误分 `input-invalid`, `model-load`, `matte-failed`, `mask-empty`, `storage-quota`, `provider-auth`, `provider-rate-limit`, `provider-timeout`, `provider-output`, `upload-failed`；保留 retryability。
- 重试是明确再尝试同一个 task/幂等标识；跨 provider 新生成须告知这会创建新任务。
- 多任务取消无法中断 TFJS 当前 op 时，取消标志在当前 item 结束后生效，并 UI 显示此语义。

### 成本控制

- 默认本地工作流不调用 API，不用一个 AI 请求“抠图 + 描边 + 贴纸”来替代可控的本地处理。
- 成本询价可信度层：供应商返回 usage + 已验证价格表 → 显示估算；只有 usage 但无已证价格 → 显示 token/图片数；都没有 → 显示“费用未知，以平台账单为准”。
- 在调用前显示：选中数量 N、模型 ID、每 item 的请求数（n）、并发、输出规格、已知价格来源时间、估算总计或“未知”、确认按钮。
- 每用户硬限制：同时运行 1–2 provider tasks、batch AI 最大默认 5 张，允许配置上限，但不能无界 `Promise.all`。
- 设置 daily budget 与 max spend；预算未知时可设置最大调用数而非虚构金额。
- `Idempotency-Key` = 本地 taskId/version；本地防双击只作补充，服务端 idempotency 是扣费防重的最终线。

### 首次启动与 IndexedDB

- 资产 Blob、模型缓存、掩模都占浏览器配额；Settings 显示 `navigator.storage.estimate()` 实际占用和可用区间。
- 增加请求持久化 storage（`navigator.storage.persist()`）但状态由浏览器决定；失败解释为低内存/Private Mode 支持差。
- 清空原图与结果确认关联影响；Project 引用的 R2 asset 不因清除本地缓存而删除。
- 对大图先做尺寸/像素限制；decode 单 item，处理完释放 Canvas/ImageData/object URL；不是把 50 张 decoded 4K Buffer 一次全驻留。

---

## 13. API 路由提案（只在 Provider 正式核验后实现）

### 自有后端

- `GET /api/ai/capabilities` → 模型/能力/价格来源状态（不含密钥）
- `POST /api/ai/images/generations` → JSON 参数 + `idempotencyKey`，鉴权额度后发供应商
- `POST /api/ai/images/edits` → multipart 或临时附件 id；后端取参考图并调用 provider
- `GET /api/ai/images/tasks/:id` → 自有 task ID 状态；供应商 requestId 仅服务端持有
- `POST /api/ai/images/tasks/:id/cancel` → 合作方若支持则取消，否则标记不等待结果，不宣称供应商中断
- `POST /api/ai/images/tasks/:id/retry` → 根据可重试错误和幂等规则；显式告知是否再扣费
- `POST /api/assets/import-sticker`（也可复用原有 `/api/assets`）→ 上传所选贴纸最终 Blob；Cloudflare D1 metadata 增 variant/source hash 选项。

### Provider Adapter

```ts
interface ProviderConfig {
  baseURL: URL;
  modelAllowlist: string[];
  apiKeyRef: SecretReference;
  requestTimeoutMs: number;
  maxConcurrent: number;
  maxDailyRequests?: number;
}
```

`baseURL` scheme/host 必须 allowlist，不能让用户 runtime 传任意 server URL。编辑图片参考图远端下载必须 SSRF-safe（仅公开 http/https、DNS/IP 防私网、禁止 redirect 到内网、size limit、timeout、content sniff）。

### Provider 验收检查清单

- /usage 账号实际模型目录、精确模型 id、Base URL、Key scope。
- 该网关的 `/v1/images/generations` 和 `/v1/images/edits` 路径与是否支持异步。
- gpt-image-2.5 是否实际出现在 model list；shyfai 文档示例为 `gpt-image-2`，二者不能自行替换推测。
- 参考图上传 API 与 edit API 跨域/跨 host 的兼容性。
- `n`, `size`, `quality`, `output_format`, `response_format`, URL 保留期和限制。
- 返回数据具体是 `data[].url` / `b64_json` 还是其他格式。
- 错误/速率头/Retry-After/usage/价格单位/幂等能力。
- 一张真实小尺寸调用后确认扣费账单；不以 200-only 作为成功，必须能解码/校验结果图。

---

## 14. 测试、验收和安全

### 单元测试

- Processor：mask round trip、Alpha 保留、描边颜色/膨胀/边缘羽化、错误图像拒绝、最大尺寸。
- Cut engine：7 cut modes、Face index 边界、多人同框、matte empty fallback warning。
- Mask 编辑：erase/restore、undo/redo、source 不被更改、坐标缩放映射。
- Asset repository：local put/get/delete、object URL revoke、cloud import mapping、重复 sourceHash 行为。
- Batch queue：任务顺序、worker cap、失败隔离、取消在 item 边界、暂停只阻止新 worker、恢复不重做 done、重试只处理 failed、item settings snapshot。
- ZIP：successful-only、manifest 字段、同名文件去重、Alpha 保留、单项损坏不阻止其他项。
- Provider mock：payload mapping、auth not leaked、key absent emits unconfigured、network timeout、429、idempotency、usage/cost unknown。
- Stage adapter：一个/多个 sticker 作为独立 layer、排序稳定、maintain aspect、云上传失败不插入损坏引用、ProjectData schema。

### Playwright E2E

1. 单张 upload → analyze → mask preview → alpha PNG → checkerboard。
2. 改描边颜色/宽度时模型请求计数不增加。
3. 手工 erase/restore → undo → redo → 最终 PNG 确认。
4. 选中两个 FaceMesh 人物各自导出贴纸（如现有模型支持 sample）。
5. 20 张文件：真实 queue 总数/状态/并发 ≤ 配置/失败隔离/重试/刷新恢复。
6. ZIP 由 3 个成功 + 1 个失败构建；解压 manifest 和 PNG 可读、Alpha 有效。
7. 结果保存到唯一库 → 选择两张 → Stage Project 显示两独立 Konva layers。
8. AI 未配置时显示未配置和无调用；mock mode 测网络层；live image API 用单独人工确认的 staging smoke，不放真实 Key/图片到 CI。
9. Stage publish 后 `/p/:slug` 图片请求全为可访 public `/api/files/…` 且无 Console/CSP 错误。
10. 移动端工坊与 Batch 可用，不出现页面横溢；Cloud asset 上传可取消且保留本地 copy。

### 真实素材验收集

使用用户自有或可公开许可的 10 类样本：自拍、多脸照、长发、戴眼镜、手持手机、张手、动物、卡通、复杂背景、暗色背景。保存 sample checksum + 输出图质量评语，不把私人图片纳入仓库；对每个样本实际检查头发、手指、道具、边缘 halo、透明 Alpha 和裁切。

---

## 15. 免费/成本与隐私现实

- Studio 的本地分割免费不等于浏览器没有成本：模型下载、内存和 GPU/CPU 时间依然存在。
- Stage 当前 Cloudflare D1/R2 free tier 可以继续用作发布必要素材，但产品不能保证永远零成本；大批素材云同步、封面和公开下载会消耗 Cloudflare 免费额度。
- 私有素材：本地 IndexedDB 的私人 Source 不上传；用户点“加入可发布作品”时才上传明确选中的 Sticker PNG / thumbnail。最好上传输出贴纸，而不是默认把原始高分辨率人物图上传。
- 图片生成 API 费用由 Agent3/实际 Provider 套餐决定；目前用户口述 Key/model 不是价格与可用性证据。集成上线门槛是核对 usage/model endpoint 与一次小额实测；不写硬编码价格。
- 新版隐私文案必须区分：**“本地抠图无需上传”**与**“发布必须上传选用素材”**，以及**“AI 风格转换会把选中图片发给外部模型服务”**。每项都独立开关/提示。
- EXIF GPS、元数据可在本地导出时 strip；原始源默认保留在用户设备，导出 sticker 可删除 metadata。

---

## 16. 工程迁移路线（每阶段独立可验收）

### 阶段 0 — 兼容性/审计（1 个短迭代）

**输出：** frozen fixtures + module map，不移动 repo、不触 API。  
**工作：**确认两个 repo 当前提交/网页、模型许可证和总模型体积、Stage 数据格式、R2 asset lifetime，Studio Cutout/ImageContext/Batch behavior、API 网关资料。  
**通过：**本地 `meme-stage` build + tests、Studio typecheck/build/tests、两边功能矩阵/资产路径/模型来源在 ADR 确认。

### 阶段 1 — 统一壳与资产桥（不动分割算法）

**输出：** Stage 主 app 中可从 Create 打开 Sticker Studio，完成本地 sticker → Stage 独立图层。  
**迁移：**把 `src/types.ts` sticker DTO 子集置入 Stage `sticker` feature；将 Studio `lib/image/mask/outline/cutout` 拷入统一 feature，保留原函数 API 与原单测。  
**关键：**统一本地 asset repo adapter；Stage `asset.url` 云端引用和 Studio blob 不相混；实现明确“云上传并插层”的 action。  
**通过：**本地 cutout 真实运行、Store to local 与 Add to Project 走不同状态；刷新后本机贴纸可恢复；Stage save/public page 仍可加载贴纸。

### 阶段 2 — 单张工坊体验

**工作：**创建三栏 workbench；统一进度/预览/原图对比；Subject select；local mask修补；程序化描边；保存 variant history。  
**通过：**重新调描边不重跑分割、原图永远可还原、手标不同 Mask 不破坏 source、Alpha png 可解码验证。

### 阶段 3 — 真正可恢复的批量工坊

**工作：**把 BatchPage 队列提为 IndexedDB durable state；单图和 batch 同用 StickerProcessor；结果多选/单独重新处理/ZIP manifest/仅失败报告/选择导入舞台。  
**通过：**20-file e2e、page refresh rehydrate、1 failed 不影响其余项；压测 50 张不 preload 全张 decoded pixels；任务恢复状态真实。

### 阶段 4 — 联合素材库和角色构建

**工作：**Library 统一 local/cloud scope；Studio results import to one Cloudflare asset id 后由 Stage layer/character 共用；Stage 调 `Editor → send copy to Studio`。  
**通过：**一个 item 在 Studio local list 与 Stage project list 可追溯，删除 Project 不误删 referenced asset，云文件删除时可显示断开引用并修复/恢复。

### 阶段 5 — Provider 与可选 AI 变体

**前置：**确认 agent3 域的正式 API usage docs/Base URL/模型目录/额度/model id `gpt-image-2.5` 是否可用；轮换聊天中暴露的密钥，再进 Cloudflare secrets。  
**工作：**Provider server adapter、capabilities、后端异步任务表、预算/限流、Image upload/Edit 兼容层、staging low-cost test。  
**通过：**前端 Bundle/网络永远找不到 `sk-`；单张显式同意后成功生成候选，取消/429/timeouts/跨次重试不重复扣费；费用来自供应商真实 usage 或显示 Unknown。

### 阶段 6 — 多主体和质量增强

**工作：**FaceMesh 多脸选择现有优先；评估通用 SAM/其他 segmentation worker size/商业许可；成熟后加入 object selection，不能替换已好用的本地人像路线。  
**通过：**目标样本 10 类实际视觉评分；每类别分割精度未知时显示清楚限制，可在 Brush 修复，不拿 AI 重绘替代 Alpha matte。

### 阶段 7 — 发布/包/成本的终验收

**工作：**桌面 Chrome/mobile Safari/Android Chrome smoke、生产安全/许可/license manifests、README/数据保留/费用文案、热路径调优。  
**通过：**所有 P0 与用户提到的真实 Stage 场景都在真实部署运行；GitHub CI success、Cloudflare production smoke、独立阶段可 rollback。

---

## 17. 关键产品决策

1. **默认创作先做确定性本地贴纸**；AI 变体是次级动作，不把抠图结果交给 prompt 重新绘造。
2. **本地隐私默认**；只有将 Sticker 加入公开 Stage 项目才上传其 sticker Blob，不随手上传原图/Mask。
3. **唯一素材库，双作用域**：对用户统一一处 Library，内部 `local/cloud` 双 adapter；不要在 UI 伪装二者数据天然都可被他人访问。
4. **唯一画布是 Stage Canvas**：Studio 的画布是处理预览与 mask editor，不做编辑项目用的第三套 Konva stage。
5. **角色是贴纸的可选人格包装**：Sticker 可不绑定人声；用户可以选择“插为角色”后给它加 voice/line/mouth/performances。
6. **每批 50 张的标准定义**：50 张成功“独立贴纸”可能要求对多脸图片继续拆出更多结果；进度按 Source Task 数与输出 Sticker 数分别报告，不能混淆。
7. **成本估算不可靠时说 Unknown**：没有经验证 price / usage 就不显示美元估价或到秒承诺；只显示实际任务数量与模型响应阶段。
8. **密钥轮换先于 Provider 开通**：聊天内贴过的 key 视为已暴露；由用户去供应商撤销/旋转并把新值放在 server secrets，绝不复制进此文档或代码。

---

## 18. 交付验收 Checklist

### 能力融合

- [ ] 单图产出 alpha sticker，保持原图不改写。
- [ ] 多人图检测每张人脸并给可选择 UI；支持单个/分别输出/整组。
- [ ] mask 手刷和 undo/redo，保存可追溯版本。
- [ ] 描边参数可实时改，不重算人脸 matte。
- [ ] 从 sticker 结果 1-click 加进 Stage Project，独立 element，保持比例、透明度、asset references。
- [ ] Sticker 可选升级角色，并使用 Stage 原有 voice/script/preview/publish。
- [ ] 从 Stage selected layer 导入 Studio，不改写 Stage source element。
- [ ] 本地/云端资产不会重复建另一套 UI 数据；显示同步状态/上传状态/不可达源的恢复操作。

### Batch

- [ ] 20/50 Source item bulk queue 状态逐项真实。
- [ ] 进度按实际 task/event 更新；失败单项重试，刷新中断可恢复。
- [ ] 同一任务 settingsSnapshot 确定；全局参数改动只影响未提交的 item，批量“apply”才改已有参数。
- [ ] ZIP 内成功项全有有效 Alpha，文件不重名，manifest 正确；失败独立报告。
- [ ] 结果多选入 Stage，所有选项都是独立图层，画布布局不覆盖人物。

### AI

- [ ] `/usage` 实际 models/authorized model/路径与额度已验证；请求含 `gpt-image-2.5` 的真实小样调用成功。
- [ ] 服务端 holds secrets；静态 JS 与页面 devtools/network 中未见 API Key。
- [ ] 显式 UI 确认的每个 AI request 都有 requestId、幂等键、usage/unknown cost、错误状态。
- [ ] AI variant 不覆盖 original/local cutout。
- [ ] 人物一致性/透明 Alpha/局部编辑效果经样本人工验收，不能仅以 API 200 当成质量验收。

### 部署

- [ ] Stage existing D1/R2 free-tier accounting reviewed against forecast and retention policy.
- [ ] Model files served with correct GitHub Pages/Cloudflare base paths and license notices.
- [ ] Local IndexedDB storage limit / quota / private browsing gracefully handled.
- [ ] README 更新为混合隐私模型（本地抠图，选用上传才进云，AI 选用即发 Provider），成本和文件保留时间有依据。
- [ ] Stage public project loads all referenced assets, mobile canvas fits, no broken cloud URL.
- [ ] GitHub CI, browser e2e, production smoke, actual download/decode/PNG alpha check all pass.

---

## 19. 已知待决项（需做技术核验，不是反复找用户确认）

- `agent3.shyfai.cn/usage` 的正式可调用 API 入口和模型列表未从公开页面提取出来；当前只有 `shyfai.cn/#start` 文档概览。须由真实账户检查 usage/base URL/model directory。
- `gpt-image-2.5` 的确切支持名称、尺寸、n 和 edit mask capability 尚未被该文档概览证明；Provider 应在 `/models` 与一张低成本请求验证后才标 `available`。
- FaceMesh 可以稳定选“人脸”，但不代表支持商品、动物、所有卡通、无脸目标；generic object capability 需单独模型评估。
- 用户稿“单张短时间”和“50 张批量”是目标，不承诺数值 SLA；实际由本地 GPU/内存/浏览器决定，真实数据前不做耗时数字承诺。
- 当前 Studio `IndexedDB` 本地缓存若清理会移除本机唯一 Source；建议批处理导出/删源前明确确认并支持原图打包备份。
- Stage 侧公开 project share 是可访问的；默认贴纸 Cloud R2 对象来自已发布 project 素材。必须明确哪些图片对访客可见，不能把“可上传”误解为“私有云盘”。
