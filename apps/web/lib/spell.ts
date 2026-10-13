/** Small dictionary spellcheck for the idea and interest fields. */
const DICT = [
  'streetwear',
  'minimalist',
  'japanese',
  'electronic',
  'underground',
  'premium',
  'limited',
  'independent',
  'luxury',
  'identity',
  'fashion',
  'audience',
  'cultural',
  'exclusive',
  'accessible',
  'brand',
  'artist',
  'concept',
  'music',
  'design',
  'minimal',
  'resonance',
  'campaign',
  'product',
  'preorder',
];

const STOP = new Set([
  'with', 'an', 'a', 'the', 'at', 'in', 'on', 'of', 'and', 'or', 'sold', 'price', 'runs',
  'for', 'to', 'from', 'this', 'that', 'your', 'you', 'are', 'is', 'it', 'be', 'as', 'by', 'into',
]);

export interface Spelling {
  from: string;
  to: string;
  index: number;
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dp[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}

function matchCase(source: string, suggestion: string): string {
  if (source === source.toUpperCase()) return suggestion.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  return suggestion;
}

export function spellSuggestions(text: string): Spelling[] {
  const source = String(text || '');
  const re = /[A-Za-z][A-Za-z'-]*/g;
  const out: Spelling[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const word = match[0];
    const key = word.toLowerCase();
    if (key.length < 4 || STOP.has(key) || DICT.includes(key)) continue;
    let best = '';
    let bestD = 3;
    const limit = key.length >= 6 ? 2 : 1;
    for (const candidate of DICT) {
      const dist = editDistance(key, candidate);
      if (dist > 0 && dist <= limit && dist < bestD) {
        bestD = dist;
        best = candidate;
      }
    }
    if (best) out.push({ from: word, to: matchCase(word, best), index: match.index });
  }
  return out.slice(-3);
}

export function applySpelling(text: string, suggestion: Spelling): string {
  return text.slice(0, suggestion.index) + suggestion.to + text.slice(suggestion.index + suggestion.from.length);
}
