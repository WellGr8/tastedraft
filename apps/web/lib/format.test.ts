import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entityMeta, humanProposalLabel, joinAnd, paramName, passSentence, placeLabel, plainEvidence, plainHypothesis, plainToken, showName, traceSummary } from './labels.ts';
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

describe('plain proposal copy', () => {
  const aphex = '4278382F-4991-4D63-B207-942D86A26ACB';
  const names = new Map<string, string>([
    [aphex.toLowerCase(), 'Aphex Twin'],
    ['comme-des-garcons', 'Comme des Garçons'],
    [`ev:${aphex}`, 'Aphex Twin'],
    ['ev:tag-japanese', 'Japanese'],
  ]);

  it('shows reference names instead of ids', () => {
    assert.equal(plainToken(aphex, names), 'Aphex Twin');
    assert.equal(plainToken(`${aphex},comme-des-garcons`, names), 'Aphex Twin, Comme des Garçons');
    assert.equal(plainToken(aphex).includes(aphex), false);
  });

  it('keeps the hypothesis and drops the evidence-id wrapper', () => {
    const why = `Evidence-backed hypothesis (ev:${aphex}): Adding Comme des Garçons gives this idea a second cultural anchor Supported by ev:${aphex}, ev:tag-japanese.`;
    assert.equal(plainHypothesis(why), 'Adding Comme des Garçons gives this idea a second cultural anchor');
    assert.equal(plainEvidence([`ev:${aphex}`, 'ev:tag-japanese'], names), 'Aphex Twin, Japanese');
  });
});

describe('audience and trace copy', () => {
  it('says who would pass, without a label dump', () => {
    const line = passSentence([
      { rejects: true, age: '18–25', city: 'Los Angeles', gender: null },
      { rejects: true, age: '18–25', city: 'Los Angeles', gender: 'female' },
      { rejects: true, age: '26–35', city: 'Los Angeles', gender: 'male' },
      { rejects: false, age: '36–45', city: 'Los Angeles', gender: 'male' },
    ]);
    assert.equal(line, 'People aged 18–25, women aged 18–25, and men aged 26–35 in Los Angeles would pass on this.');
    assert.equal(line.includes('Rejects it'), false);
    assert.equal(passSentence([]), 'Nobody in this audience rejects it on the current evidence.');
  });

  it('keeps ids and coordinates out of the summary', () => {
    assert.equal(placeLabel('34.10, -118.33', 'Los Angeles'), 'Los Angeles');
    assert.equal(placeLabel('Silver Lake', 'Los Angeles'), 'Silver Lake');
    const id = '4278382F-4991-4D63-B207-942D86A26ACB';
    const names = new Map<string, string>([[id.toLowerCase(), 'Aphex Twin'], ['tag-japanese', 'Japanese']]);
    assert.equal(showName(id, names), 'Aphex Twin');
    assert.equal(showName('34.10, -118.33', names), '');
    assert.equal(showName('rescue-ref-comme-des-garcons'), 'rescue ref comme des garcons');
    const summary = traceSummary({
      proposalCount: 1,
      names: [showName('Aphex Twin', names), showName('Japanese', names)].filter(Boolean),
      city: 'Los Angeles',
      heatmap: true,
      widened: true,
    });
    assert.equal(summary, 'One change, backed by Aphex Twin, Japanese, and a heatmap of Los Angeles, after a wider search.');
    assert.equal(summary.includes(id), false);
    assert.equal(summary.includes('34.10'), false);
    assert.equal(summary.includes('rescue-ref'), false);
    assert.equal(joinAnd(['Aphex Twin', 'Japanese']), 'Aphex Twin and Japanese');
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
