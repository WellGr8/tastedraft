import type { CritiqueInput, ExplainInput, Fit, Friction, LlmClient, ProposalDraft } from '../../domain/llm.ts';
import { hasLimitedLanguage, hasPremiumLanguage, readFacets } from '../../engine/index.ts';

/**
 * In-repo critic so simulations return fits, frictions, and proposals now.
 * Copy follows the prototype for the calibrated streetwear brief. It does
 * not choose scores.
 *
 * TODO(llm): replace this with `server/src/llm`, which must implement
 * parseBrief, explain, and critique. Proposals have to cite signal domains
 * that exist on the simulation and return a supported `change`.
 */

const FOUND: Record<string, string> = {
  sample: 'ข้อมูลตัวอย่างพบว่า',
  inferred: 'การอนุมานพบว่า',
  qloo: 'Qloo พบว่า',
};

const POINTS: Record<string, string> = {
  sample: 'ข้อมูลตัวอย่างชี้ว่า',
  inferred: 'การอนุมานชี้ว่า',
  qloo: 'Qloo ชี้ว่า',
};

function phrase(table: Record<string, string>, provider: string): string {
  return table[provider] ?? table.sample!;
}

export function createStubLlm(): LlmClient {
  return {
    async parseBrief(brief) {
      const conceptTerms = readFacets(brief.idea);
      const conflictHypotheses: string[] = [];
      if (hasPremiumLanguage(brief.idea)) conflictHypotheses.push('premium');
      if (hasLimitedLanguage(brief.idea)) conflictHypotheses.push('scarcity');
      return { conceptTerms, conflictHypotheses, domains: ['fashion', 'music', 'design', 'location'] };
    },
    async explain(input) {
      return { fits: fitsFor(input) };
    },
    async critique(input) {
      return critiqueFor(input);
    },
  };
}

function fitsFor(input: ExplainInput): Fit[] {
  const facets = readFacets(input.brief.idea);
  const fits: Fit[] = [];
  if (facets.includes('japanese') && facets.includes('minimal')) fits.push({ text: 'Japanese minimalism' });
  if (facets.includes('electronic')) fits.push({ text: 'Underground electronic' });
  if (facets.includes('minimal')) fits.push({ text: 'Independent aesthetic' });
  if (!fits.length) fits.push({ text: 'Concept references' });
  if (input.posture === 'accessible') fits.push({ text: 'Accessible premium', isNew: true });
  if (input.scarcity === 'preorder') fits.push({ text: 'Pre-order drops', isNew: true });
  return fits;
}

function critiqueFor(input: CritiqueInput): { frictions: Friction[]; proposals: ProposalDraft[] } {
  const age = input.brief.age;
  const city = input.brief.city;
  const distMin = input.districts.min.join(' · ');
  const distLux = input.districts.lux.join(' · ');
  const accessible = input.posture === 'accessible';
  const preorder = input.scarcity === 'preorder';
  const frictions: Friction[] = [];
  const proposals: ProposalDraft[] = [];

  if (accessible) {
    frictions.push({
      text: 'Premium pricing signals',
      why: 'ลดลงแล้วหลังปรับเป็น accessible premium แต่ยังเหลือสัญญาณราคาอยู่เล็กน้อยในกลุ่มวัย ' + age,
    });
  } else {
    frictions.push({
      text: 'Premium pricing signals',
      why:
        phrase(FOUND, input.provider) +
        'กลุ่มวัย ' +
        age +
        ' ใน ' +
        city +
        ' ผูกกับ independent และ minimal มากกว่าแบรนด์ราคาสูง สัญญาณเรื่องราคาพรีเมียมจึงสวนกับกลุ่มนี้',
    });
    proposals.push({
      before: 'Premium pricing',
      after: 'Accessible premium',
      why: 'ราคาพรีเมียมสวนกับสิ่งที่กลุ่มวัย ' + age + ' ใน ' + city + ' ให้ค่า',
      evidence: phrase(POINTS, input.provider) + 'กลุ่มนี้ผูกกับ independent และ minimal มากกว่าแบรนด์ราคาสูง',
      evidenceIds: ['Fashion'],
      change: { kind: 'posture', posture: 'accessible' },
    });
  }

  if (!preorder) {
    frictions.push({
      text: 'Limited-run exclusivity',
      why: 'ความขาดแคลนแบบหรูกระจุกอยู่ที่ ' + distLux + ' ไม่ใช่ ' + distMin + ' ที่ idea ของคุณเข้ากันที่สุด',
    });
    proposals.push({
      before: 'Limited-run exclusivity',
      after: 'Independent pre-order drops',
      why: 'drop เป็นรอบแบบอิสระตรงกับสัญญาณของย่านที่ idea นี้เข้ากันที่สุด',
      evidence: 'ความหรูแบบขาดแคลนกระจุกที่ ' + distLux + ' ไม่ใช่ ' + distMin,
      evidenceIds: ['Location'],
      change: { kind: 'scarcity', scarcity: 'preorder' },
    });
  }

  return { frictions, proposals };
}
