'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, PersonLine, Section } from '@/components/ui';
import { filterPeople, sortPeople } from '@/lib/query/filters';
import { EXAMPLE_QUESTIONS, type ParsedQuery } from '@/lib/query/nl';
import { aggregationTitle, runAggregation } from '@/lib/query/aggregate';

const RESULT_LIMIT = 60;

interface AskResponse {
  engine: 'llm' | 'rules';
  reading?: string;
  llmError?: string;
  llmAvailable?: boolean;
  parsed: ParsedQuery;
}

export default function AskPage() {
  const { db, idx, loading } = useData();
  const [question, setQuestion] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tell the user up front whether the model is wired up.
  useEffect(() => {
    fetch('/api/ask')
      .then((r) => r.json())
      .then((j) => setLlmAvailable(!!j.llmAvailable))
      .catch(() => setLlmAvailable(false));
  }, []);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, localOnly }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `request failed (${res.status})`);
      setResult(json as AskResponse);
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const parsed = result?.parsed ?? null;

  const people = useMemo(() => {
    if (!parsed) return [];
    return sortPeople(filterPeople(db, parsed.filters, idx), 'name', idx);
  }, [parsed, db, idx]);

  const aggregate = useMemo(() => {
    if (!parsed?.aggregation) return null;
    // Aggregate over the filtered set, so "which companies do IIT grads work
    // at" narrows before counting.
    return runAggregation(people.length > 0 ? people : db.people, parsed.aggregation, idx);
  }, [parsed, people, db.people, idx]);

  return (
    <>
      <PageHeader
        title="Ask"
        subtitle="Plain-English questions, answered against your graph"
        actions={
          <span className="flex items-center gap-3 text-xs">
            {llmAvailable === null ? null : llmAvailable ? (
              <label className="flex items-center gap-1.5 text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={localOnly}
                  onChange={(e) => setLocalOnly(e.target.checked)}
                />
                local parser only
              </label>
            ) : (
              <span className="text-fg-subtle" title="Set AZURE_OPENAI_* in .env.local">
                local parser (no model configured)
              </span>
            )}
          </span>
        }
      />

      <div className="space-y-4 p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="flex gap-2"
        >
          <input
            className="input flex-1 py-2 text-base"
            placeholder="Who in my network works at Google?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary px-4" disabled={loading || busy}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void ask(example)}
              disabled={busy}
              className="chip hover:border-brand/50 hover:text-brand-dark disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {parsed ? (
          <>
            <Section
              title="How this was read"
              aside={
                <span
                  className={`chip ${
                    result!.engine === 'llm'
                      ? 'border-node-self/30 bg-node-self/10 text-node-self'
                      : ''
                  }`}
                  title={
                    result!.engine === 'llm'
                      ? 'Azure OpenAI translated the question; only the question text was sent'
                      : 'Parsed locally with rules — nothing left this machine'
                  }
                >
                  {result!.engine === 'llm' ? 'gpt-4o' : 'local rules'}
                </span>
              }
            >
              <div className="space-y-2">
                {result?.reading ? (
                  <p className="text-sm text-fg-muted">{result.reading}</p>
                ) : null}

                {parsed.interpretation.length === 0 && !parsed.aggregation ? (
                  <p className="text-sm text-fg-muted">
                    Nothing recognizable — showing no constraints.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.aggregation ? (
                      <span className="chip border-brand/40 bg-brand/10 text-brand-dark">
                        rank by {parsed.aggregation.kind}
                        {parsed.aggregation.scope === 'any' ? ' (ever)' : ''}
                      </span>
                    ) : null}
                    {parsed.interpretation.map((i) => (
                      <span key={i.facet} className="chip">
                        <span className="text-fg-subtle">{i.facet}:</span>{' '}
                        {i.values.slice(0, 4).join(', ')}
                        {i.values.length > 4 ? ` +${i.values.length - 4}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {result?.llmError ? (
                  <p className="text-xs text-warn">
                    Model unavailable, answered with the local parser instead: {result.llmError}
                  </p>
                ) : null}

                {parsed.unresolved.length > 0 ? (
                  <p className="text-xs text-warn">
                    Not found in your data: {parsed.unresolved.join(', ')} — searched as free text
                    instead.
                  </p>
                ) : null}
              </div>
            </Section>

            {aggregate ? (
              <Section title={aggregationTitle(parsed.aggregation!)} count={aggregate.length}>
                {aggregate.length === 0 ? (
                  <Empty>Nothing to rank.</Empty>
                ) : (
                  <ol className="space-y-1">
                    {aggregate.map((row, i) => {
                      const max = aggregate[0].count || 1;
                      const inner = (
                        <div className="relative flex items-center gap-3 rounded px-2 py-1.5">
                          <div
                            className="absolute inset-y-0 left-0 rounded bg-brand/10"
                            style={{ width: `${(row.count / max) * 100}%` }}
                            aria-hidden
                          />
                          <span className="relative w-6 shrink-0 text-xs text-fg-faint">
                            {i + 1}
                          </span>
                          <span className="relative min-w-0 flex-1 truncate text-sm text-fg">
                            {row.label}
                          </span>
                          <span className="relative shrink-0 text-sm text-fg-muted">
                            {row.count}
                          </span>
                        </div>
                      );
                      return (
                        <li key={row.key}>
                          {row.href ? (
                            <Link href={row.href} className="block hover:bg-surface-hover">
                              {inner}
                            </Link>
                          ) : (
                            inner
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            ) : null}

            <Section
              title="People"
              count={people.length}
              aside={
                people.length > 0 && parsed.filters.q ? (
                  <Link
                    href={`/people?q=${encodeURIComponent(parsed.filters.q)}`}
                    className="text-xs text-fg-subtle hover:text-fg-muted"
                  >
                    open in People →
                  </Link>
                ) : null
              }
            >
              {people.length === 0 ? (
                <Empty>
                  No matches. Try naming the company or school exactly as it appears in your data.
                </Empty>
              ) : (
                <div className="-mx-4 -mb-4">
                  {people.slice(0, RESULT_LIMIT).map((p) => (
                    <PersonLine
                      key={p.id}
                      person={p}
                      strength={idx.strengthByPerson.get(p.id)}
                      noteCount={idx.noteCountByPerson.get(p.id)}
                    />
                  ))}
                  {people.length > RESULT_LIMIT ? (
                    <div className="px-3 py-2 text-xs text-fg-subtle">
                      +{people.length - RESULT_LIMIT} more — refine the question or use the People
                      page.
                    </div>
                  ) : null}
                </div>
              )}
            </Section>
          </>
        ) : (
          <div className="card p-6 text-sm text-fg-muted">
            <p className="font-medium text-fg">How this works</p>
            <p className="mt-2">
              Questions are translated into the same filters the People page uses, and the reading
              is always shown so a misinterpretation is visible rather than mysterious.
            </p>
            <p className="mt-2">
              {llmAvailable
                ? 'Azure OpenAI handles the language; only your question text is sent — never any part of your network. Entity names are then resolved locally against your own data.'
                : 'A local rule-based parser handles this today. Add AZURE_OPENAI_* values to .env.local for broader phrasing support; even then, only the question text is sent — never your network.'}
            </p>
            <p className="mt-3 font-medium text-fg-muted">Understood either way</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              <li>
                <span className="text-fg-muted">works at / is at</span> — current employer
              </li>
              <li>
                <span className="text-fg-muted">previously worked at / ex-</span> — past employer
              </li>
              <li>
                <span className="text-fg-muted">went to / studied at</span> — school (acronyms
                expand against your data, so &quot;IIT&quot; finds every IIT)
              </li>
              <li>
                <span className="text-fg-muted">lives in / based in</span> — location
              </li>
              <li>
                <span className="text-fg-muted">knows / skilled in</span> — skills
              </li>
              <li>
                <span className="text-fg-muted">which companies / schools / cities …</span> —
                ranked counts
              </li>
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
