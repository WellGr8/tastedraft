import assert from 'node:assert/strict';
import test from 'node:test';
import type { BriefV2 } from '@tastedraft/contracts';
import { chatWithPersona, enginePersonas, loadPersonas, mindChanges, normalizePersonaPayload } from './personas.ts';

const BRIEF: BriefV2 = {
  idea: 'A Bangkok streetwear brand launching in Tokyo',
  interests: [{ id: 'tag-streetwear', name: 'Streetwear', type: 'urn:tag' }],
  references: [
    {
      id: 'comme',
      name: 'Comme des Garçons',
      type: 'urn:entity:brand',
      source: 'sample',
      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Comme_des_Garcons_logo.svg/500px-Comme_des_Garcons_logo.svg.png',
    },
    { id: 'muji', name: 'Muji', type: 'urn:entity:brand', source: 'sample' },
    { id: 'aphex', name: 'Aphex Twin', type: 'urn:entity:artist', source: 'sample' },
  ],
  locations: [],
  city: 'Tokyo',
  age: '18–25',
  positioning: 'Independent',
  priceLevel: 2,
  constraints: [],
};

const score = async (brief: { age: string }) => (brief.age === '46+' ? 52 : brief.age === '36–45' ? 66 : 74);

const EMPTY_INSIGHTS = { artists: [], brands: [], places: [], dining: [], film: [] };

test('engine fallback is a measuring skeleton and does not copy brief references', async () => {
  const built = await enginePersonas({ brief: BRIEF, posture: 'accessible' }, score);
  assert.equal(built.source, 'engine');
  assert.ok(built.personas.length >= 3 && built.personas.length <= 4);
  const lead = built.personas.find((persona) => persona.label === 'Tokyo 18–25 sneakerhead');
  assert.ok(lead);
  assert.equal(lead.measuring, true);
  assert.equal(lead.anchors.length, 0);
  assert.equal(lead.fit, 0);
  assert.match(lead.interview, /Still measuring what this person actually likes/);
  assert.equal(JSON.stringify(built).includes('Comme des Garçons'), false);
  assert.equal(JSON.stringify(built).includes('example.invalid'), false);
});

test('a persona endpoint payload keeps distinct anchors and does not pad the brief', async () => {
  const remote = {
    mode: 'live',
    warnings: [],
    location: 'Tokyo',
    segments: [
      {
        id: 'seg-a',
        label: 'Tokyo 18-25 sneakerhead',
        demographics: { age: '24_and_younger', gender: 'female' },
        location: { query: 'Tokyo' },
        fit: 81,
        insights: {
          artists: [{ id: 'a1', name: 'Paper Coast', type: 'urn:entity:artist', affinity: 0.4, image: 'https://images.example.com/paper.jpg' }],
          brands: [{ id: 'b1', name: 'Studio Slot', type: 'urn:entity:brand', affinity: 0.62 }],
          places: [{ id: 'p1', name: 'Koenji Echo', type: 'urn:entity:place', affinity: 0.2, image: 'https://example.invalid/koenji.jpg' }],
          dining: [],
          film: [{ id: 'f1', name: 'Night Market', type: 'urn:entity:movie', affinity: 0.1 }],
        },
      },
      {
        id: 'seg-b',
        label: 'Tokyo 26–35 listener',
        age: '26–35',
        location: 'Tokyo',
        fit: 70,
        insights: {
          artists: [
            { id: 'a1', name: 'Paper Coast', type: 'urn:entity:artist', affinity: 0.5 },
            { id: 'a2', name: 'Shimokitazawa Static', type: 'urn:entity:artist', affinity: 0.28 },
          ],
          brands: [{ id: 'b1', name: 'Studio Slot', type: 'urn:entity:brand', affinity: 0.4 }],
          places: [{ id: 'p1', name: 'Koenji Echo', type: 'urn:entity:place', affinity: 0.3 }],
          dining: [{ id: 'd1', name: 'Yaowarat Grill', type: 'urn:entity:place', affinity: 0.33 }],
          film: [],
        },
      },
      {
        id: 'seg-c',
        label: 'Tokyo 36–45 regular',
        age: '36–45',
        location: 'Tokyo',
        fit: 61,
        anchors: [
          { name: 'Yaowarat Grill', type: 'urn:entity:place' },
          { name: 'Maa Kai Yang', type: 'urn:entity:brand', affinity: null },
          { name: 'Boat Noodle Lamp', type: 'urn:entity:brand', affinity: 0.2 },
        ],
      },
    ],
  };
  const normalized = normalizePersonaPayload(remote, BRIEF);
  assert.ok(normalized);
  assert.equal(normalized.source, 'endpoint');
  assert.equal(normalized.personas.length, 3);
  assert.equal(normalized.personas[0]?.fit, 81);
  assert.equal(normalized.personas[0]?.age, '18–25');
  assert.deepEqual(
    normalized.personas[0]?.anchors.map((anchor) => anchor.name),
    ['Paper Coast', 'Studio Slot', 'Koenji Echo'],
  );
  assert.equal(normalized.personas[0]?.anchors[0]?.image, 'https://images.example.com/paper.jpg');
  assert.equal(normalized.personas[0]?.anchors[2]?.image, undefined);
  assert.equal(normalized.personas[0]?.anchors[1]?.affinity, 0.62);
  assert.match(normalized.personas[0]?.interview ?? '', /I'd try it\. It sits next to Paper Coast and Studio Slot/);
  assert.deepEqual(
    normalized.personas[1]?.anchors.map((anchor) => anchor.name),
    ['Shimokitazawa Static', 'Yaowarat Grill'],
  );
  assert.deepEqual(
    normalized.personas[2]?.anchors.map((anchor) => anchor.name),
    ['Maa Kai Yang', 'Boat Noodle Lamp'],
  );
  assert.match(normalized.personas[2]?.interview ?? '', /Not for me\. Maa Kai Yang and Boat Noodle Lamp are my taste/);
  assert.equal(JSON.stringify(normalized).includes('Comme des Garçons'), false);
  assert.equal(JSON.stringify(normalized).includes('example.invalid'), false);

  let url = '';
  let sent: { location?: string; posture?: string; scarcity?: string; audiences?: unknown[] } = {};
  const fetched = await loadPersonas(
    { brief: BRIEF, posture: 'accessible', scarcity: 'limited' },
    score,
    async (input, init) => {
      url = String(input);
      sent = JSON.parse(String(init?.body)) as typeof sent;
      return new Response(JSON.stringify(remote), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  );
  assert.match(url, /\/api\/persona$/);
  assert.equal(sent.location, 'Tokyo');
  assert.equal(sent.posture, undefined);
  assert.equal(sent.scarcity, undefined);
  assert.ok(Array.isArray(sent.audiences) && sent.audiences.length >= 3 && sent.audiences.length <= 4);
  assert.equal(fetched.source, 'endpoint');
  assert.equal(fetched.personas[0]?.label, 'Tokyo 18-25 sneakerhead');
});

test('empty insights stay measuring skeletons', async () => {
  const remote = {
    location: 'Tokyo',
    mode: 'live',
    warnings: ['Tokyo 18–25 sneakerhead / artists: HTTP 500'],
    segments: [1, 2, 3].map((index) => ({
      id: `empty-${index}`,
      label: `Tokyo person ${index}`,
      location: 'Tokyo',
      age: '18–25',
      insights: EMPTY_INSIGHTS,
    })),
  };
  const normalized = normalizePersonaPayload(remote, BRIEF);
  assert.ok(normalized);
  assert.ok(normalized.personas.every((persona) => persona.measuring && persona.anchors.length === 0));
  assert.match(normalized.personas[0]?.interview ?? '', /Still measuring/);
});

test('unscored anchors take their fit from the engine', async () => {
  const remote = {
    location: 'Tokyo',
    mode: 'live',
    warnings: [],
    segments: [
      {
        id: 'a',
        label: 'Tokyo 18–25 sneakerhead',
        location: 'Tokyo',
        age: '18–25',
        insights: {
          artists: [{ id: '1', name: 'Harbor Static', type: 'urn:entity:artist', affinity: 0.4 }],
          brands: [{ id: '2', name: 'Night Stall', type: 'urn:entity:brand', affinity: 0.5 }],
          places: [],
          dining: [],
          film: [],
        },
      },
      {
        id: 'b',
        label: 'Tokyo 26–35 listener',
        location: 'Tokyo',
        age: '36–45',
        insights: {
          artists: [{ id: '3', name: 'Second Artist', type: 'urn:entity:artist', affinity: 0.2 }],
          brands: [],
          places: [{ id: '4', name: 'Second Place', type: 'urn:entity:place', affinity: 0.2 }],
          dining: [],
          film: [],
        },
      },
      {
        id: 'c',
        label: 'Tokyo 46+ regular',
        location: 'Tokyo',
        age: '46+',
        insights: {
          artists: [],
          brands: [],
          places: [],
          dining: [{ id: '5', name: 'Late Table', type: 'urn:entity:place', affinity: 0.2 }],
          film: [{ id: '6', name: 'Late Reel', type: 'urn:entity:movie', affinity: 0.2 }],
        },
      },
    ],
  };
  const fetched = await loadPersonas({ brief: BRIEF }, score, async () => new Response(JSON.stringify(remote), { status: 200 }));
  assert.equal(fetched.personas[0]?.fit, 74);
  assert.equal(fetched.personas[0]?.rejects, false);
  assert.equal(fetched.personas[1]?.fit, 66);
  assert.equal(fetched.personas[1]?.rejects, true);
  assert.equal(fetched.personas[2]?.fit, 52);
  assert.match(fetched.personas[1]?.interview ?? '', /Not for me/);
});

test('a missing persona route falls back to measuring skeletons', async () => {
  const fetched = await loadPersonas({ brief: BRIEF }, score, async () => new Response('nope', { status: 404 }));
  assert.equal(fetched.source, 'engine');
  assert.ok(fetched.personas.some((persona) => persona.label === 'Tokyo 18–25 sneakerhead'));
  assert.ok(fetched.personas.every((persona) => persona.measuring));
});

test('offline persona chat answers in the question language and does not repeat', async () => {
  const built = await enginePersonas({ brief: BRIEF }, score);
  const persona = {
    ...built.personas[0]!,
    measuring: false,
    anchors: [
      {
        id: 'billie',
        name: 'Billie Eilish',
        type: 'urn:entity:artist',
        affinity: 0.72,
        provenance: 'qloo',
      },
    ],
  };
  const missing = async () => new Response('missing', { status: 404 });
  const why = await chatWithPersona(persona, 'ทำไมไม่สนใจ', missing);
  const added = await chatWithPersona(persona, 'แล้วถ้าเราเพิ่มมาละ', missing, '', [
    { role: 'persona', content: why.say },
  ]);
  const again = await chatWithPersona(persona, 'ทำไมไม่สนใจ', missing, '', [
    { role: 'persona', content: why.say },
    { role: 'user', content: 'แล้วถ้าเราเพิ่มมาละ' },
    { role: 'persona', content: added.say },
  ]);
  assert.match(why.say, /Billie Eilish/);
  assert.match(why.say, /[\u0E00-\u0E7F]/);
  assert.match(added.say, /เพิ่ม/);
  assert.notEqual(why.say, added.say);
  assert.notEqual(why.say, again.say);
  assert.notEqual(added.say, again.say);
});

test('persona chat and re-interview stay on measured changes', async () => {
  const built = await enginePersonas({ brief: BRIEF }, score);
  const persona = built.personas[0]!;
  const reply = await chatWithPersona(persona, 'why would you reject this?', async () => new Response('missing', { status: 404 }));
  assert.match(reply.say, /Still measuring what this person actually likes/);
  assert.equal(reply.say.includes('Engine fit'), false);
  const flipped = built.personas.map((item, index) => (index === 0 ? { ...item, rejects: !item.rejects, fit: 80 } : item));
  assert.equal(mindChanges(built.personas, flipped).length, 1);
  assert.equal(mindChanges(built.personas, built.personas).length, 0);
});
