/**
 * Typed contracts for the Taste Lab feature endpoints.
 * The web app imports these schemas. This module does not call Qloo.
 */
import { z } from 'zod';
import { ExplainabilityContributionSchema, ScoreLedgerSchema } from './ledger.ts';

export const FEATURE_NAMES = [
  'demographic-fit',
  'competitors',
  'neighborhood',
  'niche',
  'activation',
  'impact',
  'reinterview',
  'persona-chat',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export const DEFAULT_FEATURE_BUDGET = 12;
export const MAX_FEATURE_BUDGET = 40;

/** Age buckets `urn:demographics` actually returns. Six buckets, not the product bands. */
export const QLOO_DEMOGRAPHIC_AGES = [
  '24_and_younger',
  '25_to_29',
  '30_to_34',
  '35_to_44',
  '45_to_54',
  '55_and_older',
] as const;
export type QlooDemographicAge = (typeof QLOO_DEMOGRAPHIC_AGES)[number];

/** Values `bias.trends` accepts. Any other value is HTTP 400, not a silent ignore. */
export const BIAS_TRENDS = ['off', 'very_low', 'low', 'mid', 'medium', 'high', 'very_high'] as const;
export type BiasTrend = (typeof BIAS_TRENDS)[number];

export const ESTIMATE_LABEL = 'estimate' as const;
export const IMPACT_DISCLAIMER = 'Not a sales forecast' as const;

const BudgetField = z.number().int().positive().max(MAX_FEATURE_BUDGET).optional();

export const FeatureMetaSchema = z
  .object({
    mode: z.enum(['live', 'mock']),
    cached: z.boolean(),
    qlooCalls: z.number().int().nonnegative(),
    budget: z.number().int().positive(),
    warnings: z.array(z.string()),
  })
  .strict();
export type FeatureMeta = z.infer<typeof FeatureMetaSchema>;

/** A caller-supplied entity. `id` is a Qloo entity id when it has already been resolved. */
export const FeatureEntitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1).optional(),
    affinity: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();
export type FeatureEntity = z.infer<typeof FeatureEntitySchema>;

/**
 * One simulated audience slice.
 * `location` is required so age and gender are never sent to Qloo on their own.
 */
export const FeaturePersonaSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    location: z.string().min(1),
    age: z.string().min(1).optional(),
    gender: z.string().min(1).optional(),
    anchors: z.array(FeatureEntitySchema).max(8).optional(),
  })
  .strict();
export type FeaturePersona = z.infer<typeof FeaturePersonaSchema>;

const SkewSchema = z
  .object({
    dimension: z.enum(['age', 'gender']),
    bucket: z.string().min(1),
    value: z.number().min(-1).max(1),
  })
  .strict();

const EvidenceNoteSchema = z
  .object({
    id: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

export const DemographicFitRequestSchema = z
  .object({
    references: z.array(FeatureEntitySchema).min(1).max(6),
    audience: z
      .object({
        age: z.string().min(1),
        gender: z.string().min(1).optional(),
        location: z.string().min(1),
      })
      .strict(),
    budget: BudgetField,
  })
  .strict();
export type DemographicFitRequest = z.infer<typeof DemographicFitRequestSchema>;

export const DemographicFitResultSchema = FeatureMetaSchema.extend({
  audience: z
    .object({
      age: z.string().min(1),
      ageBucket: z.string().min(1).nullable(),
      gender: z.string().min(1).nullable(),
      location: z.string().min(1),
    })
    .strict(),
  references: z.array(
    z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        skew: z.array(SkewSchema),
        peak: z
          .object({
            bucket: z.string().min(1),
            value: z.number().min(-1).max(1),
          })
          .strict()
          .nullable(),
        targetBucket: z.string().min(1).nullable(),
        targetValue: z.number().min(-1).max(1).nullable(),
        mismatch: z.number().int().min(0).max(100),
        evidence: z.array(EvidenceNoteSchema),
      })
      .strict(),
  ),
  mismatch: z.number().int().min(0).max(100).nullable(),
}).strict();
export type DemographicFitResult = z.infer<typeof DemographicFitResultSchema>;

const ScoredCompetitorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    affinity: z.number().min(0).max(1).nullable(),
    explainability: z.array(ExplainabilityContributionSchema),
  })
  .strict();

export const CompetitorBenchmarkRequestSchema = z
  .object({
    competitors: z.array(FeatureEntitySchema).min(1).max(8),
    personas: z.array(FeaturePersonaSchema).min(1).max(4),
    budget: BudgetField,
  })
  .strict();
export type CompetitorBenchmarkRequest = z.infer<typeof CompetitorBenchmarkRequestSchema>;

export const CompetitorBenchmarkResultSchema = FeatureMetaSchema.extend({
  personas: z.array(
    z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        competitors: z.array(ScoredCompetitorSchema),
      })
      .strict(),
  ),
}).strict();
export type CompetitorBenchmarkResult = z.infer<typeof CompetitorBenchmarkResultSchema>;

export const NeighborhoodFitRequestSchema = z
  .object({
    location: z.string().min(1),
    anchors: z.array(FeatureEntitySchema).max(8).optional(),
    tags: z.array(z.string().min(1)).max(8).optional(),
    age: z.string().min(1).optional(),
    gender: z.string().min(1).optional(),
    budget: BudgetField,
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasSignal = Boolean(value.anchors?.length || value.tags?.length || value.age);
    if (!hasSignal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide anchors, tags, or an age. A heatmap with no signal is rejected by Qloo.',
        path: ['anchors'],
      });
    }
  });
export type NeighborhoodFitRequest = z.infer<typeof NeighborhoodFitRequestSchema>;

export const NeighborhoodFitResultSchema = FeatureMetaSchema.extend({
  location: z.string().min(1),
  cellCount: z.number().int().nonnegative(),
  areas: z.array(
    z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        affinity: z.number().min(0).max(1),
        popularityAffinity: z.number().min(0).max(1).nullable(),
        priceLevelAffinity: z.number().min(0).max(1).nullable(),
        priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
        priceRecommendation: z.string().min(1),
        evidenceRefs: z.array(z.string().min(1)),
      })
      .strict(),
  ).max(5),
  priceRecommendation: z.string().min(1),
}).strict();
export type NeighborhoodFitResult = z.infer<typeof NeighborhoodFitResultSchema>;

export const NicheFinderRequestSchema = z
  .object({
    anchors: z.array(FeatureEntitySchema).max(8).optional(),
    tags: z.array(z.string().min(1)).max(8).optional(),
    query: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    popularityMax: z.number().min(0).max(1).optional(),
    trends: z.enum(BIAS_TRENDS).optional(),
    take: z.number().int().min(1).max(20).optional(),
    budget: BudgetField,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.anchors?.length && !value.tags?.length && !value.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide anchors, tags, or a query to resolve.',
        path: ['query'],
      });
    }
  });
export type NicheFinderRequest = z.infer<typeof NicheFinderRequestSchema>;

export const NicheFinderResultSchema = FeatureMetaSchema.extend({
  type: z.string().min(1),
  popularityMax: z.number().min(0).max(1),
  trends: z.enum(BIAS_TRENDS),
  references: z.array(
    z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        affinity: z.number().min(0).max(1).nullable(),
        popularity: z.number().min(0).max(1).nullable(),
        audienceGrowth: z.number().nullable(),
        kind: z.enum(['rising', 'under-the-radar']),
      })
      .strict(),
  ),
}).strict();
export type NicheFinderResult = z.infer<typeof NicheFinderResultSchema>;

export const ACTIVATION_KINDS = ['place', 'podcast', 'partner'] as const;

export const ActivationPlanRequestSchema = z
  .object({
    location: z.string().min(1),
    personas: z.array(FeaturePersonaSchema).min(1).max(4),
    priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    budget: BudgetField,
  })
  .strict();
export type ActivationPlanRequest = z.infer<typeof ActivationPlanRequestSchema>;

const ActivationItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    affinity: z.number().min(0).max(1).nullable(),
    priceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  })
  .strict();

export const ActivationPlanResultSchema = FeatureMetaSchema.extend({
  location: z.string().min(1),
  personas: z.array(
    z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        places: z.array(ActivationItemSchema),
        podcasts: z.array(ActivationItemSchema),
        partners: z.array(ActivationItemSchema),
      })
      .strict(),
  ),
}).strict();
export type ActivationPlanResult = z.infer<typeof ActivationPlanResultSchema>;

export const ImpactRequestSchema = z
  .object({
    pilotCost: z.number().min(0).optional(),
    focusGroupCost: z.number().min(0).optional(),
    sampleSize: z.number().int().positive().max(100_000),
    roundsAvoided: z.number().int().nonnegative().max(100),
    currency: z.string().min(1).max(8).optional(),
    budget: BudgetField,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.pilotCost == null && value.focusGroupCost == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide a pilot cost or a focus-group cost per participant.',
        path: ['pilotCost'],
      });
    }
  });
export type ImpactRequest = z.infer<typeof ImpactRequestSchema>;

export const ImpactResultSchema = FeatureMetaSchema.extend({
  label: z.literal(ESTIMATE_LABEL),
  disclaimer: z.literal(IMPACT_DISCLAIMER),
  currency: z.string().min(1),
  assumptions: z
    .object({
      pilotCost: z.number().min(0).nullable(),
      focusGroupCost: z.number().min(0).nullable(),
      sampleSize: z.number().int().positive(),
      roundsAvoided: z.number().int().nonnegative(),
    })
    .strict(),
  perRound: z.number().nonnegative(),
  costAvoided: z.number().nonnegative(),
  formula: z.string().min(1),
}).strict();
export type ImpactResult = z.infer<typeof ImpactResultSchema>;

const VersionRefsSchema = z
  .object({
    references: z.array(FeatureEntitySchema).min(1).max(8),
  })
  .strict();

export const ReinterviewRequestSchema = z
  .object({
    personas: z.array(FeaturePersonaSchema).min(1).max(4),
    before: VersionRefsSchema,
    after: VersionRefsSchema,
    budget: BudgetField,
  })
  .strict();
export type ReinterviewRequest = z.infer<typeof ReinterviewRequestSchema>;

const PersonaScoreSchema = z
  .object({
    score: z.number().int().min(0).max(100).nullable(),
    total: z.number().nullable(),
    ledger: ScoreLedgerSchema,
  })
  .strict();

export const ReinterviewResultSchema = FeatureMetaSchema.extend({
  personas: z.array(
    z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        before: PersonaScoreSchema,
        after: PersonaScoreSchema,
        delta: z.number().nullable(),
        changedMind: z.boolean(),
        reason: z.string().min(1),
      })
      .strict(),
  ),
}).strict();
export type ReinterviewResult = z.infer<typeof ReinterviewResultSchema>;

export const PersonaChatRequestSchema = z
  .object({
    persona: FeaturePersonaSchema.extend({
      anchors: z
        .array(
          FeatureEntitySchema.extend({
            reason: z.string().max(240).optional(),
          }),
        )
        .min(1)
        .max(8),
    }),
    message: z.string().min(1).max(500),
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'persona']),
            content: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    /** The launch under discussion. Optional so older clients still chat. */
    context: z
      .object({
        idea: z.string().max(500).optional(),
        verdict: z.string().max(120).optional(),
        frictions: z.array(z.string().max(240)).max(6).optional(),
        stance: z.enum(['customer', 'red-team']).optional(),
      })
      .strict()
      .optional(),
    budget: BudgetField,
  })
  .strict();
export type PersonaChatRequest = z.infer<typeof PersonaChatRequestSchema>;

export const PersonaChatResultSchema = FeatureMetaSchema.extend({
  label: z.literal('Simulated persona response'),
  source: z.enum(['llm', 'template']),
  message: z.string().min(1),
  citations: z.array(
    z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        affinity: z.number().min(0).max(1).nullable(),
      })
      .strict(),
  ),
}).strict();
export type PersonaChatResult = z.infer<typeof PersonaChatResultSchema>;

export const FeatureSseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), feature: z.enum(FEATURE_NAMES), label: z.string().min(1), detail: z.string() }).strict(),
  z.object({ type: z.literal('token'), feature: z.enum(FEATURE_NAMES), text: z.string() }).strict(),
  z.object({ type: z.literal('citation'), feature: z.enum(FEATURE_NAMES), id: z.string().min(1), name: z.string().min(1) }).strict(),
  z.object({ type: z.literal('warning'), feature: z.enum(FEATURE_NAMES), message: z.string() }).strict(),
  z.object({ type: z.literal('result'), feature: z.enum(FEATURE_NAMES), result: z.unknown() }).strict(),
  z
    .object({
      type: z.literal('done'),
      feature: z.enum(FEATURE_NAMES),
      qlooCalls: z.number().int().nonnegative(),
      budget: z.number().int().positive(),
      cached: z.boolean(),
    })
    .strict(),
]);
export type FeatureSseEvent = z.infer<typeof FeatureSseEventSchema>;
