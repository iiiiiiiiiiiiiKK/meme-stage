import { useEffect, useRef, useState } from "react";
import { Button, Modal, Spinner, TextArea, toast } from "../ui";
import { Icon } from "../Icon";
import { audioBufferToWav, waveformPeaks } from "../../lib/wav";

const MAX_SECONDS = 30;

type Phase = "idle" | "recording" | "decoding" | "ready" | "saving";

export function RecordDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (payload: { blob: Blob; duration: number; line: string }) => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const previewRef = useRef<AudioBufferSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const duration = buffer?.duration ?? 0;

  const cleanupStream = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  };

  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        // ignore
      }
      cleanupStream();
      previewRef.current?.stop();
      void contextRef.current?.close().catch(() => undefined);
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持录音，请改用上传音频或文字生成语音");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void decodeRecording(recorder.mimeType || "audio/webm");
      };
      recorder.start(200);
      setSeconds(0);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        setSeconds((value) => {
          const next = value + 0.1;
          if (next >= MAX_SECONDS) {
            stopRecording();
            return MAX_SECONDS;
          }
          return next;
        });
      }, 100);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      setError(
        name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试"
          : name === "NotFoundError"
            ? "没有找到麦克风设备"
            : "无法打开麦克风，请检查系统和浏览器权限",
      );
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
    setPhase("decoding");
  };

  const decodeRecording = async (mime: string) => {
    try {
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size === 0) throw new Error("没有录到声音");
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtx();
      contextRef.current = context;
      const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      setBuffer(decoded);
      setStart(0);
      setEnd(Math.min(decoded.duration, MAX_SECONDS));
      setError(
        decoded.duration > MAX_SECONDS
          ? `录音超过 ${MAX_SECONDS} 秒，只会保留前 ${MAX_SECONDS} 秒，可以继续裁剪`
          : null,
      );
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "录音解析失败");
      setPhase("idle");
    } finally {
      cleanupStream();
    }
  };

  const preview = async () => {
    if (!buffer) return;
    try {
      previewRef.current?.stop();
      let context = contextRef.current;
      if (!context || context.state === "closed") {
        context = new AudioContext();
        contextRef.current = context;
      }
      await context.resume();
      if (context.state !== "running") {
        setError("浏览器没有允许播放音频，请再点一次「试听选区」");
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0, start, Math.max(0.05, end - start));
      previewRef.current = source;
      setPreviewing(true);
      source.onended = () => {
        if (previewRef.current === source) previewRef.current = null;
        setPreviewing(false);
      };
    } catch {
      setPreviewing(false);
      setError("试听失败：请检查系统音量，或再点一次");
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const peaks = waveformPeaks(buffer, 220);
    const barWidth = width / peaks.length;
    const startRatio = duration > 0 ? start / duration : 0;
    const endRatio = duration > 0 ? end / duration : 1;
    peaks.forEach((peak, index) => {
      const ratio = index / peaks.length;
      const selected = ratio >= startRatio && ratio <= endRatio;
      context.fillStyle = selected ? "#b6ff3c" : "#3a3a4c";
      const barHeight = Math.max(2, peak * (height - 8));
      context.fillRect(index * barWidth, (height - barHeight) / 2, Math.max(1, barWidth - 1), barHeight);
    });
  }, [buffer, start, end, duration]);

  const save = async () => {
    if (!buffer || end - start < 0.1) {
      toast("选区太短了，至少保留 0.1 秒", "info");
      return;
    }
    setPhase("saving");
    try {
      const wav = audioBufferToWav(buffer, start, end);
      await onSave({ blob: wav.blob, duration: wav.duration, line: line.trim() });
      onClose();
    } catch (err) {
      setPhase("ready");
      setError(
        err instanceof Error
          ? `保存失败：${err.message}`
          : "保存失败，请检查网络后重试（录音仍保留在这个窗口里）",
      );
      toast(err instanceof Error ? err.message : "保存录音失败", "error");
    }
  };

  const download = () => {
    if (!buffer) return;
    try {
      const wav = audioBufferToWav(buffer, start, end);
      const url = URL.createObjectURL(wav.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `meme-stage-recording-${Date.now()}.wav`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      toast("下载失败，请重试", "error");
    }
  };

  return (
    <Modal
      title="录音"
      subtitle="用麦克风录一句台词，录完可以拖动起止点裁剪，再保存给当前人物"
      onClose={phase === "recording" ? () => undefined : onClose}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[10px] text-mute">
            {phase === "recording"
              ? `录音中 ${seconds.toFixed(1)}s / ${MAX_SECONDS}s`
              : buffer
                ? `选区 ${(end - start).toFixed(2)}s · 原始 ${duration.toFixed(2)}s`
                : "麦克风录音只保存在你的浏览器里，保存后才会写入素材库"}
          </div>
          <div className="ml-auto flex gap-1.5">
            {phase === "ready" ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setBuffer(null); setPhase("idle"); }}>
                  重录
                </Button>
                <Button size="sm" variant="secondary" icon="play" onClick={() => void preview()}>
                  {previewing ? "试听中…" : "试听选区"}
                </Button>
                <Button size="sm" variant="ghost" icon="download" onClick={download}>
                  下载 WAV
                </Button>
                <Button size="sm" variant="primary" icon="check" onClick={() => void save()}>
                  保存到人物
                </Button>
              </>
            ) : null}
            {phase === "saving" ? (
              <Button size="sm" variant="primary" disabled>
                <Spinner size={13} /> 保存中…
              </Button>
            ) : null}
            {phase === "idle" ? (
              <Button size="sm" variant="ghost" onClick={onClose}>
                关闭
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-hot/40 bg-hot/10 px-3 py-2 text-[11px] text-paper">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-hot" />
          <span>{error}</span>
        </div>
      ) : null}

      {phase === "idle" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-ink/60 px-4 py-12 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full border border-neon/40 bg-neon/10 text-neon">
            <Icon name="music" size={24} />
          </span>
          <div className="font-display text-lg">按下开始，直接说话</div>
          <p className="max-w-sm text-[11px] leading-relaxed text-mute">
            最长 30 秒。录完可以拖动波形上的两个滑块裁剪前后空白，再试听选区，满意后保存。麦克风权限只在录音时请求。
          </p>
          <Button variant="primary" icon="play" onClick={() => void startRecording()}>
            开始录音
          </Button>
        </div>
      ) : null}

      {phase === "recording" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-hot/40 bg-hot/5 px-4 py-12">
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-hot/20">
            <span className="absolute h-16 w-16 animate-ping rounded-full bg-hot/30" />
            <span className="relative h-8 w-8 rounded-full bg-hot" />
          </span>
          <div className="font-display text-2xl tabular-nums">{seconds.toFixed(1)}s</div>
          <div className="text-[11px] text-mute">正在录音… 说完点停止</div>
          <Button variant="danger" icon="pause" onClick={stopRecording}>
            停止录音
          </Button>
        </div>
      ) : null}

      {phase === "decoding" ? (
        <div className="flex flex-col items-center gap-3 py-14 text-mute">
          <Spinner size={22} className="text-neon" />
          <div className="text-[11px]">正在处理录音…</div>
        </div>
      ) : null}

      {phase === "ready" && buffer ? (
        <div className="space-y-3">
          <canvas
            ref={canvasRef}
            width={900}
            height={120}
            className="h-[110px] w-full rounded-lg border border-line bg-ink"
          />
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-[10px] text-mute">
                <span>开始点</span>
                <span className="tabular-nums text-paper">{start.toFixed(2)}s</span>
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, duration)}
                step={0.01}
                value={start}
                onChange={(e) => setStart(Math.min(Number(e.target.value), end - 0.1))}
                className="w-full accent-[#b6ff3c]"
                aria-label="录音开始点"
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-[10px] text-mute">
                <span>结束点</span>
                <span className="tabular-nums text-paper">{end.toFixed(2)}s</span>
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, duration)}
                step={0.01}
                value={end}
                onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 0.1))}
                className="w-full accent-[#b6ff3c]"
                aria-label="录音结束点"
              />
            </label>
          </div>
          <TextArea
            value={line}
            maxLength={280}
            onChange={(e) => setLine(e.target.value)}
            placeholder="这段录音的台词（可选，会显示在气泡里）"
            className="min-h-[60px] text-[12px]"
            aria-label="录音台词"
          />
          <p className="rounded-md border border-line bg-ink px-2 py-1.5 text-[10px] leading-relaxed text-mute">
            保存时会裁成 16-bit WAV 并上传到素材库，之后和导入的音频完全一样：可轮换、可发布、所有访客听到同一段。
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
