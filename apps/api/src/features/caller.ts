import type { FeatureName, FeatureSseEvent } from '@tastedraft/contracts';
import type { QlooCallOptions, QlooInsightsParams, QlooResult, QlooSearchParams } from '../providers/qloo/client.ts';
import { QlooClient } from '../providers/qloo/client.ts';
import { QlooGateway } from '../runner/gateway.ts';
import { assertInsightParams, assertSearchParams } from './params.ts';

export interface FeatureCaller {
  readonly mode: 'live' | 'mock';
  calls: number;
  budget: number;
  insights(params: QlooInsightsParams, init?: QlooCallOptions): Promise<QlooResult>;
  search(params: QlooSearchParams, init?: QlooCallOptions): Promise<QlooResult>;
}

export interface FeatureRun {
  caller: FeatureCaller;
  budget: number;
  warnings: string[];
  emit: (event: FeatureSseEvent) => void;
}

export function redact(message: string): string {
  return message.replace(/hack_[a-z0-9]+/gi, '[redacted]').slice(0, 240);
}

export function openCaller(client: QlooClient, budget: number, sleep?: (ms: number) => Promise<void>): FeatureCaller {
  const gateway = new QlooGateway(client, {
    budget,
    concurrency: 2,
    backoffMs: 250,
    attempts: 3,
    ...(sleep ? { sleep } : {}),
  });
  return {
    mode: gateway.mode,
    get calls() {
      return gateway.calls;
    },
    set calls(value: number) {
      gateway.calls = value;
    },
    budget,
    insights: (params, init) => gateway.insights(params, init),
    search: (params, init) => gateway.search(params, init),
  };
}

export function metaOf(run: FeatureRun, cached = false): {
  mode: 'live' | 'mock';
  cached: boolean;
  qlooCalls: number;
  budget: number;
  warnings: string[];
} {
  return {
    mode: run.caller.mode,
    cached,
    qlooCalls: cached ? 0 : run.caller.calls,
    budget: run.budget,
    warnings: [...run.warnings],
  };
}

function note(run: FeatureRun, feature: FeatureName, message: string): void {
  const clean = redact(message);
  run.warnings.push(clean);
  run.emit({ type: 'warning', feature, message: clean });
}

export async function callInsights(
  run: FeatureRun,
  feature: FeatureName,
  label: string,
  detail: string,
  params: QlooInsightsParams,
): Promise<QlooResult | null> {
  assertInsightParams(params);
  if (run.caller.calls >= run.caller.budget) {
    note(run, feature, 'Qloo call budget exhausted');
    return null;
  }
  run.emit({ type: 'step', feature, label, detail });
  const result = await run.caller.insights(params);
  if (!result.ok) note(run, feature, result.message);
  return result;
}

export async function callSearch(
  run: FeatureRun,
  feature: FeatureName,
  label: string,
  detail: string,
  params: QlooSearchParams,
): Promise<QlooResult | null> {
  assertSearchParams(params);
  if (run.caller.calls >= run.caller.budget) {
    note(run, feature, 'Qloo call budget exhausted');
    return null;
  }
  run.emit({ type: 'step', feature, label, detail });
  const result = await run.caller.search(params);
  if (!result.ok) note(run, feature, result.message);
  return result;
}
