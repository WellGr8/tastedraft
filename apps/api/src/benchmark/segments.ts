/** Four audience slices. Same rotation the runner uses when gender is unset. */

export const PANEL_AGES = ['18–25', '26–35', '36–45', '46+'] as const;

export interface SegmentPlan {
  id: string;
  label: string;
  age: string;
  gender: 'female' | 'male';
}

export function segmentsFor(city: string, age: string): SegmentPlan[] {
  const ages: string[] = [...PANEL_AGES];
  const start = Math.max(0, ages.indexOf(age));
  const ordered = [...ages.slice(start), ...ages.slice(0, start)];
  return ordered.slice(0, 4).map((band, index) => {
    const gender: 'female' | 'male' = index % 2 === 0 ? 'female' : 'male';
    return {
      id: `persona-${city}-${band}-${gender}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      label: `${city} ${band} ${gender}`,
      age: band,
      gender,
    };
  });
}
