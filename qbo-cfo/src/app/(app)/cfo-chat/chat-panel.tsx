'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/field';
import { ErrorNotice } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';

interface ProvenanceEntry {
  metricKey: string;
  label: string;
  value: number | null;
  formula: string;
  sourceReport: string | null;
  period: { start: string; end: string };
  basis: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  dataThrough?: string | null;
  source?: string;
  basisLabel?: string;
  caveats?: string[];
  provenance?: ProvenanceEntry[];
  data?: Record<string, unknown>;
}

/**
 * Chat client.
 *
 * The API resolves every question against the database before the model sees
 * it, so each answer carries the period it covers and the source of the data.
 */
export function ChatPanel({
  companyId,
  suggestions,
  dataThrough,
  source,
  basis,
}: {
  companyId: string;
  suggestions: string[];
  dataThrough: string | null;
  source: string;
  basis: string;
}) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conversationId, setConversationId] = React.useState<string | undefined>(undefined);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;
    setError(null);
    setPending(true);
    setInput('');
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: trimmed }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, question: trimmed, conversationId }),
      });
      const data = (await res.json()) as {
        error?: { message?: string };
        answer?: string;
        intent?: string;
        dataThrough?: string | null;
        source?: string;
        basis?: { method: string; label: string };
        caveats?: string[];
        provenance?: ProvenanceEntry[];
        data?: Record<string, unknown>;
        conversationId?: string;
      };
      if (!res.ok) {
        setError(data.error?.message ?? `Request failed (${res.status}).`);
        return;
      }
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.answer ?? '',
          intent: data.intent,
          dataThrough: data.dataThrough ?? null,
          source: data.source,
          basisLabel: data.basis?.label,
          caveats: data.caveats ?? [],
          provenance: data.provenance ?? [],
          data: data.data,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Card className="lg:col-span-3">
        <CardContent className="flex h-[calc(100vh-16rem)] min-h-[26rem] flex-col gap-3 pt-5">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1 scrollbar-thin" role="log" aria-live="polite">
            {messages.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium text-ink">Ask a question about your accounting data</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Answers are computed from your stored {source} data — never from the model&apos;s memory. Data
                  through {dataThrough ?? '—'} on a {basis.toLowerCase()}.
                </p>
              </div>
            ) : null}

            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-navy-700 px-4 py-2 text-sm text-white">
                    {m.content}
                  </p>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-3">
                    <p className="whitespace-pre-wrap text-sm text-ink">{m.content}</p>

                    {m.caveats && m.caveats.length > 0 ? (
                      <ul className="mt-2 space-y-1 rounded border border-warning/25 bg-warning-soft px-3 py-2 text-[11px] text-warning">
                        {m.caveats.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[11px] text-ink-subtle">
                      <span>Data through: {m.dataThrough ?? '—'}</span>
                      <span aria-hidden="true">·</span>
                      <span>Source: {m.source}</span>
                      {m.basisLabel ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <Badge variant="navy">{m.basisLabel}</Badge>
                        </>
                      ) : null}
                      {m.intent ? <Badge variant="outline">{m.intent.replace(/_/g, ' ')}</Badge> : null}
                    </div>

                    {m.provenance && m.provenance.length > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-navy-700 hover:underline">
                          How were these figures calculated?
                        </summary>
                        <ul className="mt-1 space-y-1 text-[11px] text-ink-muted">
                          {m.provenance.map((p) => (
                            <li key={p.metricKey}>
                              <span className="font-medium text-ink">{p.label}</span>: {p.formula} · source{' '}
                              {p.sourceReport ?? 'stored metrics'} · {p.period.start} to {p.period.end} ·{' '}
                              {p.basis} basis
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {m.data && Object.keys(m.data).length > 0 ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-navy-700 hover:underline">
                          Show the verified data behind this answer
                        </summary>
                        <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface-muted p-2 text-[11px] text-ink-muted scrollbar-thin">
                          {JSON.stringify(m.data, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </div>
              ),
            )}
            {pending ? (
              <div className="flex justify-start">
                <p className="rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-2 text-sm text-ink-muted">
                  Querying your accounting data…
                </p>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          {error ? <ErrorNotice message={error} /> : null}

          <form
            className="flex items-end gap-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <label className="sr-only" htmlFor="cfo-question">
              Your question
            </label>
            <Textarea
              id="cfo-question"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              placeholder="e.g. Why did profit go down last month?"
              rows={2}
              maxLength={500}
              className="min-h-[44px] flex-1"
            />
            <Button type="submit" disabled={pending || input.trim().length < 2}>
              Ask
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-2 text-sm font-semibold text-navy-800">Try asking</h2>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => void ask(s)}
                  disabled={pending}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-muted transition-colors hover:bg-surface-muted hover:text-navy-700 disabled:opacity-50"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
