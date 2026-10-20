/**
 * Offline benchmark.
 * Grounded reasons go through the persona template with the anchors this run is allowed to name.
 * The no-Qloo arm uses the shipped LLM-only sentence and names nothing.
 * Neither arm calls Qloo or OpenRouter.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { draftPersonaReply } from '../llm/persona.ts';
import type { LlmClient } from '../llm/client.ts';
import { scoreEngine } from '../agent/model.ts';
import { benchmarkItems, type BenchItem, type PublishedStudy } from './items.ts';
import { classifyReason, specificTasteNames } from './metrics.ts';
import { armFromReasons, RECORDED_LABEL, sampleBlock, summarize } from './publish.ts';
import { round2 } from './metrics.ts';
import { segmentsFor } from './segments.ts';
import type { BenchmarkFile, ItemRecord, ReasonRecord, SampleCity } from './types.ts';

/** Avoids the why/price/where templates, which name only the top anchor. */
export const PANEL_QUESTION = 'Would you try this?';

/** The sentence the runner stores when a pass has no Qloo entities and no model. */
export const LLM_ONLY_SENTENCE =
  'I might look at something like this. Nothing here is tied to a place or a taste I already have.';

const offlineLlm: LlmClient = {
  mode: 'offline',
  provider: 'offline',
  async complete() {
    throw new Error('offline');
  },
};

export function readPublishedStudies(path?: string): PublishedStudy[] {
  const file = path ?? fileURLToPath(new URL('../../../../apps/web/public/case-studies.json', import.meta.url));
  const body = JSON.parse(readFileSync(file, 'utf8')) as { studies?: PublishedStudy[] };
  return Array.isArray(body.studies) ? body.studies : [];
}

async function groundedReasons(item: BenchItem): Promise<ReasonRecord[]> {
  const anchors = item.verifiedNames.length
    ? item.verifiedNames.map((name) => ({
        id: `verified-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        type: item.insightType,
      }))
    : item.references.slice(0, 2).map((reference) => ({
        id: reference.id,
        name: reference.name,
        type: reference.type,
      }));
  const reasons: ReasonRecord[] = [];
  for (const segment of segmentsFor(item.city, item.age)) {
    const draft = await draftPersonaReply(offlineLlm, {
      persona: {
        id: segment.id,
        label: segment.label,
        location: item.city,
        age: segment.age,
        gender: segment.gender,
        anchors,
      },
      message: PANEL_QUESTION,
      context: { idea: item.idea.slice(0, 500) },
    });
    const classified = classifyReason({
      message: draft.message,
      claims: draft.citations.map((citation) => citation.name),
      verified: item.verifiedNames,
    });
    reasons.push({
      personaId: segment.id,
      label: segment.label,
      age: segment.age,
      reason: draft.message,
      source: 'offline-template',
      verified: classified.verified,
      unverifiable: classified.unverifiable,
      hallucinated: classified.hallucinated,
      specific: specificTasteNames(classified.verified, anchors.map((anchor) => anchor.name), item.city),
      score: null,
    });
  }
  return reasons;
}

function plainReasons(item: BenchItem): ReasonRecord[] {
  return segmentsFor(item.city, item.age).map((segment) => ({
    personaId: segment.id,
    label: segment.label,
    age: segment.age,
    reason: LLM_ONLY_SENTENCE,
    source: 'offline-template' as const,
    verified: [],
    unverifiable: [],
    hallucinated: [],
    specific: [],
    score: null,
  }));
}

function sampleCities(items: readonly BenchItem[]): SampleCity[] {
  return items
    .filter((item) => item.kind === 'example')
    .map((item) => {
      const segments = segmentsFor(item.city, item.age).map((segment) => ({
        age: segment.age,
        score: scoreEngine({
          idea: item.idea,
          age: segment.age,
          city: item.city,
          pos: item.positioning,
          refs: item.references.map((reference) => reference.name),
        }).total,
      }));
      const mean = segments.reduce((sum, segment) => sum + segment.score, 0) / segments.length;
      return { id: item.id, city: item.city, mean: round2(mean), segments };
    });
}

export async function buildRecordedBenchmark(options: {
  studies: readonly PublishedStudy[];
  now: string;
}): Promise<BenchmarkFile> {
  const items = benchmarkItems(options.studies);
  const records: ItemRecord[] = [];
  for (const item of items) {
    const qlooReasons = await groundedReasons(item);
    const llmReasons = plainReasons(item);
    records.push({
      id: item.id,
      title: item.title,
      kind: item.kind,
      city: item.city,
      outcome: item.outcome,
      qloo: armFromReasons(
        qlooReasons,
        {
          score: item.ledger?.total ?? null,
          local: item.ledger?.local ?? null,
          verdict: item.ledger?.verdict ?? null,
          matched: item.rankMatched ?? item.ledger?.matched ?? null,
        },
        false,
      ),
      llm: armFromReasons(llmReasons, { score: null, local: null, verdict: null, matched: null }, false),
    });
  }
  return summarize({
    source: 'recorded',
    label: RECORDED_LABEL,
    generatedAt: options.now,
    model: null,
    qlooCalls: 0,
    items: records,
    sampleEngine: sampleBlock(sampleCities(items)),
    llmPanel: null,
  });
}
