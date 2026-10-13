export class FormValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormValidationError';
  }
}

export class EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceValidationError';
  }
}

export class LlmValidationError extends Error {
  readonly attempts: number;
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(`LLM response failed validation after ${reasons.length} attempt(s): ${reasons[reasons.length - 1] ?? 'unknown'}`);
    this.name = 'LlmValidationError';
    this.attempts = reasons.length;
    this.reasons = reasons;
  }
}

export class LlmTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmTransportError';
  }
}

export class ChangeApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeApplyError';
  }
}
