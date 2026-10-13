/** District hexes in the prototype map. With heatmap spots, darkness follows affinity. */
export interface HexCell {
  style: string;
}

export interface HexPin {
  id: string;
  label: string;
  weight: number;
  style: string;
}

export interface AffinitySpot {
  id: string;
  label: string;
  weight: number;
  lat?: number;
  lng?: number;
}

export interface HexLayout {
  cells: HexCell[];
  pinMin: string;
  pinLux: string;
  pins: HexPin[];
}

function kernels(city: string, applied: boolean) {
  let hash = 0;
  for (let i = 0; i < city.length; i++) hash = (hash * 33 + city.charCodeAt(i)) >>> 0;
  const jitter = (hash % 8) / 10;
  if (applied) return { min: { x: 3.9 + jitter, y: 2.5, s: 1.35 }, lux: { x: 1.3, y: 1.05, s: 0.72 } };
  return { min: { x: 4.05 + jitter, y: 2.35, s: 1.12 }, lux: { x: 1.35, y: 1.1, s: 0.95 } };
}

const SLOTS = [
  { x: 4.15, y: 2.35 },
  { x: 1.55, y: 1.25 },
  { x: 2.35, y: 3.85 },
  { x: 5.25, y: 1.15 },
  { x: 3.15, y: 4.45 },
  { x: 5.45, y: 3.55 },
];

function affinityKernels(spots: AffinitySpot[]) {
  const located = spots.filter((spot) => typeof spot.lat === 'number' && typeof spot.lng === 'number');
  if (located.length >= 2) {
    const lats = located.map((spot) => spot.lat ?? 0);
    const lngs = located.map((spot) => spot.lng ?? 0);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latSpan = Math.max(0.01, maxLat - minLat);
    const lngSpan = Math.max(0.01, maxLng - minLng);
    return located.slice(0, SLOTS.length).map((spot) => {
      const weight = Math.max(0, Math.min(1, spot.weight));
      return {
        ...spot,
        weight,
        x: 0.9 + ((spot.lng! - minLng) / lngSpan) * 4.6,
        y: 0.7 + ((maxLat - spot.lat!) / latSpan) * 3.8,
        s: 0.55 + weight * 0.55,
      };
    });
  }
  return spots.slice(0, SLOTS.length).map((spot, index) => {
    const slot = SLOTS[index]!;
    const weight = Math.max(0, Math.min(1, spot.weight));
    return { ...spot, weight, x: slot.x, y: slot.y, s: 0.62 + weight * 0.7 };
  });
}

export function hexLayout(city: string, applied: boolean, spots: AffinitySpot[] = []): HexLayout {
  const ranked = [...spots].filter((spot) => spot.label).sort((a, b) => b.weight - a.weight);
  const live = affinityKernels(ranked);
  const kernelsOf = kernels(city, applied);
  const rows = [
    [1, 5],
    [0, 6],
    [0, 6],
    [1, 6],
    [2, 6],
    [3, 6],
    [4, 5],
  ];
  const w = 1 / 7.5;
  const h = w * 1.1547;
  const H = 5.5 * h;
  const weight = (cx: number, cy: number, kernel: { x: number; y: number; s: number }) => {
    const dx = cx - kernel.x;
    const dy = (cy - kernel.y) * 0.866;
    return Math.exp(-(dx * dx + dy * dy) / (2 * kernel.s * kernel.s));
  };
  const cells: HexCell[] = [];
  let index = 0;
  rows.forEach((range, row) => {
    for (let col = range[0]!; col <= range[1]!; col++) {
      const cx = col + (row % 2 ? 0.5 : 0);
      let background: string;
      if (live.length) {
        let best = 0;
        let affinity = 0;
        for (const spot of live) {
          const reach = weight(cx, row, spot);
          const ink = spot.weight * reach;
          if (ink > best) {
            best = ink;
            affinity = spot.weight;
          }
        }
        const alpha = (0.05 + 0.9 * best).toFixed(2);
        background = affinity >= 0.45 ? `rgba(23,24,43,${alpha})` : `rgba(47,63,214,${alpha})`;
      } else {
        const dense = weight(cx, row, kernelsOf.min);
        const gold = weight(cx, row, kernelsOf.lux);
        const useGold = gold > dense && gold > 0.2;
        background = useGold
          ? `rgba(184,137,43,${(0.16 + 0.74 * gold).toFixed(2)})`
          : `rgba(23,24,43,${(0.07 + 0.8 * dense).toFixed(2)})`;
      }
      cells.push({
        style: `left:${(cx * w * 100).toFixed(2)}%;top:${((row * 0.75) / 5.5 * 100).toFixed(2)}%;width:${(w * 100).toFixed(2)}%;height:${((h / H) * 100).toFixed(2)}%;background:${background};animation-delay:${index * 12}ms`,
      });
      index += 1;
    }
  });
  const pin = (kernel: { x: number; y: number }, color: string) =>
    `left:${(kernel.x * w * 100 + w * 50).toFixed(2)}%;top:${((kernel.y * 0.75) / 5.5 * 100 + (1 / 5.5) * 50).toFixed(2)}%;--pin:${color}`;
  const pins = live.slice(0, 4).map((spot) => ({
    id: spot.id,
    label: spot.label,
    weight: spot.weight,
    style: pin({ x: spot.x, y: spot.y }, spot.weight >= 0.45 ? '#17182B' : '#2F3FD6'),
  }));
  return {
    cells,
    pinMin: pin(kernelsOf.min, '#17182B'),
    pinLux: pin(kernelsOf.lux, '#B8892B'),
    pins,
  };
}

export function bandOf(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: 'HIGH', cls: 'byb-band is-high' };
  if (score >= 60) return { label: 'MODERATE', cls: 'byb-band is-mod' };
  return { label: 'LOW', cls: 'byb-band is-low' };
}
