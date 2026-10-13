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

/** One audience bucket on a persona request. Age may be a product band or a Qloo bucket. */
export const AudienceBucketSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    age: z.string().min(1).optional(),
    gender: z.string().min(1).optional(),
  })
  .strict();
export type AudienceBucket = z.infer<typeof AudienceBucketSchema>;

/**
 * Brief plus a place and 3–4 audience buckets.
 * `location` is sent as `signal.location.query` and, for places, `filter.location.query`.
 */
export const PersonaRequestSchema = z
  .object({
    brief: BriefV2Schema,
    location: z.string().min(1),
    audiences: z.array(AudienceBucketSchema).min(3).max(4),
  })
  .strict();
export type PersonaRequest = z.infer<typeof PersonaRequestSchema>;

export const PERSONA_CATEGORIES = ['artists', 'brands', 'places', 'dining', 'film'] as const;
export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

/** One cross-category insight row. `affinity` is 0–1, or null when Qloo did not measure it. */
export const PersonaInsightSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    affinity: z.number().min(0).max(1).nullable(),
    image: z.string().min(1).optional(),
  })
  .strict();
export type PersonaInsight = z.infer<typeof PersonaInsightSchema>;

export const PersonaInsightsSchema = z
  .object({
    artists: z.array(PersonaInsightSchema),
    brands: z.array(PersonaInsightSchema),
    places: z.array(PersonaInsightSchema),
    dining: z.array(PersonaInsightSchema),
    film: z.array(PersonaInsightSchema),
  })
  .strict();
export type PersonaInsights = z.infer<typeof PersonaInsightsSchema>;

export const AudienceSegmentSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    location: z.string().min(1),
    age: z.string().min(1).optional(),
    gender: z.string().min(1).optional(),
    insights: PersonaInsightsSchema,
  })
  .strict();
export type AudienceSegment = z.infer<typeof AudienceSegmentSchema>;

export const PersonaResultSchema = z
  .object({
    location: z.string().min(1),
    segments: z.array(AudienceSegmentSchema).min(3).max(4),
    mode: z.enum(['live', 'mock']),
    warnings: z.array(z.string()),
  })
  .strict();
export type PersonaResult = z.infer<typeof PersonaResultSchema>;

/** Same bands the engine uses: 4+ refs HIGH, 2–3 MEDIUM, fewer than 2 LIMITED. */
export const EvidenceStrengthSchema = z.enum(['HIGH', 'MEDIUM', 'LIMITED']);
export type EvidenceStrengthName = z.infer<typeof EvidenceStrengthSchema>;

/**
 * One Qloo-backed evidence row. `ref` is an entity id or a tag id.
 * `strength` is computed by the evidence-strength rules, never by a model.
 */
export const EvidenceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['entity', 'tag']),
    ref: z.string().min(1),
    strength: EvidenceStrengthSchema,
    affinity: z.number().min(0).max(1).nullable(),
    source: z.string().min(1),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FRICTION_LABEL = 'Potential friction inferred from cultural signals';
export const CLAIM_LABEL = 'Evidence-backed hypothesis';
export const PERSONA_RESPONSE_LABEL = 'Simulated persona response';

/** A friction hypothesis. `confidence` uses the evidence-strength rules on `evidenceRefs`. */
export const FrictionSchema = z
  .object({
    id: z.string().min(1),
    hypothesis: z.string().min(1),
    label: z.literal(FRICTION_LABEL),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    confidence: EvidenceStrengthSchema,
  })
  .strict();
export type Friction = z.infer<typeof FrictionSchema>;

/** One simulated customer. The quote is not evidence. */
export const PersonaSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    location: z.string().min(1),
    age: z.string().min(1).optional(),
    gender: z.string().min(1).optional(),
    anchors: z.array(PersonaInsightSchema).max(3),
    quote: z.string().min(1),
    quoteLabel: z.literal(PERSONA_RESPONSE_LABEL),
  })
  .strict();
export type Persona = z.infer<typeof PersonaSchema>;

export const STOP_REASONS = [
  'approved_target',
  'insufficient_evidence',
  'no_meaningful_improvement',
  'max_rounds_or_budget',
] as const;
export const StopReasonSchema = z.enum(STOP_REASONS);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const RUN_STATUSES = ['running', 'awaiting_approval', 'awaiting_input', 'stopped'] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepSchema = z
  .object({
    id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    kind: z.string().min(1),
    label: z.string().min(1),
    detail: z.string(),
  })
  .strict();
export type Step = z.infer<typeof StepSchema>;

export const MAX_ROUNDS = 5;
export const DEFAULT_QLOO_BUDGET = 40;

/** Engine ledger plus the proposal shortlist for one version. */
export const SimulationScoreSchema = z
  .object({
    version: z.number().int().positive(),
    total: z.number().nullable(),
    ledger: z.object({
      anchor: z.number().nullable(),
      cross: z.number().nullable(),
      local: z.number().nullable(),
      audience: z.number().nullable(),
      friction: z.number().nullable(),
    }),
    evidenceStrength: EvidenceStrengthSchema,
    mode: z.enum(['live', 'mock', 'sample']),
  })
  .strict();
export type SimulationScore = z.infer<typeof SimulationScoreSchema>;

/** Where the cultural evidence on this run came from. */
export const GroundingSchema = z.enum(['qloo', 'recorded', 'llm-only']);
export type Grounding = z.infer<typeof GroundingSchema>;

/** The Qloo rows a proposal is allowed to cite. Cells are heatmap labels or coordinates. */
export const DecisionLinkSchema = z
  .object({
    proposalId: z.string().min(1),
    entities: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
    cells: z.array(z.string().min(1)),
  })
  .strict();
export type DecisionLink = z.infer<typeof DecisionLinkSchema>;

export const RunSnapshotSchema = z
  .object({
    id: z.string().min(1),
    status: RunStatusSchema,
    version: z.number().int().positive(),
    round: z.number().int().nonnegative(),
    qlooCalls: z.number().int().nonnegative(),
    budget: z.number().int().positive(),
    score: z.number().nullable(),
    evidenceStrength: EvidenceStrengthSchema,
    stopReason: StopReasonSchema.nullable(),
    /** `recorded` is a derived playback. `llm-only` never calls Qloo and cannot pass the gate. */
    grounding: GroundingSchema,
    personas: z.array(PersonaSchema),
    frictions: z.array(FrictionSchema),
    evidence: z.array(EvidenceSchema),
    /** Derived heatmap cells. At most eight. No raw Qloo body. */
    districts: z.array(HeatmapCellSchema).max(8),
    proposals: z.array(ProposalSchema),
    /** Proposals a person already approved, in order. */
    applied: z.array(ProposalSchema),
    /** One row per proposal, pointing at the entities, tags, and heatmap cells behind it. */
    links: z.array(DecisionLinkSchema),
    steps: z.array(StepSchema),
    report: z.string(),
    /** Engine ledger for this version. Null until the engine has scored. */
    simulation: SimulationScoreSchema.nullable(),
  })
  .strict();
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export const SseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), step: StepSchema }).strict(),
  z.object({ type: z.literal('state'), run: RunSnapshotSchema }).strict(),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
