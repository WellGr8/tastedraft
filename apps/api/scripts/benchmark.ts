/**
 * Regenerate apps/web/public/benchmark.json.
 * Live when both QLOO_API_KEY and LLM_API_KEY are set.
 * Otherwise the recorded offline run, labeled as such.
 * Prints derived counts only. Never prints a key or a Qloo body.
 */
import { fileURLToPath } from 'node:url';
import '../src/load-env.ts';
import { createLlmClient, OPENROUTER_MODEL } from '../src/llm/client.ts';
import { QlooClient } from '../src/providers/qloo/client.ts';
import { QlooGateway } from '../src/runner/gateway.ts';
import { readPublishedStudies, buildRecordedBenchmark } from '../src/benchmark/recorded.ts';
import { runLiveBenchmark } from '../src/benchmark/live.ts';
import { BUDGET_CAP, writeBenchmark } from '../src/benchmark/publish.ts';

const studies = readPublishedStudies();
const now = new Date().toISOString();
const qlooKey = process.env.QLOO_API_KEY?.trim() ?? '';
const llmKey = process.env.LLM_API_KEY?.trim() ?? '';
const forceRecorded = process.env.BENCHMARK_RECORDED === '1';
const out = fileURLToPath(new URL('../../../apps/web/public/benchmark.json', import.meta.url));

const file = !forceRecorded && qlooKey && llmKey
  ? await runLiveBenchmark({
      gateway: new QlooGateway(
        new QlooClient({
          apiKey: qlooKey,
          retries: 0,
          minIntervalMs: 300,
          timeoutMs: 25_000,
          cacheDir: fileURLToPath(new URL('../data/qloo-cache/', import.meta.url)),
        }),
        { budget: BUDGET_CAP, backoffMs: 400, attempts: 2 },
      ),
      llm: createLlmClient(),
      studies,
      now,
      model: process.env.LLM_MODEL?.trim() || OPENROUTER_MODEL,
    })
  : await buildRecordedBenchmark({ studies, now });

writeBenchmark(file, out);
const missing = [
  qlooKey ? '' : 'QLOO_API_KEY',
  llmKey ? '' : 'LLM_API_KEY',
].filter(Boolean);
console.log(JSON.stringify({
  source: file.source,
  wrote: 'apps/web/public/benchmark.json',
  withQloo: file.headline.withQloo,
  withoutQloo: file.headline.withoutQloo,
  outcomeWithQloo: file.headline.outcomeWithQloo,
  outcomeWithoutQloo: file.headline.outcomeWithoutQloo,
  qlooCalls: file.qlooCalls,
  unverifiableNames: file.totals.qloo.unverifiableNames.length,
  ...(file.source === 'recorded' ? { missing: forceRecorded ? ['BENCHMARK_RECORDED=1'] : missing } : {}),
}));
