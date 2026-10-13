import type { Brief } from '../engine/types.ts';
import type {
  CritiqueInput,
  ExplainInput,
  Fit,
  Friction,
  LlmClient,
  ParsedBrief,
  ProposalDraft,
} from '../domain/llm.ts';
import { critique as critiqueBrief, explain as explainEvidence, parseBrief as interpretBrief } from '../llm/index.ts';
import type { LlmCallOptions } from '../llm/client.ts';
import type { Brief as LlmBrief, Change, EvidenceItem } from '../llm/schemas.ts';

const FOUND: Record<string, string> = {
  sample: 'ข้อมูลตัวอย่างพบว่า',
  inferred: 'การอนุมานพบว่า',
  qloo: 'Qloo พบว่า',
  'open-data': 'ข้อมูลเปิดพบว่า',
};

const POINTS: Record<string, string> = {
  sample: 'ข้อมูลตัวอย่างชี้ว่า',
  inferred: 'การอนุมานชี้ว่า',
  qloo: 'Qloo ชี้ว่า',
  'open-data': 'ข้อมูลเปิดชี้ว่า',
};

function phrase(table: Record<string, string>, provider: string): string {
  return table[provider] ?? table.sample ?? '';
}

function callOptions(env: Record<string, string | undefined> | undefined): LlmCallOptions {
  return env ? { env } : {};
}

function formFrom(brief: Brief) {
  return {
    idea: brief.idea,
    age: brief.age,
    city: brief.city,
    pos: brief.posture === 'accessible' ? 'Accessible premium' : brief.pos,
    refs: brief.refs,
    interests: brief.interests,
  };
}

/**
 * Qualitative evidence for the interpreter. Affinities stay on the engine packet
 * and are not copied into the text the model sees.
 */
export function evidenceForModel(input: ExplainInput): { sourceId: string; items: EvidenceItem[] } {
  const items: EvidenceItem[] = [];
  if (input.provider) {
    items.push({
      id: 'source:id',
      kind: 'source',
      label: 'Evidence source',
      detail: `Source id is ${input.provider}.`,
      polarity: 'neutral',
    });
  }
  for (const signal of input.signals) {
    const domain = signal.domain || 'signal';
    items.push({
      id: `signal:${domain.toLowerCase()}`,
      kind: 'signal',
      label: signal.name || domain,
      detail: `${domain} is recorded as ${signal.name || domain}. It feeds ${signal.feeds || 'the ledger'}.`,
      polarity: 'fit',
    });
  }
  const posture = (input.posture || '').trim();
  if (posture) {
    const premium = /premium|luxury/i.test(posture) && !/accessible/i.test(posture);
    items.push({
      id: 'posture:price',
      kind: 'posture',
      label: 'Price posture',
      detail: `The brief posture is ${posture}.`,
      polarity: premium ? 'friction' : 'neutral',
    });
  }
  const scarcity = (input.scarcity || '').trim();
  if (scarcity && scarcity.toLowerCase() !== 'none') {
    const limited = scarcity.toLowerCase() === 'limited';
    items.push({
      id: 'scarcity:run',
      kind: 'scarcity',
      label: limited ? 'Limited-run exclusivity' : 'Scarcity',
      detail: `Scarcity posture is ${scarcity}.`,
      polarity: limited ? 'friction' : 'neutral',
    });
  }
  const places = input.districts.min.concat(input.districts.lux).filter(Boolean);
  if (places.length) {
    items.push({
      id: 'local:districts',
      kind: 'local',
      label: 'City districts',
      detail: `Districts named for this city: ${places.join(', ')}.`,
      polarity: 'neutral',
    });
  }
  return { sourceId: input.provider || 'unspecified', items };
}

function toParsed(brief: LlmBrief): ParsedBrief {
  const hypotheses: string[] = [];
  for (const constraint of brief.constraints) {
    if (constraint.kind === 'price' && !hypotheses.includes('premium')) hypotheses.push('premium');
    else if (constraint.kind === 'scarcity' && !hypotheses.includes('scarcity')) hypotheses.push('scarcity');
    else if (!hypotheses.includes(constraint.kind)) hypotheses.push(constraint.kind);
  }
  return {
    conceptTerms: brief.facets,
    conflictHypotheses: hypotheses,
    domains: ['fashion', 'music', 'design', 'location'],
  };
}

function cite(preferred: string, available: readonly string[]): string | null {
  if (available.includes(preferred)) return preferred;
  return available[0] ?? null;
}

/**
 * The interpreter edits brief fields. The engine applies posture and scarcity.
 * Only those two changes become proposals. Anything else is dropped, not scored.
 */
export function mapChanges(changes: readonly Change[], input: CritiqueInput): ProposalDraft[] {
  const domains = input.evidenceIds.length ? input.evidenceIds : input.signals.map((signal) => signal.domain);
  const drafts: ProposalDraft[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const after = change.after.toLowerCase();
    const price = change.field === 'positioning' && /accessible/.test(after) && /premium/.test(after);
    const scarce = change.field === 'constraints' && /pre-?order|preorder/.test(after);
    if (price && !seen.has('posture')) {
      const evidenceId = cite('Fashion', domains);
      if (!evidenceId) continue;
      seen.add('posture');
      drafts.push({
        before: 'Premium pricing',
        after: 'Accessible premium',
        why: `ราคาพรีเมียมสวนกับสิ่งที่กลุ่มวัย ${input.brief.age} ใน ${input.brief.city} ให้ค่า`,
        evidence: `${phrase(POINTS, input.provider)}กลุ่มนี้ผูกกับ independent และ minimal มากกว่าแบรนด์ราคาสูง ${change.why}`.trim(),
        evidenceIds: [evidenceId],
        change: { kind: 'posture', posture: 'accessible' },
      });
    } else if (scarce && !seen.has('scarcity')) {
      const evidenceId = cite('Location', domains);
      if (!evidenceId) continue;
      seen.add('scarcity');
      const min = input.districts.min.join(' · ');
      const lux = input.districts.lux.join(' · ');
      drafts.push({
        before: 'Limited-run exclusivity',
        after: 'Independent pre-order drops',
        why: 'drop เป็นรอบแบบอิสระตรงกับสัญญาณของย่านที่ idea นี้เข้ากันที่สุด',
        evidence: `ความหรูแบบขาดแคลนกระจุกที่ ${lux} ไม่ใช่ ${min} ${change.why}`.trim(),
        evidenceIds: [evidenceId],
        change: { kind: 'scarcity', scarcity: 'preorder' },
      });
    }
  }
  drafts.sort((a, b) => (a.change.kind === 'posture' ? 0 : 1) - (b.change.kind === 'posture' ? 0 : 1));
  return drafts;
}

function frictionsFor(drafts: readonly ProposalDraft[], input: CritiqueInput, items: readonly EvidenceItem[]): Friction[] {
  if (drafts.length) {
    const out: Friction[] = [];
    const age = input.brief.age;
    const city = input.brief.city;
    const min = input.districts.min.join(' · ');
    const lux = input.districts.lux.join(' · ');
    for (const draft of drafts) {
      if (draft.change.kind === 'posture') {
        out.push({
          text: 'Premium pricing signals',
          why:
            phrase(FOUND, input.provider) +
            'กลุ่มวัย ' +
            age +
            ' ใน ' +
            city +
            ' ผูกกับ independent และ minimal มากกว่าแบรนด์ราคาสูง สัญญาณเรื่องราคาพรีเมียมจึงสวนกับกลุ่มนี้',
        });
      } else {
        out.push({
          text: 'Limited-run exclusivity',
          why: 'ความขาดแคลนแบบหรูกระจุกอยู่ที่ ' + lux + ' ไม่ใช่ ' + min + ' ที่ idea ของคุณเข้ากันที่สุด',
        });
      }
    }
    return out;
  }
  return items
    .filter((item) => item.polarity === 'friction')
    .slice(0, 2)
    .map((item) => ({ text: item.label, why: item.detail }));
}

function fitsFrom(resultFits: { text: string }[], input: ExplainInput): Fit[] {
  const fits: Fit[] = resultFits.map((fit) => ({ text: fit.text }));
  if (input.posture === 'accessible' && !fits.some((fit) => fit.text === 'Accessible premium')) {
    fits.push({ text: 'Accessible premium', isNew: true });
  }
  if (input.scarcity === 'preorder' && !fits.some((fit) => fit.text === 'Pre-order drops')) {
    fits.push({ text: 'Pre-order drops', isNew: true });
  }
  return fits;
}

/**
 * Domain client over `server/src/llm`. parseBrief, explain, and critique never
 * receive ledger numbers. Change sets are mapped onto the engine's apply format.
 */
export function createEngineLlm(env?: Record<string, string | undefined>): LlmClient {
  const options = callOptions(env);
  return {
    async parseBrief(brief) {
      const parsed = await interpretBrief(brief.idea, formFrom(brief), options);
      return toParsed(parsed);
    },
    async explain(input) {
      const evidence = evidenceForModel(input);
      const explained = await explainEvidence(evidence, { evidenceStrength: input.evidenceStrength }, options);
      return { fits: fitsFrom(explained.fits, input) };
    },
    async critique(input) {
      const parsed = await interpretBrief(input.brief.idea, formFrom(input.brief), options);
      const evidence = evidenceForModel(input);
      const reviewed = await critiqueBrief(parsed, evidence, { evidenceStrength: input.evidenceStrength }, options);
      const proposals = reviewed.status === 'proposals' ? mapChanges(reviewed.proposals, input) : [];
      return { frictions: frictionsFor(proposals, input, evidence.items), proposals };
    },
  };
}
