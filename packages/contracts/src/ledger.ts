import { z } from 'zod';

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
