import type { Brief, EvidencePacket } from '../engine/types.ts';

/**
 * Evidence boundary. Implementations live in `server/src/providers/`
 * (owned by the provider workstream).
 *
 * TODO(providers): export a class or factory whose getEvidence(brief) returns
 * an EvidencePacket, then pass it to createOrchestrator. Do not fold affinity
 * math into the provider — deriveSubs() and ledgerPoints() stay in the engine.
 */
export interface EvidenceProvider {
  /** Stored on the evidence snapshot. Example: "sample" or "qloo". */
  readonly id: string;
  getEvidence(brief: Brief): Promise<EvidencePacket>;
}
