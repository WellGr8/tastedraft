/**
 * Lines for a simulated customer. Fit comes from the deterministic engine.
 * The wording names that person's anchors so two cards do not share a quote.
 */

export type Sentiment = 'measuring' | 'buy' | 'curious' | 'pass';

export function sentimentOf(fit: number, measuring = false): Sentiment {
  if (measuring || !Number.isFinite(fit) || fit <= 0) return 'measuring';
  if (fit >= 75) return 'buy';
  if (fit >= 52) return 'curious';
  return 'pass';
}

export function sentimentLabel(sentiment: Sentiment): string {
  if (sentiment === 'buy') return 'Would buy';
  if (sentiment === 'curious') return 'Curious';
  if (sentiment === 'pass') return 'Would pass';
  return 'Measuring';
}

function spin(seed: string, count: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash + seed.charCodeAt(index) * (index + 3)) % 997;
  }
  return hash % count;
}

function namesOf(anchors: readonly { name: string }[]): { first: string; second?: string; seed: string } {
  const first = anchors[0]!.name;
  const second = anchors[1]?.name;
  const seed = anchors.map((anchor) => anchor.name).join('|');
  return { first, second, seed };
}

function measuringLine(who?: string): string {
  const person = who?.split('#')[0]?.trim();
  return person
    ? `Still measuring what ${person} actually likes.`
    : 'Still measuring what this person actually likes.';
}

export interface VoiceInput {
  anchors: readonly { name: string }[];
  fit: number;
  previous?: number;
  who?: string;
}

/** A second fit is the earlier score. A move of 5 or more gets its own line. */
export function voiceFor(anchors: readonly { name: string }[], fit: number, previous?: number, who?: string, salt = 0): string {
  if (!anchors.length || !Number.isFinite(fit) || fit <= 0) return measuringLine(who);
  const { first, second, seed } = namesOf(anchors);
  const pair = second ? `${first} and ${second}` : first;
  const spice = `${who ?? ''}|${salt}`;
  if (previous != null && Number.isFinite(previous) && previous > 0 && Math.abs(fit - previous) >= 5) {
    const rose = fit > previous;
    const lines = rose
      ? [
          `This version is closer. ${pair} sit nearer what I would actually buy.`,
          `I'd look again. ${pair} fit this change better than the last version.`,
          `The change helps. ${pair} feel less like a mismatch now.`,
          `Closer. I would stop for ${pair} on this version.`,
        ]
      : [
          `This moved away. ${pair} fit the last version better.`,
          `I'd pass now. ${pair} were closer before the change.`,
          `The change hurts. ${pair} no longer line up.`,
          `Further off. ${pair} belonged to the earlier version.`,
        ];
    return lines[spin(`${seed}|${Math.round(fit)}|${Math.round(previous)}|move|${spice}`, lines.length)]!;
  }
  const sentiment = sentimentOf(fit);
  if (sentiment === 'measuring') return measuringLine(who);
  if (!second) {
    if (sentiment === 'buy') return `I'd buy it. It sits next to ${first}, which is already how I spend my time.`;
    if (sentiment === 'curious') return `Curious. ${first} is close enough that I would look twice.`;
    return `I'd pass. I already live in ${first}, and this doesn't belong there.`;
  }
  const lines: Record<Exclude<Sentiment, 'measuring'>, readonly string[]> = {
    buy: [
      `I'd buy it. ${first} and ${second} are already how I spend the week.`,
      `This belongs with ${first}. I already make time for ${second}.`,
      `${first} is my lane, and ${second} is why I would pay for this.`,
      `Yes. I would take this home beside ${first} and ${second}.`,
    ],
    curious: [
      `Curious. ${first} is close, and ${second} makes me look twice.`,
      `I might stop. ${first} fits, and ${second} is the open question.`,
      `Not sure I'd buy yet. ${first} and ${second} are almost this.`,
      `I'd give it a look. ${first} pulls me in, and ${second} keeps me here.`,
    ],
    pass: [
      `I'd pass. ${first} is the taste I keep, and ${second} doesn't pull me in.`,
      `Not for me. I'd walk past. ${first} and ${second} are the taste, and this isn't.`,
      `${first} is home. ${second} says this one is for someone else.`,
      `I'd leave it. ${second} is what I came for, and ${first} doesn't save this.`,
    ],
  };
  return lines[sentiment][spin(`${seed}|${Math.round(fit)}|${sentiment}|${spice}`, lines[sentiment].length)]!;
}

/** One line per person. A shared measuring sentence or a shared template gets a different line. */
export function distinctVoices(rows: readonly VoiceInput[]): string[] {
  const used = new Set<string>();
  return rows.map((row, index) => {
    const who = row.who?.trim() || `person ${index + 1}`;
    let line = voiceFor(row.anchors, row.fit, row.previous, who, 0);
    for (let salt = 1; used.has(line) && salt < 8; salt += 1) {
      line = voiceFor(row.anchors, row.fit, row.previous, who, salt);
    }
    if (used.has(line)) line = `${line} — ${who}`;
    used.add(line);
    return line;
  });
}

/** The engine scores a persona on that persona's anchors, not the shared brief. */
export function anchorRefs(anchors: readonly { name: string }[]): string[] {
  return anchors.map((anchor) => anchor.name).filter((name) => name.trim().length > 0);
}
