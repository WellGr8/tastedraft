const SCORE_KEY = /^(score|scores|rating|ratings|points|point|affinity|affinities|sub|subs|subscore|subscores|total|totals|weight|weights|percentile|percent)$/i;

const SCORE_PHRASES: RegExp[] = [
  /\d+(?:\.\d+)?\s*%/,
  /\b\d+(?:\.\d+)?\s*\/\s*100\b/,
  /\b(?:score|scores|rating|ratings|affinity|affinities|points)\b[^.]{0,24}\d/i,
  /คะแนน[^.]{0,12}\d/,
  /\b\d+(?:\.\d+)?\s*(?:points|pts)\b/i,
];

const AGE_SPAN = /(?:1[0-9]|[2-9][0-9])\s*[–-]\s*(?:1[0-9]|[2-9][0-9])|\b(?:1[0-9]|[2-9][0-9])\+/g;

function agePlaceholder(index: number): string {
  return `\u0000${'A'.repeat(index + 1)}\u0000`;
}

/** Remove score-shaped text. Age spans such as 18–25 and 46+ are kept. */
export function redactScores(text: string): string {
  const spans: string[] = [];
  let out = text.replace(AGE_SPAN, (match) => {
    const token = agePlaceholder(spans.length);
    spans.push(match);
    return token;
  });
  out = out.replace(/\d+(?:\.\d+)?\s*%/g, '');
  out = out.replace(/\b\d+(?:\.\d+)?\s*\/\s*100\b/g, '');
  out = out.replace(/\b(?:score|scores|rating|ratings|affinity|affinities|points)\b\s*[:=]?\s*\d+(?:\.\d+)?/gi, '');
  out = out.replace(/คะแนน\s*[:=]?\s*\d+(?:\.\d+)?/g, '');
  out = out.replace(/\b\d+(?:\.\d+)?\s*(?:points|pts)\b/gi, '');
  out = out.replace(/\b\d+(?:\.\d+)?\b/g, '');
  spans.forEach((span, index) => {
    out = out.replace(agePlaceholder(index), span);
  });
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim();
}

export function allowedNumbersIn(text: string): Set<string> {
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
}

function walk(value: unknown, onString: (text: string) => void, onKey: (key: string) => void): void {
  if (typeof value === 'string') {
    onString(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, onString, onKey);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      onKey(key);
      walk(child, onString, onKey);
    }
  }
}

export function findScoreIssue(value: unknown): string | null {
  let issue: string | null = null;
  walk(
    value,
    (text) => {
      if (issue) return;
      for (const pattern of SCORE_PHRASES) {
        if (pattern.test(text)) {
          issue = 'output contains a score, rating, percentage, or points';
          return;
        }
      }
    },
    (key) => {
      if (issue) return;
      if (SCORE_KEY.test(key)) issue = `output contains a score field (${key})`;
    },
  );
  return issue;
}

export function findNovelNumbers(value: unknown, allowed: Set<string>): string | null {
  let issue: string | null = null;
  walk(
    value,
    (text) => {
      if (issue) return;
      const matches = text.match(/\d+(?:\.\d+)?/g) ?? [];
      for (const match of matches) {
        if (!allowed.has(match)) {
          issue = 'output contains a number that was not in the brief or the evidence';
          return;
        }
      }
    },
    () => undefined,
  );
  return issue;
}
