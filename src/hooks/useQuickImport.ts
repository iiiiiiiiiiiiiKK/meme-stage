/**
 * Drop / paste image import.
 *
 * Files land on the canvas immediately as placeholders, then upload in a small
 * concurrency pool. A failed upload is reported but never removes the rest of
 * the batch, so a 30-image drop is one gesture instead of one dialog.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "../store/editor";
import { useAssets, uploadImagePair } from "../store/assets";
import { prepareImage } from "../lib/image";
import { layoutElements } from "../lib/layout";
import { createCharacter, makeBubble } from "../lib/defaults";
import { parseFileName } from "../lib/importName";
import { runPool } from "../lib/uploadPool";
import { estimateSpeechSeconds } from "../lib/deviceSpeech";
import { api } from "../lib/api";
import type { CanvasElement, VoiceClip } from "../lib/types";

const ACCENTS = ["#b6ff3c", "#4d7cff", "#ff4d9d", "#ffd93d", "#9b5cff", "#ff8a3d", "#2fbf71"];
const MAX_IMAGES = 300;
const MAX_FILE_BYTES = 24 * 1024 * 1024;

export interface ImportProgress {
  total: number;
  done: number;
  failed: number;
  running: boolean;
}

export function useQuickImport() {
  const [progress, setProgress] = useState<ImportProgress>({ total: 0, done: 0, failed: 0, running: false });
  const busy = useRef(false);

  const importFiles = useCallback(async (incoming: File[]) => {
    const images = incoming.filter((file) => file.type.startsWith("image/") && file.size <= MAX_FILE_BYTES);
    const audios = incoming.filter((file) => file.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg)$/i.test(file.name));
    if (images.length === 0 && audios.length === 0) return;
    if (busy.current) return;
    busy.current = true;

    const project = useEditor.getState().project;
    const room = Math.max(0, MAX_IMAGES - project.elements.length);
    const accepted = images.slice(0, room);
    setProgress({ total: accepted.length + (audios.length > 0 ? 1 : 0), done: 0, failed: 0, running: true });

    // audio first: it attaches to characters that may already exist by name
    if (audios.length > 0) {
      await attachAudioFiles(audios);
    }

    if (accepted.length > 0) {
      const sizes = await Promise.all(
        accepted.map(async (file) => {
          try {
            const prepared = await prepareImage(file);
            return { file, prepared };
          } catch {
            return { file, error: "无法读取图片" as const };
          }
        }),
      );

      const usable = sizes.filter(
        (item): item is { file: File; prepared: Awaited<ReturnType<typeof prepareImage>> } =>
          "prepared" in item && !!item.prepared,
      );

      const rects = layoutElements(
        usable.map((item) => ({ width: item.prepared.width, height: item.prepared.height })),
        { width: project.width, height: project.height },
        { mode: usable.length > 6 ? "grid" : "scatter", baseHeight: Math.round(Math.min(project.height * 0.3, 340)), gap: 20, seed: Date.now() % 100000 },
      );

      let done = audios.length > 0 ? 1 : 0;
      let failed = sizes.length - usable.length;
      const created: CanvasElement[] = [];

      const tasks = usable.map((item, index) => ({
        label: item.file.name,
        run: async () => {
          const uploaded = await uploadImagePair(
            item.prepared.full,
            item.prepared.thumb,
            item.file.name,
            item.prepared.width,
            item.prepared.height,
          );
          const parsed = parseFileName(item.file.name);
          const rect = rects[index];
          const el = createCharacter({
            name: parsed.name,
            imageUrl: uploaded.url,
            thumbUrl: uploaded.thumbUrl,
            assetId: uploaded.assetId,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          });
          if (el.character) {
            el.character.bubble = { ...makeBubble("comic"), bg: ACCENTS[index % ACCENTS.length] };
            if (parsed.line) el.character.line = parsed.line;
          }
          URL.revokeObjectURL(item.prepared.fullUrl);
          URL.revokeObjectURL(item.prepared.thumbUrl);
          return el;
        },
      }));

      const result = await runPool(tasks, {
        concurrency: 3,
        onProgress: (count) => setProgress((prev) => ({ ...prev, done: done + count })),
      });
      created.push(...result.ok);
      failed += result.failed.length;
      done += result.ok.length;

      if (created.length > 0) {
        useEditor.getState().addElements(created);
        const state = useEditor.getState();
        if (state.project.title === "未命名作品" || !state.project.title.trim()) {
          const first = created[0].character?.name?.trim();
          state.mutate((draft) => {
            draft.title = first ? `${first} 等 ${created.length} 人` : `${created.length} 个人开始说话`;
          }, false);
        }
      }
      setProgress({ total: done + failed, done, failed, running: false });
    } else {
      setProgress((prev) => ({ ...prev, running: false }));
    }

    busy.current = false;
  }, []);

  return { importFiles, progress };
}

/** attach audio files to characters by filename basename (name or name-01) */
async function attachAudioFiles(files: File[]) {
  const project = useEditor.getState().project;
  const characters = project.elements.filter((el) => el.type === "character");
  const updates = new Map<string, VoiceClip[]>();

  const tasks = files.map((file) => ({
    label: file.name,
    run: async () => {
      const parsed = parseFileName(file.name);
      const target = characters.find(
        (el) => (el.character?.name ?? "").toLowerCase() === parsed.name.toLowerCase(),
      );
      if (!target) throw new Error(`没有同名人物：${parsed.name}`);
      const duration = await estimateDuration(file);
      const asset = await api.uploadAsset(file, { kind: "audio", name: file.name, duration });
      const clip: VoiceClip = {
        id: asset.id,
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 40),
        url: asset.url,
        duration: asset.duration ?? duration,
        volume: 1,
        ...(parsed.line ? { line: parsed.line } : {}),
      };
      const list = updates.get(target.id) ?? [];
      list.push(clip);
      updates.set(target.id, list);
      return target.id;
    },
  }));

  const result = await runPool(tasks, { concurrency: 3 });
  if (updates.size === 0) return;

  useEditor.getState().mutate((draft) => {
    for (const el of draft.elements) {
      const clips = updates.get(el.id);
      if (!clips || !el.character) continue;
      const room = Math.max(0, 20 - el.character.voices.length);
      el.character.voices = [...el.character.voices, ...clips.slice(0, room)];
    }
  });

  // results are also useful for the toast text
  void result;
  return result;
}

function estimateDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (value: number) => {
      audio.src = "";
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) ? audio.duration : estimateSpeechSeconds(file.name));
    audio.onerror = () => finish(0);
    setTimeout(() => finish(0), 4000);
    audio.src = url;
  });
}

/** wires drag-drop + clipboard paste onto an element */
export function useDropTarget(
  targetRef: React.RefObject<HTMLElement | null>,
  onFiles: (files: File[]) => void,
  enabled = true,
) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !enabled) return;
    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      onFiles(Array.from(event.dataTransfer.files));
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    };

    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [targetRef, onFiles, enabled]);

  return dragging;
}

/** small helper used by the editor shell to keep the asset store in sync */
export function rememberAsset(asset: Parameters<ReturnType<typeof useAssets.getState>["add"]>[0]) {
  useAssets.getState().add(asset);
}
