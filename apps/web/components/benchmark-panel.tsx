'use client';

import { useEffect, useState } from 'react';
import { parseBenchmark, type BenchmarkView } from '@/lib/benchmark';
import styles from './benchmark-panel.module.css';

function parts(headline: string): { hit: number; total: number } | null {
  const match = headline.match(/(\d+)\s+of\s+(\d+)/);
  if (!match) return null;
  return { hit: Number(match[1]), total: Number(match[2]) };
}

function widthOf(headline: string): number {
  const parsed = parts(headline);
  if (!parsed || parsed.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((parsed.hit / parsed.total) * 100)));
}

export function BenchmarkPanel() {
  const [view, setView] = useState<BenchmarkView | null>(null);
  const [arm, setArm] = useState<'qloo' | 'llm'>('qloo');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancel = false;
    void fetch('/benchmark.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('missing'))))
      .then((body: unknown) => {
        const parsed = parseBenchmark(body);
        if (cancel) return;
        if (parsed) setView(parsed);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (failed || !view) {
    return (
      <section className={styles.panel} data-testid="benchmark-slot" data-ready="false">
        <p className={styles.kicker}>Benchmark</p>
        <p>{failed ? 'The benchmark file is missing. Regenerate it with npm run benchmark.' : 'Loading the benchmark.'}</p>
      </section>
    );
  }

  const selected = view.arms[arm];
  const qloo = view.arms.qloo.headline;
  const plain = view.arms.llm.headline;

  return (
    <section className={styles.panel} data-testid="benchmark-slot" data-ready="true" data-source={view.source}>
      <p className={styles.kicker}>Benchmark</p>
      <p className={styles.number} data-testid="benchmark-headline">{selected.headline}</p>
      <p className={styles.sentence} data-testid="benchmark-sentence">
        With Qloo: {qloo} persona reasons are backed by real taste data. Without: {plain}.
      </p>
      <div className={styles.bars} data-testid="benchmark-bars">
        <div data-on={arm === 'qloo' ? 'true' : 'false'}>
          <span>With Qloo</span>
          <i><em style={{ width: `${widthOf(qloo)}%` }} /></i>
          <b>{qloo}</b>
        </div>
        <div data-on={arm === 'llm' ? 'true' : 'false'}>
          <span>Without</span>
          <i><em style={{ width: `${widthOf(plain)}%` }} /></i>
          <b>{plain}</b>
        </div>
      </div>
      <div className={styles.meta}>
        {view.source === 'live' ? <span className={styles.pill} data-live="true" data-testid="benchmark-source">Live{view.model ? ` · ${view.model}` : ''}</span> : null}
        {view.arms.qloo.outcome ? <span className={styles.pill}>With Qloo outcomes {view.arms.qloo.outcome}</span> : null}
        {view.arms.llm.outcome ? <span className={styles.pill}>Without Qloo outcomes {view.arms.llm.outcome}</span> : null}
      </div>
      <div className={styles.toggle} role="group" aria-label="Qloo grounding" data-testid="benchmark-toggle">
        <button type="button" aria-pressed={arm === 'qloo'} onClick={() => setArm('qloo')}>
          With Qloo
        </button>
        <button type="button" aria-pressed={arm === 'llm'} onClick={() => setArm('llm')}>
          Without Qloo
        </button>
      </div>
      <details className={styles.limits}>
        <summary>Nine launches</summary>
        <ul className={styles.rows}>
          {view.rows.map((row) => (
            <li key={row.id}>
              <b>{row.title}</b>
              <small>
                {row.city} · With Qloo {row.withQloo} · Without Qloo {row.withoutQloo}
                {row.kind === 'case-study' ? ` · ${row.outcome}` : ''}
              </small>
            </li>
          ))}
        </ul>
      </details>
      <details className={styles.limits}>
        <summary>Method</summary>
        {view.sampleNote ? <p className={styles.note}>{view.sampleNote}</p> : null}
        {view.label ? <p className={styles.note}>{view.label}</p> : null}
        {view.limits.length ? (
          <ul>
            {view.limits.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </details>
    </section>
  );
}
