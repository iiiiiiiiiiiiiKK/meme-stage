import type { AssetRecord, ProjectData, ServerProject } from "./types";
import { getEditorKey } from "./ids";
import { normalizeProject } from "./schema";

export class ApiRequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { "X-Editor-Key": getEditorKey() };
  if (json) h["content-type"] = "application/json";
  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...headers(!(init.body instanceof FormData)), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const payload = (data ?? {}) as { error?: string; message?: string };
    throw new ApiRequestError(
      res.status,
      payload.error ?? "request_failed",
      payload.message ?? `请求失败（${res.status}）`,
    );
  }
  return data as T;
}

export interface ProjectSummary {
  id: string;
  slug: string | null;
  title: string;
  description: string;
  coverUrl: string | null;
  visibility: "private" | "public";
  published: boolean;
  rev: number;
  views: number;
  updatedAt: number;
}

export const api = {
  async createProject(data: ProjectData): Promise<{ id: string; rev: number; updatedAt: number }> {
    return request("/api/projects", { method: "POST", body: JSON.stringify({ data }) });
  },

  async saveProject(
    id: string,
    data: ProjectData,
    rev: number,
    force = false,
  ): Promise<{ rev: number; updatedAt: number }> {
    return request(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ data, rev, force }),
    });
  },

  async getProject(id: string): Promise<ServerProject> {
    const res = await request<ServerProject>(`/api/projects/${encodeURIComponent(id)}`);
    return { ...res, data: normalizeProject(res.data) };
  },

  async deleteProject(id: string): Promise<{ ok: true }> {
    return request(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async listProjects(): Promise<ProjectSummary[]> {
    const data = await request<{ projects: ProjectSummary[] }>("/api/projects");
    return data.projects;
  },

  async publish(
    id: string,
    payload: { data: ProjectData; coverDataUrl?: string },
  ): Promise<{ slug: string; url: string; rev: number; coverUrl: string | null }> {
    return request(`/api/projects/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async unpublish(id: string): Promise<{ ok: true }> {
    return request(`/api/projects/${encodeURIComponent(id)}/publish`, { method: "DELETE" });
  },

  async uploadAsset(
    file: Blob,
    meta: { kind: "image" | "audio" | "cover"; name: string; width?: number; height?: number; duration?: number },
  ): Promise<AssetRecord> {
    const form = new FormData();
    form.append("file", file, meta.name);
    form.append("kind", meta.kind);
    if (meta.width) form.append("width", String(Math.round(meta.width)));
    if (meta.height) form.append("height", String(Math.round(meta.height)));
    if (meta.duration) form.append("duration", String(meta.duration));
    const data = await request<{ asset: AssetRecord }>("/api/assets", { method: "POST", body: form });
    return data.asset;
  },

  async getPublic(slug: string): Promise<{ project: ServerProject }> {
    const res = await request<{ project: ServerProject }>(`/api/public/${encodeURIComponent(slug)}`);
    return { project: { ...res.project, data: normalizeProject(res.project.data) } };
  },

  /** fire-and-forget view counter */
  view(slug: string): void {
    void fetch(`/api/public/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      keepalive: true,
    }).catch(() => undefined);
  },
};

export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}
