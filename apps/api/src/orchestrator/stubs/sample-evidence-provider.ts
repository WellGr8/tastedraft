import type { EvidenceProvider } from '../../domain/evidence-provider.ts';
import { provideEvidence } from '../../engine/index.ts';

/**
 * In-repo sample provider so the API can run before `server/src/providers` lands.
 *
 * TODO(providers): delete this wiring once `server/src/providers` exports an
 * EvidenceProvider. The replacement must implement getEvidence(brief) and
 * return the EvidencePacket shape. Leave provideEvidence() in the engine as
 * the calibration fixture (default brief 71, applied proposal 82).
 */
export function createSampleEvidenceProvider(): EvidenceProvider {
  return {
    id: 'sample',
    async getEvidence(brief) {
      return provideEvidence(brief);
    },
  };
}
