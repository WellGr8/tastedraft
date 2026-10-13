import type { Districts, EvidencePacket, EvidenceStrength } from '../engine/types.ts';
import type { Signal, SignalSource } from '../domain/llm.ts';
import type { NullableSubs } from '../wiring/gaps.ts';

const LEVELS = ['', 'Limited', 'Moderate', 'Strong'] as const;

function levelOf(value: number): 1 | 2 | 3 {
  if (value >= 75) return 3;
  if (value >= 55) return 2;
  return 1;
}

function levelName(value: number, strength: EvidenceStrength): Signal['level'] {
  const dropped = strength === 'LIMITED' ? 1 : 0;
  const index = Math.max(1, levelOf(value) - dropped) as 1 | 2 | 3;
  return LEVELS[index];
}

function sourcesFrom(packet: EvidencePacket, pred: (type: string) => boolean): SignalSource[] {
  const matched = packet.refs.filter((ref) => pred(ref.type));
  const list = matched.length ? matched : packet.refs;
  return list.map((ref) => {
    const source: SignalSource = {
      name: ref.name,
      type: ref.type,
      provenance: ref.provenance,
    };
    if (typeof ref.affinity === 'number') source.affinity = ref.affinity;
    return source;
  });
}

function fashionName(facets: string[]): string {
  if (facets.includes('japanese') && facets.includes('minimal')) return 'Japanese minimalism';
  if (facets.includes('streetwear')) return 'Streetwear';
  if (facets.includes('minimal')) return 'Minimalism';
  return 'Fashion signal';
}

function musicName(facets: string[]): string {
  if (facets.includes('electronic')) return 'Electronic / alternative';
  return 'Music signal';
}

function designName(facets: string[]): string {
  if (facets.includes('minimal')) return 'Independent aesthetic';
  return 'Design signal';
}

export function buildSignals(input: {
  packet: EvidencePacket;
  subs: NullableSubs;
  districts: Districts;
  strength: EvidenceStrength;
}): Signal[] {
  const { packet, subs, districts, strength } = input;
  const place = districts.min.join(' · ');
  const signals: Signal[] = [];
  if (typeof packet.signal.fashion === 'number') {
    signals.push({
      domain: 'Fashion',
      name: fashionName(packet.facets),
      level: levelName(packet.signal.fashion, strength),
      feeds: 'Anchor affinity',
      sources: sourcesFrom(packet, (type) => type === 'Brand'),
    });
  }
  if (typeof packet.signal.music === 'number') {
    signals.push({
      domain: 'Music',
      name: musicName(packet.facets),
      level: levelName(packet.signal.music, strength),
      feeds: 'Cross-domain fit',
      sources: sourcesFrom(packet, (type) => type === 'Artist'),
    });
  }
  if (typeof packet.signal.design === 'number') {
    signals.push({
      domain: 'Design',
      name: designName(packet.facets),
      level: levelName(packet.signal.design, strength),
      feeds: 'Anchor affinity',
      sources: sourcesFrom(packet, () => true),
    });
  }
  if (typeof subs.local === 'number') {
    signals.push({
      domain: 'Location',
      name: place || 'City districts',
      level: levelName(subs.local, strength),
      feeds: 'Local fit',
      sources: districts.min.map((name) => ({ name, type: 'Place', provenance: packet.sourceId })),
    });
  }
  return signals;
}
