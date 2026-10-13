import { BriefV2Schema } from '@tastedraft/contracts';
import { z } from 'zod';
import { AGES, CITY_NAMES, POS } from '../engine/index.ts';

const ages = [AGES[0], ...AGES.slice(1)] as [string, ...string[]];
const cities = [CITY_NAMES[0], ...CITY_NAMES.slice(1)] as [string, ...string[]];
const positions = [POS[0], ...POS.slice(1)] as [string, ...string[]];

export const BriefInput = z
  .object({
    idea: z.string().trim().min(1).max(4000),
    age: z.enum(ages),
    city: z.enum(cities),
    pos: z.enum(positions),
    refs: z.array(z.string().trim().min(1).max(200)).max(8),
    muted: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
    interests: z.string().max(2000).optional(),
  })
  .strict();

export const CreateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    brief: BriefInput.partial().strict().optional(),
    briefV2: BriefV2Schema.optional(),
  })
  .strict();

export const PatchBody = BriefInput.partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one brief field' });

export const SimulationBody = z.object({
  projectId: z.string().trim().min(1),
  conceptVersionId: z.string().trim().min(1).optional(),
});
