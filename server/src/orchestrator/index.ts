import type { EvidenceProvider } from '../domain/evidence-provider.ts';
import type { LlmClient } from '../domain/llm.ts';
import type { ProjectRepository } from '../domain/repository.ts';
import { createEngineLlm } from '../wiring/llm.ts';
import { createConfiguredProvider } from '../wiring/provider.ts';
import { Orchestrator } from './orchestrator.ts';

export interface OrchestratorDeps {
  repository: ProjectRepository;
  /** Defaults to createConfiguredProvider(): sample, fallback, or qloo. */
  provider?: EvidenceProvider;
  /** Defaults to the score-free interpreter in server/src/llm. */
  llm?: LlmClient;
  ids?: () => string;
  now?: () => string;
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  return new Orchestrator(
    deps.repository,
    deps.provider ?? createConfiguredProvider(),
    deps.llm ?? createEngineLlm(),
    deps.ids,
    deps.now,
  );
}

export { Orchestrator } from './orchestrator.ts';
export { createSampleEvidenceProvider } from './stubs/sample-evidence-provider.ts';
export { createStubLlm } from './stubs/stub-llm.ts';
