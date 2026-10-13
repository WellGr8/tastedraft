import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_BRIEF } from '../engine/index.ts';
import { openRepository } from './sqlite-repository.ts';

describe('sqlite repository', () => {
  test('versions are append-only and brief edits mark complete simulations stale', () => {
    const repo = openRepository(':memory:');
    const created = repo.createProject({
      projectId: 'p1',
      name: 'Demo',
      versionId: 'v1',
      brief: DEFAULT_BRIEF,
      now: '2026-10-12T00:00:00.000Z',
    });
    assert.equal(created.version.number, 1);
    assert.equal(created.project.currentVersionId, 'v1');

    repo.saveSuccess({
      snapshot: {
        id: 'snap1',
        projectId: 'p1',
        conceptVersionId: 'v1',
        providerId: 'sample',
        packet: {
          sourceId: 'sample',
          mixed: false,
          facets: [],
          refs: [],
          domains: [],
          local: { base: 1, penalty: 0 },
          audience: { base: 1, penalty: 0 },
          friction: 0,
          signal: { fashion: 1, music: 1, design: 1 },
          crossAdjust: 0,
          posture: 'Premium',
          scarcity: 'limited',
        },
        createdAt: '2026-10-12T00:00:01.000Z',
      },
      simulation: {
        id: 's1',
        projectId: 'p1',
        conceptVersionId: 'v1',
        evidenceSnapshotId: 'snap1',
        status: 'complete',
        result: {
          score: 71,
          displayScore: { text: '71', why: 'Why 71?', limited: false, approx: 71 },
          ledger: { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5, total: 71 },
          subs: { anchor: 80, cross: 80, local: 74, audience: 68, friction: 12 },
          evidenceStrength: 'HIGH',
          signals: [],
          districts: { min: [], lux: [] },
          fits: [],
          frictions: [],
          provider: 'sample',
          mixed: false,
          parsedBrief: { conceptTerms: [], conflictHypotheses: [], domains: [] },
        },
        error: null,
        createdAt: '2026-10-12T00:00:01.000Z',
      },
      recommendations: [],
    });

    const edited = repo.saveBriefEdit({
      versionId: 'v2',
      projectId: 'p1',
      parentId: 'v1',
      brief: { ...DEFAULT_BRIEF, city: 'Miami' },
      now: '2026-10-12T00:00:02.000Z',
    });
    assert.equal(edited.version.number, 2);
    assert.equal(edited.version.origin, 'brief_edit');
    assert.deepEqual(edited.staleSimulationIds, ['s1']);
    assert.equal(repo.getVersion('v1')?.brief.city, 'Los Angeles');
    assert.equal(repo.getSimulation('s1')?.status, 'stale');
    assert.equal(repo.getSimulation('s1')?.result?.score, 71);
    assert.equal(repo.getProject('p1')?.currentVersionId, 'v2');
  });

  test('a failed simulation stores no score', () => {
    const repo = openRepository(':memory:');
    repo.createProject({
      projectId: 'p1',
      name: 'Demo',
      versionId: 'v1',
      brief: DEFAULT_BRIEF,
      now: '2026-10-12T00:00:00.000Z',
    });
    repo.saveFailure({
      id: 's-fail',
      projectId: 'p1',
      conceptVersionId: 'v1',
      evidenceSnapshotId: 'should-be-dropped',
      status: 'complete',
      result: {
        score: 71,
        displayScore: { text: '71', why: 'Why 71?', limited: false, approx: 71 },
        ledger: { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5, total: 71 },
        subs: { anchor: 80, cross: 80, local: 74, audience: 68, friction: 12 },
        evidenceStrength: 'HIGH',
        signals: [],
        districts: { min: [], lux: [] },
        fits: [],
        frictions: [],
        provider: 'sample',
        mixed: false,
        parsedBrief: { conceptTerms: [], conflictHypotheses: [], domains: [] },
      },
      error: 'provider down',
      createdAt: '2026-10-12T00:00:03.000Z',
    });
    const failed = repo.getSimulation('s-fail');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.result, null);
    assert.equal(failed?.evidenceSnapshotId, null);
    assert.equal(failed?.error, 'provider down');
  });

  test('apply inserts a new version and leaves the parent brief intact', () => {
    const repo = openRepository(':memory:');
    repo.createProject({
      projectId: 'p1',
      name: 'Demo',
      versionId: 'v1',
      brief: DEFAULT_BRIEF,
      now: '2026-10-12T00:00:00.000Z',
    });
    repo.saveSuccess({
      snapshot: {
        id: 'snap1',
        projectId: 'p1',
        conceptVersionId: 'v1',
        providerId: 'sample',
        packet: {
          sourceId: 'sample',
          mixed: false,
          facets: [],
          refs: [],
          domains: [],
          local: { base: 0, penalty: 0 },
          audience: { base: 0, penalty: 0 },
          friction: 0,
          signal: { fashion: 0, music: 0, design: 0 },
          crossAdjust: 0,
          posture: 'Premium',
          scarcity: 'limited',
        },
        createdAt: '2026-10-12T00:00:01.000Z',
      },
      simulation: {
        id: 's1',
        projectId: 'p1',
        conceptVersionId: 'v1',
        evidenceSnapshotId: 'snap1',
        status: 'complete',
        result: null,
        error: null,
        createdAt: '2026-10-12T00:00:01.000Z',
      },
      recommendations: [
        {
          id: 'r1',
          simulationId: 's1',
          projectId: 'p1',
          position: 0,
          before: 'Premium pricing',
          after: 'Accessible premium',
          why: 'price',
          evidence: 'sample',
          evidenceIds: ['Fashion'],
          change: { kind: 'posture', posture: 'accessible' },
          status: 'open',
          appliedVersionId: null,
          createdAt: '2026-10-12T00:00:01.000Z',
          updatedAt: '2026-10-12T00:00:01.000Z',
        },
      ],
    });
    const applied = repo.commitAppliedVersion({
      versionId: 'v2',
      projectId: 'p1',
      parentId: 'v1',
      brief: { ...DEFAULT_BRIEF, posture: 'accessible' },
      recommendationId: 'r1',
      now: '2026-10-12T00:00:04.000Z',
    });
    assert.equal(applied.number, 2);
    assert.equal(applied.origin, 'recommendation_applied');
    assert.equal(applied.parentId, 'v1');
    assert.equal(repo.getVersion('v1')?.brief.posture, undefined);
    assert.equal(repo.getRecommendation('r1')?.status, 'applied');
    assert.equal(repo.getRecommendation('r1')?.appliedVersionId, 'v2');
    assert.equal(repo.getSimulation('s1')?.status, 'complete');
  });
});
