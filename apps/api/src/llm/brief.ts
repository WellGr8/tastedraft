import { BriefSchema, type Brief, type BriefForm } from './schemas.ts';

type ReferenceType = Brief['references'][number]['type'];

const FACET_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const POSTURES: ReadonlyArray<readonly [string, string]> = [
  ['accessible premium', 'Accessible premium'],
  ['independent', 'Independent'],
  ['premium', 'Premium'],
  ['mass', 'Mass'],
  ['luxury', 'Luxury'],
];

const KNOWN_REFERENCE_TYPES: Record<string, ReferenceType> = {
  'comme des garcons': 'brand',
  'comme des garçons': 'brand',
  muji: 'brand',
  'aphex twin': 'artist',
  'lost in translation': 'film',
  'silver lake': 'place',
};

export function slugFacet(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function inferReferenceType(name: string): ReferenceType {
  const key = name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return KNOWN_REFERENCE_TYPES[name.trim().toLowerCase()] ?? KNOWN_REFERENCE_TYPES[key] ?? 'other';
}

export function canonicalPositioning(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const known = POSTURES.find(([needle]) => needle === trimmed.toLowerCase());
  return known ? known[1] : trimmed;
}

export function canonicalizeBrief(input: Brief): Brief {
  const facets: string[] = [];
  for (const facet of input.facets) {
    const slug = FACET_SLUG.test(facet) ? facet : slugFacet(facet);
    if (!slug || facets.includes(slug)) continue;
    facets.push(slug);
  }
  const brief: Brief = {
    productType: input.productType.trim().replace(/\s+/g, ' ').toLowerCase(),
    facets,
    audience: {
      age: input.audience.age.trim(),
      description: input.audience.description.trim(),
    },
    city: input.city.trim(),
    references: input.references.map((reference) => ({
      name: reference.name.trim(),
      type: reference.type,
    })),
    positioning: canonicalPositioning(input.positioning),
    constraints: input.constraints.map((constraint) => ({
      kind: constraint.kind,
      text: constraint.text.trim().replace(/\s+/g, ' '),
    })),
  };
  return BriefSchema.parse(brief);
}

export function overlayForm(brief: Brief, form: BriefForm): Brief {
  const next: Brief = {
    ...brief,
    audience: { ...brief.audience },
    references: brief.references.map((reference) => ({ ...reference })),
    constraints: brief.constraints.map((constraint) => ({ ...constraint })),
    facets: brief.facets.slice(),
  };
  const age = form.age?.trim();
  const city = form.city?.trim();
  const positioning = (form.positioning ?? form.pos)?.trim();
  const names = form.references ?? form.refs;
  if (age) next.audience.age = age;
  if (city) next.city = city;
  if (positioning) next.positioning = canonicalPositioning(positioning);
  const interests = form.interests?.trim();
  if (interests && !next.audience.description.includes(interests)) {
    next.audience.description = [next.audience.description, interests].filter(Boolean).join(' ').slice(0, 400);
  }
  if (names) {
    next.references = names.map((name) => {
      const found = brief.references.find((reference) => reference.name.toLowerCase() === name.toLowerCase());
      return { name: name.trim(), type: found?.type ?? inferReferenceType(name) };
    });
  }
  return BriefSchema.parse(next);
}

export function isFacetToken(value: string): boolean {
  return FACET_SLUG.test(value);
}
