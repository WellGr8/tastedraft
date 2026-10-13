import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'brief-model.js'), 'utf8');
const td = new Function(src + `
  return {
    tdNorm, tdTypeLabel, tdDisambiguate, tdSuggest, tdSpellSuggestions, tdApplySuggestion,
    tdMergeEntities, tdSuggestTags
  };
`)();

const DEFAULT_IDEA = 'Japanese minimalist streetwear with an underground electronic identity, sold at a premium price in limited runs';

const muji = [
  { id: 'person-muji', name: 'Muji', type: 'urn:entity:person', source: 'qloo' },
  { id: 'brand-muji', name: 'Muji', type: 'urn:entity:brand', image: 'https://example.invalid/muji.png', source: 'qloo' },
  { id: 'place-muji', name: 'Muji', type: 'urn:entity:place', city: 'Tokyo', source: 'qloo' },
];

assert.equal(td.tdDisambiguate(muji, { query: 'Muji' })[0].id, 'brand-muji');
assert.deepEqual(td.tdDisambiguate(muji, { query: 'Muji', type: 'brand' }).map((row) => row.id), ['brand-muji']);
assert.equal(td.tdTypeLabel('urn:entity:brand'), 'Brand');

const places = td.tdDisambiguate(
  [
    { id: 'lantern', name: 'Lantern Row', type: 'urn:entity:place', source: 'mock' },
    { id: 'tokyo', name: 'Lantern Tokyo', type: 'urn:entity:place', city: 'Tokyo', source: 'mock' },
  ],
  { query: 'Lantern', type: 'place', city: 'Los Angeles' },
);
assert.deepEqual(places.map((row) => row.id), ['lantern']);
assert.equal(places[0].city, 'Los Angeles');

const typed = td.tdSuggest('Muj', { kind: 'reference' });
assert.equal(typed[0].name, 'Muji');
assert.equal(td.tdTypeLabel(typed[0].type), 'Brand');
assert.ok(typed[0].image);
assert.equal(td.tdTypeLabel(typed[1].type), 'Person');

const lake = td.tdSuggest('silver', { kind: 'location', city: 'Los Angeles' });
assert.equal(lake[0].name, 'Silver Lake');
assert.equal(lake[0].city, 'Los Angeles');
assert.equal(td.tdSuggest('silver', { kind: 'location', city: 'New York' }).length, 0);
const east = td.tdSuggest('east', { kind: 'location', city: 'New York' });
assert.equal(east[0].name, 'Lower East Side');
assert.equal(east[0].city, 'New York');

assert.deepEqual(td.tdSpellSuggestions(DEFAULT_IDEA), []);
const typo = 'Japanese minimalist streewear drop';
const suggestions = td.tdSpellSuggestions(typo);
assert.equal(suggestions.length, 1);
assert.equal(suggestions[0].to, 'streetwear');
assert.equal(td.tdApplySuggestion(typo, suggestions[0]), 'Japanese minimalist streetwear drop');
assert.equal(td.tdSpellSuggestions('electonic night')[0].to, 'electronic');
assert.equal(td.tdSuggestTags('street')[0].name, 'streetwear');

const merged = td.tdMergeEntities(
  [{ id: 'remote', name: 'Muji', type: 'urn:entity:brand', source: 'qloo' }],
  typed,
);
assert.equal(merged.filter((row) => td.tdNorm(row.name) === 'muji' && td.tdTypeLabel(row.type) === 'Brand').length, 1);

console.log('ok brief-model');
