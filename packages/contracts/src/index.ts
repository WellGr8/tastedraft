/**
 * Shared TasteDraft contracts for Wave 0.
 *
 * Server and frontend import the same module:
 *   import { BriefV2Schema, type BriefV2 } from '@tastedraft/contracts';
 *
 * Zod schemas are the runtime check. TypeScript types are inferred from them.
 * This file does not call Qloo and does not score a brief.
 */
import { z } from 'zod';

/** WGS84 point. Qloo payloads that say `lon` are mapped to `lng` by the caller. */
export const GeoSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export type Geo = z.infer<typeof GeoSchema>;

/**
 * A resolved cultural object or place.
 * `type` is a Qloo URN (`urn:entity:brand`) or a screen label (`Brand`).
 * `source` names who resolved it (`qloo`, `mock`, `open-data`).
 */
export const EntitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    image: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    geo: GeoSchema.optional(),
    source: z.string().min(1),
  })
  .strict();
export type Entity = z.infer<typeof EntitySchema>;

/** A Qloo tag, or a mock tag id from `QlooClient` when the API key is unset. */
export const TagSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1).optional(),
  })
  .strict();
export type Tag = z.infer<typeof TagSchema>;

/** Entities returned for one `/search` query. */
export const SearchResultSchema = z
  .object({
    query: z.string(),
    entities: z.array(EntitySchema),
    source: z.string().min(1),
  })
  .strict();
export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Hackathon brief. Not the prototype brief (`pos`, `refs: string[]`).
 * `age` is a product band such as `18–25` (en dash). Mapping that band onto
 * `signal.demographics.age` belongs to the insights owner.
 * `priceLevel` is the Qloo place scale 1–4.
 */
export const BriefV2Schema = z
  .object({
    idea: z.string().min(1),
    interests: z.array(TagSchema),
    references: z.array(EntitySchema),
    locations: z.array(EntitySchema),
    city: z.string().min(1),
    age: z.string().min(1),
    gender: z.string().min(1).optional(),
    priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    positioning: z.string().min(1),
    constraints: z.array(z.string().min(1)),
  })
  .strict();
export type BriefV2 = z.infer<typeof BriefV2Schema>;

/**
 * One measured taste signal. `affinity` is 0–1, or null when the call
 * returned no measurement. Null is a gap, not a zero.
 * `params` stores the dotted `signal.*` / `filter.*` keys that produced the row.
 */
export const InsightSignalSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    affinity: z.number().min(0).max(1).nullable(),
    source: z.string().min(1),
    params: z.record(z.string(), z.string()),
  })
  .strict();
export type InsightSignal = z.infer<typeof InsightSignalSchema>;

/** One input's share of a result, from `feature.explainability`. Weights are 0–1. */
export const ExplainabilityContributionSchema = z
  .object({
    input: z.string().min(1),
    weight: z.number().min(0).max(1),
    target: z.string().min(1),
  })
  .strict();
export type ExplainabilityContribution = z.infer<typeof ExplainabilityContributionSchema>;

/** Where a ledger row's number came from. */
export const ProvenanceSchema = z
  .object({
    source: z.string().min(1),
    detail: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const LEDGER_ROW_IDS = ['anchor', 'cross', 'local', 'audience', 'friction'] as const;
export type LedgerRowId = (typeof LEDGER_ROW_IDS)[number];

/**
 * One weighted row. `points` is null when the dimension was not measured.
 * Friction points are signed (already negative) when present.
 */
export const LedgerRowSchema = z
  .object({
    id: z.enum(LEDGER_ROW_IDS),
    subscore: z.number().nullable(),
    weight: z.number(),
    points: z.number().nullable(),
    provenance: ProvenanceSchema,
  })
  .strict();
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export const ScoreLedgerSchema = z
  .object({
    rows: z.array(LedgerRowSchema),
    total: z.number().nullable(),
  })
  .strict()
  .superRefine((ledger, ctx) => {
    const seen = new Set<string>();
    for (const row of ledger.rows) {
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate ledger row "${row.id}"`,
          path: ['rows'],
        });
      }
      seen.add(row.id);
    }
  });
export type ScoreLedger = z.infer<typeof ScoreLedgerSchema>;

/**
 * A change to one Qloo query parameter.
 * `param` is a dotted key such as `signal.demographics.age` or `filter.location.query`.
 */
export const QlooParamDiffSchema = z
  .object({
    param: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i),
    from: z.string().nullable(),
    to: z.string().nullable(),
  })
  .strict();
export type QlooParamDiff = z.infer<typeof QlooParamDiffSchema>;

export const ProposalSchema = z
  .object({
    id: z.string().min(1),
    changes: z.array(QlooParamDiffSchema).min(1),
    why: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    predictedDelta: z.number().optional(),
  })
  .strict();
export type Proposal = z.infer<typeof ProposalSchema>;

export const HeatmapCellSchema = z
  .object({
    id: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** 0–1 heat for this cell. */
    weight: z.number().min(0).max(1),
    label: z.string().min(1).optional(),
  })
  .strict();
export type HeatmapCell = z.infer<typeof HeatmapCellSchema>;

export const MapPinSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    entityId: z.string().min(1).optional(),
  })
  .strict();
export type MapPin = z.infer<typeof MapPinSchema>;

/** A map overlay is either heatmap cells or pins, not a mix of both. */
export const MapLayerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('heatmap'),
      id: z.string().min(1),
      name: z.string().min(1),
      cells: z.array(HeatmapCellSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pins'),
      id: z.string().min(1),
      name: z.string().min(1),
      pins: z.array(MapPinSchema),
    })
    .strict(),
]);
export type MapLayer = z.infer<typeof MapLayerSchema>;

/** One finished run. `mode` says whether the evidence came from Qloo or the authored mock. */
export const SimulationResultSchema = z
  .object({
    id: z.string().min(1),
    brief: BriefV2Schema,
    signals: z.array(InsightSignalSchema),
    explainability: z.array(ExplainabilityContributionSchema),
    ledger: ScoreLedgerSchema,
    proposals: z.array(ProposalSchema),
    layers: z.array(MapLayerSchema),
    mode: z.enum(['live', 'mock']),
  })
  .strict();
export type SimulationResult = z.infer<typeof SimulationResultSchema>;
