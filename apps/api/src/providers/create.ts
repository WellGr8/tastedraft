import { TtlCache } from './cache.js';
import { FallbackProvider } from './fallback.js';
import { createHttpClient, DEFAULT_CACHE_TTL_MS, DEFAULT_TIMEOUT_MS } from './http.js';
import { MusicBrainzProvider } from './musicbrainz.js';
import { OsmProvider } from './osm.js';
import { QlooProvider } from './qloo.js';
import type { EvidenceProvider } from './types.js';
import { WikidataProvider } from './wikidata.js';

export interface CreateProviderOptions {
  /** Defaults to `process.env`. Pass `{}` in tests so a developer key is not picked up. */
  env?: { QLOO_API_KEY?: string };
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

/**
 * Qloo when `QLOO_API_KEY` is set. Otherwise the open-data fallback.
 * Qloo numbers are not filled in with POI counts or genre-tag votes.
 */
export function createEvidenceProvider(options: CreateProviderOptions = {}): EvidenceProvider {
  const env = options.env ?? process.env;
  const apiKey = typeof env.QLOO_API_KEY === 'string' ? env.QLOO_API_KEY.trim() : '';
  const http = createHttpClient({
    fetchImpl: options.fetchImpl,
    cache: new TtlCache(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (apiKey) return new QlooProvider({ apiKey, http });
  return new FallbackProvider(
    new WikidataProvider({ http }),
    new MusicBrainzProvider(http),
    new OsmProvider(http),
  );
}
