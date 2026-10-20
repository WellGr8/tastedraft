/**
 * Offline persona lines used when the language model is unavailable.
 * The same sentence is never returned twice in one conversation.
 * Entity names stay exactly as Qloo wrote them.
 */
import { stripEntityIds } from './launch.ts';

export type PersonaReplyKind = 'why' | 'change' | 'price' | 'where' | 'mind' | 'other';
export type PersonaReplyLanguage = 'en' | 'th';

export interface OfflinePersonaRequest {
  message: string;
  history?: ReadonlyArray<{ role: 'user' | 'persona'; content: string }>;
  persona: {
    location?: string;
    anchors: ReadonlyArray<{ name: string; type?: string; affinity?: number | null }>;
  };
  context?: { idea?: string };
}

function readable(value: string): string {
  return stripEntityIds(value).replace(/^simulated persona response\.?\s*/i, '').trim();
}

/** Thai script in the question means the reply is Thai. Entity names are not translated. */
export function replyLanguage(message: string): PersonaReplyLanguage {
  return /[\u0E00-\u0E7F]/.test(message) ? 'th' : 'en';
}

export function questionKind(message: string): PersonaReplyKind {
  const text = message.toLowerCase();
  if (/เปลี่ยนใจ|อะไรจะทำให้/.test(message) || /change (your|my) mind|what would (it take|change)|convince/.test(text)) return 'mind';
  if (/ราคา|แพง|ค่าใช้จ่าย/.test(message) || /\b(price|prices|cost|costs|expensive|cheap|afford)\b/.test(text)) return 'price';
  if (/ที่ไหน|ย่าน|ทำเล/.test(message) || /\b(where|neighborhood|neighbourhood|district|location)\b/.test(text)) return 'where';
  if (
    /เพิ่ม|ถ้าเรา|ถ้าเกิด|ถ้าเพิ่ม/.test(message)
    || /what if|if we (add|change|include|put|swap)|what happens if/.test(text)
  ) return 'change';
  if (/ทำไม|ไม่สนใจ/.test(message) || /\bwhy\b/.test(text)) return 'why';
  return 'other';
}

function normalizedReply(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?…]+$/g, '');
}

function sameReply(left: string, right: string): boolean {
  const a = normalizedReply(left);
  const b = normalizedReply(right);
  return a.length > 0 && a === b;
}

function categoryOf(type: string | undefined): string {
  const raw = readable(type ?? '');
  if (!raw) return '';
  const tail = raw.split(':').filter(Boolean).pop() ?? raw;
  return tail.replace(/_/g, ' ').trim();
}

function linesFor(
  kind: PersonaReplyKind,
  language: PersonaReplyLanguage,
  detail: { name: string; cited: string; lead: string; subject: string; location: string },
): string[] {
  const { name, cited, lead, subject, location } = detail;
  if (language === 'th') {
    if (kind === 'why') {
      return [
        `ฉันไม่สนใจ ${subject} เพราะ ${lead} คือรสนิยมที่ฉันมีอยู่แล้ว`,
        `เหตุผลคือ ${name} ${subject} ยังไม่เข้ากับรสนิยมนั้น`,
        `ฉันเลือก ${name} อยู่แล้ว เลยข้าม ${subject}`,
      ];
    }
    if (kind === 'price') {
      return [
        `ราคาคือเหตุที่ฉันลังเลกับ ${subject} ฉันจ่ายให้ ${name} อยู่แล้ว และอันนี้ไม่คุ้มเท่า`,
        `ฉันยอมจ่ายให้ ${name} ${subject} ขอเงินที่ฉันใช้ไปกับอันนั้นแล้ว`,
        `ค่าใช้จ่ายคือจุดที่สะดุดของ ${subject} ${name} คือสิ่งที่ฉันกันงบไว้แล้ว`,
      ];
    }
    if (kind === 'where') {
      return [
        `ฉันจะหา ${subject} ในที่ที่ ${name} อยู่แล้ว แถว ${location}`,
        `รอบ ${location} ฉันเริ่มจาก ${name} แล้วค่อยมองหา ${subject}`,
        `${location} คือที่ที่ฉันจะลอง ${subject} บล็อกเดียวกับ ${name}`,
      ];
    }
    if (kind === 'change') {
      return [
        `ถ้าเราเพิ่ม ${name} เข้ามาใน ${subject} ฉันจะมองอีกที ตอนนี้มันยังแยกจากรสนิยมนั้น`,
        `ถ้าเปลี่ยน ${subject} ให้ใกล้ ${name} นั่นคือเวอร์ชันที่ฉันจะลอง`,
        `เพิ่ม ${name} แล้วฉันจะคิดเรื่อง ${subject} ใหม่ ถ้าไม่เพิ่ม ฉันอยู่ที่เดิม`,
      ];
    }
    if (kind === 'mind') {
      return [
        `สิ่งที่จะเปลี่ยนใจฉันเรื่อง ${subject} คือเวอร์ชันที่อยู่ข้าง ${name}`,
        `ฉันจะคิดใหม่เรื่อง ${subject} ถ้ามันคุ้นเหมือน ${name}`,
        `วาง ${subject} ข้าง ${name} แล้วฉันจะดูอีกครั้ง`,
      ];
    }
    return [
      `ฉันจะไปกับ ${subject} ก็ต่อเมื่อมันให้ความรู้สึกเหมือน ${name} ฉันตัดสินจาก ${cited}`,
      `${name} คือวิธีที่ฉันตัดสิน ${subject} นั่นคือรสนิยมที่ฉันเชื่อ`,
      `ฉันวัด ${subject} กับ ${name} ${cited} คือสิ่งที่ฉันรู้อยู่แล้ว`,
    ];
  }
  if (kind === 'why') {
    return [
      `I would pass on ${subject} because ${lead} is the taste I already keep.`,
      `The reason is ${name}. ${subject} does not sit next to that taste.`,
      `I keep choosing ${name}, so ${subject} is the thing I skip.`,
    ];
  }
  if (kind === 'price') {
    return [
      `The price is why I hesitate on ${subject}. I already spend on ${name}, and this does not earn the same money.`,
      `I would pay for ${name}. ${subject} asks for money I already spent there.`,
      `Cost is the snag on ${subject}. ${name} is what I already budget for.`,
    ];
  }
  if (kind === 'where') {
    return [
      `I would look for ${subject} where ${name} already shows up, around ${location}.`,
      `Around ${location}, I start from ${name} and only then look for ${subject}.`,
      `${location} is where I would try ${subject}, on the same block as ${name}.`,
    ];
  }
  if (kind === 'change') {
    return [
      `If we added ${name} to ${subject}, I would look twice. Right now it sits apart from that taste.`,
      `Changing ${subject} toward ${name} is the version I would actually try.`,
      `Add ${name} and I would reconsider ${subject}. Leave it out and I stay where I am.`,
    ];
  }
  if (kind === 'mind') {
    return [
      `What would change my mind about ${subject} is a version that belongs next to ${name}.`,
      `I would reconsider ${subject} if it felt as familiar as ${name}.`,
      `Put ${subject} beside ${name} and I would give it another look.`,
    ];
  }
  return [
    `I would go for ${subject} only if it felt like ${name}. I judge it from ${cited}.`,
    `${name} is how I decide on ${subject}. That is the taste I trust.`,
    `I measure ${subject} against ${name}. ${cited} is what I already know.`,
  ];
}

function priorPersonaLines(request: OfflinePersonaRequest): string[] {
  return (request.history ?? [])
    .filter((turn) => turn.role === 'persona')
    .map((turn) => readable(turn.content))
    .filter((line) => line.length > 0);
}

/** A first-person line for this question. A later turn in the same conversation gets a different sentence. */
export function offlinePersonaMessage(request: OfflinePersonaRequest): string {
  const anchors = [...request.persona.anchors].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)).slice(0, 3);
  const names = anchors.map((anchor) => readable(anchor.name) || 'that reference');
  const name = names[0] ?? 'that reference';
  const cited = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : name;
  const question = readable(request.message) || request.message;
  const language = replyLanguage(question);
  const top = anchors[0];
  const category = categoryOf(top?.type);
  const affinity = top?.affinity == null
    ? ''
    : language === 'th'
      ? `ค่าความชอบ ${top.affinity.toFixed(2)}`
      : `affinity ${top.affinity.toFixed(2)}`;
  const categoryBit = category ? (language === 'th' ? `ประเภท ${category}` : category) : '';
  const bits = [categoryBit, affinity].filter(Boolean).join(', ');
  const lead = bits ? `${name} (${bits})` : name;
  const idea = readable(request.context?.idea ?? '');
  const subject = idea ? idea.slice(0, 80) : 'this';
  const location = readable(request.persona.location ?? '') || 'this city';
  const pool = linesFor(questionKind(question), language, { name, cited, lead, subject, location });
  const prior = priorPersonaLines(request);
  const fresh = pool.find((line) => !prior.some((item) => sameReply(item, line)));
  if (fresh) return fresh;
  const turn = prior.length + 1;
  const base = pool[(turn - 1) % pool.length] ?? pool[0] ?? '';
  const tail = replyLanguage(question) === 'th'
    ? `ฉันยังตอบจาก ${name} รอบที่ ${turn}`
    : `I am still answering from ${name}, turn ${turn}.`;
  return `${base} ${tail}`;
}
