import type { DraftState } from './defaults.ts';
import { scoreLive } from './engine-preview.ts';
import { featureEntity, loadNeighborhoodSignal } from './lab-api.ts';
import { loadPersonas } from './personas.ts';
import { postureForPrice, scarcityForEngine, toProfileBrief, type ProfileControls } from './profile.ts';
import {
  COMPARE_CONCURRENCY,
  capCompareLabels,
  mapLimit,
  rankCompare,
  type CompareCard,
  type CompareKind,
  type CompareSignal,
} from './compare.ts';

/**
 * One idea, up to five options.
 * The persona panel and one neighborhood read run in parallel.
 * Neighborhood responses are cached by the feature route. The cap is five.
 */
export async function runCompare(args: {
  draft: DraftState;
  controls: ProfileControls;
  kind: CompareKind;
  labels: readonly string[];
  fetchImpl?: typeof fetch;
  base?: string;
}): Promise<CompareCard[]> {
  const labels = capCompareLabels(args.labels);
  const fetchImpl = args.fetchImpl ?? fetch;
  const base = args.base ?? '';
  const posture = postureForPrice(args.controls.priceLevel);
  const scarcity = scarcityForEngine(args.controls.scarcity);
  const signals = await mapLimit(labels, COMPARE_CONCURRENCY, async (label) => {
    const brief = toProfileBrief(args.draft, args.controls);
    let location = brief.city;
    if (args.kind === 'cities') {
      brief.city = label;
      location = label;
    } else if (args.kind === 'neighborhoods') {
      location = `${label}, ${brief.city}`;
      brief.idea = `${brief.idea} in ${label}`.slice(0, 500);
    } else {
      brief.idea = label.slice(0, 500);
    }
    const scored = await scoreLive({
      idea: brief.idea,
      age: brief.age,
      city: brief.city,
      pos: brief.positioning,
      refs: brief.references.map((item) => item.name),
      posture,
      scarcity,
    });
    const [heat, panel] = await Promise.all([
      loadNeighborhoodSignal(
        {
          location,
          anchors: brief.references.slice(0, 4).map((entity) => featureEntity(entity)),
          age: brief.age,
          budget: 2,
        },
        fetchImpl,
        base,
      ).catch(() => null),
      loadPersonas(
        { brief, ...(posture ? { posture } : {}), scarcity },
        async (query) => (await scoreLive(query)).total,
        fetchImpl,
        base,
      ).catch(() => null),
    ]);
    const panelAnchors = (panel?.personas ?? []).flatMap((persona) => persona.anchors);
    const measured = panelAnchors.filter((anchor) => typeof anchor.affinity === 'number');
    const audience = measured.length
      ? measured.reduce((sum, anchor) => sum + (anchor.affinity ?? 0), 0) / measured.length
      : scored.total / 100;
    const anchors = [...panelAnchors]
      .sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1) || a.name.localeCompare(b.name))
      .map((anchor) => anchor.name)
      .filter((name, index, list) => name && list.indexOf(name) === index)
      .slice(0, 2);
    const named = anchors.length
      ? anchors
      : brief.references.slice(0, 2).map((entity) => entity.name);
    const saturation = heat?.saturation ?? null;
    const signal: CompareSignal = {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option',
      label,
      fit: scored.total,
      local: audience,
      heatmap: heat?.heatmap ?? null,
      popularity: heat?.popularity ?? null,
      saturation,
      anchors: named,
      risk: '',
      reason: '',
      personas: (panel?.personas ?? []).map((persona) => persona.label).slice(0, 4),
    };
    return signal;
  });
  return rankCompare(signals);
}
