import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGES,
  CITY_NAMES,
  DEFAULT_BRIEF,
  DEFAULT_IDEA,
  FRICTION_FACTOR,
  POS,
  SUBS1,
  SUBS2,
  WEIGHTS,
  deriveSubs,
  displayScore,
  evidenceKey,
  ledgerPoints,
  provideEvidence,
} from './index.ts';

function brief(over: Record<string, unknown> = {}) {
  return { ...DEFAULT_BRIEF, applied: false, ...over };
}

function score(over: Record<string, unknown> = {}) {
  const packet = provideEvidence(brief(over));
  const subs = deriveSubs(packet);
  const points = ledgerPoints(subs);
  return { subs, points, packet };
}

describe('deterministic engine', () => {
  test('weights, friction factor, and rounded rows', () => {
    assert.deepEqual(WEIGHTS, { anchor: 30, cross: 25, local: 20, audience: 25 });
    assert.equal(FRICTION_FACTOR, 0.4);
    const points = ledgerPoints(SUBS1);
    assert.equal(points.anchor + points.cross + points.local + points.audience + points.friction, points.total);
  });

  test('default brief scores 71 and the applied proposal scores 82', () => {
    const v1 = score();
    assert.deepEqual(v1.subs, SUBS1);
    assert.deepEqual(v1.points, { anchor: 24, cross: 20, local: 15, audience: 17, friction: -5, total: 71 });
    assert.equal(
      v1.points.anchor + v1.points.cross + v1.points.local + v1.points.audience + v1.points.friction,
      71,
    );

    const v2 = score({ applied: true });
    assert.deepEqual(v2.subs, SUBS2);
    assert.deepEqual(v2.points, { anchor: 24, cross: 20, local: 18, audience: 22, friction: -2, total: 82 });
    assert.equal(v2.packet.posture, 'accessible');
    assert.equal(v2.packet.scarcity, 'preorder');
  });

  test('explicit posture and scarcity match the applied proposal', () => {
    const viaFlag = score({ applied: true });
    const viaFields = score({ posture: 'accessible', scarcity: 'preorder' });
    assert.deepEqual(viaFields.subs, viaFlag.subs);
    assert.deepEqual(viaFields.points, viaFlag.points);
    assert.equal(viaFields.points.total, 82);
  });

  test('city, age, positioning, references, and idea move the score', () => {
    const base = score().points.total;
    assert.equal(base, 71);
    for (const city of CITY_NAMES) {
      if (city === 'Los Angeles') continue;
      assert.notEqual(score({ city }).points.total, base, city);
    }
    const losAngeles = score({ city: 'Los Angeles' }).points.total;
    const quiet = { pos: 'Independent', posture: 'Independent', scarcity: 'none', age: '26–35' };
    const quietLa = score({ ...quiet, city: 'Los Angeles' }).points.total;
    for (const city of ['Bangkok', 'Seoul', 'New York', 'Lisbon']) {
      assert.notEqual(score({ city }).points.total, losAngeles, city);
      assert.notEqual(score({ ...quiet, city }).points.total, quietLa, `${city} independent`);
    }
    assert.notEqual(score({ city: 'Bangkok' }).points.total, score({ city: 'Lisbon' }).points.total);
    assert.notEqual(score({ city: 'Seoul' }).points.total, score({ city: 'Bangkok' }).points.total);
    assert.equal(score({ city: 'Tokyo' }).points.total, losAngeles);
    assert.equal(score({ city: 'NYC' }).points.total, score({ city: 'New York' }).points.total);
    for (let i = 1; i < AGES.length; i++) {
      assert.notEqual(score({ age: AGES[i] }).points.total, base, AGES[i]);
    }
    for (const pos of POS) {
      if (pos === 'Premium') continue;
      assert.notEqual(score({ pos }).points.total, base, pos);
    }
    const refs = [...DEFAULT_BRIEF.refs];
    for (const name of refs) {
      assert.notEqual(score({ refs: refs.filter((r) => r !== name) }).points.total, base, name);
    }
    assert.notEqual(score({ refs: refs.concat(['Nike']) }).points.total, base, 'add Nike');
    assert.notEqual(score({ refs: ['Muji'] }).points.total, base, 'mute to one');
    assert.notEqual(
      score({ idea: 'Organic dog food subscription for retirees in the suburbs' }).points.total,
      base,
    );
    assert.notEqual(score({ idea: 'Japanese minimal homeware for quiet apartments' }).points.total, base);
    assert.notEqual(
      score({
        idea: 'Japanese minimalist streetwear with an underground electronic identity, sold at a premium price',
      }).points.total,
      base,
    );
    assert.notEqual(score({ idea: 'An underground electronic club night' }).points.total, base);
  });

  test('interests do not change the score', () => {
    assert.equal(score({ interests: 'galleries' }).points.total, 71);
  });

  test('evidence strength and LIMITED rounding', () => {
    assert.equal(
      evidenceKey(4) + evidenceKey(3) + evidenceKey(2) + evidenceKey(1) + evidenceKey(0),
      'HIGHMEDIUMMEDIUMLIMITEDLIMITED',
    );
    const full = displayScore(71, 5);
    assert.deepEqual(full, { text: '71', why: 'Why 71?', limited: false, approx: 71 });

    const one = score({ refs: ['Muji'] });
    const shown = displayScore(one.points.total, 1);
    assert.equal(shown.limited, true);
    assert.equal(shown.why, 'Why ' + shown.text + '?');
    assert.equal(shown.text, '\u2248 ' + shown.approx);
    assert.equal(shown.approx, Math.round(one.points.total / 5) * 5);
    assert.equal(one.points.anchor + one.points.cross + one.points.local + one.points.audience + one.points.friction, one.points.total);
  });

  test('default signals, source labels, and local band', () => {
    const v1 = score();
    const v2 = score({ applied: true });
    assert.ok(v1.packet.signal.fashion != null && v1.packet.signal.fashion >= 75);
    assert.ok(v1.packet.signal.music != null && v1.packet.signal.music >= 75);
    assert.ok(v1.packet.signal.design != null && v1.packet.signal.design >= 75);
    assert.ok(v1.subs.local >= 55 && v1.subs.local < 75);
    assert.ok(v2.subs.local >= 75);
    assert.equal(v1.packet.sourceId, 'sample');
    const nike = score({ refs: ['Nike', 'Uniqlo'] });
    assert.equal(nike.packet.sourceId, 'inferred');
    assert.equal(DEFAULT_IDEA.length > 0, true);
  });
});
