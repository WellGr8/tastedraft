import { referenceFromEntity, withCity } from './entity.js';
import { facetsInIdea } from './facets.js';
import type { MusicBrainzProvider } from './musicbrainz.js';
import type { OsmProvider } from './osm.js';
import { buildPacket, limitedNumber } from './packet.js';
import { normalizeName } from './resolve.js';
import { evidenceSignal } from './signal.js';
import type {
  Brief,
  EvidencePacket,
  EvidenceProvider,
  ResolveContext,
  ResolvedEntity,
} from './types.js';
import type { WikidataProvider } from './wikidata.js';

/**
 * Wikidata, then MusicBrainz for artists Wikidata already typed or missed,
 * then OpenStreetMap counts for the brief city.
 * A same-named MusicBrainz person does not retype a Wikidata brand, film, or place.
 */
export class FallbackProvider implements EvidenceProvider {
  readonly id = 'open-data';

  constructor(
    private readonly wikidata: WikidataProvider,
    private readonly musicbrainz: MusicBrainzProvider,
    private readonly osm: OsmProvider,
  ) {}

  async resolveEntities(refs: readonly string[], context?: ResolveContext): Promise<ResolvedEntity[]> {
    const fromWikidata = await this.wikidata.resolveEntities(refs, context);
    const mbSlots: number[] = [];
    fromWikidata.forEach((entity, index) => {
      const artist = entity.status === 'found' && entity.type.value === 'Artist';
      const missed = entity.resolution === 'none' || entity.resolution === 'http';
      if (artist || missed) mbSlots.push(index);
    });
    const mbRefs = mbSlots.flatMap((index) => {
      const query = refs[index];
      return query === undefined ? [] : [query];
    });
    const fromMusicBrainz = mbRefs.length ? await this.musicbrainz.resolveEntities(mbRefs, context) : [];
    return fromWikidata.map((entity, index) => {
      const slot = mbSlots.indexOf(index);
      if (slot < 0) return entity;
      const music = fromMusicBrainz[slot];
      if (!music) return entity;
      if (entity.status === 'found' && entity.type.value === 'Artist' && music.status === 'found') {
        return mergeArtist(entity, music);
      }
      if ((entity.resolution === 'none' || entity.resolution === 'http') && music.status === 'found') {
        return { ...music, query: entity.query };
      }
      return entity;
    });
  }

  async getEvidence(brief: Brief): Promise<EvidencePacket> {
    const facets = facetsInIdea(brief.idea);
    const entities = await this.resolveEntities(brief.refs, { city: brief.city });
    const local = await this.osm.localSignals(brief.city);
    const refs = entities.map((entity) => {
      const ranked = [...entity.labels].sort((a, b) => (entity.measurements[b] ?? 0) - (entity.measurements[a] ?? 0));
      const ref = referenceFromEntity({ ...entity, labels: ranked }, facets, brief.city);
      const city = (brief.city ?? '').trim().toLowerCase();
      if (!city || entity.status !== 'found') return ref;
      const located = entity.locatedIn.find((label) => label.toLowerCase() === city);
      if (!located) return ref;
      return withCity(
        ref,
        evidenceSignal({
          value: located,
          source: 'wikidata:P131',
          status: 'found',
          detail: `A source label matches the brief city “${brief.city}”.`,
          url: entity.url ?? undefined,
        }),
        evidenceSignal({
          value: true,
          source: 'wikidata:P131',
          status: 'found',
          detail: `“${located}” matches the brief city.`,
          url: entity.url ?? undefined,
        }),
      );
    });
    return buildPacket({
      sourceId: 'open-data',
      brief,
      facets,
      refs,
      localBase: limitedNumber(
        'osm:overpass',
        'OpenStreetMap POI counts are in local.signals. They are not copied into local.base, because that field is an indie-district affinity in the sample packet.',
      ),
      audienceBase: limitedNumber(
        'open-data',
        'Wikidata, MusicBrainz, and OpenStreetMap have no age-band taste data.',
      ),
      localSignals: local.signals,
      extraSignals: refs.flatMap((ref) => {
        const electronic = ref.entity.measurements.electronic;
        if (ref.entity.status !== 'found' || typeof electronic !== 'number') return [];
        return [{
          id: `musicbrainz.tag.${ref.entity.id}.electronic`,
          domain: 'facet',
          name: `${ref.name} electronic tag votes`,
          value: electronic,
          source: 'musicbrainz:artist.lookup',
          status: 'found' as const,
          detail: 'MusicBrainz tag vote count for “electronic”. Not a 0–100 taste affinity.',
          url: ref.entity.url ?? undefined,
        }];
      }),
    });
  }
}

function mergeArtist(wikidata: ResolvedEntity, musicbrainz: ResolvedEntity): ResolvedEntity {
  if (normalizeName(wikidata.name ?? '') !== normalizeName(musicbrainz.name ?? '')) return wikidata;
  const labels = [...new Set([...wikidata.labels, ...musicbrainz.labels])];
  return {
    ...wikidata,
    labels,
    measurements: { ...wikidata.measurements, ...musicbrainz.measurements },
    source: 'wikidata+musicbrainz',
    type: {
      ...wikidata.type,
      source: 'wikidata:P106+musicbrainz:artist.lookup',
      detail: `${wikidata.type.detail} MusicBrainz genre tags were added and were not turned into affinities.`,
    },
  };
}
