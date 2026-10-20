/**
 * Multi-round agent. Every round is a concrete edit whose engine delta is at
 * least MIN_GAIN. A name-only edit or a neighborhood string that does not
 * move the score is not shown as a jump. The stop sentence names the next
 * rejected edit and its measured delta.
 */
export const MIN_GAIN = 4;
export const MAX_ROUNDS = 4;

const FACET = 'Japanese minimalist streetwear with an underground electronic identity';

export interface AgentBrief {
  idea: string;
  age: string;
  city: string;
  pos: string;
  refs: string[];
  posture: string | null;
  scarcity: string;
}

export type PriceLevel = 1 | 2 | 3 | 4;
export type Scarcity = 'open' | 'limited' | 'preorder';

export interface AgentState {
  idea: string;
  city: string;
  age: string;
  priceLevel: PriceLevel;
  scarcity: Scarcity;
  refs: string[];
}

export type RoundKind = 'concept' | 'name' | 'price' | 'place' | 'partner';

export interface AgentRound {
  kind: RoundKind;
  title: string;
  /** Short noun used in the recommended action. */
  label: string;
  before: string;
  after: string;
  why: string;
  delta: number;
  score: number;
  state: AgentState;
}

export interface AgentPlan {
  before: number;
  after: number;
  rounds: AgentRound[];
  stop: string;
  action: string;
  week: string[];
}

export interface PlanInput {
  state: AgentState;
  places?: readonly string[];
  partners?: readonly string[];
}

export type AgentScorer = (brief: AgentBrief) => number | Promise<number>;

export const PARTNER_CATALOG: ReadonlyArray<{ id: string; name: string; type: string }> = [
  { id: 'comme-des-garcons', name: 'Comme des Garçons', type: 'urn:entity:brand' },
  { id: 'aphex-twin', name: 'Aphex Twin', type: 'urn:entity:artist' },
  { id: 'muji', name: 'Muji', type: 'urn:entity:brand' },
  { id: 'lost-in-translation', name: 'Lost in Translation', type: 'urn:entity:movie' },
  { id: 'boards-of-canada', name: 'Boards of Canada', type: 'urn:entity:artist' },
  { id: 'silver-lake', name: 'Silver Lake', type: 'urn:entity:place' },
  { id: 'studio-ghibli', name: 'Studio Ghibli', type: 'urn:entity:movie' },
  { id: 'blue-bottle', name: 'Blue Bottle', type: 'urn:entity:brand' },
  { id: 'nils-frahm', name: 'Nils Frahm', type: 'urn:entity:artist' },
  { id: 'arabica', name: '% Arabica', type: 'urn:entity:brand' },
];

export function productNameFor(idea: string): string {
  const text = idea.toLowerCase();
  if (/coffee|caf[eé]/.test(text)) return 'After Hours';
  if (/game|puzzle/.test(text)) return 'Night Puzzle';
  if (/skin|serum|beauty|k-drama/.test(text)) return 'Glass Hour';
  if (/eco travel|travel tour|lisbon/.test(text)) return 'Low Line';
  return 'Night Bus';
}

function positioningForPrice(price: PriceLevel): string {
  if (price === 1) return 'Mass';
  if (price === 2) return 'Independent';
  if (price === 4) return 'Luxury';
  return 'Premium';
}

function postureForPrice(price: PriceLevel): string | null {
  if (price === 1) return 'Mass';
  if (price === 2) return 'accessible';
  if (price === 4) return 'Luxury';
  return null;
}

function scarcityForEngine(value: Scarcity): string {
  if (value === 'open') return 'none';
  return value;
}

export function toAgentBrief(state: AgentState): AgentBrief {
  return {
    idea: state.idea,
    age: state.age,
    city: state.city,
    pos: positioningForPrice(state.priceLevel),
    refs: state.refs,
    posture: postureForPrice(state.priceLevel),
    scarcity: scarcityForEngine(state.scarcity),
  };
}

export function agentStateFrom(
  draft: { idea: string; city: string; age: string; references: readonly { name: string }[] },
  controls: { priceLevel: PriceLevel; scarcity: Scarcity },
): AgentState {
  return {
    idea: draft.idea,
    city: draft.city,
    age: draft.age,
    priceLevel: controls.priceLevel,
    scarcity: controls.scarcity,
    refs: draft.references.map((entity) => entity.name),
  };
}

function fold(value: string): string {
  return value.trim().toLowerCase();
}

function signed(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta === 0) return '+0';
  return String(delta);
}

function priceWords(level: PriceLevel, scarcity: Scarcity): string {
  const band = level === 1 ? 'Mass' : level === 2 ? 'Independent' : level === 4 ? 'Luxury' : 'Premium';
  const drop = scarcity === 'limited' ? 'limited' : scarcity === 'preorder' ? 'preorder' : 'open';
  return `${band}, ${drop}`;
}

function clip(value: string, max = 96): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function article(phrase: string): string {
  return /^[aeiou]/i.test(phrase) ? 'an' : 'a';
}

function weekFor(where: string): string[] {
  return [
    'Day 1. Lock the name and the one-sentence concept before anything is printed.',
    'Day 2. Set the price and the drop size to the version that scored.',
    'Day 3. Put the partner names on the poster and the product.',
    `Day 4. Walk ${where} and note who stops.`,
    'Day 5. Ask four people the same question the panel was asked.',
    'Day 6. Count how many would say yes, and compare it with the earlier panel.',
    'Day 7. Keep the change only if more people said yes than before.',
  ];
}

function actionFor(rounds: readonly AgentRound[], where: string): string {
  const concept = rounds.find((round) => round.kind === 'concept');
  const named = rounds.find((round) => round.kind === 'name');
  const price = rounds.find((round) => round.kind === 'price');
  const partner = rounds.find((round) => round.kind === 'partner');
  const product = concept?.label ?? named?.label;
  let lead = 'Ship this version';
  if (product && price) lead = `Ship ${product} at ${article(price.label)} ${price.label} price`;
  else if (product) lead = `Ship ${product}`;
  else if (price) lead = `Ship this at ${article(price.label)} ${price.label} price`;
  const withPartner = partner ? ` with ${partner.label}` : '';
  return `${lead}${withPartner}, and test it in ${where} this week.`;
}

function stopFor(count: number, score: number, move: AgentRound | null): string {
  const head = `Stopped after ${count} ${count === 1 ? 'change' : 'changes'} at ${score}.`;
  if (!move) {
    return `${head} Every remaining edit is already in this version. The next change has to move the score by at least ${MIN_GAIN} points.`;
  }
  return `${head} ${move.title} only scores ${signed(move.delta)} (to ${move.score}). The next change has to move the score by at least ${MIN_GAIN} points.`;
}

interface Scored {
  (state: AgentState): Promise<number>;
}

async function conceptMove(state: AgentState, score: Scored, baseline: number): Promise<AgentRound | null> {
  const name = productNameFor(state.idea);
  const nextIdea = `${name} — ${FACET}. ${state.idea.trim()}`;
  if (fold(nextIdea) === fold(state.idea)) return null;
  if (state.idea.includes(name) && /streetwear/i.test(state.idea) && /electronic/i.test(state.idea)) return null;
  const next = { ...state, idea: nextIdea };
  const total = await score(next);
  return {
    kind: 'concept',
    title: `Rename it ${name} and reframe the concept`,
    label: name,
    before: clip(state.idea),
    after: clip(nextIdea),
    why: `${name} adds the taste the engine can score: Japanese, minimal, streetwear, electronic.`,
    delta: total - baseline,
    score: total,
    state: next,
  };
}

async function nameMove(state: AgentState, score: Scored, baseline: number): Promise<AgentRound | null> {
  const name = productNameFor(state.idea);
  if (state.idea.trim().toLowerCase().startsWith(name.toLowerCase())) return null;
  const nextIdea = `${name}. ${state.idea.trim()}`;
  const next = { ...state, idea: nextIdea };
  const total = await score(next);
  return {
    kind: 'name',
    title: `Rename it ${name}`,
    label: name,
    before: clip(state.idea),
    after: name,
    why: `The name is ${name}. It is only kept when the engine score actually moves.`,
    delta: total - baseline,
    score: total,
    state: next,
  };
}

async function priceMove(state: AgentState, score: Scored, baseline: number): Promise<AgentRound | null> {
  const options: Array<{ level: PriceLevel; scarcity: Scarcity; label: string; title: string }> = [
    { level: 2, scarcity: 'open', label: 'independent', title: 'Price it as independent and open the drop' },
    { level: 1, scarcity: 'open', label: 'mass', title: 'Price it as mass and open the drop' },
  ];
  let best: AgentRound | null = null;
  for (const option of options) {
    if (state.priceLevel === option.level && state.scarcity === option.scarcity) continue;
    const next = { ...state, priceLevel: option.level, scarcity: option.scarcity };
    const total = await score(next);
    const move: AgentRound = {
      kind: 'price',
      title: option.title,
      label: option.label,
      before: priceWords(state.priceLevel, state.scarcity),
      after: priceWords(option.level, option.scarcity),
      why: `${option.title} changes what this audience pays. The engine measured ${signed(total - baseline)}.`,
      delta: total - baseline,
      score: total,
      state: next,
    };
    if (!best || move.delta > best.delta) best = move;
  }
  return best;
}

async function placeMove(state: AgentState, places: readonly string[], score: Scored, baseline: number): Promise<AgentRound | null> {
  let best: AgentRound | null = null;
  for (const place of places) {
    const label = place.trim();
    if (!label || state.idea.toLowerCase().includes(label.toLowerCase())) continue;
    const next = { ...state, idea: `${state.idea.trim()} in ${label}` };
    const total = await score(next);
    const move: AgentRound = {
      kind: 'place',
      title: `Show it in ${label}`,
      label,
      before: state.city,
      after: label,
      why: `${label} is on the neighborhood list. It is kept only when the engine score moves.`,
      delta: total - baseline,
      score: total,
      state: next,
    };
    if (!best || move.delta > best.delta) best = move;
  }
  return best;
}

async function partnerMove(state: AgentState, catalog: readonly string[], score: Scored, baseline: number): Promise<AgentRound | null> {
  const have = new Set(state.refs.map(fold));
  const missing = catalog.filter((name) => name.trim() && !have.has(fold(name)));
  const bundles: string[][] = missing.map((name) => [name]);
  const pair = ['Comme des Garçons', 'Silver Lake'].filter((name) => !have.has(fold(name)));
  if (pair.length === 2) bundles.push(pair);
  let best: AgentRound | null = null;
  for (const bundle of bundles) {
    const next = { ...state, refs: [...state.refs, ...bundle] };
    const total = await score(next);
    const label = bundle.join(' and ');
    const move: AgentRound = {
      kind: 'partner',
      title: `Partner with ${label}`,
      label,
      before: state.refs.slice(0, 2).join(', ') || 'No partners',
      after: label,
      why: `${label} ${bundle.length > 1 ? 'are' : 'is'} a taste this audience already has. The engine measured ${signed(total - baseline)}.`,
      delta: total - baseline,
      score: total,
      state: next,
    };
    if (!best || move.delta > best.delta) best = move;
  }
  return best;
}

export async function planAgentRounds(input: PlanInput, scorer: AgentScorer): Promise<AgentPlan> {
  const cache = new Map<string, number>();
  const score: Scored = async (state) => {
    const brief = toAgentBrief(state);
    const key = JSON.stringify(brief);
    const hit = cache.get(key);
    if (hit != null) return hit;
    const total = await scorer(brief);
    cache.set(key, total);
    return total;
  };
  const places = input.places ?? [];
  const catalog = [...new Set([...PARTNER_CATALOG.map((item) => item.name), ...(input.partners ?? [])])];
  let state = input.state;
  const baseline = await score(state);
  const rounds: AgentRound[] = [];
  const used = new Set<RoundKind>();
  let rejected: AgentRound | null = null;

  while (rounds.length < MAX_ROUNDS) {
    const found = (
      await Promise.all([
        used.has('concept') ? null : conceptMove(state, score, await score(state)),
        used.has('name') ? null : nameMove(state, score, await score(state)),
        used.has('price') ? null : priceMove(state, score, await score(state)),
        used.has('place') ? null : placeMove(state, places, score, await score(state)),
        used.has('partner') ? null : partnerMove(state, catalog, score, await score(state)),
      ])
    ).filter((move): move is AgentRound => move != null);
    if (!found.length) break;
    found.sort((left, right) => right.delta - left.delta);
    const best = found[0]!;
    if (best.delta < MIN_GAIN) {
      rejected = best;
      break;
    }
    rounds.push(best);
    used.add(best.kind);
    state = best.state;
  }

  const after = rounds.length ? rounds[rounds.length - 1]!.score : baseline;
  const where = places.find((place) => place.trim())?.trim() || state.city;
  return {
    before: baseline,
    after,
    rounds,
    stop: stopFor(rounds.length, after, rejected),
    action: actionFor(rounds, where),
    week: weekFor(where),
  };
}
