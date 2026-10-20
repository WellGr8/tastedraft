'use client';

import type { LaunchReportModel } from '@/lib/launch-report';

function badgeLabel(badge: 'best-bet' | 'safe-market'): string {
  return badge === 'best-bet' ? 'Best bet' : 'Safe big market';
}

export function LaunchReport({ model, onBack }: { model: LaunchReportModel; onBack: () => void }) {
  const delta = model.delta;
  const deltaLabel = delta > 0 ? `+${delta}` : String(delta);
  return (
    <article className="lab-card lab-report-sheet" data-testid="launch-report">
      <p className="lab-eyebrow" style={{ color: '#4a5273' }}>Launch report</p>
      <div className="lab-report-hero">
        <div>
          <span className="lab-label">Before</span>
          <strong>{model.before}</strong>
        </div>
        <span className="lab-report-delta" data-up={delta > 0 ? 'true' : 'false'}>{deltaLabel}</span>
        <div>
          <span className="lab-label">After</span>
          <strong data-testid="report-score">{model.after}</strong>
        </div>
      </div>
      <p className="lab-plain" data-testid="report-text">{model.action}</p>
      <p className="lab-report-flips">
        {model.flipCount} of {model.panel} flipped to yes
      </p>
      <ul className="lab-report-quotes">
        {model.quotes.map((person) => (
          <li key={person.label}>
            <b>{person.label}</b>
            <span>{person.before} → {person.after}</span>
            <q>{person.quote}</q>
          </li>
        ))}
      </ul>
      {model.changes.length ? (
        <section>
          <h2>What moved the score</h2>
          <ol className="lab-report-changes">
            {model.changes.map((change) => (
              <li key={change.title}>
                <b>{change.title}</b>
                <span>+{change.delta}</span>
                <p>{change.why}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {model.neighborhoods.length ? (
        <section data-testid="report-neighborhoods">
          <h2>Where to test</h2>
          <ul className="lab-report-areas">
            {model.neighborhoods.map((area) => (
              <li key={area.label}>
                <span className="lab-area-name">{area.label}</span>
                <i><em style={{ width: `${Math.max(area.value, 4)}%` }} /></i>
                <b>{area.value}</b>
                {area.badge ? <small className={area.badge === 'best-bet' ? 'is-best' : 'is-safe'}>{badgeLabel(area.badge)}</small> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {model.week.length ? (
        <section>
          <h2>This week</h2>
          <ol className="lab-report-week">
            {model.week.map((day) => (
              <li key={day}>{day}</li>
            ))}
          </ol>
        </section>
      ) : null}
      {model.fixes.length ? (
        <section>
          <h2>Fix list</h2>
          <ul className="lab-report-fixes">
            {model.fixes.map((fix) => (
              <li key={fix}>{fix}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <details className="lab-report-method">
        <summary>Method</summary>
        {model.method.map((line) => (
          <p key={line} className="lab-fine" data-testid={line === model.stop ? 'report-stop' : undefined}>{line}</p>
        ))}
      </details>
      <button type="button" className="lab-quiet" onClick={onBack}>Back</button>
    </article>
  );
}
