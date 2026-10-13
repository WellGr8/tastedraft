const STEPS = [
  'Structuring your audience',
  'Resolving cultural references',
  'Mapping location',
  'Finding cross-domain cultural signals',
  'Evaluating cultural friction',
];

export function AnalysisScreen({ step }: { step: number }) {
  const width = Math.max(8, Math.min(100, Math.round((step / STEPS.length) * 100)));
  return (
    <section data-testid="analysis-screen" className="td-glass td-rise mx-auto w-full max-w-[760px] rounded-[36px] px-5 py-10 sm:px-12" aria-live="polite">
      <p className="text-xs font-semibold tracking-[0.14em] text-label uppercase">Analysis</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Reading the brief</h2>
      <ol className="mt-8 flex flex-col gap-5">
        {STEPS.map((label, index) => {
          const done = index < step;
          const on = index === step;
          return (
            <li
              key={label}
              data-state={done ? 'done' : on ? 'on' : 'wait'}
              className={`flex items-center gap-4 text-base sm:text-lg ${done ? 'text-ink-soft' : on ? 'font-medium text-ink' : 'text-[#6A7291]'}`}
            >
              <span
                className={`grid size-[26px] shrink-0 place-items-center rounded-full border ${
                  done
                    ? 'border-transparent bg-good-bg text-good'
                    : on
                      ? 'border-[#5B7BFF] shadow-[0_0_0_5px_rgba(91,110,255,0.16)]'
                      : 'border-[rgba(30,34,70,0.18)]'
                }`}
                aria-hidden="true"
              >
                {done ? '✓' : on ? <i className="size-2 animate-pulse rounded-full bg-iris" /> : null}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <div className="mt-8 h-[3px] overflow-hidden rounded-full bg-[rgba(30,34,70,0.08)]" aria-hidden="true">
        <i className="block h-full bg-gradient-to-r from-[#5B7BFF] to-[#8B5CFF] transition-[width] duration-700" style={{ width: `${width}%` }} />
      </div>
    </section>
  );
}
