'use client';

import { useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatPatch } from '@/lib/api';
import { deltaText } from '@/lib/labels';
import { cn } from '@/lib/utils';

export interface ChatProposalView {
  id: string;
  title: string;
  from: string;
  to: string;
  delta: number | null;
  why: string;
  kind: 'server' | 'local';
  status: 'open' | 'approved' | 'dismissed';
  patch?: ChatPatch;
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'agent';
  text: string;
  steps: string[];
  tools: Array<{ title: string; detail: string }>;
  proposals: ChatProposalView[];
  confirmLabel?: string;
  confirmId?: string;
  comparison?: { before: number; after: number };
}

const PROMPTS = ['make it work for Bangkok', 'what if older audience?', 'add NewJeans as reference', 'why is local score low?'];

export function ChatPanel({
  turns,
  draft,
  busy,
  onDraft,
  onSend,
  onPrompt,
  onApprove,
  onDismiss,
  onTweak,
  onConfirm,
}: {
  turns: ChatTurn[];
  draft: string;
  busy: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onPrompt: (value: string) => void;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onTweak: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const scroller = endRef.current?.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [turns]);

  const latestAgent = [...turns].reverse().find((turn) => turn.role === 'agent');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[rgba(120,125,170,0.16)] px-4 py-3">
        <p className="text-xs font-semibold tracking-[0.14em] text-label uppercase">TasteDraft agent</p>
        <p className="text-sm text-slate">Ask in plain language. A change waits for your approval.</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="flex flex-col gap-2">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-2xl bg-white/80 px-3 py-2 text-left text-sm text-ink"
                onClick={() => onPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
        {turns.map((turn) => (
          <article key={turn.id} className={cn('flex flex-col gap-2', turn.role === 'user' ? 'items-end' : 'items-start')}>
            {turn.role === 'user' ? (
              <p className="max-w-[90%] rounded-2xl bg-ink px-3 py-2 text-sm text-white">{turn.text}</p>
            ) : (
              <div className="flex w-full flex-col gap-2">
                {turn.steps.map((step) => (
                  <p key={step} data-testid={turn.id === latestAgent?.id ? 'agent-step' : undefined} className="text-[13px] text-slate">
                    {step}
                  </p>
                ))}
                {turn.text ? <p className="text-sm leading-6 text-ink">{turn.text}</p> : null}
                {turn.tools.map((tool) => (
                  <div key={tool.title} className="rounded-2xl bg-white/80 px-3 py-2">
                    <p className="text-sm font-semibold text-ink">{tool.title}</p>
                    <p className="text-[13px] text-slate">{tool.detail}</p>
                  </div>
                ))}
                {turn.confirmLabel && turn.confirmId ? (
                  <button
                    type="button"
                    className="inline-flex h-9 w-fit items-center rounded-full bg-[#eef0ff] px-3 text-sm font-semibold text-iris"
                    onClick={() => onConfirm(turn.confirmId!)}
                  >
                    {turn.confirmLabel}
                  </button>
                ) : null}
                {turn.proposals.map((proposal, index) => (
                  <div
                    key={proposal.id}
                    data-testid={turn.id === latestAgent?.id ? `proposal-${index}` : undefined}
                    className="rounded-2xl bg-white/90 p-3 shadow-[0_2px_8px_rgba(30,34,70,0.06)]"
                  >
                    <p className="text-sm font-semibold text-ink">{proposal.title}</p>
                    <p className="mt-1 text-sm">
                      <span className="text-bad line-through">{proposal.from}</span>
                      <span className="text-slate"> → </span>
                      <span className="font-bold text-good">{proposal.to}</span>
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate">{proposal.why}</p>
                    {proposal.delta != null ? <p className="mt-1 text-[13px] font-semibold text-iris">About {deltaText(proposal.delta)}</p> : null}
                    {proposal.status === 'open' ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={() => onApprove(proposal.id)} disabled={busy}>
                          Approve
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => onDismiss(proposal.id)} disabled={busy}>
                          Dismiss
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => onTweak(proposal.id)}>
                          Tweak
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-2 text-[13px] font-semibold text-slate">{proposal.status === 'approved' ? 'Approved' : 'Dismissed'}</p>
                    )}
                  </div>
                ))}
                {turn.comparison ? (
                  <p className="text-sm font-semibold text-ink">
                    {turn.comparison.before} → {turn.comparison.after}
                  </p>
                ) : null}
              </div>
            )}
          </article>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-center gap-2 border-t border-[rgba(120,125,170,0.16)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <input
          data-testid="chat-input"
          value={draft}
          aria-label="Message the agent"
          placeholder="make it work for Bangkok"
          className="h-11 min-w-0 flex-1 rounded-full bg-[rgba(30,34,70,0.045)] px-4 text-sm text-ink outline-none"
          onChange={(event) => onDraft(event.target.value)}
        />
        <Button type="submit" size="icon" data-testid="chat-send" aria-label="Send" disabled={busy || !draft.trim()}>
          <Send />
        </Button>
      </form>
    </div>
  );
}
