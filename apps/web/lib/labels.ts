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
  if (lower.includes('brand')) return 'Brand';
  if (lower.includes('artist')) return 'Artist';
  if (lower.includes('movie') || lower.includes('film')) return 'Film';
  if (lower.includes('place') || lower.includes('destination') || lower.includes('locality')) return 'Place';
  if (lower.includes('tag')) return 'Tag';
  return 'Reference';
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
