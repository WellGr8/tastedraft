import { tryApplyChangeSet } from './apply.ts';
import { canonicalPositioning, inferReferenceType } from './brief.ts';
import type { Brief, BriefForm, Change, CritiqueResult, EvidenceItem, EvidencePacket, ExplainResult, Ledger } from './schemas.ts';
import { presentedItems } from './normalize.ts';

const CITIES = ['Los Angeles', 'New York', 'San Francisco', 'Austin', 'Miami', 'Chicago', 'Seattle'];

const FACET_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['japanese', /japan|japanese|ญี่ปุ่น/i],
  ['minimal', /minimal|มินิมอล/i],
  ['streetwear', /street\s?wear|สตรีท/i],
  ['electronic', /electronic|underground|อิเล็กทรอนิก/i],
  ['independent', /independent|อินดี้/i],
  ['homeware', /homeware|home\s?ware|ของใช้ในบ้าน/i],
];

const PRODUCT_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['streetwear', /street\s?wear|สตรีท/i],
  ['homeware', /homeware|home\s?ware|ของใช้ในบ้าน/i],
  ['food', /food|อาหาร|dog food/i],
  ['campaign', /campaign|แคมเปญ/i],
  ['music', /album|club night|เพลง/i],
  ['film', /film|หนัง/i],
];

const KNOWN_REFERENCES = ['Comme des Garçons', 'Muji', 'Aphex Twin', 'Lost in Translation', 'Silver Lake'];

const AGE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['18–25', /18\s*[–-]\s*25|under 25|วัยรุ่น/i],
  ['26–35', /26\s*[–-]\s*35/i],
  ['36–45', /36\s*[–-]\s*45/i],
  ['46+', /46\+|over 46/i],
];

export function fallbackBrief(text: string, form: BriefForm): Brief {
  const idea = text.trim() || form.idea?.trim() || '';
  const facets: string[] = [];
  for (const [id, pattern] of FACET_RULES) {
    if (pattern.test(idea) && !facets.includes(id)) facets.push(id);
  }
  const product = PRODUCT_RULES.find(([, pattern]) => pattern.test(idea))?.[0] ?? (idea ? 'concept' : 'unspecified');
  const constraints: Brief['constraints'] = [];
  if (/premium|luxury|พรีเมียม|หรู|ราคาสูง/i.test(idea)) constraints.push({ kind: 'price', text: 'premium price' });
  if (/limited|exclusive|scarcity|ลิมิเต็ด|ขาดแคลน/i.test(idea)) constraints.push({ kind: 'scarcity', text: 'limited runs' });
  const named = KNOWN_REFERENCES.filter((name) => idea.toLowerCase().includes(name.toLowerCase()));
  const formNames = form.references ?? form.refs;
  const names = formNames ?? named;
  return {
    productType: product,
    facets,
    audience: {
      age: form.age?.trim() || AGE_RULES.find(([, pattern]) => pattern.test(idea))?.[0] || 'unspecified',
      description: form.interests?.trim() || '',
    },
    city: form.city?.trim() || CITIES.find((city) => idea.toLowerCase().includes(city.toLowerCase())) || 'unspecified',
    references: names.slice(0, 8).map((name) => ({ name: name.trim(), type: inferReferenceType(name) })),
    positioning: canonicalPositioning(
      (form.positioning ?? form.pos)?.trim() || detectPositioning(idea) || 'unspecified',
    ),
    constraints,
  };
}

function detectPositioning(idea: string): string {
  if (/accessible premium/i.test(idea)) return 'Accessible premium';
  if (/luxury|หรู/i.test(idea)) return 'Luxury';
  if (/premium|พรีเมียม/i.test(idea)) return 'Premium';
  if (/\bmass\b/i.test(idea)) return 'Mass';
  if (/independent|อินดี้/i.test(idea)) return 'Independent';
  return '';
}

export function fallbackExplain(packet: EvidencePacket, _ledger: Ledger): ExplainResult {
  const items = presentedItems(packet.items);
  const fits = items.filter((item) => polarityOf(item) === 'fit').slice(0, 3).map((item) => ({
    text: clip(item.label, 80),
    evidenceRefs: [item.id],
  }));
  const frictions = items.filter((item) => polarityOf(item) === 'friction').slice(0, 2).map((item) => ({
    text: clip(item.label, 80),
    why: clip(`เพราะ${item.label} ที่ระบุในหลักฐานสวนกับท่าทีของแนวคิด`, 240),
    evidenceRefs: [item.id],
  }));
  const cited = unique([
    ...fits.flatMap((fit) => fit.evidenceRefs),
    ...frictions.flatMap((friction) => friction.evidenceRefs),
  ]);
  const refs = cited.length > 0 ? cited : items.slice(0, 1).map((item) => item.id);
  const inferences = refs.length
    ? [{ text: clip(inferenceText(fits.map((fit) => fit.text), frictions.map((friction) => friction.text)), 500), evidenceRefs: refs }]
    : [];
  const evidence = unique(refs).map((id) => {
    const item = items.find((candidate) => candidate.id === id);
    return {
      evidenceId: id,
      statement: clip(`${item?.label ?? id}: ${item?.detail ?? 'ไม่มีรายละเอียดเชิงคุณภาพ'}`, 140),
    };
  });
  const prose = renderProse(evidence, inferences, fits, frictions);
  return { prose, evidence, inferences, fits, frictions };
}

function polarityOf(item: EvidenceItem): 'fit' | 'friction' | 'neutral' {
  if (item.polarity) return item.polarity;
  if (item.kind === 'friction') return 'friction';
  if (item.kind === 'facet' || item.kind === 'reference' || item.kind === 'domain') return 'fit';
  return 'neutral';
}

function inferenceText(fits: string[], frictions: string[]): string {
  const fitNames = fits.join(', ');
  const frictionNames = frictions.join(', ');
  if (fitNames && frictionNames) return `จากหลักฐานที่ยกมา แนวนี้เข้ากับ ${fitNames} แต่ยังสะดุดที่ ${frictionNames}`;
  if (fitNames) return `จากหลักฐานที่ยกมา แนวนี้เข้ากับ ${fitNames}`;
  if (frictionNames) return `จากหลักฐานที่ยกมา แนวนี้ยังสะดุดที่ ${frictionNames}`;
  return 'หลักฐานที่มีอยู่ยังบอกได้เพียงสิ่งที่ระบุไว้โดยตรง จึงยังไม่สรุปจุดที่เข้าหรือสะดุดเพิ่ม';
}

function renderProse(
  evidence: ExplainResult['evidence'],
  inferences: ExplainResult['inferences'],
  fits: ExplainResult['fits'],
  frictions: ExplainResult['frictions'],
): string {
  const lines = ['หลักฐาน:'];
  if (evidence.length === 0) lines.push('ยังไม่มีรายการหลักฐานให้ยึด');
  for (const note of evidence) lines.push(`[${note.evidenceId}] ${note.statement}`);
  lines.push('อนุมาน:');
  if (inferences.length === 0) {
    lines.push('ยังไม่มีหลักฐานให้ยึด จึงไม่สรุปความเข้ากันหรือจุดสะดุด');
  }
  for (const inference of inferences) {
    lines.push(`${inference.text} ${inference.evidenceRefs.map((id) => `[${id}]`).join('')}`);
  }
  if (fits.length > 0) lines.push(`จุดที่เข้ากัน: ${fits.map((fit) => fit.text).join(', ')}`);
  if (frictions.length > 0) lines.push(`จุดที่สะดุด: ${frictions.map((friction) => friction.text).join(', ')}`);
  lines.push('ข้อความนี้แยกหลักฐานออกจากการอนุมาน และไม่กำหนดค่าให้มิติ anchor, cross, local, audience หรือ friction');
  return lines.join('\n');
}

export function fallbackCritique(brief: Brief, packet: EvidencePacket, ledger: Ledger): CritiqueResult {
  if (tooThin(packet, ledger)) return needsMore(packet, ledger);
  const items = presentedItems(packet.items);
  const proposals: Change[] = [];
  const price = items.find((item) => item.polarity === 'friction' && /price|premium|pricing|posture/i.test(`${item.id} ${item.label} ${item.detail}`));
  if (price && /premium|luxury/i.test(brief.positioning) && !/accessible/i.test(brief.positioning)) {
    proposals.push({
      field: 'positioning',
      before: brief.positioning,
      after: 'Accessible premium',
      why: `ท่าทีราคาปัจจุบันอ่านว่าขัดกับหลักฐานเรื่อง ${price.label}`,
      evidenceRefs: [price.id],
      limitations: 'หลักฐานนี้บอกความตึงของท่าทีราคา แต่ไม่ได้วัดว่ากลุ่มเป้าหมายจะรับทางเลือกใหม่แค่ไหน',
    });
  }
  const scarce = items.find((item) => item.polarity === 'friction' && /scarce|scarcity|limited|exclusiv/i.test(`${item.id} ${item.label} ${item.detail}`));
  const constraint = brief.constraints.find((item) => item.kind === 'scarcity' || /limited|exclusive|scarce/i.test(item.text));
  if (scarce && constraint) {
    proposals.push({
      field: 'constraints',
      before: constraint.text,
      after: 'independent pre-order drops',
      why: `จังหวะการปล่อยแบบขาดแคลนอ่านว่าขัดกับหลักฐานเรื่อง ${scarce.label}`,
      evidenceRefs: [scarce.id],
      limitations: 'หลักฐานบอกความตึงของการขาดแคลน แต่ไม่ได้บอกว่ารอบสั่งจองล่วงหน้าจะถูกกลุ่มเป้าหมายรับ',
    });
  }
  if (proposals.length === 0) {
    return {
      status: 'needs more evidence',
      reason: 'หลักฐานยังไม่ชี้ میدانที่แก้ใน brief ได้โดยไม่เดา',
      missing: ['a friction item tied to positioning or a constraint'],
    };
  }
  const applicable = tryApplyChangeSet(brief, proposals);
  if (!applicable.ok) {
    return {
      status: 'needs more evidence',
      reason: 'การเปลี่ยนที่อนุมานได้ยังใส่กลับเข้า brief ไม่ได้',
      missing: [applicable.reason],
    };
  }
  return { status: 'proposals', proposals };
}

export function tooThin(packet: EvidencePacket, ledger: Ledger): boolean {
  return ledger.evidenceStrength === 'LIMITED' || packet.items.length < 2;
}

export function needsMore(packet: EvidencePacket, ledger: Ledger): CritiqueResult {
  const missing: string[] = [];
  if (ledger.evidenceStrength === 'LIMITED') missing.push('cultural evidence stronger than a limited set');
  if (packet.items.length < 2) missing.push('at least a pair of evidence items');
  return {
    status: 'needs more evidence',
    reason: 'หลักฐานยังบางเกินไป จึงยังไม่เสนอให้แก้ brief',
    missing,
  };
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) if (!out.includes(value)) out.push(value);
  return out;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max).trimEnd();
}
