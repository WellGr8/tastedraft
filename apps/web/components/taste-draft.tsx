'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BriefV2, Entity } from '@tastedraft/contracts';
import { MessageCircle } from 'lucide-react';
import { ChatPanel, type ChatTurn } from '@/components/chat-panel';
import { ScoreBoard, coversOf, type AlbumCard } from '@/components/score-board';
import { TasteProfile } from '@/components/taste-profile';
import { Button } from '@/components/ui/button';
import {
  ApiError,
  TasteDraftClient,
  readChatStream,
  type ChatPatch,
  type ChatStreamEvent,
  type MapPayload,
  type SimulationResponse,
  type VersionList,
} from '@/lib/api';
import { defaultDraft, withImage, type DraftState } from '@/lib/defaults';
import { scoreLive, type LiveScore } from '@/lib/engine-preview';
import {
  defaultControls,
  positioningForPrice,
  postureForPrice,
  scarcityForEngine,
  toProfileBrief,
  type ProfileControls,
} from '@/lib/profile';

export function TasteDraft() {
  const client = useMemo(() => new TasteDraftClient(), []);
  const [draft, setDraft] = useState<DraftState>(() => defaultDraft());
  const [controls, setControls] = useState<ProfileControls>(() => defaultControls());
  const [live, setLive] = useState<LiveScore | null>(null);
  const [v1, setV1] = useState<SimulationResponse | null>(null);
  const [v2, setV2] = useState<SimulationResponse | null>(null);
  const [v1Brief, setV1Brief] = useState<BriefV2 | null>(null);
  const [versions, setVersions] = useState<VersionList | null>(null);
  const [map, setMap] = useState<MapPayload | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumCard[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [composer, setComposer] = useState('');
  const [error, setError] = useState('');
  const [scoring, setScoring] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const albumMemory = useRef(new Map<string, { draft: DraftState; controls: ProfileControls }>());
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const brief = useMemo(() => {
    try {
      return toProfileBrief(draft, controls);
    } catch {
      return null;
    }
  }, [draft, controls]);

  useEffect(() => {
    if (!brief) return;
    let cancel = false;
    void scoreLive({
      idea: brief.idea,
      age: brief.age,
      city: brief.city,
      pos: brief.positioning,
      refs: brief.references.map((entity) => entity.name),
      posture: postureForPrice(controls.priceLevel),
      scarcity: scarcityForEngine(controls.scarcity),
    })
      .then((score) => {
        if (!cancel) setLive(score);
      })
      .catch(() => {
        if (!cancel) setLive(null);
      });
    return () => {
      cancel = true;
    };
  }, [brief, controls.priceLevel, controls.scarcity]);

  const loadMap = useCallback(
    async (current: BriefV2, next?: BriefV2 | null) => {
      try {
        setMap(
          await client.map({
            city: current.city,
            interests: {
              tags: current.interests.map((tag) => tag.name),
              entities: current.references.map((entity) => entity.name),
            },
            v2: next
              ? {
                  city: next.city,
                  interests: {
                    tags: next.interests.map((tag) => tag.name),
                    entities: next.references.map((entity) => entity.name),
                  },
                }
              : null,
          }),
        );
      } catch {
        setMap(null);
      }
    },
    [client],
  );

  useEffect(() => {
    if (brief) void loadMap(brief);
  }, [brief, loadMap]);

  const scoreProfile = useCallback(async () => {
    if (!brief) {
      setError('Add an idea before scoring.');
      return;
    }
    setScoring(true);
    setError('');
    try {
      const project = await client.createProject(brief);
      const simulation = await client.simulate(project.id);
      if (simulation.status === 'failed' || simulation.score == null) {
        throw new Error(simulation.error ?? 'The simulation did not return a score');
      }
      setProjectId(project.id);
      setV1(simulation);
      setV1Brief(brief);
      setV2(null);
      const list = await client.versions(project.id).catch(() => null);
      if (list) setVersions(list);
      void loadMap(brief);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The API could not score this profile');
    } finally {
      setScoring(false);
    }
  }, [brief, client, loadMap]);

  function rememberAlbum(name: string) {
    if (!brief) return;
    const id = `album-${Date.now()}`;
    albumMemory.current.set(id, {
      draft: JSON.parse(JSON.stringify(draft)) as DraftState,
      controls: { ...controls, muted: [...controls.muted] },
    });
    setAlbums((current) => [
      {
        id,
        name,
        score: live?.total ?? null,
        covers: coversOf(brief, draft),
        note: draft.city,
      },
      ...current,
    ]);
  }

  async function addSimilar(name: string) {
    if (draft.references.length >= 8) return;
    let entity: Entity | null = null;
    try {
      entity = (await client.search(name)).entities[0] ?? null;
    } catch {
      entity = null;
    }
    const row = withImage(
      entity ?? {
        id: `similar-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        type: 'urn:entity',
        source: 'sample',
      },
    );
    if (draft.references.some((item) => item.name.toLowerCase() === row.name.toLowerCase())) return;
    setDraft({ ...draft, references: [...draft.references, row] });
  }

  function applyPatch(current: DraftState, currentControls: ProfileControls, patch: ChatPatch | undefined) {
    const nextDraft = { ...current, references: [...current.references], interests: [...current.interests], locations: [...current.locations] };
    const nextControls = { ...currentControls, muted: [...currentControls.muted] };
    if (!patch) return { draft: nextDraft, controls: nextControls };
    if (patch.city) nextDraft.city = patch.city;
    if (patch.age) nextDraft.age = patch.age;
    if (patch.positioning) nextDraft.positioning = patch.positioning;
    if (patch.priceLevel) nextControls.priceLevel = patch.priceLevel;
    if (patch.reference && nextDraft.references.length < 8) {
      const reference = withImage(patch.reference);
      if (!nextDraft.references.some((item) => item.name.toLowerCase() === reference.name.toLowerCase())) {
        nextDraft.references.push(reference);
      }
    }
    nextDraft.positioning = positioningForPrice(nextControls.priceLevel);
    return { draft: nextDraft, controls: nextControls };
  }

  async function approve(id: string) {
    const turn = [...turns].reverse().find((item) => item.proposals.some((proposal) => proposal.id === id));
    const proposal = turn?.proposals.find((item) => item.id === id);
    if (!proposal || proposal.status !== 'open' || !brief) return;
    setChatBusy(true);
    setError('');
    const before = v1?.score ?? live?.total ?? null;
    try {
      let afterSim: SimulationResponse;
      let afterBrief = brief;
      if (proposal.kind === 'server') {
        const result = await client.apply(proposal.id);
        if (result.simulation.status === 'failed' || result.simulation.score == null) {
          throw new Error(result.simulation.error ?? 'The new version did not score');
        }
        afterSim = result.simulation;
        afterBrief = result.version.brief.briefV2 ?? brief;
        setV2(afterSim);
        if (projectId) {
          const list = await client.versions(projectId).catch(() => null);
          if (list) setVersions(list);
        }
      } else {
        const patched = applyPatch(draft, controls, proposal.patch);
        const nextBrief = toProfileBrief(patched.draft, patched.controls);
        let nextProject = projectId;
        if (nextProject) {
          const knownCity = ['Los Angeles', 'New York', 'San Francisco', 'Austin', 'Miami', 'Chicago', 'Seattle'].includes(nextBrief.city);
          await client.patchBrief(nextProject, {
            briefV2: nextBrief,
            idea: nextBrief.idea,
            age: nextBrief.age,
            ...(knownCity ? { city: nextBrief.city } : {}),
            pos: nextBrief.positioning,
            refs: nextBrief.references.map((entity) => entity.name),
            interests: nextBrief.interests.map((tag) => tag.name).join(', '),
          });
        } else {
          const project = await client.createProject(nextBrief);
          nextProject = project.id;
          setProjectId(project.id);
        }
        afterSim = await client.simulate(nextProject);
        if (afterSim.status === 'failed' || afterSim.score == null) {
          throw new Error(afterSim.error ?? 'The new version did not score');
        }
        afterBrief = nextBrief;
        if (!v1) {
          setV1(afterSim);
          setV1Brief(nextBrief);
        } else {
          setV2(afterSim);
        }
        setDraft(patched.draft);
        setControls(patched.controls);
        const list = await client.versions(nextProject).catch(() => null);
        if (list) setVersions(list);
      }
      if (v1Brief) void loadMap(v1Brief, afterBrief);
      else void loadMap(afterBrief);
      setTurns((current) =>
        current.map((item) =>
          item.id !== turn?.id
            ? item
            : {
                ...item,
                proposals: item.proposals.map((row) => (row.id === id ? { ...row, status: 'approved' as const } : row)),
                comparison: before != null && afterSim.score != null ? { before, after: afterSim.score } : item.comparison,
              },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setChatBusy(false);
    }
  }

  async function dismiss(id: string) {
    const proposal = turns.flatMap((turn) => turn.proposals).find((item) => item.id === id);
    if (!proposal || proposal.status !== 'open') return;
    if (proposal.kind === 'server') {
      try {
        await client.dismiss(id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Dismiss failed');
        return;
      }
    }
    setTurns((current) =>
      current.map((turn) => ({
        ...turn,
        proposals: turn.proposals.map((row) => (row.id === id ? { ...row, status: 'dismissed' as const } : row)),
      })),
    );
  }

  async function send(message: string) {
    const text = message.trim();
    if (!text || !brief || chatBusy) return;
    setComposer('');
    setChatBusy(true);
    setError('');
    const userTurn: ChatTurn = { id: `user-${Date.now()}`, role: 'user', text, steps: [], tools: [], proposals: [] };
    const agentId = `agent-${Date.now()}`;
    const agentTurn: ChatTurn = { id: agentId, role: 'agent', text: '', steps: [], tools: [], proposals: [] };
    setTurns((current) => [...current, userTurn, agentTurn]);
    const source = v2 ?? v1;
    try {
      const response = await client.chat({
        message: text,
        brief,
        provenance: source?.story?.provenance,
        proposals: (v2 ? [] : v1?.proposals ?? []).slice(0, 3).map((item) => ({
          id: item.id,
          param: item.param,
          from: item.from,
          to: item.to,
          why: item.why,
          predictedDelta: item.predictedDelta,
        })),
        considered: source?.story?.considered,
      });
      await readChatStream(response, (event) => applyEvent(agentId, event));
    } catch (err) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === agentId ? { ...turn, text: err instanceof Error ? err.message : 'The agent could not answer.' } : turn,
        ),
      );
    } finally {
      setChatBusy(false);
    }
  }

  function applyEvent(agentId: string, event: ChatStreamEvent) {
    setTurns((current) =>
      current.map((turn) => {
        if (turn.id !== agentId) return turn;
        if (event.type === 'step') return { ...turn, steps: [...turn.steps, event.label] };
        if (event.type === 'token') return { ...turn, text: turn.text + event.text };
        if (event.type === 'tool') return { ...turn, tools: [...turn.tools, { title: event.title, detail: event.detail }] };
        if (event.type === 'proposal') {
          return {
            ...turn,
            proposals: [
              ...turn.proposals,
              {
                id: event.id,
                title: event.title,
                from: event.from,
                to: event.to,
                delta: event.delta,
                why: event.why,
                kind: event.kind,
                status: 'open',
                patch: event.patch,
              },
            ],
          };
        }
        if (event.type === 'confirm') return { ...turn, confirmLabel: event.label, confirmId: event.id };
        return turn;
      }),
    );
  }

  const chat = (
    <ChatPanel
      turns={turns}
      draft={composer}
      busy={chatBusy}
      onDraft={setComposer}
      onSend={() => void send(composer)}
      onPrompt={(prompt) => void send(prompt)}
      onApprove={(id) => void approve(id)}
      onDismiss={(id) => void dismiss(id)}
      onTweak={(id) => {
        const proposal = turns.flatMap((turn) => turn.proposals).find((item) => item.id === id);
        setComposer(proposal ? `tweak ${proposal.title}` : 'tweak ');
      }}
      onConfirm={(id) => void approve(id)}
    />
  );

  return (
    <div className="td-canvas min-h-screen">
      <header className="sticky top-3 z-20 mx-auto flex w-[calc(100%-1.25rem)] max-w-[1400px] items-center justify-between gap-2 rounded-full border border-white/80 bg-white/60 p-1.5 shadow-[0_12px_32px_-10px_rgba(30,34,70,0.16)] backdrop-blur-xl">
        <span className="flex items-center gap-3 rounded-full bg-white/70 px-4 py-2 text-lg font-bold tracking-tight text-ink">
          <i className="size-2.5 rounded-full bg-gradient-to-br from-[#2F3FD6] to-[#6A45D8] shadow-[0_0_0_5px_rgba(91,110,255,0.14)]" />
          TasteDraft
        </span>
      </header>
      <main className="mx-auto grid w-full max-w-[1400px] gap-4 px-4 pt-6 pb-28 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-6">
        <div className="flex min-w-0 flex-col gap-4">
          {error ? (
            <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm text-bad">
              {error}
            </p>
          ) : null}
          <section className="td-glass rounded-[32px] px-4 py-6 sm:px-8 sm:py-8">
            <TasteProfile draft={draft} controls={controls} onDraft={setDraft} onControls={setControls} onAddSimilar={(name) => void addSimilar(name)} />
          </section>
          <ScoreBoard
            draft={draft}
            controls={controls}
            live={live}
            v1={v1}
            v2={v2}
            versions={versions}
            albums={albums}
            map={map}
            scoring={scoring}
            onScore={() => void scoreProfile()}
            onSave={() => rememberAlbum(draft.city)}
            onDuplicate={() => rememberAlbum(`${draft.city} copy`)}
            onOpenAlbum={(id) => {
              const saved = albumMemory.current.get(id);
              if (!saved) return;
              setDraft(saved.draft);
              setControls(saved.controls);
            }}
          />
        </div>
        {wide ? (
          <aside data-testid="chat-panel" className="td-glass sticky top-20 flex h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-[32px]">
            {chat}
          </aside>
        ) : null}
      </main>
      {wide ? null : (
        <Button
          type="button"
          data-testid="chat-toggle"
          className="fixed right-4 bottom-4 z-30 shadow-lg"
          onClick={() => setSheet((open) => !open)}
        >
          <MessageCircle />
          Agent
        </Button>
      )}
      {!wide && sheet ? (
        <div data-testid="chat-sheet" className="td-glass fixed inset-x-3 bottom-20 z-40 flex h-[min(70vh,640px)] flex-col overflow-hidden rounded-[28px]">
          {chat}
        </div>
      ) : null}
    </div>
  );
}
