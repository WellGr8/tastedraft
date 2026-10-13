import { EvidenceValidationError } from './errors.ts';
import {
  EvidencePacketSchema,
  LedgerSchema,
  SamplePacketSchema,
  type EvidenceItem,
  type EvidencePacket,
  type Ledger,
  type SamplePacket,
} from './schemas.ts';
import { redactScores } from './scores.ts';

export function coerceEvidence(input: unknown): EvidencePacket {
  if (Array.isArray(input)) return EvidencePacketSchema.parse({ items: input });
  if (input && typeof input === 'object' && 'items' in input) return EvidencePacketSchema.parse(input);
  if (isSamplePacket(input)) return evidenceFromSamplePacket(input);
  throw new EvidenceValidationError('evidence.items is required');
}

export function evidenceFromSamplePacket(input: unknown): EvidencePacket {
  const parsed = SamplePacketSchema.safeParse(input);
  if (!parsed.success) throw new EvidenceValidationError('sample evidence packet is not readable');
  return EvidencePacketSchema.parse({
    sourceId: clean(parsed.data.sourceId) || undefined,
    items: sampleItems(parsed.data),
  });
}

function isSamplePacket(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  if ('items' in record) return false;
  return Array.isArray(record.refs) || 'posture' in record || 'scarcity' in record || 'sourceId' in record;
}

function sampleItems(packet: SamplePacket): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const used = new Set<string>();
  const push = (item: EvidenceItem) => {
    const detail = qualitative(item.detail);
    const label = qualitative(item.label);
    if (!label || !detail) return;
    items.push({ ...item, id: uniqueId(item.id, used), label, detail });
  };

  const sourceId = clean(packet.sourceId);
  if (sourceId) {
    push({
      id: 'source:id',
      kind: 'source',
      label: 'Evidence source',
      detail: `Source id is ${sourceId}.`,
      polarity: 'neutral',
    });
  }

  for (const facet of packet.facets ?? []) {
    const name = clean(facet);
    if (!name) continue;
    push({
      id: `facet:${slug(name)}`,
      kind: 'facet',
      label: name,
      detail: `The concept names the facet ${name}.`,
      polarity: 'fit',
    });
  }

  for (const reference of packet.refs ?? []) {
    const name = clean(reference.name);
    if (!name) continue;
    const bits = [
      reference.type ? `Type ${clean(reference.type)}.` : '',
      reference.provenance ? `Provenance ${clean(reference.provenance)}.` : '',
      reference.city ? `Tied to ${clean(reference.city)}.` : '',
    ].filter(Boolean);
    push({
      id: `ref:${slug(name)}`,
      kind: 'reference',
      label: name,
      detail: bits.join(' ') || 'Named reference.',
      polarity: 'fit',
    });
  }

  for (const domain of packet.domains ?? []) {
    const type = clean(domain.type);
    if (!type) continue;
    push({
      id: `domain:${slug(type)}`,
      kind: 'domain',
      label: type,
      detail: `References cover the ${type} domain.`,
      polarity: 'fit',
    });
  }

  if (packet.local) {
    const drag = (packet.local.penalty ?? 0) > 0;
    push({
      id: drag ? 'local:drag' : 'local:base',
      kind: 'local',
      label: drag ? 'Local price or scarcity drag' : 'Local district fit',
      detail: drag
        ? 'The city record includes a drag from the current price posture or scarcity.'
        : 'The city record has a local-fit base with no posture drag.',
      polarity: drag ? 'friction' : 'fit',
    });
  }

  if (packet.audience) {
    const drag = (packet.audience.penalty ?? 0) > 0;
    push({
      id: drag ? 'audience:drag' : 'audience:base',
      kind: 'audience',
      label: drag ? 'Audience price drag' : 'Audience frame',
      detail: drag
        ? 'The audience record includes a penalty for the current price posture.'
        : 'The audience record has no price-posture penalty.',
      polarity: drag ? 'friction' : 'fit',
    });
  }

  const posture = clean(packet.posture);
  if (posture) {
    push({
      id: 'posture:price',
      kind: 'posture',
      label: 'Price posture',
      detail: `The brief posture is ${posture}.`,
      polarity: /premium|luxury/i.test(posture) && !/accessible/i.test(posture) ? 'friction' : 'neutral',
    });
  }

  const scarcity = clean(packet.scarcity);
  if (scarcity && scarcity.toLowerCase() !== 'none') {
    const limited = scarcity.toLowerCase() === 'limited';
    push({
      id: 'scarcity:run',
      kind: 'scarcity',
      label: limited ? 'Limited-run exclusivity' : 'Scarcity',
      detail: `Scarcity posture is ${scarcity}.`,
      polarity: limited ? 'friction' : 'neutral',
    });
  }

  if ((packet.friction ?? 0) > 0) {
    push({
      id: 'friction:gap',
      kind: 'friction',
      label: 'Cultural friction',
      detail: 'A cultural-friction gap is recorded for the current posture and scarcity.',
      polarity: 'friction',
    });
  }

  for (const key of ['fashion', 'music', 'design'] as const) {
    if (packet.signal && packet.signal[key] != null) {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      push({
        id: `signal:${key}`,
        kind: 'signal',
        label,
        detail: `A ${key} signal was recorded for this brief.`,
        polarity: 'neutral',
      });
    }
  }

  return items.slice(0, 40);
}

export function presentItem(item: EvidenceItem): EvidenceItem | null {
  const label = qualitative(item.label);
  const detail = qualitative(item.detail) || 'ไม่มีรายละเอียดเชิงคุณภาพ';
  if (!label) return null;
  return { ...item, label, detail };
}

export function presentedItems(items: EvidenceItem[]): EvidenceItem[] {
  return items.map(presentItem).filter((item): item is EvidenceItem => item != null);
}

export function readLedger(input: unknown): Ledger {
  if (input == null) return {};
  const parsed = LedgerSchema.safeParse(input);
  if (!parsed.success) throw new EvidenceValidationError('ledger is not readable');
  return parsed.data;
}

function qualitative(text: string | undefined): string {
  return redactScores(clean(text));
}

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function slug(value: string): string {
  const out = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return out || 'item';
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base.slice(0, 80);
  let salt = 'b';
  while (used.has(id)) {
    id = `${base}-${salt}`.slice(0, 80);
    salt += 'b';
  }
  used.add(id);
  return id;
}
