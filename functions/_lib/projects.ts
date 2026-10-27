/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./http";
import { escapeHtml } from "./http";

export interface ProjectRow {
  id: string;
  slug: string | null;
  owner_hash: string;
  title: string;
  description: string;
  data: string;
  cover_url: string | null;
  visibility: "private" | "public";
  published: number;
  rev: number;
  views: number;
  created_at: number;
  updated_at: number;
}

export interface AssetRow {
  id: string;
  owner_hash: string;
  kind: "image" | "audio" | "cover";
  object_key: string;
  mime: string;
  size: number;
  name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  created_at: number;
}

export function publicProject(row: ProjectRow) {
  let data: unknown = null;
  try {
    data = JSON.parse(row.data);
  } catch {
    data = null;
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    data,
    coverUrl: row.cover_url,
    visibility: row.visibility,
    published: row.published === 1,
    rev: row.rev,
    views: row.views,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function summary(row: ProjectRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    visibility: row.visibility,
    published: row.published === 1,
    rev: row.rev,
    views: row.views,
    updatedAt: row.updated_at,
  };
}

export function assetRecord(row: AssetRow) {
  return {
    id: row.id,
    kind: row.kind,
    url: `/api/files/${row.id}`,
    mime: row.mime,
    size: row.size,
    name: row.name,
    width: row.width,
    height: row.height,
    duration: row.duration,
  };
}

export async function findProjectById(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>();
}

export async function findPublicBySlug(env: Env, slug: string): Promise<ProjectRow | null> {
  return env.DB.prepare("SELECT * FROM projects WHERE slug = ? AND published = 1 AND visibility = 'public'")
    .bind(slug)
    .first<ProjectRow>();
}

export async function slugTaken(env: Env, slug: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM projects WHERE slug = ?").bind(slug).first<{ id: string }>();
  return !!row;
}

export function metaTags(input: {
  title: string;
  description: string;
  image: string | null;
  url: string;
  index: boolean;
}): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description || "点击人物，听他们开口。");
  const image = input.image ? escapeHtml(input.image) : "";
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="MEME STAGE" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeHtml(input.url)}" />`,
    image ? `<meta property="og:image" content="${image}" />` : "",
    image ? `<meta property="og:image:width" content="1200" />` : "",
    image ? `<meta property="og:image:height" content="630" />` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    image ? `<meta name="twitter:image" content="${image}" />` : "",
    input.index ? "" : `<meta name="robots" content="noindex" />`,
  ];
  return tags.filter(Boolean).join("\n    ");
}
