import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_QLOO_LOCATION,
  askFor,
  broadenQueries,
  decideGate,
  evidenceIsThin,
  ideaKeywords,
  isQlooEntityId,
  plainStopReason,
  type MeasuredEvidence,
} from './evidence-gate.ts';

const EMPTY: MeasuredEvidence = { resolvedEntities: 0, tags: 0, heatmapCells: 0, personaAnchors: 0 };
const UUID = '11111111-2222-4333-8444-555555555555';

describe('evidence gate', () => {
  it('asks a mock run with one reference to continue', () => {
    assert.equal(decideGate({ measured: { ...EMPTY, tags: 3, heatmapCells: 2 }, referenceCount: 1, live: false, forced: false }), 'ask');
  });

  it('scores a mock run once two references are on the brief', () => {
    assert.equal(decideGate({ measured: EMPTY, referenceCount: 2, live: false, forced: false }), 'score');
  });

  it('scores a live run that resolved one artist, even with a single reference', () => {
    const measured: MeasuredEvidence = { resolvedEntities: 1, tags: 2, heatmapCells: 4, personaAnchors: 6 };
    assert.equal(evidenceIsThin(measured), false);
    assert.equal(decideGate({ measured, referenceCount: 1, live: true, forced: false }), 'score');
  });

  it('scores a live run from persona anchors when search did not resolve', () => {
    const measured: MeasuredEvidence = { ...EMPTY, personaAnchors: 3 };
    assert.equal(decideGate({ measured, referenceCount: 1, live: true, forced: false }), 'score');
  });

  it('asks a live run that came back empty', () => {
    assert.equal(decideGate({ measured: EMPTY, referenceCount: 4, live: true, forced: false }), 'ask');
    assert.equal(askFor(EMPTY, 'Nowhereville').kind, 'reference');
  });

  it('asks for a city when the reference resolved but the place did not', () => {
    const measured: MeasuredEvidence = { resolvedEntities: 1, tags: 0, heatmapCells: 0, personaAnchors: 0 };
    assert.equal(evidenceIsThin(measured), false);
    const ask = askFor({ ...measured, resolvedEntities: 1, tags: 0, heatmapCells: 0, personaAnchors: 1 }, 'Nowhereville');
    assert.equal(ask.kind, 'city');
    assert.equal(ask.suggestion, DEFAULT_QLOO_LOCATION);
    assert.match(ask.question, /Add a city/);
  });

  it('scores when the person already chose to continue', () => {
    assert.equal(decideGate({ measured: EMPTY, referenceCount: 1, live: false, forced: true }), 'score');
  });

  it('rewrites stop reasons without the raw enum', () => {
    assert.equal(plainStopReason('insufficient_evidence').includes('insufficient_evidence'), false);
    assert.match(plainStopReason('insufficient_evidence'), /cultural evidence/);
    assert.match(plainStopReason('no_meaningful_improvement'), /move the score/);
  });
});

describe('broaden queries', () => {
  it('drops filters, discards sample ids, and falls back to a known city', () => {
    const plan = broadenQueries({
      city: 'Nowhereville',
      referenceNames: ['Aphex Twin', 'Aphex Twin', ''],
      candidateIds: ['aphex-twin', UUID, 'urn:entity:artist:example'],
      heatmapFailed: true,
      demographicsFailed: true,
    });
    assert.equal(plan.usedDefaultLocation, true);
    assert.equal(plan.location, DEFAULT_QLOO_LOCATION);
    assert.equal(plan.dropDemographics, true);
    assert.equal(plan.dropPrice, true);
    assert.deepEqual(plan.entityIds, [UUID, 'urn:entity:artist:example']);
    assert.deepEqual(plan.relatedNames, ['Aphex Twin']);
  });

  it('keeps a city that already returned a place', () => {
    const plan = broadenQueries({
      city: 'Tokyo',
      referenceNames: ['Muji'],
      candidateIds: [UUID],
      heatmapFailed: false,
      demographicsFailed: false,
    });
    assert.equal(plan.usedDefaultLocation, false);
    assert.equal(plan.location, 'Tokyo');
    assert.deepEqual(plan.entityIds, [UUID]);
  });

  it('uses the default city when the brief has no place', () => {
    const plan = broadenQueries({
      city: '  ',
      referenceNames: [],
      candidateIds: [],
      heatmapFailed: false,
      demographicsFailed: false,
    });
    assert.equal(plan.location, DEFAULT_QLOO_LOCATION);
    assert.equal(plan.usedDefaultLocation, true);
  });

  it('pulls a few distinctive words out of the idea for a related search', () => {
    assert.deepEqual(ideaKeywords('A small independent record label for late-night electronic listeners'), [
      'small',
      'independent',
      'record',
    ]);
  });

  it('recognises a Qloo entity id and ignores a sample slug', () => {
    assert.equal(isQlooEntityId(UUID), true);
    assert.equal(isQlooEntityId('urn:entity:artist'), true);
    assert.equal(isQlooEntityId('aphex-twin'), false);
  });
});
