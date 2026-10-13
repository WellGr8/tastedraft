/** Sentences for a finished run. The screen does not show the enum. */
export function plainStopReason(reason: string | null | undefined): string {
  if (reason === 'approved_target') return 'This version already clears the target you set.';
  if (reason === 'insufficient_evidence') return 'There isn’t enough cultural evidence to recommend a change yet.';
  if (reason === 'no_meaningful_improvement') return 'Another change wouldn’t move the score in a useful way.';
  if (reason === 'max_rounds_or_budget') return 'This run has used its questions and is stopping here.';
  return reason?.trim() ?? '';
}

/** Human labels for Qloo parameter diffs. The screen never shows the raw key. */
const PARAM_NAMES: Record<string, string> = {
  'filter.price_level.max': 'price level',
  'filter.price_level.min': 'price level',
  'signal.interests.tags': 'positioning',
  'signal.demographics.age': 'age',
  'signal.demographics.gender': 'gender',
  'filter.location.query': 'location',
  'filter.tags': 'channel',
  'signal.interests.entities': 'references',
};

export function paramName(param: string): string {
  const known = PARAM_NAMES[param];
  if (known) return known;
  const cleaned = param
    .replace(/^(filter|signal)\./i, '')
    .replace(/\.(max|min)$/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'setting';
}

/** "Lower price level 3 → 2", never "filter.price_level.max". */
export function humanProposalLabel(param: string, from: string | null, to: string | null): string {
  const name = paramName(param);
  const left = from ?? 'none';
  const right = to ?? 'none';
  if (name === 'price level') {
    const start = Number(left);
    const end = Number(right);
    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      return `Lower price level ${left} → ${right}`;
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return `Raise price level ${left} → ${right}`;
    }
    return `Set price level ${left} → ${right}`;
  }
  return `Change ${name} ${left} → ${right}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turn an id, slug, or comma-separated list into words a person can read. */
export function plainToken(value: string | null | undefined, names?: ReadonlyMap<string, string>): string {
  if (!value?.trim()) return 'none';
  return value
    .split(',')
    .map((part) => named(part.trim(), names))
    .filter((part) => part.length > 0)
    .join(', ');
}

function named(token: string, names?: ReadonlyMap<string, string>): string {
  const bare = token.replace(/^ev:/i, '');
  const known = names?.get(token) ?? names?.get(bare) ?? names?.get(bare.toLowerCase());
  if (known) return known;
  if (UUID.test(bare)) return 'a measured reference';
  return bare.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The hypothesis sentence, without the evidence-id wrapper. */
export function plainHypothesis(why: string): string {
  const match = why.match(/Evidence-backed hypothesis \([^)]*\):\s*([\s\S]*?)\s*Supported by\s+.+$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  return why.replace(/\bev:[^\s,)]+/gi, 'measured evidence').trim();
}

export function plainEvidence(ids: readonly string[], names?: ReadonlyMap<string, string>): string {
  const labels: string[] = [];
  for (const id of ids) {
    const label = named(id, names);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.join(', ');
}

const COORDINATES = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+|^area\s+-?\d/i;

/** A map pin name. Coordinates stay out of the label. */
export function placeLabel(label: string | null | undefined, city: string): string {
  const text = label?.trim() ?? '';
  if (!text || COORDINATES.test(text)) return city.trim() || 'Nearby';
  return text;
}

const RAW_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A name safe to show on the card. Ids and coordinates become an empty string. */
export function showName(value: string, names?: ReadonlyMap<string, string>): string {
  const bare = value.replace(/^ev:/i, '').trim();
  const known = names?.get(value) ?? names?.get(bare) ?? names?.get(bare.toLowerCase());
  const text = (known ?? bare).trim();
  if (!text || RAW_ID.test(text) || COORDINATES.test(text)) return '';
  if (known) return known;
  return bare.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function traceSummary(input: {
  proposalCount: number;
  names: readonly string[];
  city?: string;
  heatmap: boolean;
  widened: boolean;
}): string {
  const cited = input.names.map((name) => name.trim()).filter(Boolean);
  const unique = cited.filter((name, index) => cited.indexOf(name) === index).slice(0, 4);
  const place = input.city?.trim() ?? '';
  const heat = input.heatmap ? (place ? `a heatmap of ${place}` : 'a district heatmap') : '';
  const evidence = joinAnd([...unique, heat]) || 'the cultural evidence on this brief';
  if (!input.proposalCount) return `No change to recommend from ${evidence}.`;
  const count = input.proposalCount === 1 ? 'One change' : `${input.proposalCount} changes`;
  return `${count}, backed by ${evidence}${input.widened ? ', after a wider search' : ''}.`;
}

export function joinAnd(items: readonly string[]): string {
  const list = items.map((item) => item.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

/** "Women aged 18–25 in Los Angeles would pass on this." */
export function passSentence(
  people: ReadonlyArray<{ rejects: boolean; age?: string; city?: string; gender?: string | null }>,
): string {
  const rejecting = people.filter((person) => person.rejects);
  if (!rejecting.length) return 'Nobody in this audience rejects it on the current evidence.';
  const byCity = new Map<string, string[]>();
  for (const person of rejecting) {
    const city = person.city?.trim() || 'this city';
    const who = person.gender === 'female' ? 'women' : person.gender === 'male' ? 'men' : 'people';
    const phrase = person.age?.trim() ? `${who} aged ${person.age.trim()}` : who;
    const group = byCity.get(city) ?? [];
    if (!group.includes(phrase)) group.push(phrase);
    byCity.set(city, group);
  }
  const parts = [...byCity.entries()].map(([city, group]) => `${joinAnd(group)} in ${city}`);
  const sentence = `${joinAnd(parts)} would pass on this.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function deltaText(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return '';
  return delta > 0 ? `+${delta}` : String(delta);
}

/** One line under the name. The city is included at most once, and never when the name already says it. */
export function entityMeta(entity: { name: string; type: string; city?: string }): string {
  const type = typeLabel(entity.type);
  const city = entity.city?.trim();
  if (!city) return type;
  const name = entity.name.trim().toLowerCase();
  const folded = city.toLowerCase();
  if (name === folded || name.includes(folded)) return type;
  return `${type} · ${city}`;
}

export function typeLabel(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes('videogame') || lower.includes('video_game')) return 'Game';
  if (lower.includes('tv_show') || lower.includes('tv show') || lower.includes('series')) return 'Series';
  if (lower.includes('podcast')) return 'Podcast';
  if (lower.includes('book')) return 'Book';
  if (lower.includes('person')) return 'Person';
  if (lower.includes('brand')) return 'Brand';
  if (lower.includes('artist')) return 'Artist';
  if (lower.includes('movie') || lower.includes('film')) return 'Film';
  if (lower.includes('destination')) return 'Destination';
  if (lower.includes('place') || lower.includes('locality')) return 'Place';
  if (lower.includes('tag')) return 'Tag';
  if (lower === 'artists') return 'Artist';
  if (lower === 'brands') return 'Brand';
  if (lower === 'places') return 'Place';
  if (lower === 'dining') return 'Dining';
  return 'Reference';
}

export function tasteVerb(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes('artist')) return 'Listen';
  if (lower.includes('brand')) return 'Wear';
  if (lower.includes('dining')) return 'Eat';
  if (lower.includes('destination')) return 'Visit';
  if (lower.includes('place')) return 'Go';
  if (lower.includes('tv') || lower.includes('film') || lower.includes('movie')) return 'Watch';
  if (lower.includes('book')) return 'Read';
  if (lower.includes('game')) return 'Play';
  if (lower.includes('podcast')) return 'Hear';
  if (lower.includes('person')) return 'Follow';
  return 'Also';
}

export function fitOf(type: string): 'logo' | 'circle' | 'cover' {
  const label = typeLabel(type);
  if (label === 'Brand') return 'logo';
  if (label === 'Artist') return 'circle';
  return 'cover';
}

export function strengthTone(strength: string | null | undefined): 'high' | 'medium' | 'low' {
  const value = (strength ?? '').toUpperCase();
  if (value === 'HIGH') return 'high';
  if (value === 'MEDIUM') return 'medium';
  return 'low';
}

export function providerLabel(provider: string | null | undefined, mode: string | null | undefined): string {
  const id = (provider || mode || 'sample').toLowerCase();
  if (id.includes('qloo') || id === 'live') return 'Qloo';
  if (id.includes('open')) return 'Open data';
  if (id.includes('infer')) return 'Inferred';
  return 'Sample data';
}
