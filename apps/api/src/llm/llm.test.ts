import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyChangeSet, applyCritique } from './apply.ts';
import { type ChatMessage, type LlmClient } from './client.ts';
import { critique } from './critique.ts';
import { ChangeApplyError, FormValidationError, LlmValidationError } from './errors.ts';
import { explain } from './explain.ts';
import { evidenceFromSamplePacket } from './normalize.ts';
import { parseBrief } from './parseBrief.ts';
import { CRITIQUE_SYSTEM_PROMPT, EXPLAIN_SYSTEM_PROMPT, PARSE_BRIEF_SYSTEM_PROMPT, repairUserPrompt } from './prompts.ts';
import { BriefSchema, CritiqueResultSchema, ExplainResultSchema, type Brief } from './schemas.ts';
import { findNovelNumbers, redactScores } from './scores.ts';
import { extractJson, formatZod, MAX_LLM_ATTEMPTS } from './validate.ts';

const IDEA =
  'Japanese minimalist streetwear with an underground electronic identity, sold at a premium price in limited runs';

const FORM = {
  age: '18–25',
  city: 'Los Angeles',
  pos: 'Premium',
  refs: ['Comme des Garçons', 'Muji', 'Aphex Twin', 'Lost in Translation', 'Silver Lake'],
  interests: 'design',
};

function brief(over: Partial<Brief> = {}): Brief {
  return {
    productType: 'streetwear',
    facets: ['japanese', 'minimal', 'streetwear', 'electronic'],
    audience: { age: '18–25', description: '' },
    city: 'Los Angeles',
    references: [
      { name: 'Muji', type: 'brand' },
      { name: 'Aphex Twin', type: 'artist' },
    ],
    positioning: 'Premium',
    constraints: [
      { kind: 'price', text: 'premium price' },
      { kind: 'scarcity', text: 'limited runs' },
    ],
    ...over,
  };
}

const EVIDENCE = {
  sourceId: 'sample',
  items: [
    {
      id: 'posture:price',
      kind: 'posture',
      label: 'Price posture',
      detail: 'The brief posture is Premium.',
      polarity: 'friction' as const,
    },
    {
      id: 'scarcity:run',
      kind: 'scarcity',
      label: 'Limited-run exclusivity',
      detail: 'Scarcity posture is limited.',
      polarity: 'friction' as const,
    },
    {
      id: 'facet:japanese',
      kind: 'facet',
      label: 'japanese',
      detail: 'The concept names the facet japanese.',
      polarity: 'fit' as const,
    },
  ],
};

function scripted(responses: string[]) {
  const seen: ChatMessage[][] = [];
  let calls = 0;
  const client: LlmClient = {
    mode: 'live',
    async complete(messages) {
      seen.push(messages);
      const index = Math.min(calls, responses.length - 1);
      calls += 1;
      return responses[index] ?? '';
    },
  };
  return { client, seen, get calls() { return calls; } };
}

function explainBody(id: string) {
  return {
    prose: `หลักฐาน:\n[${id}] คำให้การจากหลักฐาน\nอนุมาน:\nแนวนี้สอดคล้องกับคำให้การ [${id}]`,
    evidence: [{ evidenceId: id, statement: 'คำให้การจากหลักฐาน' }],
    inferences: [{ text: 'แนวนี้สอดคล้องกับคำให้การ', evidenceRefs: [id] }],
    fits: [{ text: 'japanese', evidenceRefs: [id] }],
    frictions: [{ text: 'ท่าทีราคา', why: 'เพราะหลักฐานชี้ว่าท่าทีราคาตึงกับกลุ่มนี้', evidenceRefs: [id] }],
  };
}

function proposalBody() {
  return {
    status: 'proposals',
    proposals: [
      {
        field: 'positioning',
        before: 'Premium',
        after: 'Accessible premium',
        why: 'ท่าทีราคาขัดกับหลักฐาน',
        evidenceRefs: ['posture:price'],
        limitations: 'ไม่ได้วัดการรับของกลุ่มเป้าหมาย',
      },
    ],
  };
}

describe('prompts and score redaction', () => {
  it('keeps digits out of the system prompts', () => {
    for (const prompt of [PARSE_BRIEF_SYSTEM_PROMPT, EXPLAIN_SYSTEM_PROMPT, CRITIQUE_SYSTEM_PROMPT, repairUserPrompt('extra keys')]) {
      assert.doesNotMatch(prompt, /\d/);
    }
    assert.match(PARSE_BRIEF_SYSTEM_PROMPT, /productType/);
    assert.match(EXPLAIN_SYSTEM_PROMPT, /หลักฐาน/);
    assert.match(EXPLAIN_SYSTEM_PROMPT, /frictions/);
    assert.match(CRITIQUE_SYSTEM_PROMPT, /needs more evidence/);
    assert.match(CRITIQUE_SYSTEM_PROMPT, /evidenceRefs/);
    assert.equal(MAX_LLM_ATTEMPTS, 3);
  });

  it('redacts score-shaped text and keeps age spans', () => {
    assert.equal(redactScores('affinity 86 and age 18–25'), 'and age 18–25');
    assert.equal(redactScores('about 71/100 now'), 'about now');
    assert.equal(redactScores('age 46+'), 'age 46+');
    assert.equal(findNovelNumbers('resonance 71', new Set(['18', '25'])), 'output contains a number that was not in the brief or the evidence');
    assert.equal(findNovelNumbers('ages 18–25', new Set(['18', '25'])), null);
  });

  it('formats schema failures without echoing bounds', () => {
    const parsed = BriefSchema.safeParse({ ...brief(), city: 'x'.repeat(120), score: 71 });
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.doesNotMatch(formatZod(parsed.error), /\d/);
  });
});

describe('parseBrief', () => {
  it('builds a deterministic brief offline from the idea and the form', async () => {
    const first = await parseBrief(IDEA, FORM, { env: {} });
    const second = await parseBrief(IDEA, FORM, { env: {} });
    assert.deepEqual(first, second);
    assert.equal(first.productType, 'streetwear');
    assert.deepEqual(first.facets, ['japanese', 'minimal', 'streetwear', 'electronic']);
    assert.deepEqual(first.audience, { age: '18–25', description: 'design' });
    assert.equal(first.city, 'Los Angeles');
    assert.equal(first.positioning, 'Premium');
    assert.deepEqual(first.references.map((reference) => reference.type), ['brand', 'brand', 'artist', 'film', 'place']);
    assert.deepEqual(first.constraints, [
      { kind: 'price', text: 'premium price' },
      { kind: 'scarcity', text: 'limited runs' },
    ]);
    assert.equal(JSON.stringify(first).includes('score'), false);
  });

  it('reads city, age, and posture from the idea when the form is empty', async () => {
    const parsed = await parseBrief('Premium Japanese streetwear in Los Angeles for ages 18-25, limited', {}, { env: {} });
    assert.equal(parsed.city, 'Los Angeles');
    assert.equal(parsed.audience.age, '18–25');
    assert.equal(parsed.positioning, 'Premium');
    assert.deepEqual(parsed.facets, ['japanese', 'streetwear']);
    assert.equal(parsed.constraints.length, 2);
  });

  it('does not call the network when no key is set', async () => {
    const parsed = await parseBrief('hi', {}, {
      env: {},
      fetchImpl: async () => {
        throw new Error('network');
      },
    });
    assert.equal(parsed.productType, 'concept');
  });

  it('rejects an unknown form field before calling a model', async () => {
    const llm = scripted(['{}']);
    await assert.rejects(
      () => parseBrief('hi', { pos: 'Premium', extra: 'nope' } as never, { client: llm.client }),
      FormValidationError,
    );
    assert.equal(llm.calls, 0);
  });

  it('retries a bounded number of times, then accepts a valid brief and keeps the form authoritative', async () => {
    const valid = {
      productType: 'Streetwear',
      facets: ['Japanese'],
      audience: { age: '18–25', description: 'from the model' },
      city: 'Paris',
      references: [
        { name: 'Nike', type: 'brand' },
        { name: 'Muji', type: 'brand' },
      ],
      positioning: 'Luxury',
      constraints: [{ kind: 'price', text: 'premium price' }],
    };
    const llm = scripted(['{"score":71}', '```json\n' + JSON.stringify(valid) + '\n```']);
    const parsed = await parseBrief(IDEA, { age: '18–25', city: 'Austin', pos: 'Premium', refs: ['Muji'], interests: 'quiet' }, { client: llm.client });
    assert.equal(llm.calls, 2);
    assert.equal(parsed.city, 'Austin');
    assert.equal(parsed.audience.age, '18–25');
    assert.equal(parsed.positioning, 'Premium');
    assert.equal(parsed.productType, 'streetwear');
    assert.deepEqual(parsed.facets, ['japanese']);
    assert.deepEqual(parsed.references, [{ name: 'Muji', type: 'brand' }]);
    assert.match(parsed.audience.description, /quiet/);
    assert.equal('score' in parsed, false);
  });

  it('stops at three invalid responses', async () => {
    const llm = scripted(['nope', 'still nope', '{', '{"score":1}']);
    await assert.rejects(() => parseBrief('hi', {}, { client: llm.client }), (error: unknown) => {
      assert.ok(error instanceof LlmValidationError);
      assert.equal(error.attempts, 3);
      return true;
    });
    assert.equal(llm.calls, 3);
  });

  it('honors a lower attempt cap', async () => {
    const llm = scripted(['nope', JSON.stringify(brief())]);
    await assert.rejects(() => parseBrief('hi', {}, { client: llm.client, maxAttempts: 1 }), LlmValidationError);
    assert.equal(llm.calls, 1);
  });

  it('posts an OpenAI-compatible chat completion', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const valid = {
      productType: 'object',
      facets: [],
      audience: { age: 'unspecified', description: '' },
      city: 'unspecified',
      references: [],
      positioning: 'unspecified',
      constraints: [],
    };
    await parseBrief('a quiet object', {}, {
      env: { LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://llm.example/v1/', LLM_MODEL: 'demo-model' },
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }), { status: 200 });
      },
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, 'https://llm.example/v1/chat/completions');
    const headers = seen[0]?.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(String(seen[0]?.init.body));
    assert.equal(body.model, 'demo-model');
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].content, PARSE_BRIEF_SYSTEM_PROMPT);
    assert.doesNotMatch(JSON.stringify(body), /test-key/);
  });
});

describe('explain', () => {
  it('writes Thai prose that separates evidence from inference and cites ids', async () => {
    const result = await explain(EVIDENCE, { total: 71, anchor: 24, cross: 20, local: 15, audience: 17, friction: -5, evidenceStrength: 'HIGH' }, { env: {} });
    assert.match(result.prose, /หลักฐาน/);
    assert.match(result.prose, /อนุมาน/);
    assert.ok(result.inferences.length > 0);
    assert.ok(result.fits.length > 0);
    assert.ok(result.frictions.length > 0);
    const ids = new Set(EVIDENCE.items.map((item) => item.id));
    for (const claim of [...result.inferences, ...result.fits, ...result.frictions]) {
      assert.ok(claim.evidenceRefs.every((id) => ids.has(id)));
      for (const id of claim.evidenceRefs) assert.match(result.prose, new RegExp(`\\[${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`));
    }
    for (const friction of result.frictions) assert.ok(friction.why.length > 0);
    const blob = JSON.stringify(result);
    assert.doesNotMatch(blob, /\b71\b/);
    assert.doesNotMatch(blob, /\b24\b/);
    assert.equal(ExplainResultSchema.safeParse({ ...result, score: 71 }).success, false);
  });

  it('stays inside the prose limit for long evidence text', async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `facet:${'x'.repeat(60)}${index === 0 ? '' : 'y'.repeat(index)}`,
      kind: 'facet',
      label: 'l'.repeat(150),
      detail: 'd'.repeat(400),
      polarity: index < 4 ? 'fit' as const : 'friction' as const,
    }));
    const result = await explain({ items }, { evidenceStrength: 'HIGH', total: 99 }, { env: {} });
    assert.ok(result.prose.length <= 2500);
    assert.doesNotMatch(result.prose, /99/);
  });

  it('retries when a claim cites an unknown id or a score', async () => {
    const llm = scripted([
      JSON.stringify({ ...explainBody('facet:japanese'), score: 82 }),
      JSON.stringify(explainBody('missing')),
      JSON.stringify(explainBody('facet:japanese')),
    ]);
    const result = await explain(EVIDENCE, { total: 71, evidenceStrength: 'HIGH' }, { client: llm.client });
    assert.equal(llm.calls, 3);
    assert.equal(result.fits[0]?.evidenceRefs[0], 'facet:japanese');
    const user = llm.seen[0]?.[1]?.content ?? '';
    assert.equal(JSON.parse(user).ledger.total, undefined);
    assert.doesNotMatch(user, /71/);
    assert.deepEqual(JSON.parse(user).ledger.dimensions, ['anchor', 'cross', 'local', 'audience', 'friction']);
    assert.equal(llm.seen[0]?.[0]?.content, EXPLAIN_SYSTEM_PROMPT);
  });

  it('explains an empty packet without calling the model', async () => {
    const llm = scripted(['{}']);
    const result = await explain({ items: [] }, undefined, { client: llm.client });
    assert.equal(llm.calls, 0);
    assert.match(result.prose, /หลักฐาน/);
    assert.deepEqual(result.fits, []);
    assert.deepEqual(result.frictions, []);
  });
});

describe('critique', () => {
  it('proposes an applicable change set offline and does not echo ledger numbers', async () => {
    const source = brief();
    const result = await critique(source, EVIDENCE, { evidenceStrength: 'HIGH', total: 71, anchor: 24 }, { env: {} });
    assert.equal(result.status, 'proposals');
    if (result.status !== 'proposals') return;
    const next = applyChangeSet(source, result.proposals);
    assert.equal(next.positioning, 'Accessible premium');
    assert.equal(next.constraints.find((constraint) => constraint.kind === 'scarcity')?.text, 'independent pre-order drops');
    assert.equal(next.city, source.city);
    assert.equal(source.positioning, 'Premium');
    assert.equal(applyCritique(source, result).positioning, 'Accessible premium');
    const blob = JSON.stringify(result);
    assert.doesNotMatch(blob, /\b71\b/);
    assert.doesNotMatch(blob, /\b24\b/);
    for (const change of result.proposals) {
      assert.ok(change.limitations.length > 0);
      assert.ok(change.evidenceRefs.length > 0);
    }
  });

  it('returns needs more evidence for a limited ledger without calling the model', async () => {
    const llm = scripted([JSON.stringify(proposalBody())]);
    const result = await critique(brief(), EVIDENCE, { evidenceStrength: 'LIMITED', total: 70 }, { client: llm.client });
    assert.equal(llm.calls, 0);
    assert.equal(result.status, 'needs more evidence');
    if (result.status === 'needs more evidence') assert.match(result.reason, /หลักฐาน/);
    assert.equal(applyCritique(brief(), result).positioning, 'Premium');
  });

  it('returns needs more evidence when nothing in the packet can change the brief', async () => {
    const result = await critique(
      brief(),
      {
        items: [
          { id: 'facet:japanese', kind: 'facet', label: 'japanese', detail: 'The concept names the facet japanese.', polarity: 'fit' },
          { id: 'facet:minimal', kind: 'facet', label: 'minimal', detail: 'The concept names the facet minimal.', polarity: 'fit' },
        ],
      },
      { evidenceStrength: 'MEDIUM' },
      { env: {} },
    );
    assert.equal(result.status, 'needs more evidence');
  });

  it('accepts a model refusal and retries a change that does not apply', async () => {
    const refusal = { status: 'needs more evidence', reason: 'ยังชี้จุดแก้ไม่ได้', missing: ['a grounded price friction'] };
    const bad = proposalBody();
    bad.proposals[0]!.before = 'Luxury';
    const llm = scripted([JSON.stringify(bad), JSON.stringify(refusal)]);
    const refused = await critique(brief(), EVIDENCE, { evidenceStrength: 'HIGH', total: 71 }, { client: llm.client });
    assert.equal(refused.status, 'needs more evidence');
    assert.equal(llm.calls, 2);
    assert.equal(llm.seen[0]?.[0]?.content, CRITIQUE_SYSTEM_PROMPT);
    assert.equal(JSON.parse(llm.seen[0]?.[1]?.content ?? '').ledger.total, undefined);
    assert.doesNotMatch(llm.seen[0]?.[1]?.content ?? '', /71/);

    const again = scripted([JSON.stringify(bad), JSON.stringify(proposalBody())]);
    const proposed = await critique(brief(), EVIDENCE, { evidenceStrength: 'HIGH' }, { client: again.client });
    assert.equal(proposed.status, 'proposals');
    if (proposed.status === 'proposals') {
      assert.equal(applyChangeSet(brief(), proposed.proposals).positioning, 'Accessible premium');
    }
  });

  it('rejects a change whose before value is not on the brief', () => {
    assert.throws(
      () => applyChangeSet(brief(), [{
        field: 'positioning',
        before: 'Luxury',
        after: 'Mass',
        why: 'เพราะหลักฐาน',
        evidenceRefs: ['posture:price'],
        limitations: 'ยังไม่พอ',
      }]),
      ChangeApplyError,
    );
  });
});

describe('sample evidence adapter', () => {
  it('turns a scored packet into qualitative items with stable ids and no digits', () => {
    const packet = evidenceFromSamplePacket({
      sourceId: 'sample',
      facets: ['japanese', 'minimal'],
      refs: [{ name: 'Comme des Garçons', type: 'Brand', provenance: 'sample', city: '' }],
      domains: [{ type: 'Brand', affinity: 80 }],
      local: { base: 86, penalty: 10 },
      audience: { base: 84, penalty: 20 },
      friction: 12,
      posture: 'Premium',
      scarcity: 'limited',
      signal: { fashion: 90, music: 88, design: 70 },
    });
    assert.equal(packet.sourceId, 'sample');
    assert.ok(packet.items.some((item) => item.id === 'ref:comme-des-garcons'));
    assert.doesNotMatch(JSON.stringify(packet), /\d/);
    assert.ok(packet.items.some((item) => item.polarity === 'friction'));
    assert.ok(packet.items.some((item) => item.polarity === 'fit'));
  });
});

describe('json extraction', () => {
  it('reads a fenced object', () => {
    const extracted = extractJson('```json\n{"city":"Austin"}\n```');
    assert.equal(extracted.ok, true);
    if (extracted.ok) assert.deepEqual(extracted.value, { city: 'Austin' });
  });
});

describe('output schemas', () => {
  it('reject score fields', () => {
    assert.equal(BriefSchema.safeParse({ ...brief(), score: 1 }).success, false);
    assert.equal(CritiqueResultSchema.safeParse({ status: 'needs more evidence', reason: 'บาง', missing: [], total: 71 }).success, false);
  });
});
