-- TasteDraft schema for the Worker (Durable Object SQLite; also valid for D1).
-- Mirrors the CREATE TABLE IF NOT EXISTS blocks in persistence/sqlite-repository.ts,
-- runner/store.ts and ops/qloo-budget.ts. New changes go in a new numbered file.

-- src/persistence/sqlite-repository.ts
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concept_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  parent_id TEXT REFERENCES concept_versions(id),
  origin TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  recommendation_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, number)
);

CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  concept_version_id TEXT NOT NULL REFERENCES concept_versions(id),
  provider_id TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  concept_version_id TEXT NOT NULL REFERENCES concept_versions(id),
  evidence_snapshot_id TEXT REFERENCES evidence_snapshots(id),
  status TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  position INTEGER NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  why TEXT NOT NULL,
  evidence TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  change_json TEXT NOT NULL,
  status TEXT NOT NULL,
  applied_version_id TEXT REFERENCES concept_versions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_project ON concept_versions(project_id, number);
CREATE INDEX IF NOT EXISTS idx_sims_project ON simulations(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recs_simulation ON recommendations(simulation_id, position);

-- src/runner/store.ts
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE (run_id, seq)
);

-- src/ops/qloo-budget.ts
CREATE TABLE IF NOT EXISTS qloo_daily (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
