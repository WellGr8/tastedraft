/**
 * Live Qloo city-entry probe.
 * Run from apps/api so .env.local loads. Prints derived fields only.
 * Refuses to run without a key, and does not fall back to the sample graph.
 */
import '../src/load-env.ts';
import { QlooClient } from '../src/providers/qloo/client.ts';
import { BACKTEST_CASES } from '../src/backtest/cases.ts';
import { formatProbe, probeCase } from '../src/backtest/live.ts';

const key = process.env.QLOO_API_KEY?.trim() ?? '';
if (!key) {
  console.error('QLOO_API_KEY is not set. This backtest does not fall back to the sample graph.');
  process.exit(1);
}

const client = new QlooClient({ apiKey: key, retries: 2, minIntervalMs: 250 });
console.log('brand\tcity\toutcome\tentity\tplaces\tmedian place affinity\theatmap in city\tmedian heat\tdemographics');
for (const row of BACKTEST_CASES) {
  const result = await probeCase(client, row);
  console.log(formatProbe(result));
}
console.log('');
console.log('Affinities are Qloo measurements for places and heatmap cells in the city that was asked.');
console.log('They are not a cultural resonance score and not a forecast of whether the store stayed.');
