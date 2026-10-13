/** Status of one measured, or deliberately unmeasured, evidence value. */
export const SIGNAL_STATUSES = ['found', 'limited', 'ambiguous', 'failed'] as const;

export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

/**
 * One evidence value. `value` is null whenever this source cannot support
 * the number or label. Ambiguous and failed signals never carry a value.
 */
export interface EvidenceSignal<T> {
  value: T;
  /** Provider id and the endpoint or property the value was read from. */
  source: string;
  status: SignalStatus;
  /** What was actually returned. A proxy says so here. */
  detail: string;
  url?: string;
  /**
   * True when the JSON path is not in the official response example this
   * package checked. Callers must not treat that number as a stable contract.
   */
  unverifiedField?: boolean;
}

export function evidenceSignal<T>(input: EvidenceSignal<T>): EvidenceSignal<T> {
  if (!input.source.trim()) throw new Error('Evidence signal is missing a source');
  if (!input.detail.trim()) throw new Error(`Evidence signal from ${input.source} is missing a detail`);
  if (!SIGNAL_STATUSES.includes(input.status)) {
    throw new Error(`Unknown signal status from ${input.source}`);
  }
  if ((input.status === 'ambiguous' || input.status === 'failed') && input.value != null) {
    throw new Error(
      `Refusing a ${input.status} signal from ${input.source} that still carries a value`,
    );
  }
  return input;
}

export function isSignalStatus(value: unknown): value is SignalStatus {
  return typeof value === 'string' && (SIGNAL_STATUSES as readonly string[]).includes(value);
}
