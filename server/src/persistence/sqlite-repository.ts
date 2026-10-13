import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Brief } from '../engine/types.ts';
import type { ProjectRepository } from '../domain/repository.ts';
import type {
  ConceptVersion,
  EvidenceSnapshot,
  Project,
  Recommendation,
  RecommendationStatus,
  StoredScore,
  StoredSimulation,
  SimulationStatus,
  VersionOrigin,
} from '../domain/records.ts';
import type { RecommendationChange } from '../domain/llm.ts';

const SCHEMA = `
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
`;

interface VersionRow {
  id: string;
  project_id: string;
  number: number;
  parent_id: string | null;
  origin: string;
  brief_json: string;
  recommendation_id: string | null;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SimulationRow {
  id: string;
  project_id: string;
  concept_version_id: string;
  evidence_snapshot_id: string | null;
  status: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
}

interface RecommendationRow {
  id: string;
  simulation_id: string;
  project_id: string;
  position: number;
  before_text: string;
  after_text: string;
  why: string;
  evidence: string;
  evidence_ids_json: string;
  change_json: string;
  status: string;
  applied_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export function openRepository(path: string): SqliteRepository {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec(SCHEMA);
  return new SqliteRepository(db);
}

export class SqliteRepository implements ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  createProject(input: {
    projectId: string;
    name: string;
    versionId: string;
    brief: Brief;
    now: string;
  }): { project: Project; version: ConceptVersion } {
    return this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, current_version_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?)`,
        )
        .run(input.projectId, input.name, input.now, input.now);
      this.insertVersion({
        id: input.versionId,
        projectId: input.projectId,
        number: 1,
        parentId: null,
        origin: 'initial',
        brief: input.brief,
        recommendationId: null,
        createdAt: input.now,
      });
      this.db.prepare(`UPDATE projects SET current_version_id = ? WHERE id = ?`).run(input.versionId, input.projectId);
      return {
        project: this.requireProject(input.projectId),
        version: this.requireVersion(input.versionId),
      };
    });
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
    if (!row || !row.current_version_id) return null;
    return {
      id: row.id,
      name: row.name,
      currentVersionId: row.current_version_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getVersion(id: string): ConceptVersion | null {
    const row = this.db.prepare(`SELECT * FROM concept_versions WHERE id = ?`).get(id) as VersionRow | undefined;
    return row ? mapVersion(row) : null;
  }

  listVersions(projectId: string): ConceptVersion[] {
    const rows = this.db
      .prepare(`SELECT * FROM concept_versions WHERE project_id = ? ORDER BY number ASC`)
      .all(projectId) as unknown as VersionRow[];
    return rows.map(mapVersion);
  }

  saveBriefEdit(input: {
    versionId: string;
    projectId: string;
    parentId: string;
    brief: Brief;
    now: string;
  }): { version: ConceptVersion; staleSimulationIds: string[] } {
    return this.transaction(() => {
      const number = this.allocateNumber(input.projectId);
      this.insertVersion({
        id: input.versionId,
        projectId: input.projectId,
        number,
        parentId: input.parentId,
        origin: 'brief_edit',
        brief: input.brief,
        recommendationId: null,
        createdAt: input.now,
      });
      this.db
        .prepare(`UPDATE projects SET current_version_id = ?, updated_at = ? WHERE id = ?`)
        .run(input.versionId, input.now, input.projectId);
      const staleSimulationIds = this.markCompleteStale(input.projectId);
      return { version: this.requireVersion(input.versionId), staleSimulationIds };
    });
  }

  commitAppliedVersion(input: {
    versionId: string;
    projectId: string;
    parentId: string;
    brief: Brief;
    recommendationId: string;
    now: string;
  }): ConceptVersion {
    return this.transaction(() => {
      const number = this.allocateNumber(input.projectId);
      this.insertVersion({
        id: input.versionId,
        projectId: input.projectId,
        number,
        parentId: input.parentId,
        origin: 'recommendation_applied',
        brief: input.brief,
        recommendationId: input.recommendationId,
        createdAt: input.now,
      });
      this.db
        .prepare(`UPDATE projects SET current_version_id = ?, updated_at = ? WHERE id = ?`)
        .run(input.versionId, input.now, input.projectId);
      this.setRecommendationStatus(input.recommendationId, 'applied', input.versionId, input.now);
      return this.requireVersion(input.versionId);
    });
  }

  saveSuccess(input: { snapshot: EvidenceSnapshot; simulation: StoredSimulation; recommendations: Recommendation[] }): void {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO evidence_snapshots (id, project_id, concept_version_id, provider_id, packet_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.snapshot.id,
          input.snapshot.projectId,
          input.snapshot.conceptVersionId,
          input.snapshot.providerId,
          JSON.stringify(input.snapshot.packet),
          input.snapshot.createdAt,
        );
      this.insertSimulation(input.simulation);
      const insertRec = this.db.prepare(
        `INSERT INTO recommendations (
           id, simulation_id, project_id, position, before_text, after_text, why, evidence,
           evidence_ids_json, change_json, status, applied_version_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const rec of input.recommendations) {
        insertRec.run(
          rec.id,
          rec.simulationId,
          rec.projectId,
          rec.position,
          rec.before,
          rec.after,
          rec.why,
          rec.evidence,
          JSON.stringify(rec.evidenceIds),
          JSON.stringify(rec.change),
          rec.status,
          rec.appliedVersionId,
          rec.createdAt,
          rec.updatedAt,
        );
      }
    });
  }

  saveFailure(simulation: StoredSimulation): void {
    this.insertSimulation({
      ...simulation,
      status: 'failed',
      result: null,
      evidenceSnapshotId: null,
    });
  }

  getSimulation(id: string): StoredSimulation | null {
    const row = this.db.prepare(`SELECT * FROM simulations WHERE id = ?`).get(id) as SimulationRow | undefined;
    return row ? mapSimulation(row) : null;
  }

  listRecommendations(simulationId: string): Recommendation[] {
    const rows = this.db
      .prepare(`SELECT * FROM recommendations WHERE simulation_id = ? ORDER BY position ASC`)
      .all(simulationId) as unknown as RecommendationRow[];
    return rows.map(mapRecommendation);
  }

  getRecommendation(id: string): Recommendation | null {
    const row = this.db.prepare(`SELECT * FROM recommendations WHERE id = ?`).get(id) as RecommendationRow | undefined;
    return row ? mapRecommendation(row) : null;
  }

  setRecommendationStatus(
    id: string,
    status: 'applied' | 'dismissed',
    appliedVersionId: string | null,
    now: string,
  ): void {
    this.db
      .prepare(
        `UPDATE recommendations
         SET status = ?, applied_version_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, appliedVersionId, now, id);
  }

  private requireProject(id: string): Project {
    const project = this.getProject(id);
    if (!project) throw new Error(`Project ${id} was not stored`);
    return project;
  }

  private requireVersion(id: string): ConceptVersion {
    const version = this.getVersion(id);
    if (!version) throw new Error(`Concept version ${id} was not stored`);
    return version;
  }

  private allocateNumber(projectId: string): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM concept_versions WHERE project_id = ?`)
      .get(projectId) as { n: number };
    return row.n;
  }

  private markCompleteStale(projectId: string): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM simulations WHERE project_id = ? AND status = 'complete'`)
      .all(projectId) as unknown as Array<{ id: string }>;
    this.db.prepare(`UPDATE simulations SET status = 'stale' WHERE project_id = ? AND status = 'complete'`).run(projectId);
    return rows.map((row) => row.id);
  }

  private insertVersion(version: ConceptVersion): void {
    this.db
      .prepare(
        `INSERT INTO concept_versions (
           id, project_id, number, parent_id, origin, brief_json, recommendation_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.projectId,
        version.number,
        version.parentId,
        version.origin,
        JSON.stringify(version.brief),
        version.recommendationId,
        version.createdAt,
      );
  }

  private insertSimulation(simulation: StoredSimulation): void {
    this.db
      .prepare(
        `INSERT INTO simulations (
           id, project_id, concept_version_id, evidence_snapshot_id, status, result_json, error, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        simulation.id,
        simulation.projectId,
        simulation.conceptVersionId,
        simulation.evidenceSnapshotId,
        simulation.status,
        simulation.result ? JSON.stringify(simulation.result) : null,
        simulation.error,
        simulation.createdAt,
      );
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function mapVersion(row: VersionRow): ConceptVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    parentId: row.parent_id,
    origin: row.origin as VersionOrigin,
    brief: JSON.parse(row.brief_json) as Brief,
    recommendationId: row.recommendation_id,
    createdAt: row.created_at,
  };
}

function mapSimulation(row: SimulationRow): StoredSimulation {
  return {
    id: row.id,
    projectId: row.project_id,
    conceptVersionId: row.concept_version_id,
    evidenceSnapshotId: row.evidence_snapshot_id,
    status: row.status as SimulationStatus,
    result: row.result_json ? (JSON.parse(row.result_json) as StoredScore) : null,
    error: row.error,
    createdAt: row.created_at,
  };
}

function mapRecommendation(row: RecommendationRow): Recommendation {
  return {
    id: row.id,
    simulationId: row.simulation_id,
    projectId: row.project_id,
    position: row.position,
    before: row.before_text,
    after: row.after_text,
    why: row.why,
    evidence: row.evidence,
    evidenceIds: JSON.parse(row.evidence_ids_json) as string[],
    change: JSON.parse(row.change_json) as RecommendationChange,
    status: row.status as RecommendationStatus,
    appliedVersionId: row.applied_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
