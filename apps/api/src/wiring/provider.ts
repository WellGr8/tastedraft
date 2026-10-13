import type { EvidenceProvider as DomainProvider } from '../domain/evidence-provider.ts';
import type { Brief, EvidencePacket as EnginePacket } from '../engine/types.ts';
import { createSampleEvidenceProvider } from '../orchestrator/stubs/sample-evidence-provider.ts';
import { createEvidenceProvider, toSamplePacket } from '../providers/index.ts';
import type { EvidencePacket as ProviderPacket } from '../providers/types.ts';

export type ProviderMode = 'sample' | 'fallback' | 'qloo';

export interface ProviderEnv {
  EVIDENCE_PROVIDER?: string;
  QLOO_API_KEY?: string;
}

export interface ProviderExtras {
  fetchImpl?: typeof fetch;
}

/**
 * `EVIDENCE_PROVIDER=sample|fallback|qloo`.
 * Unset: Qloo when `QLOO_API_KEY` is set, otherwise the sample provider so the 71 → 82 demo stays calibrated.
 */
export function selectProviderMode(env: ProviderEnv = process.env): ProviderMode {
  const raw = (env.EVIDENCE_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'sample' || raw === 'fallback' || raw === 'qloo') return raw;
  if (raw) throw new Error('EVIDENCE_PROVIDER must be sample, fallback, or qloo');
  return (env.QLOO_API_KEY ?? '').trim() ? 'qloo' : 'sample';
}

/** Screen id. `open-data` is its own label; it must not fall through to sample. */
export function providerLabel(sourceId: string): string {
  if (sourceId === 'open-data' || sourceId === 'none' || sourceId === 'mixed') return 'open-data';
  return sourceId;
}

export function toEnginePacket(packet: ProviderPacket): EnginePacket {
  const flat = toSamplePacket(packet);
  const label = providerLabel(flat.sourceId);
  return {
    sourceId: label,
    mixed: flat.mixed,
    facets: [...flat.facets],
    refs: flat.refs.map((ref) => ({
      name: ref.name,
      type: ref.type ?? 'Reference',
      fit: ref.fit ?? 'photo',
      provenance: ref.provenance || label,
      affinity: ref.affinity,
      minimal: ref.minimal,
      electronic: ref.electronic,
      streetwear: ref.streetwear,
      city: ref.city,
    })),
    domains: flat.domains.map((domain) => ({ type: domain.type, affinity: domain.affinity })),
    local: { base: flat.local.base, penalty: flat.local.penalty },
    audience: { base: flat.audience.base, penalty: flat.audience.penalty },
    friction: flat.friction,
    signal: {
      fashion: flat.signal.fashion,
      music: flat.signal.music,
      design: flat.signal.design,
    },
    crossAdjust: flat.crossAdjust,
    posture: flat.posture,
    scarcity: flat.scarcity,
  };
}

export function adaptEvidenceProvider(inner: {
  readonly id: string;
  getEvidence(brief: Brief): Promise<ProviderPacket>;
}): DomainProvider {
  return {
    id: inner.id,
    async getEvidence(brief) {
      return toEnginePacket(await inner.getEvidence(brief));
    },
  };
}

export function createConfiguredProvider(env: ProviderEnv = process.env, extra: ProviderExtras = {}): DomainProvider {
  const mode = selectProviderMode(env);
  if (mode === 'sample') return createSampleEvidenceProvider();
  const key = (env.QLOO_API_KEY ?? '').trim();
  if (mode === 'qloo' && !key) throw new Error('EVIDENCE_PROVIDER=qloo requires QLOO_API_KEY');
  const inner = createEvidenceProvider({
    env: mode === 'qloo' ? { QLOO_API_KEY: key } : {},
    fetchImpl: extra.fetchImpl,
  });
  return adaptEvidenceProvider(inner);
}
