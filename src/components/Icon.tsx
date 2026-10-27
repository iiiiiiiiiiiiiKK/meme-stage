import type { SVGProps } from "react";

type IconName =
  | "plus"
  | "minus"
  | "close"
  | "check"
  | "chevron-down"
  | "chevron-up"
  | "chevron-left"
  | "chevron-right"
  | "upload"
  | "download"
  | "image"
  | "music"
  | "text"
  | "sparkles"
  | "play"
  | "pause"
  | "volume"
  | "mute"
  | "undo"
  | "redo"
  | "eye"
  | "eye-off"
  | "lock"
  | "unlock"
  | "trash"
  | "copy"
  | "layers"
  | "grid"
  | "magnet"
  | "search"
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "target"
  | "sliders"
  | "move"
  | "link"
  | "share"
  | "external"
  | "alert"
  | "info"
  | "grip"
  | "wand"
  | "flip"
  | "users"
  | "workflow"
  | "bolt"
  | "download-cloud"
  | "rotate"
  | "github";

const paths: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M20 6L9 17l-5-5" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-up": <path d="M18 15l-6-6-6 6" />,
  "chevron-left": <path d="M15 18l-6-6 6-6" />,
  "chevron-right": <path d="M9 18l6-6-6-6" />,
  upload: <path d="M12 16V4m0 0L7 9m5-5l5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />,
  download: <path d="M12 4v12m0 0l5-5m-5 5l-5-5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  text: <path d="M4 6h16M4 12h12M4 18h8" />,
  sparkles: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />,
  play: <path d="M8 5l12 7-12 7V5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  volume: <path d="M4 9v6h4l5 5V4L8 9H4zM17 9a4 4 0 010 6M20 6a8 8 0 010 12" />,
  mute: <path d="M4 9v6h4l5 5V4L8 9H4zM17 9l4 6M21 9l-4 6" />,
  undo: <path d="M9 14L4 9l5-5M4 9h9a7 7 0 017 7v4" />,
  redo: <path d="M15 14l5-5-5-5M20 9h-9a7 7 0 00-7 7v4" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": <path d="M3 3l18 18M10.6 6.2A10.8 10.8 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3 3.7M6.2 6.9A17 17 0 002 12s3.5 7 10 7a10 10 0 004.1-.9M9.9 9.9a3 3 0 004.2 4.2" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 017.5-2" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" />
    </>
  ),
  layers: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  magnet: <path d="M6 4v8a6 6 0 0012 0V4M6 4h4v8a2 2 0 004 0V4h4M6 9h4M14 9h4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  "zoom-in": (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6M8 11h6M20 20l-3.5-3.5" />
    </>
  ),
  "zoom-out": (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M8 11h6M20 20l-3.5-3.5" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  sliders: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />,
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  link: <path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" />,
  share: <path d="M12 16V4m0 0L7 9m5-5l5 5M5 15v4a2 2 0 002 2h10a2 2 0 002-2v-4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h5" />,
  alert: <path d="M12 3l9 17H3L12 3zM12 9v5M12 17v.01" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 8v.01" />
    </>
  ),
  grip: <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" />,
  wand: <path d="M3 21l9-9M14 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM19 13l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />,
  flip: <path d="M12 3v18M8 7L3 12l5 5V7zM16 7l5 5-5 5V7z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-2a5 5 0 015-5h4a5 5 0 015 5v2M17 4a4 4 0 010 8M22 21v-2a5 5 0 00-3-4.6" />
    </>
  ),
  workflow: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
      <path d="M9 6h6a3 3 0 013 3v6" />
    </>
  ),
  bolt: <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />,
  "download-cloud": <path d="M7 18a5 5 0 01-.6-10A7 7 0 0120 10a4 4 0 01-1 8M12 12v9m0 0l-4-4m4 4l4-4" />,
  rotate: <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />,
  github: <path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />,
};

export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export type { IconName };
