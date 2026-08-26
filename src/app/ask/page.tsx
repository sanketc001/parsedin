'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { Empty, PageHeader, PersonLine, Section } from '@/components/ui';
import { filterPeople, sortPeople } from '@/lib/query/filters';
import { EXAMPLE_QUESTIONS, parseQuestion } from '@/lib/query/nl';
import { aggregationTitle, runAggregation } from '@/lib/query/aggregate';

const RESULT_LIMIT = 60;

export default function AskPage() {
  const { db, idx, loading } = useData();
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState('');

  const parsed = useMemo(
    () => (submitted.trim() ? parseQuestion(submitted, db) : null),
    [submitted, db],
  );

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

  const ask = (text: string) => {
    setQuestion(text);
    setSubmitted(text);
  };

  return (
    <>
      <PageHeader
        title="Ask"
        subtitle="Plain-English questions, answered locally against your graph"
      />

      <div className="space-y-4 p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(question);
          }}
          className="flex gap-2"
        >
          <input
            className="input flex-1 py-2 text-base"
            placeholder="Who in my network works at Google?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn btn-primary px-4" disabled={loading}>
            Ask
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => ask(example)}
              className="chip hover:border-accent/50 hover:text-accent-soft"
            >
              {example}
            </button>
          ))}
        </div>

        {parsed ? (
          <>
            <Section title="How this was read">
              <div className="space-y-2">
                {parsed.interpretation.length === 0 && !parsed.aggregation ? (
                  <p className="text-sm text-slate-400">
                    Nothing recognizable — showing no constraints.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {parsed.aggregation ? (
                      <span className="chip border-accent/40 bg-accent/10 text-accent-soft">
                        rank by {parsed.aggregation.kind}
                        {parsed.aggregation.scope === 'any' ? ' (ever)' : ''}
                      </span>
                    ) : null}
                    {parsed.interpretation.map((i) => (
                      <span key={i.facet} className="chip">
                        <span className="text-slate-500">{i.facet}:</span>{' '}
                        {i.values.slice(0, 4).join(', ')}
                        {i.values.length > 4 ? ` +${i.values.length - 4}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {parsed.fellBackToSearch ? (
                  <p className="text-xs text-slate-500">
                    No specific pattern matched, so this ran as a full-text search across every
                    profile field.
                  </p>
                ) : null}

                {parsed.unresolved.length > 0 ? (
                  <p className="text-xs text-amber-500/90">
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
                            className="absolute inset-y-0 left-0 rounded bg-accent/10"
                            style={{ width: `${(row.count / max) * 100}%` }}
                            aria-hidden
                          />
                          <span className="relative w-6 shrink-0 font-mono text-xs text-slate-600">
                            {i + 1}
                          </span>
                          <span className="relative min-w-0 flex-1 truncate text-sm text-slate-200">
                            {row.label}
                          </span>
                          <span className="relative shrink-0 font-mono text-sm text-slate-300">
                            {row.count}
                          </span>
                        </div>
                      );
                      return (
                        <li key={row.key}>
                          {row.href ? (
                            <Link href={row.href} className="block hover:brightness-125">
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
                people.length > 0 ? (
                  <Link
                    href={`/people?q=${encodeURIComponent(parsed.filters.q)}`}
                    className="text-xs text-slate-500 hover:text-slate-300"
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
                    <div className="px-3 py-2 text-xs text-slate-500">
                      +{people.length - RESULT_LIMIT} more — refine the question or use the People
                      page.
                    </div>
                  ) : null}
                </div>
              )}
            </Section>
          </>
        ) : (
          <div className="card p-6 text-sm text-slate-400">
            <p className="font-medium text-slate-200">What this understands</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <span className="text-slate-300">works at / is at</span> — current employer
              </li>
              <li>
                <span className="text-slate-300">previously worked at / used to work at / ex-</span>{' '}
                — past employer
              </li>
              <li>
                <span className="text-slate-300">went to / studied at / graduated from</span> —
                school (matches every school containing the phrase, so &quot;IIT&quot; finds all of
                them)
              </li>
              <li>
                <span className="text-slate-300">lives in / based in</span> — location
              </li>
              <li>
                <span className="text-slate-300">knows / skilled in</span> — skills
              </li>
              <li>
                <span className="text-slate-300">which companies / schools / cities …</span> — ranked
                counts
              </li>
              <li>
                Combine with <span className="text-slate-300">and</span>: &quot;who went to IIT and
                works in AI&quot;
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Parsing is rule-based and runs entirely in your browser — no model calls, and the
              reading is always shown so a misinterpretation is visible.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
