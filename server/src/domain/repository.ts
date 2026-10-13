import type { Brief } from '../engine/types.ts';
import type {
  ConceptVersion,
  EvidenceSnapshot,
  Project,
  Recommendation,
  StoredSimulation,
  VersionOrigin,
} from './records.ts';

/**
 * Persistence boundary. The SQLite adapter is the default.
 * A Supabase/Postgres adapter can implement this same interface later;
 * routes and the orchestrator should not import a driver.
 */
export interface ProjectRepository {
  createProject(input: {
    projectId: string;
    name: string;
    versionId: string;
    brief: Brief;
    now: string;
  }): { project: Project; version: ConceptVersion };

  getProject(id: string): Project | null;
  getVersion(id: string): ConceptVersion | null;
  listVersions(projectId: string): ConceptVersion[];

  /**
   * Insert a concept version for a brief edit, point the project at it,
   * and mark every complete simulation on the project stale.
   * Does not modify the parent version. Version number is assigned inside
   * the write so two edits cannot claim the same number.
   */
  saveBriefEdit(input: {
    versionId: string;
    projectId: string;
    parentId: string;
    brief: Brief;
    now: string;
  }): { version: ConceptVersion; staleSimulationIds: string[] };

  /**
   * Insert the version produced by applying a recommendation and mark that
   * recommendation applied. Does not mark existing simulations stale and
   * does not modify the parent version.
   */
  commitAppliedVersion(input: {
    versionId: string;
    projectId: string;
    parentId: string;
    brief: Brief;
    recommendationId: string;
    now: string;
  }): ConceptVersion;

  saveSuccess(input: {
    snapshot: EvidenceSnapshot;
    simulation: StoredSimulation;
    recommendations: Recommendation[];
  }): void;

  saveFailure(simulation: StoredSimulation): void;

  getSimulation(id: string): StoredSimulation | null;
  listRecommendations(simulationId: string): Recommendation[];
  getRecommendation(id: string): Recommendation | null;
  setRecommendationStatus(
    id: string,
    status: 'applied' | 'dismissed',
    appliedVersionId: string | null,
    now: string,
  ): void;
}

export type { VersionOrigin };
