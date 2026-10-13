import assert from 'node:assert/strict';
import test from 'node:test';
import { BriefV2Schema } from '@tastedraft/contracts';
import { STARTER_REFERENCES, TOUR_IDEA, TOUR_REFERENCES, defaultDraft } from './defaults.ts';
import {
  addChip,
  changedMind,
  costAvoided,
  DEFAULT_ASSUMPTIONS,
  duplicateIdea,
  formatElapsed,
  formatMoney,
  impactRequest,
  isTourBrief,
  previewGap,
  rememberVersion,
  snagLine,
  type LabIdea,
} from './lab.ts';
import { mergeFeatures, parseLabFeatures, projectFeatures, stubLabFeatures } from './lab-api.ts';
import { recordedSnapshot } from './recorded-tour.ts';
import { anchorRefs, sentimentOf, voiceFor } from './voice.ts';

const idea = (): LabIdea => ({
  id: 'idea-a',
  title: 'Night drop',
  city: 'Los Angeles',
  variant: 'A',
  parentId: null,
  draft: defaultDraft(),
  controls: { muted: [], priceLevel: 3, scarcity: 'limited' },
  versions: [],
});

test('cost avoided is the focus groups plus the pilot days', () => {
  assert.equal(costAvoided(DEFAULT_ASSUMPTIONS), 10400);
  assert.equal(formatMoney(10400), '$10,400');
  assert.equal(costAvoided({ ...DEFAULT_ASSUMPTIONS, groups: 0, pilotDays: -2 }), 0);
  const body = impactRequest(DEFAULT_ASSUMPTIONS);
  assert.ok(body);
  assert.equal(body.roundsAvoided * (body.pilotCost + body.focusGroupCost * body.sampleSize), 10400);
  const noGroups = impactRequest({ ...DEFAULT_ASSUMPTIONS, groups: 0 });
  assert.ok(noGroups);
  assert.equal(noGroups.sampleSize, 1);
  assert.equal(noGroups.focusGroupCost, 0);
  assert.equal(noGroups.roundsAvoided * (noGroups.pilotCost + noGroups.focusGroupCost * noGroups.sampleSize), costAvoided({ ...DEFAULT_ASSUMPTIONS, groups: 0 }));
  assert.equal(impactRequest({ ...DEFAULT_ASSUMPTIONS, groups: 0, pilotDays: 0 }), null);
});

test('the tour brief is the music example', () => {
  assert.equal(isTourBrief(TOUR_IDEA, 'Tokyo'), true);
  assert.equal(isTourBrief(TOUR_IDEA, 'Los Angeles'), false);
  assert.equal(isTourBrief('A Bangkok streetwear brand launching in Tokyo', 'Tokyo'), false);
});

test('elapsed time stays clock-shaped', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(12_400), '0:12');
  assert.equal(formatElapsed(75_000), '1:15');
});

test('persona voice follows that persona’s anchors and fit', () => {
  const keen = voiceFor(
    [
      { name: 'Paper Coast' },
      { name: 'Studio Slot' },
    ],
    84,
  );
  const passing = voiceFor(
    [
      { name: 'Maa Kai Yang' },
      { name: 'Boat Noodle Lamp' },
    ],
    44,
  );
  assert.match(keen, /Paper Coast/);
  assert.match(keen, /Studio Slot/);
  assert.match(passing, /Maa Kai Yang/);
  assert.match(passing, /pass|Not for me|leave it|walk past/i);
  assert.notEqual(keen, passing);
  const sameAnchors = [
    { name: 'Aphex Twin' },
    { name: 'Muji' },
  ];
  assert.notEqual(voiceFor(sameAnchors, 44), voiceFor(sameAnchors, 61));
  const moved = voiceFor(sameAnchors, 53, 44);
  assert.match(moved, /Aphex Twin/);
  assert.match(moved, /closer|look again|change helps|stop for/i);
  assert.notEqual(moved, voiceFor(sameAnchors, 44));
  assert.equal(sentimentOf(84), 'buy');
  assert.equal(sentimentOf(66), 'curious');
  assert.equal(sentimentOf(44), 'pass');
  assert.equal(sentimentOf(53), 'curious');
  assert.equal(voiceFor([], 80), 'Still measuring what this person actually likes.');
  assert.deepEqual(anchorRefs([{ name: 'Paper Coast' }, { name: 'Studio Slot' }]), ['Paper Coast', 'Studio Slot']);
  assert.notDeepEqual(
    anchorRefs([{ name: 'Paper Coast' }]),
    ['Comme des Garçons', 'Muji'],
  );
});

test('a snag names the passing persona, and a changed mind is a 5-point move', () => {
  const line = snagLine(
    [
      { label: 'Tokyo 18–25', fit: 82, rejects: false, measuring: false },
      { label: 'Tokyo 46+', fit: 54, rejects: true, measuring: false },
    ],
    ['Premium price'],
  );
  assert.match(line, /Tokyo 46\+/);
  assert.match(line, /Premium price/);
  assert.equal(changedMind(82, 54), true);
  assert.equal(changedMind(82, 84), false);
  assert.equal(changedMind(44, 53), true);
  assert.equal(changedMind(44, 47), false);
  assert.equal(changedMind(0, 80, true, false), false);
});

test('library chips, versions, and A/B copies stay deterministic', () => {
  const chip = { id: 'sacai', name: 'Sacai', type: 'urn:entity:brand', kind: 'reference' as const };
  const next = addChip(STARTER_REFERENCES, chip);
  assert.equal(next.at(-1)?.name, 'Sacai');
  assert.equal(addChip(next, chip).length, next.length);
  const saved = rememberVersion(idea(), 1, 71);
  assert.deepEqual(saved.versions, [{ n: 1, score: 71 }]);
  const copy = duplicateIdea(saved, 'idea-b');
  assert.equal(copy.variant, 'B');
  assert.equal(copy.parentId, 'idea-a');
  assert.equal(copy.versions.length, 0);
  assert.equal(previewGap(71, 80), 'Variant B is +9 versus A on the engine preview. Not a sales forecast.');
  assert.equal(previewGap(71, null), 'Score both variants to compare.');
});

test('the features parser keeps a real payload and ignores a stub-shaped miss', () => {
  const fallback = stubLabFeatures({ city: 'Tokyo', age: '18–25' });
  assert.equal(fallback.source, 'stub');
  assert.equal(fallback.skews.length, 0);
  const parsed = parseLabFeatures(
    {
      features: {
        demographicLine: 'Target is 36–45, but NewJeans skews 25–29 (+0.83).',
        skews: [{ name: 'NewJeans', bucket: '25_to_29', skew: 0.83 }],
        competitors: [{ persona: 'Tokyo 18–25', name: 'A.P.C.', affinity: 0.62 }],
        neighborhoods: [{ label: 'Shimokitazawa', weight: 0.8, price: 0.4, popularity: 0.7 }],
        niches: [{ id: 'n1', name: 'Koenji Echo', type: 'urn:entity:place', affinity: 0.5 }],
        activation: { places: ['Shelter'], podcasts: ['Design Notes'], brands: ['Sacai'] },
        explain: [{ name: 'Sacai', before: 0.2, after: 0.7 }],
      },
    },
    fallback,
  );
  assert.equal(parsed.source, 'api');
  assert.equal(parsed.skews[0]?.skew, 0.83);
  assert.equal(parsed.activation.podcasts[0], 'Design Notes');
  assert.equal(parsed.explain[0]?.after, 0.7);
  assert.equal(parseLabFeatures({ nope: true }, fallback).source, 'stub');
  assert.equal(projectFeatures({}, fallback).source, 'stub');
  const merged = mergeFeatures(
    { ...fallback, demographicLine: 'Recorded run. Demographic skew was not in this playback.', neighborhoods: [{ label: 'Shimokitazawa', weight: 0.84, price: null, popularity: null }] },
    fallback,
  );
  assert.equal(merged.neighborhoods[0]?.label, 'Shimokitazawa');
});

test('a recorded tour snapshot cites the playback places and an engine delta', () => {
  const brief = BriefV2Schema.parse({
    idea: TOUR_IDEA,
    interests: [{ id: 'tag-live', name: 'Live music', type: 'urn:tag' }],
    references: TOUR_REFERENCES,
    locations: [TOUR_REFERENCES[2]],
    city: 'Tokyo',
    age: '18–25',
    priceLevel: 3,
    positioning: 'Premium',
    constraints: ['premium price', 'limited runs'],
  });
  const run = recordedSnapshot(brief, 52, 9);
  assert.ok(run);
  assert.equal(run.grounding, 'recorded');
  assert.equal(run.score, 52);
  assert.equal(run.report, 'Recorded run.');
  assert.equal(run.proposals[0]?.predictedDelta, 9);
  assert.equal(run.proposals[0]?.changes[0]?.to, '2');
  assert.ok(run.districts.some((cell) => cell.label === 'Shimokitazawa'));
  assert.equal(run.personas.length, 4);
  assert.equal(new Set(run.personas.map((persona) => persona.anchors.map((anchor) => anchor.name).join('|'))).size, 4);
});
