import { evidenceSignal, type EvidenceSignal } from './signal.js';
import type { FacetAffinity } from './types.js';

export interface FacetSpec {
  id: 'japanese' | 'minimal' | 'streetwear' | 'electronic';
  /** Same idea patterns as `CONCEPT_FACETS` in `split/evidence.js`. */
  idea: RegExp;
  /** Labels a source actually uses. Narrower than the idea pattern. */
  label: RegExp;
}

export const FACETS: readonly FacetSpec[] = [
  { id: 'japanese', idea: /japan|japanese|ญี่ปุ่น/i, label: /japan/i },
  { id: 'minimal', idea: /minimal|มินิมอล/i, label: /minimal/i },
  { id: 'streetwear', idea: /street\s?wear|สตรีท|street fashion/i, label: /street\s?wear|street fashion/i },
  {
    id: 'electronic',
    idea: /electronic|underground|อิเล็กทรอนิก/i,
    label: /electronic|\btechno\b|\bambient\b|\bidm\b|\bedm\b|intelligent dance/i,
  },
];

export function facetsInIdea(idea: string): FacetSpec['id'][] {
  const text = idea ?? '';
  return FACETS.filter((facet) => facet.idea.test(text)).map((facet) => facet.id);
}

export function matchingLabel(facetId: string, labels: readonly string[]): string | null {
  const spec = FACETS.find((facet) => facet.id === facetId);
  if (!spec) return null;
  for (const label of labels) {
    if (spec.label.test(label)) return label;
  }
  return null;
}

export function facetAffinity(input: {
  facet: string;
  labels: readonly string[];
  source: string;
  status: EvidenceSignal<number | null>['status'];
  url?: string;
  /** Set when the entity itself was not resolved, so the facet was not looked up. */
  unresolvedDetail?: string;
}): FacetAffinity {
  if (input.unresolvedDetail) {
    return {
      facet: input.facet,
      matchedLabel: null,
      affinity: evidenceSignal({
        value: null,
        source: input.source,
        status: input.status === 'found' ? 'limited' : input.status,
        detail: input.unresolvedDetail,
        url: input.url,
      }),
    };
  }
  const matched = matchingLabel(input.facet, input.labels);
  if (matched) {
    return {
      facet: input.facet,
      matchedLabel: matched,
      affinity: evidenceSignal({
        value: null,
        source: input.source,
        status: 'limited',
        url: input.url,
        detail: `Source lists “${matched}”, which matches the ${input.facet} facet. This source does not publish a 0–100 affinity.`,
      }),
    };
  }
  return {
    facet: input.facet,
    matchedLabel: null,
    affinity: evidenceSignal({
      value: null,
      source: input.source,
      status: 'limited',
      url: input.url,
      detail: input.labels.length
        ? `Resolved labels (${input.labels.join(', ')}) do not match the ${input.facet} facet.`
        : `Resolved entity has no genre, movement, country, language, or tag labels for the ${input.facet} facet.`,
    }),
  };
}

export function hasPremiumLanguage(idea: string): boolean {
  return /premium|luxury|พรีเมียม|หรู|ราคาสูง/i.test(idea ?? '');
}

export function hasLimitedLanguage(idea: string): boolean {
  return /limited|exclusive|scarcity|ลิมิเต็ด|ขาดแคลน/i.test(idea ?? '');
}
