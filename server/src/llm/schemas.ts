import { z } from 'zod';

/**
 * Output schemas are strict so a model cannot smuggle a score in an extra key.
 * Input schemas strip unknown keys so provider packets can grow without breaking parsing.
 * Numeric affinities belong to the deterministic engine, never to these outputs.
 */

export const LEDGER_DIMENSIONS = ['anchor', 'cross', 'local', 'audience', 'friction'] as const;

export const ReferenceTypeSchema = z.enum(['brand', 'artist', 'film', 'place', 'person', 'other']);

export const ConstraintKindSchema = z.enum(['price', 'scarcity', 'channel', 'tone', 'other']);

export const ReferenceSchema = z
  .object({
    name: z.string().min(1).max(120),
    type: ReferenceTypeSchema,
  })
  .strict();

export const ConstraintSchema = z
  .object({
    kind: ConstraintKindSchema,
    text: z.string().min(1).max(200),
  })
  .strict();

export const BriefSchema = z
  .object({
    productType: z.string().min(1).max(80),
    facets: z.array(z.string().min(1).max(40)).max(12),
    audience: z
      .object({
        age: z.string().min(1).max(40),
        description: z.string().max(400),
      })
      .strict(),
    city: z.string().min(1).max(80),
    references: z.array(ReferenceSchema).max(8),
    positioning: z.string().min(1).max(80),
    constraints: z.array(ConstraintSchema).max(8),
  })
  .strict();

export const BriefFormSchema = z
  .object({
    idea: z.string().max(4000).optional(),
    age: z.string().max(40).optional(),
    city: z.string().max(80).optional(),
    positioning: z.string().max(80).optional(),
    pos: z.string().max(80).optional(),
    references: z.array(z.string().min(1).max(120)).max(8).optional(),
    refs: z.array(z.string().min(1).max(120)).max(8).optional(),
    interests: z.string().max(400).optional(),
  })
  .strict();

export const EvidenceItemSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.string().min(1).max(40),
    label: z.string().min(1).max(160),
    detail: z.string().min(1).max(500),
    polarity: z.enum(['fit', 'friction', 'neutral']).optional(),
  })
  .strip();

export const EvidencePacketSchema = z
  .object({
    sourceId: z.string().min(1).max(40).optional(),
    items: z.array(EvidenceItemSchema).max(40),
  })
  .strip();

export const LedgerSchema = z
  .object({
    anchor: z.number().optional(),
    cross: z.number().optional(),
    local: z.number().optional(),
    audience: z.number().optional(),
    friction: z.number().optional(),
    total: z.number().optional(),
    evidenceStrength: z.enum(['HIGH', 'MEDIUM', 'LIMITED']).optional(),
  })
  .strip();

export const EvidenceStatementSchema = z
  .object({
    evidenceId: z.string().min(1).max(80),
    statement: z.string().min(1).max(500),
  })
  .strict();

export const InferenceSchema = z
  .object({
    text: z.string().min(1).max(500),
    evidenceRefs: z.array(z.string().min(1).max(80)).min(1).max(8),
  })
  .strict();

export const FitSchema = z
  .object({
    text: z.string().min(1).max(200),
    evidenceRefs: z.array(z.string().min(1).max(80)).min(1).max(8),
  })
  .strict();

export const FrictionSchema = z
  .object({
    text: z.string().min(1).max(200),
    why: z.string().min(1).max(500),
    evidenceRefs: z.array(z.string().min(1).max(80)).min(1).max(8),
  })
  .strict();

export const ExplainResultSchema = z
  .object({
    prose: z.string().min(1).max(2500),
    evidence: z.array(EvidenceStatementSchema).max(40),
    inferences: z.array(InferenceSchema).max(8),
    fits: z.array(FitSchema).max(8),
    frictions: z.array(FrictionSchema).max(8),
  })
  .strict();

export const ChangeFieldSchema = z.enum([
  'productType',
  'facets',
  'audience.age',
  'audience.description',
  'city',
  'references',
  'positioning',
  'constraints',
]);

export const ChangeSchema = z
  .object({
    field: ChangeFieldSchema,
    before: z.string().min(1).max(200),
    after: z.string().min(1).max(200),
    why: z.string().min(1).max(500),
    evidenceRefs: z.array(z.string().min(1).max(80)).min(1).max(8),
    limitations: z.string().min(1).max(400),
  })
  .strict();

export const ProposalsSchema = z
  .object({
    status: z.literal('proposals'),
    proposals: z.array(ChangeSchema).min(1).max(4),
  })
  .strict();

export const NeedsEvidenceSchema = z
  .object({
    status: z.literal('needs more evidence'),
    reason: z.string().min(1).max(400),
    missing: z.array(z.string().min(1).max(200)).max(8),
  })
  .strict();

export const CritiqueResultSchema = z.discriminatedUnion('status', [ProposalsSchema, NeedsEvidenceSchema]);

export const SamplePacketSchema = z
  .object({
    sourceId: z.string().optional(),
    facets: z.array(z.string()).optional(),
    refs: z
      .array(
        z
          .object({
            name: z.string(),
            type: z.string().optional(),
            provenance: z.string().optional(),
            city: z.string().optional(),
          })
          .strip(),
      )
      .optional(),
    domains: z.array(z.object({ type: z.string() }).strip()).optional(),
    local: z.object({ base: z.number().optional(), penalty: z.number().optional() }).strip().optional(),
    audience: z.object({ base: z.number().optional(), penalty: z.number().optional() }).strip().optional(),
    friction: z.number().optional(),
    posture: z.string().optional(),
    scarcity: z.string().optional(),
    signal: z
      .object({
        fashion: z.number().optional(),
        music: z.number().optional(),
        design: z.number().optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

export type Brief = z.infer<typeof BriefSchema>;
export type BriefForm = z.infer<typeof BriefFormSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;
export type Ledger = z.infer<typeof LedgerSchema>;
export type ExplainResult = z.infer<typeof ExplainResultSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type ChangeField = z.infer<typeof ChangeFieldSchema>;
export type CritiqueResult = z.infer<typeof CritiqueResultSchema>;
export type SamplePacket = z.infer<typeof SamplePacketSchema>;
