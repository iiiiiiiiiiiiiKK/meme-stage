-- MEME STAGE · Cloudflare D1 schema (free tier friendly)
-- One row per project document, one row per uploaded asset.
-- The project document itself is versioned JSON validated by src/lib/schema.ts.

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  slug         TEXT,
  owner_hash   TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  data         TEXT NOT NULL,
  cover_url    TEXT,
  visibility   TEXT NOT NULL DEFAULT 'private',
  published    INTEGER NOT NULL DEFAULT 0,
  rev          INTEGER NOT NULL DEFAULT 1,
  views        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_hash, updated_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  owner_hash   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  object_key   TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  width        INTEGER,
  height       INTEGER,
  duration     REAL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_object ON assets(object_key);
