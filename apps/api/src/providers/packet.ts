import { hasLimitedLanguage } from './facets.js';
import { evidenceSignal, type EvidenceSignal, type SignalStatus } from './signal.js';
import type {
  Brief,
  DomainAffinity,
  EvidencePacket,
  FacetAffinity,
  NamedSignal,
  ReferenceEvidence,
  SampleEvidencePacket,
} from './types.js';

export function namedSignal(
  id: string,
  domain: string,
  name: string,
  signal: EvidenceSignal<number | string | boolean | null>,
): NamedSignal {
  return { id, domain, name, ...signal };
}

export function limitedNumber(source: string, detail: string): EvidenceSignal<number | null> {
  return evidenceSignal({ value: null, source, status: 'limited', detail });
}

export function failedNumber(source: string, detail: string): EvidenceSignal<number | null> {
  return evidenceSignal({ value: null, source, status: 'failed', detail });
}

export function meanFound(values: readonly EvidenceSignal<number | null>[]): EvidenceSignal<number | null> | null {
  const found = values.filter((signal) => signal.status === 'found' && typeof signal.value === 'number');
  if (!found.length) return null;
  const total = found.reduce((sum, signal) => sum + (signal.value ?? 0), 0);
  return evidenceSignal({
    value: Math.round(total / found.length),
    source: found.map((signal) => signal.source).join('+'),
    status: 'found',
    detail: `Unweighted mean of ${found.length} affinity value(s) whose status is found.`,
    unverifiedField: found.some((signal) => signal.unverifiedField === true),
  });
}

export function facetNumber(
  facets: readonly FacetAffinity[],
  facet: string,
): EvidenceSignal<number | null> {
  const row = facets.find((item) => item.facet === facet);
  if (!row) {
    return limitedNumber('brief', `The ${facet} facet was not requested for this reference.`);
  }
  return row.affinity;
}

export function scarcityFromBrief(brief: Brief): EvidencePacket['scarcity'] {
  if (brief.applied) return 'preorder';
  if (hasLimitedLanguage(brief.idea)) return 'limited';
  return 'none';
}

export function fitForType(type: ReferenceEvidence['type']['value']): ReferenceEvidence['fit'] {
  if (type === 'Brand') return 'logo';
  if (type === 'Artist') return 'circle';
  if (type === 'Film' || type === 'Place') return 'photo';
  return null;
}

function domainAffinities(refs: readonly ReferenceEvidence[]): DomainAffinity[] {
  const types: string[] = [];
  for (const ref of refs) {
    const type = ref.type.value;
    if (type && ref.type.status === 'found' && !types.includes(type)) types.push(type);
  }
  return types.map((type) => {
    const rows = refs.filter((ref) => ref.type.value === type);
    const measured = meanFound(rows.map((ref) => ref.affinity));
    return {
      type,
      affinity: measured ?? limitedNumber(
        rows[0]?.provenance ?? 'open-data',
        `No measured 0–100 affinity for the ${type} references. Their labels are on each ref.`,
      ),
    };
  });
}

function coverageSignal(facets: readonly string[], refs: readonly ReferenceEvidence[]): EvidenceSignal<number | null> {
  const wantsElectronic = facets.includes('electronic');
  const hasElectronicArtist = refs.some((ref) => {
    if (ref.type.value !== 'Artist' || ref.type.status !== 'found') return false;
    return ref.facets.some((facet) => facet.facet === 'electronic' && facet.matchedLabel);
  });
  if (wantsElectronic && refs.length > 0 && !hasElectronicArtist) {
    return limitedNumber(
      'open-data',
      'The idea names an electronic facet and no resolved artist carries an electronic genre label. The sample provider subtracts 6 here; this package does not invent that adjustment.',
    );
  }
  return limitedNumber(
    'open-data',
    'No cross-domain coverage gap was observed. This package still does not emit the sample provider’s numeric crossAdjust.',
  );
}

export interface PacketParts {
  sourceId: EvidencePacket['sourceId'];
  brief: Brief;
  facets: readonly string[];
  refs: readonly ReferenceEvidence[];
  localBase: EvidenceSignal<number | null>;
  localPenalty?: EvidenceSignal<number | null>;
  localSignals?: readonly NamedSignal[];
  audienceBase: EvidenceSignal<number | null>;
  audiencePenalty?: EvidenceSignal<number | null>;
  audienceSignals?: readonly NamedSignal[];
  friction?: EvidenceSignal<number | null>;
  fashion?: EvidenceSignal<number | null>;
  music?: EvidenceSignal<number | null>;
  design?: EvidenceSignal<number | null>;
  extraSignals?: readonly NamedSignal[];
}

export function buildPacket(parts: PacketParts): EvidencePacket {
  const localSignals = parts.localSignals ?? [];
  const audienceSignals = parts.audienceSignals ?? [];
  const fashion = parts.fashion ?? limitedNumber(parts.sourceId, 'No measured fashion affinity.');
  const music = parts.music ?? limitedNumber(parts.sourceId, 'No measured music affinity.');
  const design = parts.design ?? limitedNumber(parts.sourceId, 'No measured design affinity.');
  const friction = parts.friction ?? limitedNumber(
    parts.sourceId,
    'No provider in this package measures price or scarcity friction. The sample friction tables are not reused.',
  );
  const localPenalty = parts.localPenalty ?? limitedNumber(
    parts.sourceId,
    'No provider in this package measures a premium-price or scarcity drag.',
  );
  const audiencePenalty = parts.audiencePenalty ?? limitedNumber(
    parts.sourceId,
    'No provider in this package measures a price-posture penalty for this age band.',
  );
  const crossAdjust = coverageSignal(parts.facets, parts.refs);
  const domains = domainAffinities(parts.refs);
  const foundRefs = parts.refs.filter((ref) => ref.status === 'found').length;
  const unresolved = parts.refs.filter((ref) => ref.status === 'ambiguous' || ref.status === 'failed').length;
  const signals: NamedSignal[] = [
    ...parts.refs.flatMap((ref) => [
      namedSignal(`ref.${ref.name}.type`, 'reference', `${ref.name} type`, {
        value: ref.type.value,
        source: ref.type.source,
        status: ref.type.status,
        detail: ref.type.detail,
        url: ref.type.url,
        unverifiedField: ref.type.unverifiedField,
      }),
      namedSignal(`ref.${ref.name}.affinity`, 'anchor', `${ref.name} concept affinity`, ref.affinity),
      namedSignal(`ref.${ref.name}.city`, 'location', `${ref.name} city`, ref.city),
      ...ref.facets.map((facet) => namedSignal(
        `ref.${ref.name}.facet.${facet.facet}`,
        'facet',
        `${ref.name} ${facet.facet}`,
        facet.affinity,
      )),
    ]),
    ...domains.map((domain) => namedSignal(
      `domain.${domain.type}`,
      'cross',
      `${domain.type} domain affinity`,
      domain.affinity,
    )),
    namedSignal('local.base', 'location', 'Local base', parts.localBase),
    namedSignal('local.penalty', 'location', 'Local penalty', localPenalty),
    ...localSignals,
    namedSignal('audience.base', 'audience', 'Audience base', parts.audienceBase),
    namedSignal('audience.penalty', 'audience', 'Audience penalty', audiencePenalty),
    ...audienceSignals,
    namedSignal('friction', 'friction', 'Cultural friction', friction),
    namedSignal('signal.fashion', 'fashion', 'Fashion', fashion),
    namedSignal('signal.music', 'music', 'Music', music),
    namedSignal('signal.design', 'design', 'Design', design),
    namedSignal('crossAdjust', 'cross', 'Cross-domain adjustment', crossAdjust),
    namedSignal('brief.posture', 'audience', 'Price posture', evidenceSignal({
      value: parts.brief.pos || '',
      source: 'brief',
      status: 'found',
      detail: 'Copied from the brief. This is the user’s positioning, not a measured preference.',
    })),
    namedSignal('brief.scarcity', 'audience', 'Scarcity posture', evidenceSignal({
      value: scarcityFromBrief(parts.brief),
      source: 'brief',
      status: 'found',
      detail: parts.brief.applied
        ? 'brief.applied is set. The sample provider reads that as a pre-order posture. This is not an external measurement.'
        : 'Keyword check on the idea text (limited / exclusive / scarcity). Not a market measurement.',
    })),
    ...(parts.extraSignals ?? []),
  ];
  return {
    sourceId: parts.sourceId,
    mixed: foundRefs > 0 && unresolved > 0,
    facets: parts.facets,
    refs: parts.refs,
    domains,
    local: { base: parts.localBase, penalty: localPenalty, signals: localSignals },
    audience: { base: parts.audienceBase, penalty: audiencePenalty, signals: audienceSignals },
    friction,
    signal: { fashion, music, design },
    crossAdjust,
    posture: parts.brief.pos || '',
    scarcity: scarcityFromBrief(parts.brief),
    signals,
  };
}

/** Unwrap signal values into the object `deriveSubs` reads. Nulls are left null. */
export function toSamplePacket(packet: EvidencePacket): SampleEvidencePacket {
  return {
    sourceId: packet.sourceId,
    mixed: packet.mixed,
    facets: [...packet.facets],
    refs: packet.refs.map((ref) => ({
      name: ref.name,
      type: ref.type.value,
      fit: ref.fit,
      provenance: ref.provenance,
      affinity: ref.affinity.value,
      minimal: ref.minimal.value,
      electronic: ref.electronic.value,
      streetwear: ref.streetwear.value,
      city: ref.city.value ?? '',
    })),
    domains: packet.domains.map((domain) => ({ type: domain.type, affinity: domain.affinity.value })),
    local: { base: packet.local.base.value, penalty: packet.local.penalty.value },
    audience: { base: packet.audience.base.value, penalty: packet.audience.penalty.value },
    friction: packet.friction.value,
    signal: {
      fashion: packet.signal.fashion.value,
      music: packet.signal.music.value,
      design: packet.signal.design.value,
    },
    crossAdjust: packet.crossAdjust.value,
    posture: packet.posture,
    scarcity: packet.scarcity,
  };
}

const STATUSES: readonly SignalStatus[] = ['found', 'limited', 'ambiguous', 'failed'];

/** Every nested `{ value, source, status }` in the packet. */
export function walkSignals(packet: EvidencePacket): EvidenceSignal<unknown>[] {
  const found: EvidenceSignal<unknown>[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.source === 'string' && typeof record.status === 'string' && 'value' in record) {
      const status = record.status;
      if ((STATUSES as readonly string[]).includes(status)) {
        found.push(record as unknown as EvidenceSignal<unknown>);
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(packet);
  return found;
}
