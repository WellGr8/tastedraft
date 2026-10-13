export interface CaseStudyView {
  id: string;
  title: string;
  short: string;
  verdict: string;
  matched: boolean;
  outcomeSummary: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Read the published fixture. Scores stay whatever the file recorded. */
export function caseStudyViews(body: unknown): CaseStudyView[] {
  if (!body || typeof body !== 'object') return [];
  const studies = (body as { studies?: unknown }).studies;
  if (!Array.isArray(studies)) return [];
  const views: CaseStudyView[] = [];
  for (const row of studies) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const engine = record.engine && typeof record.engine === 'object' ? (record.engine as Record<string, unknown>) : {};
    const id = text(record.id);
    const title = text(record.title);
    const verdict = text(engine.verdict);
    if (!id || !title || (verdict !== 'caution' && verdict !== 'encourage') || typeof record.matched !== 'boolean') continue;
    views.push({
      id,
      title,
      short: title.split(',')[0]?.trim() || title,
      verdict,
      matched: record.matched,
      outcomeSummary: text(record.outcomeSummary),
    });
  }
  return views;
}

export function caseStudySummary(studies: readonly { matched: boolean }[]): string {
  const matched = studies.filter((study) => study.matched).length;
  return `${matched} of ${studies.length} matched`;
}
