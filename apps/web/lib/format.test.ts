import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entityMeta, humanProposalLabel, paramName } from './labels.ts';
import { applySpelling, spellSuggestions } from './spell.ts';

describe('human proposal labels', () => {
  it('reads a price drop as a sentence', () => {
    const label = humanProposalLabel('filter.price_level.max', '3', '2');
    assert.equal(label, 'Lower price level 3 → 2');
    assert.equal(label.includes('filter.price_level'), false);
  });

  it('raises a price level when the number goes up', () => {
    assert.equal(humanProposalLabel('filter.price_level.min', '1', '3'), 'Raise price level 1 → 3');
  });

  it('names the other Qloo keys in plain language', () => {
    assert.equal(humanProposalLabel('signal.demographics.age', '35_and_under', '36_to_55'), 'Change age 35_and_under → 36_to_55');
    assert.equal(humanProposalLabel('filter.location.query', 'Los Angeles', 'Silver Lake'), 'Change location Los Angeles → Silver Lake');
    assert.equal(paramName('signal.interests.entities'), 'references');
    assert.equal(humanProposalLabel('not.a.known.key', 'a', 'b').includes('not.a.known.key'), false);
  });
});

describe('entity meta', () => {
  it('names the city once', () => {
    const line = entityMeta({ name: 'Silver Lake', type: 'urn:entity:place', city: 'Los Angeles' });
    assert.equal(line, 'Place · Los Angeles');
    assert.equal(line.split('Los Angeles').length - 1, 1);
  });

  it('drops the city when the name already is that city', () => {
    assert.equal(entityMeta({ name: 'Los Angeles', type: 'urn:entity:place', city: 'Los Angeles' }), 'Place');
    assert.equal(entityMeta({ name: 'Muji', type: 'urn:entity:brand' }), 'Brand');
  });
});

describe('spellcheck', () => {
  it('suggests a close dictionary word', () => {
    const hits = spellSuggestions('sold as streatwear');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.to, 'streetwear');
    assert.equal(applySpelling('sold as streatwear', hits[0]!), 'sold as streetwear');
  });

  it('leaves a correct idea alone', () => {
    assert.equal(spellSuggestions('Japanese minimalist streetwear').length, 0);
  });
});
