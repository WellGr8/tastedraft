'use client';

import { useEffect, useState } from 'react';
import { revealAt } from '@/lib/reveal';
import { sentimentLabel, type Sentiment } from '@/lib/voice';

const DURATION_MS = 900;

export function ScoreReveal({
  name,
  from,
  to,
  fromSentiment,
  toSentiment,
  beforeQuote,
  afterQuote,
  shifted,
  evidence,
  reduced,
  delayMs,
}: {
  name: string;
  from: number;
  to: number;
  fromSentiment: Sentiment;
  toSentiment: Sentiment;
  beforeQuote: string;
  afterQuote: string;
  shifted: boolean;
  evidence: string;
  reduced: boolean;
  delayMs: number;
}) {
  const measurable = from > 0 && to > 0;
  const [progress, setProgress] = useState(reduced || !measurable ? 1 : 0);

  useEffect(() => {
    if (reduced || !measurable) {
      setProgress(1);
      return;
    }
    setProgress(0);
    let frame = 0;
    const wait = window.setTimeout(() => {
      const started = performance.now();
      const tick = (now: number) => {
        const next = Math.min(1, (now - started) / DURATION_MS);
        setProgress(next);
        if (next < 1) frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(wait);
      window.cancelAnimationFrame(frame);
    };
  }, [reduced, measurable, delayMs, from, to]);

  const settled = reduced || !measurable || progress >= 1;
  const shown = measurable ? revealAt(from, to, reduced ? 1 : progress) : null;
  const sentiment = !measurable || reduced || progress >= 0.45 ? toSentiment : fromSentiment;

  return (
    <div className="lab-card lab-pair lab-reveal" data-testid="score-reveal" data-settled={settled ? 'true' : 'false'}>
      <div>
        <b>{name}</b>
        <p className="lab-quote">{beforeQuote}</p>
        <span className="lab-score"><small>Before</small>{from > 0 ? from : '—'}</span>
      </div>
      <div className="lab-flip">
        <strong className="lab-reveal-score">{shown ?? '—'}</strong>
        <span className={`lab-pill is-${sentiment}`}>{sentimentLabel(sentiment)}</span>
        <span className={`lab-pill ${shifted ? 'is-changed' : 'is-same'}`}>{shifted ? 'Changed mind' : 'Same mind'}</span>
        <p className="lab-evidence">{evidence}</p>
      </div>
      <div>
        <p className="lab-quote" data-testid="persona-quote">{afterQuote}</p>
        <span className="lab-score"><small>After</small>{to > 0 ? to : '—'}</span>
      </div>
    </div>
  );
}
