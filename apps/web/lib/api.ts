import {
  BriefV2Schema,
  MapLayerSchema,
  SearchResultSchema,
  TagSchema,
  type BriefV2,
  type MapLayer,
  type SearchResult,
  type Tag,
} from '@tastedraft/contracts';
import { z } from 'zod';

export function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8787';
  return raw.replace(/\/$/, '');
}

const TagSearchSchema = z
  .object({
    query: z.string(),
    tags: z.array(TagSchema),
    source: z.string(),
  })
  .strict();

const ProvenanceRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  points: z.number().nullable(),
  detail: z.string(),
});

const ProposalViewSchema = z.object({
  id: z.string(),
  before: z.string(),
  after: z.string(),
  why: z.string(),
  evidence: z.string(),
  evidenceIds: z.array(z.string()).optional(),
  predictedDelta: z.number().nullable().optional(),
  param: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  status: z.string().optional(),
});

export const SimulationResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  conceptVersionId: z.string(),
  versionNumber: z.number(),
  status: z.enum(['complete', 'failed', 'stale']),
  provider: z.string().nullable(),
  score: z.number().nullable(),
  ledger: z
    .object({
      anchor: z.number().nullable(),
      cross: z.number().nullable(),
      local: z.number().nullable(),
      audience: z.number().nullable(),
      friction: z.number().nullable(),
    })
    .nullable(),
  evidenceStrength: z.enum(['HIGH', 'MEDIUM', 'LIMITED']).nullable(),
  proposals: z.array(ProposalViewSchema),
  story: z
    .object({
      mode: z.enum(['sample', 'insights']),
      considered: z.number(),
      baseline: z.number().nullable(),
      captions: z.array(z.string()),
      provenance: z.array(ProvenanceRowSchema),
    })
    .nullable(),
  error: z.string().nullable(),
});

export type SimulationResponse = z.infer<typeof SimulationResponseSchema>;
export type ProposalView = z.infer<typeof ProposalViewSchema>;

const VersionSchema = z.object({
  id: z.string(),
  number: z.number(),
  origin: z.string(),
  parentId: z.string().nullable().optional(),
  brief: z
    .object({
      idea: z.string().optional(),
      age: z.string().optional(),
      city: z.string().optional(),
      pos: z.string().optional(),
      briefV2: BriefV2Schema.nullable().optional(),
    })
    .passthrough(),
});

export const VersionListSchema = z.object({
  projectId: z.string(),
  currentVersionId: z.string(),
  versions: z.array(VersionSchema),
});
export type VersionList = z.infer<typeof VersionListSchema>;

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  currentVersionId: z.string(),
  version: VersionSchema,
});
export type ProjectCreated = z.infer<typeof ProjectSchema>;

export const ApplyResponseSchema = z.object({
  recommendation: z.object({ id: z.string(), status: z.string() }).passthrough(),
  version: VersionSchema,
  simulation: SimulationResponseSchema,
});
export type ApplyResponse = z.infer<typeof ApplyResponseSchema>;

export interface MapQuery {
  city: string;
  interests?: { entities?: string[]; tags?: string[] };
  v2?: { city?: string; interests?: { entities?: string[]; tags?: string[] } } | null;
}

export interface MapPayload {
  city: string;
  center: { lat: number; lng: number };
  mode: string;
  basis: string;
  note: string;
  fits: { v1: MapLayer; v2: MapLayer | null };
  friction: { v1: MapLayer; v2: MapLayer | null };
  locations: MapLayer;
}

const MapPayloadSchema = z.object({
  city: z.string(),
  center: z.object({ lat: z.number(), lng: z.number() }),
  mode: z.string(),
  basis: z.string(),
  note: z.string(),
  fits: z.object({ v1: MapLayerSchema, v2: MapLayerSchema.nullable() }),
  friction: z.object({ v1: MapLayerSchema, v2: MapLayerSchema.nullable() }),
  locations: MapLayerSchema,
});

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError('The API returned a response that was not JSON');
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return `Request failed (${status})`;
}

export class TasteDraftClient {
  constructor(private readonly base = apiBase()) {}

  private async request(path: string, init?: RequestInit, allowStatus: number[] = []): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      });
    } catch {
      throw new ApiError('The API is not reachable. Start it with npm run dev.');
    }
    const body = await readBody(res);
    if (!res.ok && !allowStatus.includes(res.status)) throw new ApiError(errorMessage(body, res.status));
    return body;
  }

  async search(q: string, type?: string, city?: string): Promise<SearchResult> {
    const params = new URLSearchParams({ q });
    if (type) params.set('type', type);
    if (city) params.set('city', city);
    return SearchResultSchema.parse(await this.request(`/api/search?${params}`));
  }

  async tags(q: string): Promise<{ query: string; tags: Tag[]; source: string }> {
    return TagSearchSchema.parse(await this.request(`/api/tags?q=${encodeURIComponent(q)}`));
  }

  async createProject(brief: BriefV2): Promise<ProjectCreated> {
    return ProjectSchema.parse(
      await this.request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ briefV2: BriefV2Schema.parse(brief) }),
      }),
    );
  }

  async simulate(projectId: string, conceptVersionId?: string): Promise<SimulationResponse> {
    return SimulationResponseSchema.parse(
      await this.request(
        '/api/simulations',
        { method: 'POST', body: JSON.stringify({ projectId, conceptVersionId }) },
        [422],
      ),
    );
  }

  async apply(recommendationId: string): Promise<ApplyResponse> {
    return ApplyResponseSchema.parse(
      await this.request(`/api/recommendations/${encodeURIComponent(recommendationId)}/apply`, { method: 'POST' }, [422]),
    );
  }

  async versions(projectId: string): Promise<VersionList> {
    return VersionListSchema.parse(await this.request(`/api/projects/${encodeURIComponent(projectId)}/versions`));
  }

  async map(query: MapQuery): Promise<MapPayload> {
    return MapPayloadSchema.parse(
      await this.request('/api/map', { method: 'POST', body: JSON.stringify(query) }),
    );
  }

  async dismiss(recommendationId: string): Promise<void> {
    await this.request(`/api/recommendations/${encodeURIComponent(recommendationId)}/dismiss`, { method: 'POST' });
  }

  async patchBrief(projectId: string, patch: Record<string, unknown>): Promise<void> {
    await this.request(`/api/projects/${encodeURIComponent(projectId)}/brief`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async chat(body: ChatRequestBody, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/chat`, {
        method: 'POST',
        headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      throw new ApiError('The API is not reachable. Start it with npm run dev.');
    }
    if (!res.ok) {
      const payload = await readBody(res);
      throw new ApiError(errorMessage(payload, res.status));
    }
    return res;
  }
}

export interface ChatRequestBody {
  message: string;
  brief: BriefV2;
  provenance?: Array<{ id: string; label: string; points: number | null; detail: string }>;
  proposals?: Array<{
    id: string;
    param?: string | null;
    from?: string | null;
    to?: string | null;
    why?: string;
    predictedDelta?: number | null;
  }>;
  considered?: number;
}

export type ChatStreamEvent =
  | { type: 'step'; label: string }
  | { type: 'token'; text: string }
  | { type: 'tool'; title: string; detail: string }
  | {
      type: 'proposal';
      id: string;
      title: string;
      from: string;
      to: string;
      delta: number | null;
      why: string;
      kind: 'server' | 'local';
      patch?: ChatPatch;
    }
  | { type: 'confirm'; id: string; label: string; patch?: ChatPatch }
  | { type: 'done' };

export interface ChatPatch {
  city?: string;
  age?: string;
  positioning?: string;
  priceLevel?: 1 | 2 | 3 | 4;
  reference?: BriefV2['references'][number];
}

export async function readChatStream(response: Response, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = (line: string) => {
    if (!line.trim()) return;
    onEvent(JSON.parse(line) as ChatStreamEvent);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) emit(line);
  }
  if (buffer.trim()) emit(buffer);
}
