import assert from 'node:assert/strict';
import test from 'node:test';
import { capCompareLabels, compareSummary, rankCompare, saturationLabel, type CompareSignal } from './compare.ts';

function signal(partial: Partial<CompareSignal> & Pick<CompareSignal, 'id' | 'label'>): CompareSignal {
  return {
    fit: 70,
    local: 0.7,
    heatmap: 0.4,
    popularity: 0.4,
    saturation: 0.4,
    anchors: ['Billie Eilish'],
    risk: '',
    reason: '',
    personas: ['18–25'],
    ...partial,
  };
}

test('compare keeps at most five distinct options', () => {
  assert.deepEqual(capCompareLabels([' Tokyo ', 'Osaka', 'tokyo', 'Seoul', 'Taipei', 'Bangkok', 'Kyoto']), [
    'Tokyo',
    'Osaka',
    'Seoul',
    'Taipei',
    'Bangkok',
  ]);
});

test('sorts by score descending and gives every option a unique rank', () => {
  const cards = rankCompare([
    signal({ id: 'bangkok', label: 'Bangkok', fit: 51, local: 0.51, heatmap: 0.85, popularity: 0.79, saturation: 0.85 }),
    signal({ id: 'osaka', label: 'Osaka', fit: 52, local: 0.52, heatmap: 0.4, popularity: 0.42, saturation: 0.4 }),
    signal({ id: 'taipei', label: 'Taipei', fit: 52, local: 0.52, heatmap: 0.4, popularity: 0.42, saturation: 0.4 }),
    signal({ id: 'tokyo', label: 'Tokyo', fit: 52, local: 0.52, heatmap: 0.95, popularity: 0.95, saturation: 0.95 }),
    signal({ id: 'seoul', label: 'Seoul', fit: 48, local: 0.48, heatmap: 0.52, popularity: 0.45, saturation: 0.52 }),
  ]);
  const scores = cards.map((card) => card.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => (b ?? -1) - (a ?? -1)));
  assert.deepEqual(cards.map((card) => card.rank), [1, 2, 3, 4, 5]);
  assert.equal(new Set(cards.map((card) => card.rank)).size, cards.length);
  assert.equal(cards[0]?.label, 'Osaka');
  assert.equal(cards[1]?.label, 'Taipei');
  assert.ok((cards.find((card) => card.label === 'Osaka')?.score ?? 0) > (cards.find((card) => card.label === 'Tokyo')?.score ?? 0));
  assert.notEqual(cards[0]?.label, 'Tokyo');
  const osaka = cards.find((card) => card.label === 'Osaka');
  const taipei = cards.find((card) => card.label === 'Taipei');
  assert.equal(osaka?.score, taipei?.score);
  assert.ok((osaka?.rank ?? 0) < (taipei?.rank ?? 0));
});

test('best bet is the top non-crowded option and the safe market is a different crowded card', () => {
  const cards = rankCompare([
    signal({ id: 'tokyo', label: 'Tokyo', fit: 52, local: 0.82, popularity: 0.9, saturation: 0.8, heatmap: 0.8, anchors: ['Yohei Fukuda'] }),
    signal({ id: 'osaka', label: 'Osaka', fit: 52, local: 0.78, popularity: 0.45, saturation: 0.3, heatmap: 0.35, anchors: ['篠崎愛'] }),
    signal({ id: 'seoul', label: 'Seoul', fit: 60, local: 0.6, popularity: 0.5, saturation: 0.5, heatmap: 0.4, anchors: ['Peterpan Complex'] }),
  ]);
  assert.equal(cards[0]?.label, 'Osaka');
  assert.equal(cards[0]?.verdict, 'best-bet');
  assert.equal(cards.find((card) => card.label === 'Tokyo')?.verdict, 'safe-market');
  assert.notEqual(cards.find((card) => card.verdict === 'best-bet')?.id, cards.find((card) => card.verdict === 'safe-market')?.id);
  assert.ok((cards.find((card) => card.verdict === 'best-bet')?.rank ?? 9) <= 2);
  const summary = compareSummary(cards);
  assert.match(summary, /Best bet: Osaka/);
  assert.match(summary, /Safe big market: Tokyo/);
  assert.match(summary, /not crowded/);
  assert.match(cards.find((card) => card.label === 'Tokyo')?.reason ?? '', /crowded/i);
  assert.match(cards.find((card) => card.label === 'Osaka')?.reason ?? '', /篠崎愛/);
  assert.doesNotMatch(cards.map((card) => card.reason).join('\n'), /Not for me/);
  assert.equal(new Set(cards.map((card) => card.reason)).size, cards.length);
  assert.equal(saturationLabel(0.8), 'Crowded');
  assert.equal(saturationLabel(0.3), 'Room to enter');
  assert.equal(saturationLabel(null), 'Not measured');
});

test('a leading open market is the best bet and a lower crowded market stays the safe one', () => {
  const cards = rankCompare([
    signal({ id: 'osaka', label: 'Osaka', local: 0.9, heatmap: 0.5, popularity: 0.5, saturation: 0.4 }),
    signal({ id: 'tokyo', label: 'Tokyo', local: 0.4, heatmap: 0.9, popularity: 0.85, saturation: 0.9 }),
  ]);
  assert.equal(cards[0]?.label, 'Osaka');
  assert.equal(cards[0]?.rank, 1);
  assert.equal(cards[0]?.verdict, 'best-bet');
  assert.equal(cards[1]?.verdict, 'safe-market');
  assert.match(cards[0]?.reason ?? '', /fits/i);
  assert.match(compareSummary(cards), /leads the list/);
});
