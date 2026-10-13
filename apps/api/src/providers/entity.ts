import { facetAffinity, type FacetSpec } from './facets.js';
import { facetNumber, fitForType } from './packet.js';
import { evidenceSignal, type SignalStatus } from './signal.js';
import type { EvidenceSignal } from './signal.js';
import type { FacetAffinity, ReferenceEvidence, ReferenceType, ResolvedEntity } from './types.js';

export function unresolvedEntity(input: {
  query: string;
  source: string;
  status: SignalStatus;
  resolution: ResolvedEntity['resolution'];
  detail: string;
  url?: string;
  candidates?: ResolvedEntity['candidates'];
  name?: string | null;
  id?: string | null;
  description?: string | null;
  measurements?: Readonly<Record<string, number>>;
}): ResolvedEntity {
  const status = input.status === 'found' ? 'ambiguous' : input.status;
  return {
    query: input.query,
    name: input.name ?? null,
    id: input.id ?? null,
    description: input.description ?? null,
    image: null,
    url: input.url ?? null,
    labels: [],
    locatedIn: [],
    measurements: input.measurements ?? {},
    candidates: input.candidates ?? [],
    resolution: input.resolution,
    source: input.source,
    status,
    type: evidenceSignal({
      value: null,
      source: input.source,
      status,
      detail: input.detail,
      url: input.url,
    }),
  };
}

export function typedEntity(input: {
  query: string;
  source: string;
  name: string;
  id: string;
  type: ReferenceType | null;
  typeDetail: string;
  typeStatus?: SignalStatus;
  description: string | null;
  image: string | null;
  url: string | null;
  labels: readonly string[];
  locatedIn?: readonly string[];
  measurements?: Readonly<Record<string, number>>;
  note?: string;
}): ResolvedEntity {
  const typeStatus = input.typeStatus ?? (input.type ? 'found' : 'limited');
  return {
    query: input.query,
    name: input.name,
    id: input.id,
    description: input.description,
    image: input.image,
    url: input.url,
    labels: input.labels,
    locatedIn: input.locatedIn ?? [],
    measurements: input.measurements ?? {},
    candidates: [],
    resolution: 'unique',
    source: input.source,
    status: 'found',
    type: evidenceSignal({
      value: input.type,
      source: input.source,
      status: typeStatus,
      detail: input.note ? `${input.typeDetail} ${input.note}` : input.typeDetail,
      url: input.url ?? undefined,
    }),
  };
}

export function referenceFromEntity(
  entity: ResolvedEntity,
  facets: readonly FacetSpec['id'][],
  cityName: string,
  facetOverrides?: readonly FacetAffinity[],
): ReferenceEvidence {
  const facetsOut = facets.map((facet) => {
    const override = facetOverrides?.find((row) => row.facet === facet);
    if (override) return override;
    if (entity.status !== 'found') {
      return facetAffinity({
        facet,
        labels: [],
        source: entity.source,
        status: entity.status,
        url: entity.url ?? undefined,
        unresolvedDetail: entity.type.detail,
      });
    }
    return facetAffinity({
      facet,
      labels: entity.labels,
      source: entity.source,
      status: 'limited',
      url: entity.url ?? undefined,
    });
  });
  const city = entity.status === 'found'
    ? evidenceSignal<string | null>({
      value: null,
      source: entity.source,
      status: 'limited',
      detail: 'This source did not state a city for the reference.',
      url: entity.url ?? undefined,
    })
    : evidenceSignal<string | null>({
      value: null,
      source: entity.source,
      status: entity.status,
      detail: entity.type.detail,
      url: entity.url ?? undefined,
    });
  const measured = facetsOut
    .map((row) => row.affinity)
    .filter((signal) => signal.status === 'found' && typeof signal.value === 'number');
  const affinity = measured.length
    ? evidenceSignal<number | null>({
      value: Math.round(measured.reduce((sum, signal) => sum + (signal.value ?? 0), 0) / measured.length),
      source: measured.map((signal) => signal.source).join('+'),
      status: 'found',
      detail: `Unweighted mean of ${measured.length} facet affinity value(s) with status found.`,
      unverifiedField: measured.some((signal) => signal.unverifiedField === true),
    })
    : evidenceSignal<number | null>({
      value: null,
      source: entity.source,
      status: entity.status === 'found' ? 'limited' : entity.status,
      detail: entity.status === 'found'
        ? 'No facet affinity was measured for this reference. Matching labels, if any, are categorical only.'
        : entity.type.detail,
      url: entity.url ?? undefined,
    });
  return {
    name: entity.query,
    type: entity.type,
    fit: fitForType(entity.type.value),
    provenance: entity.source,
    city,
    inBriefCity: evidenceSignal({
      value: null,
      source: entity.source,
      status: entity.status === 'found' ? 'limited' : entity.status,
      detail: cityName
        ? 'No statement places this reference in the brief city.'
        : 'The brief has no city.',
      url: entity.url ?? undefined,
    }),
    facets: facetsOut,
    affinity,
    minimal: facetNumber(facetsOut, 'minimal'),
    electronic: facetNumber(facetsOut, 'electronic'),
    streetwear: facetNumber(facetsOut, 'streetwear'),
    japanese: facetNumber(facetsOut, 'japanese'),
    status: entity.status,
    entity,
  };
}

export function withCity(
  ref: ReferenceEvidence,
  city: EvidenceSignal<string | null>,
  inBriefCity: EvidenceSignal<boolean | null>,
): ReferenceEvidence {
  return { ...ref, city, inBriefCity };
}
