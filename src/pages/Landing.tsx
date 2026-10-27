import { useEffect } from "react";
import { Link } from "react-router-dom";
import { VisitorStage } from "../components/canvas/VisitorStage";
import { DEMO_PROJECT } from "../lib/demo";
import { Button } from "../components/ui";
import { Icon } from "../components/Icon";

const X_URL = "https://x.com/0xkillcoin";
const REPO_URL = "https://github.com/iiiiiiiiiiiiiKK/meme-stage";

export function LandingPage() {
  useEffect(() => {
    document.title = "MEME STAGE — 把二十个人塞进一张画布";
  }, []);

  return (
    <div className="min-h-full bg-ink text-paper">
      <TopNav />
      <Hero />
      <Ticker />
      <HowItWorks />
      <FeatureWall />
      <ExampleSection />
      <ClosingCta />
      <Footer />
    </div>
  );
}

function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center border-2 border-ink bg-neon font-display text-[15px] text-ink hard-shadow-sm">
            M
          </span>
          <span className="font-display text-[16px] tracking-tight">
            MEME<span className="text-neon">STAGE</span>
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-4 text-[12px] text-mute sm:flex">
          <a href="#how" className="hover:text-paper">怎么玩</a>
          <a href="#features" className="hover:text-paper">能力</a>
          <Link to="/p/demo" className="hover:text-paper">示例作品</Link>
          <Link to="/library" className="hover:text-paper">我的作品</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="grid h-8 w-8 place-items-center rounded-md border border-line text-[15px] font-bold transition-colors hover:border-paper/40 hover:bg-white/5"
            aria-label="作者 X 主页"
            title="@0xkillcoin"
          >
            𝕏
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hidden h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] text-mute transition-colors hover:border-paper/40 hover:text-paper sm:flex"
            title="GitHub 开源仓库"
          >
            <Icon name="github" size={13} />
            GitHub
          </a>
          <Link to="/editor">
            <Button variant="primary" size="sm" icon="bolt">
              开始创作
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-24 top-16 h-64 w-64 rounded-full bg-electric/20 blur-[90px]" />
      <div className="pointer-events-none absolute -right-24 top-40 h-72 w-72 rounded-full bg-hot/20 blur-[100px]" />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-10 pt-8 lg:grid-cols-[1.02fr_1.22fr] lg:items-center lg:gap-6 lg:pb-14 lg:pt-12">
        <div className="relative">
          <div className="mb-4 inline-flex rotate-[-2deg] items-center gap-2 border border-neon/50 bg-neon/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-neon">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neon" />
            互动式 Meme 画布 · 免注册
          </div>
          <h1 className="font-display text-[42px] leading-[0.92] tracking-[-0.04em] sm:text-[62px] lg:text-[72px]">
            把二十个人
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">塞进一张画布</span>
              <span className="absolute inset-x-0 bottom-1 z-0 h-4 -rotate-1 bg-neon sm:h-6" />
            </span>
            <br />
            然后让他们开口
          </h1>
          <p className="mt-5 max-w-[440px] text-[13.5px] leading-relaxed text-mute sm:text-[15px]">
            一次导入一堆人物，给每个人单独配一条声音。点谁，谁说话；谁接梗，谁破防，全由你安排。
            做完发个链接，别人点开就能玩——不用注册，不用装 App。
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Link to="/editor">
              <Button variant="primary" size="lg" icon="bolt">
                开始创作
              </Button>
            </Link>
            <Link to="/p/demo">
              <Button variant="secondary" size="lg" icon="play">
                先玩示例
              </Button>
            </Link>
            <span className="hidden items-center gap-1.5 text-[11px] text-mute sm:flex">
              <Icon name="check" size={13} className="text-neon" /> 免费 · 手机可玩
            </span>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-mute">
            <span className="flex items-center gap-1.5"><Icon name="users" size={13} /> 50 个人物也不卡</span>
            <span className="flex items-center gap-1.5"><Icon name="music" size={13} /> 每人一条独立语音</span>
            <span className="flex items-center gap-1.5"><Icon name="workflow" size={13} /> 点击触发连续互动</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -top-3 left-4 z-20 rotate-[-4deg] border-2 border-ink bg-hot px-2.5 py-1 font-display text-[11px] text-ink hard-shadow-sm">
            点人物 · 有声音
          </div>
          <div className="absolute -bottom-3 right-6 z-20 rotate-[3deg] border-2 border-ink bg-neon px-2.5 py-1 font-display text-[11px] text-ink hard-shadow-sm">
            LIVE DEMO
          </div>
          <div className="relative overflow-hidden rounded-xl border-2 border-line bg-ink-2 p-1.5 shadow-[0_0_0_1px_#262633,12px_12px_0_#000]">
            <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
              <span className="h-2 w-2 rounded-full bg-hot" />
              <span className="h-2 w-2 rounded-full bg-warn" />
              <span className="h-2 w-2 rounded-full bg-neon" />
              <span className="ml-2 truncate text-[10px] text-mute">全员开麦：这波到底亏不亏</span>
              <span className="ml-auto flex items-center gap-1 text-[9px] text-neon">
                <Icon name="volume" size={10} /> 官方示例
              </span>
            </div>
            <div className="scanlines relative h-[340px] overflow-hidden rounded-lg border border-line bg-ink sm:h-[420px] lg:h-[470px]">
              <VisitorStage project={DEMO_PROJECT} compact allowViewport={false} />
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-mute">
            声音是真实合成的示例语音 · 素材全部原创，可放心商用演示
          </p>
        </div>
      </div>
    </section>
  );
}

function Ticker() {
  const items = [
    "20 个人物一次导入",
    "每人独立配音",
    "点击就演",
    "链接即玩",
    "可 Remix",
    "导出 PNG",
    "手机全屏",
    "OG 分享卡",
  ];
  return (
    <div className="overflow-hidden border-y border-line bg-neon py-2 text-ink">
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {items.map((item, index) => (
              <span key={`${copy}-${index}`} className="flex items-center gap-3 whitespace-nowrap px-3 font-display text-[13px] uppercase tracking-tight">
                {item}
                <span className="text-[10px]">✦</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      no: "01",
      title: "一次丢进二十张图",
      body: "多选、拖拽都行。系统会压缩图片、自动排开，绝不会全部叠在同一个坐标上。",
      accent: "bg-neon",
      rotate: "-rotate-1",
    },
    {
      no: "02",
      title: "给每个人配声音",
      body: "上传 MP3 / WAV / M4A，或者先用内置的六个熟人试手。台词、气泡样式、描边都能单独调。",
      accent: "bg-electric",
      rotate: "rotate-1",
    },
    {
      no: "03",
      title: "安排谁先开口",
      body: "点 A 说一句，自动接 B 的反驳，C 最后一个破防。发布后把链接丢进 X 或微信群。",
      accent: "bg-hot",
      rotate: "-rotate-[0.5deg]",
    },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
      <SectionHeading eyebrow="怎么玩" title="三步，做一张会说话的梗图" />
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {steps.map((step) => (
          <div
            key={step.no}
            className={`group relative overflow-hidden border border-line bg-ink-2 p-5 transition-transform hover:-translate-y-1 ${step.rotate}`}
          >
            <div className={`absolute -right-2 -top-3 font-display text-[64px] leading-none text-white/5`}>{step.no}</div>
            <div className={`mb-4 inline-block border-2 border-ink px-2 py-0.5 font-display text-[12px] text-ink ${step.accent}`}>
              STEP {step.no}
            </div>
            <h3 className="font-display text-[19px] leading-tight">{step.title}</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-mute">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureWall() {
  const features = [
    { icon: "move" as const, title: "真的无限画布", body: "平移、缩放、框选、多选、吸附、参考线、图层、撤销重做。该有的都有，键盘快捷键也齐。", span: "sm:col-span-2", color: "text-neon" },
    { icon: "users" as const, title: "批量导入不堆叠", body: "六种自动布局：散落、网格、聚集、随机、防重叠、自定义。导入后每个仍然独立可动。", span: "", color: "text-electric" },
    { icon: "music" as const, title: "每人一条声音", body: "上传、试听、替换、调音量。单音频模式自动打断上一个，也可以选择全员混音。", span: "", color: "text-hot" },
    { icon: "workflow" as const, title: "可视化互动编排", body: "触发 → 动作 → 下一步。气泡、语音、动画、显示隐藏、跳转事件，不用写一行代码。", span: "sm:col-span-2", color: "text-warn" },
    { icon: "share" as const, title: "链接即作品", body: "访客页没有工具栏，只有画布和声音。自动生成 1200×630 分享封面，X 和微信都有预览。", span: "", color: "text-neon" },
    { icon: "download" as const, title: "PNG 与项目导出", body: "静态图导出和互动作品发布是两件事。也能导出 JSON，把作品带走继续改。", span: "", color: "text-electric" },
  ];
  return (
    <section id="features" className="border-y border-line bg-ink-2/40">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <SectionHeading eyebrow="能力清单" title="不是又一个在线白板" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`relative overflow-hidden rounded-lg border border-line bg-ink p-4 transition-colors hover:border-paper/25 ${feature.span}`}
            >
              <div className={`mb-3 inline-grid h-9 w-9 place-items-center rounded-md border border-line bg-ink-3 ${feature.color}`}>
                <Icon name={feature.icon} size={17} />
              </div>
              <h3 className="font-display text-[16px]">{feature.title}</h3>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">{feature.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[10.5px] text-mute">
          已知限制：暂不提供 AI 自动抠图，建议上传透明背景 PNG；社交平台的链接预览是静态图，互动需要点进链接。
        </p>
      </div>
    </section>
  );
}

function ExampleSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
      <SectionHeading eyebrow="官方示例" title="先听听这六个人怎么说" />
      <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Link
          to="/p/demo"
          className="group relative block overflow-hidden rounded-xl border-2 border-line bg-ink-2 shadow-[10px_10px_0_#000] transition-transform hover:-translate-y-0.5"
        >
          <img
            src="/demo/cover.png"
            alt="示例作品：全员开麦"
            className="aspect-[1200/630] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-ink via-ink/85 to-transparent p-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-neon">点击人物 · 立刻开演</div>
              <div className="font-display text-lg">全员开麦：这波到底亏不亏</div>
              <div className="text-[10px] text-mute">老K / 阿呆 / 钱包君 / 键盘侠 / 老板 / 猫猫头</div>
            </div>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neon text-ink">
              <Icon name="play" size={15} />
            </span>
          </div>
        </Link>

        <div className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-ink p-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-mute">它演示了什么</div>
            <ul className="mt-2 space-y-2 text-[12px] leading-relaxed">
              {[
                "六个人物、六段独立语音",
                "点老K 会自动接阿呆、再接钱包君",
                "每个人物有自己的气泡颜色和描边",
                "声音是真实的合成语音，不是占位符",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Icon name="check" size={13} className="mt-0.5 shrink-0 text-neon" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-dashed border-line bg-ink-2 p-3 text-[11px] leading-relaxed text-mute">
            这是一条真实发布的链接：<span className="font-mono text-paper">/p/demo</span>。你也可以用同一套人物开始自己的版本。
          </div>
          <div className="flex gap-2">
            <Link to="/p/demo" className="flex-1">
              <Button size="sm" variant="primary" icon="play" className="w-full">打开示例</Button>
            </Link>
            <Link to="/editor" className="flex-1">
              <Button size="sm" variant="secondary" icon="plus" className="w-full">我也做一个</Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="relative overflow-hidden border-y border-line bg-neon text-ink">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(#07070a 1.5px, transparent 1.5px)", backgroundSize: "16px 16px" }} />
      <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:py-16">
        <div>
          <div className="font-display text-[30px] leading-[0.95] tracking-tight sm:text-[42px]">
            你手机里那二十张表情包
            <br />
            该出来上班了
          </div>
          <p className="mt-2 max-w-md text-[12.5px] font-medium text-ink/70">
            免费。不用注册。做完直接分享，朋友点开就能听到你的声音。
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <Link to="/editor">
            <Button size="lg" className="w-full border-2 border-ink bg-ink px-8 text-paper hard-shadow-sm hover:bg-ink-3">
              开始创作 →
            </Button>
          </Link>
          <a href={X_URL} target="_blank" rel="noreferrer noopener" className="text-center text-[11px] font-semibold text-ink/60 hover:text-ink">
            关注作者 @0xkillcoin
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center border-2 border-ink bg-neon font-display text-[13px] text-ink">
              M
            </span>
            <span className="font-display text-[14px]">
              MEME<span className="text-neon">STAGE</span>
            </span>
          </div>
          <p className="mt-2 max-w-xs text-[10.5px] leading-relaxed text-mute">
            一个把人物、声音和互动塞进同一张画布的创作工具。示例人物与语音均为项目原创素材。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[11px] text-mute sm:grid-cols-3">
          <Link to="/editor" className="hover:text-paper">开始创作</Link>
          <Link to="/library" className="hover:text-paper">我的作品</Link>
          <Link to="/p/demo" className="hover:text-paper">示例作品</Link>
          <a href={X_URL} target="_blank" rel="noreferrer noopener" className="hover:text-paper">作者 X</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="hover:text-paper">GitHub</a>
          <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer noopener" className="hover:text-paper">文档</a>
        </div>
      </div>
      <div className="mt-8 flex flex-col gap-1 border-t border-line pt-4 text-[10px] text-mute sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} MEME STAGE · MIT License</span>
        <span>用鼠标和键盘创作，用手机分享和玩耍。</span>
      </div>
    </footer>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-neon">{eyebrow}</div>
      <h2 className="mt-1.5 font-display text-[26px] leading-tight tracking-tight sm:text-[34px]">{title}</h2>
    </div>
  );
}
